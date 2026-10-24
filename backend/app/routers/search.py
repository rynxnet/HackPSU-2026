from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from uuid import UUID
from typing import List

from app.database import get_db
from app.models.user import User
from app.models.paper import Paper
from app.models.dataset import Dataset
from app.models.draft import Draft
from app.schemas.search import SearchResultItem, SearchResultResponse
from app.services.auth_service import get_current_user
from app.services.vector_search import vector_search_service

router = APIRouter(tags=["Search"])

@router.get("/projects/{project_id}/search", response_model=SearchResultResponse)
async def global_project_search(
    project_id: UUID,
    q: str = Query(..., min_length=1),
    search_type: str = Query("hybrid", regex="^(hybrid|semantic|keyword)$"),
    limit: int = Query(15, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    results: List[SearchResultItem] = []

    # 1. Search Drafts (Keyword)
    d_res = await db.execute(
        select(Draft).where(
            Draft.project_id == project_id,
            or_(Draft.title.ilike(f"%{q}%"), Draft.content.ilike(f"%{q}%"))
        ).limit(5)
    )
    for draft in d_res.scalars().all():
        snippet = draft.content[:200].replace("\n", " ") if draft.content else "Empty draft"
        results.append(SearchResultItem(
            id=draft.id,
            resource_type="draft",
            title=draft.title,
            snippet=snippet,
            score=0.9,
            metadata={"content_type": draft.content_type, "path": f"/drafts/{draft.id}"}
        ))

    # 2. Search Datasets
    ds_res = await db.execute(
        select(Dataset).where(
            Dataset.project_id == project_id,
            Dataset.name.ilike(f"%{q}%")
        ).limit(5)
    )
    for ds in ds_res.scalars().all():
        cols = [c["name"] for c in ds.column_info[:5]]
        results.append(SearchResultItem(
            id=ds.id,
            resource_type="dataset",
            title=ds.name,
            snippet=f"Dataset with {ds.row_count} rows. Columns: {', '.join(cols)}",
            score=0.85,
            metadata={"file_type": ds.file_type, "path": f"/data/{ds.id}"}
        ))

    # 3. Hybrid search on Papers & Chunks
    paper_chunks = await vector_search_service.search_project(
        db=db,
        project_id=project_id,
        query=q,
        top_k=limit
    )

    for chunk in paper_chunks:
        results.append(SearchResultItem(
            id=chunk["id"],
            resource_type="paper",
            title=chunk["paper_title"],
            snippet=chunk["snippet"][:250] + "...",
            score=chunk["score"],
            metadata={
                "paper_id": str(chunk["paper_id"]),
                "section": chunk["section"],
                "page": chunk["page"],
                "path": f"/library/{chunk['paper_id']}"
            }
        ))

    # Sort combined results
    results.sort(key=lambda x: x.score, reverse=True)

    return SearchResultResponse(
        query=q,
        results=results[:limit]
    )
