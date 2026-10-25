from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.paper import Paper
from app.models.user import User
from app.models.writing import LiteratureMatrix, MatrixCell
from app.services.auth_service import get_current_user, get_owned_project, get_owned_resource
from app.services import matrix_service

router = APIRouter(tags=["Literature matrix"])


class MatrixColumn(BaseModel):
    name: str
    question: Optional[str] = None
    type: str = "text"  # text, number, yes_no


class MatrixCreate(BaseModel):
    name: str
    columns: List[MatrixColumn]
    paper_ids: Optional[List[UUID]] = None  # default: every parsed paper in the project


class MatrixUpdate(BaseModel):
    name: Optional[str] = None
    columns: Optional[List[MatrixColumn]] = None


class FillRequest(BaseModel):
    columns: Optional[List[str]] = None
    only_empty: bool = True


class CellUpdate(BaseModel):
    paper_id: UUID
    column: str
    value: Optional[str] = None


async def _payload(db: AsyncSession, m: LiteratureMatrix) -> Dict[str, Any]:
    return {
        "id": str(m.id), "project_id": str(m.project_id), "name": m.name, "columns": m.columns,
        "status": m.status, "progress": m.progress or {}, "dataset_id": str(m.dataset_id) if m.dataset_id else None,
        "rows": await matrix_service.matrix_rows(db, m),
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


@router.get("/projects/{project_id}/matrices")
async def list_matrices(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_project(db, project_id, current_user)
    res = await db.execute(select(LiteratureMatrix).where(LiteratureMatrix.project_id == project_id).order_by(LiteratureMatrix.created_at.asc()))
    return [{"id": str(m.id), "name": m.name, "columns": len(m.columns or []), "papers": len(m.paper_ids or []), "status": m.status} for m in res.scalars().all()]


@router.post("/projects/{project_id}/matrices", status_code=status.HTTP_201_CREATED)
async def create_matrix(project_id: UUID, payload: MatrixCreate, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_project(db, project_id, current_user)
    columns = matrix_service.normalize_columns([c.model_dump() for c in payload.columns])
    if not columns:
        raise HTTPException(status_code=400, detail="Add at least one column")
    query = select(Paper.id).where(Paper.project_id == project_id, Paper.parsing_status == "completed").order_by(Paper.created_at.asc())
    available = [str(p) for p in (await db.execute(query)).scalars().all()]
    paper_ids = [str(p) for p in payload.paper_ids if str(p) in available] if payload.paper_ids else available
    if not paper_ids:
        raise HTTPException(status_code=400, detail="No parsed papers to compare yet")
    matrix = LiteratureMatrix(project_id=project_id, name=payload.name.strip() or "Literature matrix", columns=columns, paper_ids=paper_ids)
    db.add(matrix)
    await db.commit()
    await db.refresh(matrix)
    background_tasks.add_task(matrix_service.fill_matrix, matrix.id)
    return await _payload(db, matrix)


@router.get("/matrices/{matrix_id}")
async def get_matrix(matrix_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    return await _payload(db, matrix)


@router.patch("/matrices/{matrix_id}")
async def update_matrix(matrix_id: UUID, payload: MatrixUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    if payload.name is not None:
        matrix.name = payload.name.strip() or matrix.name
    if payload.columns is not None:
        columns = matrix_service.normalize_columns([c.model_dump() for c in payload.columns])
        if not columns:
            raise HTTPException(status_code=400, detail="A matrix needs at least one column")
        removed = {c["name"] for c in matrix.columns} - {c["name"] for c in columns}
        for cell in (await db.execute(select(MatrixCell).where(MatrixCell.matrix_id == matrix.id, MatrixCell.column.in_(removed)))).scalars().all():
            await db.delete(cell)
        matrix.columns = columns
    await db.commit()
    await db.refresh(matrix)
    return await _payload(db, matrix)


@router.post("/matrices/{matrix_id}/fill")
async def fill_matrix(matrix_id: UUID, payload: FillRequest, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    # A fill that hasn't reported progress for 10 minutes died (e.g. a server restart); allow a new one
    stale = matrix.updated_at is not None and (datetime.now(timezone.utc) - matrix.updated_at) > timedelta(minutes=10)
    if matrix.status == "filling" and not stale:
        raise HTTPException(status_code=409, detail="This matrix is already being filled")
    matrix.status = "filling"
    await db.commit()
    await db.refresh(matrix)  # updated_at is set by the database
    background_tasks.add_task(matrix_service.fill_matrix, matrix.id, payload.columns, payload.only_empty)
    return await _payload(db, matrix)


@router.patch("/matrices/{matrix_id}/cells")
async def update_cell(matrix_id: UUID, payload: CellUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """A person's correction: kept as-is and never overwritten by later fills."""
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    if payload.column not in {c["name"] for c in matrix.columns}:
        raise HTTPException(status_code=400, detail="Unknown column")
    cell = (await db.execute(select(MatrixCell).where(MatrixCell.matrix_id == matrix.id, MatrixCell.paper_id == payload.paper_id, MatrixCell.column == payload.column))).scalar_one_or_none()
    if cell is None:
        cell = MatrixCell(matrix_id=matrix.id, paper_id=payload.paper_id, column=payload.column)
        db.add(cell)
    cell.value = (payload.value or "").strip() or None
    cell.edited = 1
    await db.commit()
    return {"ok": True}


@router.post("/matrices/{matrix_id}/dataset")
async def matrix_to_dataset(matrix_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    return await matrix_service.save_as_dataset(db, matrix)


@router.get("/matrices/{matrix_id}/table")
async def matrix_table(matrix_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    return matrix_service.table_snippets(matrix, await matrix_service.matrix_rows(db, matrix))


@router.delete("/matrices/{matrix_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_matrix(matrix_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    matrix = await get_owned_resource(db, LiteratureMatrix, matrix_id, current_user, "Matrix")
    await db.delete(matrix)
    await db.commit()
    return None
