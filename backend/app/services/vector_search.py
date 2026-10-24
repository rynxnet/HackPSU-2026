from typing import List, Dict, Any, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.services.embedding_service import embedding_service
import logging

logger = logging.getLogger(__name__)

class VectorSearchService:
    """
    Performs hybrid retrieval (pgvector cosine similarity + postgres full-text search)
    with Reciprocal Rank Fusion (RRF) ranking.
    """

    async def search_project(
        self,
        db: AsyncSession,
        project_id: UUID,
        query: str,
        paper_ids: Optional[List[UUID]] = None,
        top_k: int = 8,
        rrf_k: int = 60
    ) -> List[Dict[str, Any]]:
        # 1. Embed query
        query_vector = await embedding_service.get_embedding(query)
        vector_str = "[" + ",".join(f"{x:.6f}" for x in query_vector) + "]"

        # Base filter
        paper_filter_sql = ""
        params: Dict[str, Any] = {
            "project_id": str(project_id),
            "query": query,
            "top_k": top_k * 2,
            "vector_str": vector_str
        }

        if paper_ids:
            paper_filter_sql = "AND c.paper_id = ANY(:paper_ids)"
            params["paper_ids"] = [str(pid) for pid in paper_ids]

        # 2. Semantic Vector Search Query
        vector_sql = f"""
            SELECT 
                c.id,
                c.paper_id,
                p.title as paper_title,
                c.section_title,
                c.page_number,
                c.chunk_text,
                (1 - (c.embedding <=> :vector_str::vector)) as similarity
            FROM paper_chunks c
            JOIN papers p ON p.id = c.paper_id
            WHERE c.project_id = :project_id
            {paper_filter_sql}
            AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> :vector_str::vector ASC
            LIMIT :top_k
        """

        # 3. Full-Text Keyword Search Query
        fts_sql = f"""
            SELECT 
                c.id,
                c.paper_id,
                p.title as paper_title,
                c.section_title,
                c.page_number,
                c.chunk_text,
                ts_rank_cd(to_tsvector('english', c.chunk_text), plainto_tsquery('english', :query)) as rank
            FROM paper_chunks c
            JOIN papers p ON p.id = c.paper_id
            WHERE c.project_id = :project_id
            {paper_filter_sql}
            AND to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', :query)
            ORDER BY rank DESC
            LIMIT :top_k
        """

        vector_results = []
        fts_results = []

        try:
            v_res = await db.execute(text(vector_sql), params)
            vector_results = v_res.mappings().all()
        except Exception as e:
            logger.warning(f"Vector search failed (pgvector might be warming up or empty): {e}")

        try:
            f_res = await db.execute(text(fts_sql), params)
            fts_results = f_res.mappings().all()
        except Exception as e:
            logger.warning(f"FTS search failed: {e}")

        # 4. Reciprocal Rank Fusion (RRF)
        scored_items: Dict[str, Dict[str, Any]] = {}

        for rank, row in enumerate(vector_results):
            cid = str(row["id"])
            rrf_score = 1.0 / (rrf_k + rank + 1)
            scored_items[cid] = {
                "id": row["id"],
                "paper_id": row["paper_id"],
                "paper_title": row["paper_title"],
                "section": row["section_title"] or "General",
                "page": row["page_number"] or 1,
                "snippet": row["chunk_text"],
                "score": rrf_score,
                "data_source": "library"
            }

        for rank, row in enumerate(fts_results):
            cid = str(row["id"])
            rrf_score = 1.0 / (rrf_k + rank + 1)
            if cid in scored_items:
                scored_items[cid]["score"] += rrf_score
            else:
                scored_items[cid] = {
                    "id": row["id"],
                    "paper_id": row["paper_id"],
                    "paper_title": row["paper_title"],
                    "section": row["section_title"] or "General",
                    "page": row["page_number"] or 1,
                    "snippet": row["chunk_text"],
                    "score": rrf_score,
                    "data_source": "library"
                }

        # Sort descending by fused score
        sorted_results = sorted(scored_items.values(), key=lambda x: x["score"], reverse=True)
        return sorted_results[:top_k]

vector_search_service = VectorSearchService()
