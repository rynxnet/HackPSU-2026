from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID, uuid4
from typing import List

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.dataset import Dataset
from app.schemas.dataset import DatasetResponse, DatasetPreviewResponse
from app.services.auth_service import get_current_user
from app.services.storage_service import storage_service
from app.services.dataset_service import dataset_service

router = APIRouter(tags=["Datasets"])

@router.post("/projects/{project_id}/datasets/upload", response_model=DatasetResponse)
async def upload_dataset(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    p_res = await db.execute(select(Project).where(Project.id == project_id, Project.user_id == current_user.id))
    if not p_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    file_bytes = await file.read()
    dataset_id = uuid4()
    ext = file.filename.split(".")[-1].lower()
    s3_key = f"datasets/{project_id}/{dataset_id}.{ext}"

    # Analyze dataframe
    try:
        analysis = dataset_service.analyze_dataset_file(file_bytes, file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to analyze dataset: {e}")

    # Upload to storage
    storage_service.upload_bytes(file_bytes, s3_key)

    dataset = Dataset(
        id=dataset_id,
        project_id=project_id,
        name=file.filename,
        file_type=analysis["file_type"],
        s3_key=s3_key,
        file_size_bytes=len(file_bytes),
        row_count=analysis["row_count"],
        column_count=analysis["column_count"],
        column_info=analysis["column_info"],
        summary_stats=analysis["summary_stats"]
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)

    return DatasetResponse.model_validate(dataset)

@router.get("/datasets/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(dataset_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = res.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return DatasetResponse.model_validate(ds)

@router.get("/datasets/{dataset_id}/preview", response_model=DatasetPreviewResponse)
async def get_dataset_preview(
    dataset_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = res.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    preview = dataset_service.get_preview(
        s3_key=ds.s3_key,
        file_type=ds.file_type,
        page=page,
        page_size=page_size
    )

    return DatasetPreviewResponse(
        id=ds.id,
        name=ds.name,
        columns=preview["columns"],
        rows=preview["rows"],
        total_rows=preview["total_rows"],
        page=preview["page"],
        page_size=preview["page_size"]
    )

@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(dataset_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = res.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    storage_service.delete_file(ds.s3_key)
    await db.delete(ds)
    await db.commit()
    return None
