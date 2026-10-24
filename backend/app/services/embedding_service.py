from typing import List, Optional
import logging
import hashlib
import numpy as np
import google.generativeai as genai
from app.config import settings

logger = logging.getLogger(__name__)

class EmbeddingService:
    def __init__(self):
        self.model_name = settings.GEMINI_EMBEDDING_MODEL or "text-embedding-004"
        self.dimension = 768
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)

    async def get_embedding(self, text: str, title: Optional[str] = None) -> List[float]:
        """
        Embeds a single piece of text using Gemini API text-embedding-004.
        """
        if not settings.GEMINI_API_KEY:
            return self._generate_deterministic_fallback(text)

        try:
            # google-generativeai embed_content
            task_type = "retrieval_document" if title else "retrieval_query"
            response = genai.embed_content(
                model=f"models/{self.model_name}",
                content=text,
                task_type=task_type,
                title=title
            )
            embedding = response["embedding"]
            return embedding[:self.dimension]
        except Exception as e:
            logger.error(f"Gemini embedding API call failed: {e}. Using deterministic fallback.")
            return self._generate_deterministic_fallback(text)

    async def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        if not settings.GEMINI_API_KEY:
            return [self._generate_deterministic_fallback(t) for t in texts]

        try:
            response = genai.embed_content(
                model=f"models/{self.model_name}",
                content=texts,
                task_type="retrieval_document"
            )
            embeddings = response["embedding"]
            return [emb[:self.dimension] for emb in embeddings]
        except Exception as e:
            logger.error(f"Batch embedding failed: {e}. Falling back to individual or deterministic.")
            results = []
            for t in texts:
                emb = await self.get_embedding(t)
                results.append(emb)
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
