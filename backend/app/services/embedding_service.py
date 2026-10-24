from typing import List, Optional
import asyncio
import logging
import hashlib
import numpy as np
import google.generativeai as genai
from app.config import settings

logger = logging.getLogger(__name__)

# Gemini's batch embed endpoint accepts at most 100 inputs per request
EMBED_BATCH_SIZE = 100

class EmbeddingService:
    def __init__(self):
        self.model_name = settings.GEMINI_EMBEDDING_MODEL or "gemini-embedding-001"
        self.dimension = 768
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)

    def _embed(self, content, task_type: str, title: Optional[str] = None):
        # The SDK call is synchronous; callers run it in a worker thread
        return genai.embed_content(
            model=f"models/{self.model_name}",
            content=content,
            task_type=task_type,
            title=title,
            output_dimensionality=self.dimension
        )["embedding"]

    async def get_embedding(self, text: str, title: Optional[str] = None) -> List[float]:
        """
        Embeds a single piece of text using the configured Gemini embedding model.
        """
        if not settings.GEMINI_API_KEY:
            return self._generate_deterministic_fallback(text)

        try:
            task_type = "retrieval_document" if title else "retrieval_query"
            embedding = await asyncio.to_thread(self._embed, text, task_type, title)
            return embedding[:self.dimension]
        except Exception as e:
            logger.error(f"Gemini embedding API call failed: {e}. Using deterministic fallback.")
            return self._generate_deterministic_fallback(text)

    async def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        if not settings.GEMINI_API_KEY:
            return [self._generate_deterministic_fallback(t) for t in texts]

        results: List[List[float]] = []
        for start in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = texts[start:start + EMBED_BATCH_SIZE]
            try:
                embeddings = await asyncio.to_thread(self._embed, batch, "retrieval_document")
                results.extend(emb[:self.dimension] for emb in embeddings)
            except Exception as e:
                logger.error(f"Batch embedding failed: {e}. Falling back to deterministic embeddings for this batch.")
                results.extend(self._generate_deterministic_fallback(t) for t in batch)
        return results

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
