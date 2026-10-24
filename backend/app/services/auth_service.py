from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.utils.security import decode_access_token
from app.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

async def get_current_user_optional(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    # Check bearer header, or session cookie
    extracted_token = token
    if not extracted_token:
        extracted_token = request.cookies.get(settings.SESSION_COOKIE_NAME)

    if not extracted_token:
        # For development / single-user ease, fallback to demo/admin user
        result = await db.execute(select(User).order_by(User.created_at.asc()).limit(1))
        demo_user = result.scalar_one_or_none()
        if not demo_user:
            demo_user = User(
                email="researcher@researchide.org",
                name="Dr. Alex Rivera"
            )
            db.add(demo_user)
            await db.commit()
            await db.refresh(demo_user)
        return demo_user

    user_id = decode_access_token(extracted_token)
    if not user_id:
        return None

    try:
        res = await db.execute(select(User).where(User.id == UUID(user_id)))
        return res.scalar_one_or_none()
    except Exception:
        return None

async def get_current_user(
    current_user: Optional[User] = Depends(get_current_user_optional)
) -> User:
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user

async def get_owned_project(db: AsyncSession, project_id: UUID, user: User) -> Project:
    res = await db.execute(select(Project).where(Project.id == project_id, Project.user_id == user.id))
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

async def get_owned_resource(db: AsyncSession, model, resource_id: UUID, user: User, label: str):
    """Fetches a project-scoped row (Paper, Dataset, Draft, ChatSession) only if the user owns its project."""
    res = await db.execute(
        select(model)
        .join(Project, Project.id == model.project_id)
        .where(model.id == resource_id, Project.user_id == user.id)
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return obj
