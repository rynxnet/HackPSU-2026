from typing import List, Optional
from contextlib import asynccontextmanager
import asyncio
import time
import re
import logging
import hashlib
import numpy as np
import google.generativeai as genai
from app.config import settings

logger = logging.getLogger(__name__)

# Gemini's batch embed endpoint accepts at most 100 inputs per request
EMBED_BATCH_SIZE = 100
# Keep each request well under the free tier's 30k-tokens-per-minute limit; a single request
# larger than that can never succeed, however long we wait (~4 characters per token)
EMBED_BATCH_TOKEN_BUDGET = 8000
# Seconds to wait between retries when the per-minute embedding quota is exceeded
RATE_LIMIT_WAITS = [20, 40, 60]
# Tokens we allow ourselves per rolling minute. Kept well under the 30k free-tier limit because
# the 4-characters-per-token estimate undercounts PDF text (symbols, math, broken words)
EMBED_TOKENS_PER_MINUTE = 16000


class _TokenRateLimiter:
    """
    Serializes document-embedding requests and paces them under the per-minute token limit,
    so several papers ingesting at once queue up instead of all failing with 429s.
    """

    def __init__(self, tokens_per_minute: int):
        self.capacity = tokens_per_minute
        self.window: List[tuple] = []  # (timestamp, tokens)
        self.lock = asyncio.Lock()

    @asynccontextmanager
    async def reserve(self, tokens: int):
        async with self.lock:
            while True:
                now = time.monotonic()
                self.window = [(t, n) for t, n in self.window if now - t < 60]
                used = sum(n for _, n in self.window)
                if not self.window or used + tokens <= self.capacity:
                    break
                await asyncio.sleep(max(0.5, 60 - (now - self.window[0][0])))
            self.window.append((time.monotonic(), tokens))
            yield


_rate_limiter = _TokenRateLimiter(EMBED_TOKENS_PER_MINUTE)

# Set when the free tier's daily request quota (1,000 inputs per day) runs out
_quota_pause = {"until": 0.0}


class DailyQuotaExhausted(Exception):
    pass

