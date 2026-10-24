from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import List

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.draft import Draft
from app.schemas.draft import DraftCreate, DraftUpdate, DraftResponse
from app.services.auth_service import get_current_user, get_owned_project, get_owned_resource
from app.services.draft_history import maybe_auto_snapshot

router = APIRouter(tags=["Drafts"])

@router.get("/projects/{project_id}/drafts", response_model=List[DraftResponse])
async def list_drafts(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_project(db, project_id, current_user)
    res = await db.execute(select(Draft).where(Draft.project_id == project_id).order_by(Draft.updated_at.desc()))
    return [DraftResponse.model_validate(d) for d in res.scalars().all()]

@router.post("/projects/{project_id}/drafts", response_model=DraftResponse, status_code=status.HTTP_201_CREATED)
async def create_draft(
    project_id: UUID,
    payload: DraftCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await get_owned_project(db, project_id, current_user)

    # Detect content type from title extension if not explicitly specified
    content_type = payload.content_type
    if payload.title.endswith(".tex"):
        content_type = "latex"
    elif payload.title.endswith(".py"):
        content_type = "python"
    elif payload.title.endswith(".typ"):
        content_type = "typst"

    draft = Draft(
        project_id=project_id,
        title=payload.title,
        content_type=content_type,
        content=payload.content or ""
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    return DraftResponse.model_validate(draft)

@router.get("/drafts/{draft_id}", response_model=DraftResponse)
async def get_draft(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    return DraftResponse.model_validate(draft)

@router.put("/drafts/{draft_id}", response_model=DraftResponse)
async def update_draft(draft_id: UUID, payload: DraftUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")

    if payload.title is not None:
        draft.title = payload.title
    if payload.content_type is not None:
        draft.content_type = payload.content_type
    if payload.content is not None and payload.content != draft.content:
        previous_content = draft.content
        draft.content = payload.content
        draft.version += 1
        await maybe_auto_snapshot(db, draft, previous_content)

    await db.commit()
    await db.refresh(draft)
    return DraftResponse.model_validate(draft)

@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")

    await db.delete(draft)
    await db.commit()
    return None