class EmbeddingService:
    def __init__(self):
        self.model_name = settings.GEMINI_EMBEDDING_MODEL or "gemini-embedding-001"
        self.dimension = 768
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)

    @property
    def paused_until(self) -> float:
        return _quota_pause["until"]

    def _embed(self, content, task_type: str, title: Optional[str] = None):
        # The SDK call is synchronous; callers run it in a worker thread
        if time.time() < _quota_pause["until"]:
            raise DailyQuotaExhausted("Embedding daily quota exhausted; paused until it resets")
        try:
            return genai.embed_content(
                model=f"models/{self.model_name}",
                content=content,
                task_type=task_type,
                title=title,
                output_dimensionality=self.dimension
            )["embedding"]
        except Exception as e:
            message = str(e)
            if "PerDay" in message:
                # Retrying a daily limit can't succeed; stop calling until Google says it resets
                m = re.search(r"retry in (\d+(?:\.\d+)?)s", message) or re.search(r"seconds:\s*(\d+)", message)
                wait = float(m.group(1)) if m else 3600.0
                _quota_pause["until"] = time.time() + wait
                logger.warning(f"Embedding daily quota exhausted; pausing embeddings for {wait / 3600:.1f} h (keyword search still works)")
                raise DailyQuotaExhausted(message) from e
            raise

    async def get_embedding(self, text: str, title: Optional[str] = None) -> Optional[List[float]]:
        """
        Embeds a single piece of text using the configured Gemini embedding model.
        Returns None if the API call fails, so callers can skip semantic search
        rather than compare against a meaningless vector.
        """
        if not settings.GEMINI_API_KEY:
            return self._generate_deterministic_fallback(text)

        try:
            task_type = "retrieval_document" if title else "retrieval_query"
            embedding = await asyncio.to_thread(self._embed, text, task_type, title)
            return embedding[:self.dimension]
        except Exception as e:
            logger.error(f"Gemini embedding API call failed: {e}. Falling back to keyword search only.")
            return None

    async def get_query_embeddings(self, texts: List[str]) -> List[Optional[List[float]]]:
        """Embeds several search queries in one paced request (used by the citation audit)."""
        if not texts:
            return []
        if not settings.GEMINI_API_KEY:
            return [self._generate_deterministic_fallback(t) for t in texts]
        results: List[Optional[List[float]]] = []
        for batch in self._token_batches(texts):
            if time.time() < _quota_pause["until"]:
                results.extend([None] * len(batch))  # keyword search only until the quota resets
                continue
            try:
                async with _rate_limiter.reserve(sum(max(1, len(t) // 4) for t in batch)):
                    embs = await asyncio.to_thread(self._embed, batch, "retrieval_query")
                results.extend(e[:self.dimension] for e in embs)
            except Exception as e:
                logger.error(f"Query embedding failed: {e}")
                results.extend([None] * len(batch))
        return results

    async def get_embeddings_batch(self, texts: List[str]) -> List[Optional[List[float]]]:
        """
        Embeds document chunks. With an API key, a batch that still fails after retries gets None
        entries rather than fake vectors: those chunks stay findable by keyword search and can be
        embedded later with reindex_missing(), instead of polluting semantic search with noise.
        """
        if not texts:
            return []

        if not settings.GEMINI_API_KEY:
            return [self._generate_deterministic_fallback(t) for t in texts]

        results: List[Optional[List[float]]] = []
        for batch in self._token_batches(texts):
            embeddings = await self._embed_with_retry(batch)
            if embeddings is None:
                results.extend([None] * len(batch))
            else:
                results.extend(emb[:self.dimension] for emb in embeddings)
        return results

    @staticmethod
    def _token_batches(texts: List[str]):
        """Groups texts into requests bounded by both input count and estimated tokens."""
        batch: List[str] = []
        tokens = 0
        for t in texts:
            est = max(1, len(t) // 4)
            if batch and (len(batch) >= EMBED_BATCH_SIZE or tokens + est > EMBED_BATCH_TOKEN_BUDGET):
                yield batch
                batch, tokens = [], 0
            batch.append(t)
            tokens += est
        if batch:
            yield batch

    async def _embed_with_retry(self, batch: List[str]):
        # The free tier allows ~30k embedding tokens per minute, so importing a few papers
        # back to back routinely hits 429s that clear within a minute
        for attempt, wait in enumerate(RATE_LIMIT_WAITS + [None]):
            if time.time() < _quota_pause["until"]:
                return None  # don't queue for rate-limit budget when the daily quota is gone
            try:
                async with _rate_limiter.reserve(sum(max(1, len(t) // 4) for t in batch)):
                    return await asyncio.to_thread(self._embed, batch, "retrieval_document")
            except DailyQuotaExhausted:
                return None  # leave these chunks for the periodic backfill
            except Exception as e:
                rate_limited = "429" in str(e) or "quota" in str(e).lower()
                if not rate_limited or wait is None:
                    logger.error(f"Batch embedding failed ({len(batch)} chunks): {e}")
                    return None
                logger.warning(f"Embedding rate limited; retrying in {wait}s (attempt {attempt + 1})")
                await asyncio.sleep(wait)
        return None

    def _generate_deterministic_fallback(self, text: str) -> List[float]:
        """
        Generates deterministic 768-dim normalized pseudo-embeddings when API key is missing.
        Ensures identical strings produce identical vectors, allowing offline local testing.
        """
        h = hashlib.sha256(text.encode("utf-8")).digest()
        seed = int.from_bytes(h[:4], "big")
        rng = np.random.default_rng(seed)
        vec = rng.normal(0, 1, self.dimension)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.tolist()

embedding_service = EmbeddingService()
