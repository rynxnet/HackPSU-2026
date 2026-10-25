import asyncio
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.dataset import Dataset
from app.models.writing import Figure
from app.schemas.writing import FigureCreate, FigureUpdate, FigureResponse, DatasetReplaceResponse
from app.services.auth_service import get_current_user, get_owned_project, get_owned_resource
from app.services.dataset_service import dataset_service
from app.services.figure_service import validate_spec, slugify, render_figure
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Figures"])

def _to_response(fig: Figure, dataset_name: Optional[str] = None) -> FigureResponse:
    return FigureResponse(
        id=fig.id,
        project_id=fig.project_id,
        dataset_id=fig.dataset_id,
        dataset_name=dataset_name,
        label=fig.label,
        caption=fig.caption or "",
        spec=fig.spec or {},
        version=fig.version,
        render_error=fig.render_error,
        # Version in the URL busts browser caches whenever the figure is re-rendered
        image_url=f"/api/v1/figures/{fig.id}/image?v={fig.version}",
        created_at=fig.created_at,
        updated_at=fig.updated_at,
    )

_render = render_figure

async def _unique_label(db: AsyncSession, project_id: UUID, base: str) -> str:
    res = await db.execute(select(Figure.label).where(Figure.project_id == project_id))
    taken = set(res.scalars().all())
    label, n = base, 2
    while label in taken:
        label = f"{base}-{n}"
        n += 1
    return label

@router.get("/projects/{project_id}/figures", response_model=List[FigureResponse])
async def list_figures(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_project(db, project_id, current_user)
    res = await db.execute(
        select(Figure, Dataset.name).outerjoin(Dataset, Dataset.id == Figure.dataset_id)
        .where(Figure.project_id == project_id).order_by(Figure.created_at.asc())
    )
    return [_to_response(fig, name) for fig, name in res.all()]

@router.post("/datasets/{dataset_id}/figures", response_model=FigureResponse, status_code=status.HTTP_201_CREATED)
async def create_figure(dataset_id: UUID, payload: FigureCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    dataset = await get_owned_resource(db, Dataset, dataset_id, current_user, "Dataset")
    columns = [c["name"] for c in (dataset.column_info or [])]
    try:
        spec = validate_spec(payload.model_dump(include={"chart", "x", "y", "title", "xlabel", "ylabel"}), columns)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    y_part = "-".join(spec["y"][:2]) if spec["y"] else "distribution"
    base = slugify(payload.label or payload.title or f"{dataset.name.rsplit('.', 1)[0]}-{y_part}-{spec['x']}")
    caption = (payload.caption or "").strip() or (spec["title"] or f"{', '.join(spec['y']) or spec['x']} by {spec['x']} ({dataset.name}).")
    fig = Figure(
        project_id=dataset.project_id,
        dataset_id=dataset.id,
        label=await _unique_label(db, dataset.project_id, base),
        caption=caption,
        spec=spec,
        version=0,
    )
    db.add(fig)
    await db.flush()
    await _render(fig, dataset)
    if fig.render_error:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not render figure: {fig.render_error}")
    await db.commit()
    await db.refresh(fig)
    return _to_response(fig, dataset.name)

@router.get("/figures/{figure_id}", response_model=FigureResponse)
async def get_figure(figure_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    fig = await get_owned_resource(db, Figure, figure_id, current_user, "Figure")
    name = await db.scalar(select(Dataset.name).where(Dataset.id == fig.dataset_id)) if fig.dataset_id else None
    return _to_response(fig, name)

@router.get("/figures/{figure_id}/image")
async def get_figure_image(figure_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    fig = await get_owned_resource(db, Figure, figure_id, current_user, "Figure")
    if not fig.s3_key:
        raise HTTPException(status_code=404, detail="Figure has not been rendered")
    try:
        data = storage_service.download_file(fig.s3_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Figure image not found in storage")
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, max-age=31536000"})

@router.patch("/figures/{figure_id}", response_model=FigureResponse)
async def update_figure(figure_id: UUID, payload: FigureUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    fig = await get_owned_resource(db, Figure, figure_id, current_user, "Figure")
    if payload.caption is not None:
        fig.caption = payload.caption.strip()
    spec_changes = payload.model_dump(exclude_none=True, exclude={"caption"})
    dataset = None
    if spec_changes or payload.caption is None:
        if not fig.dataset_id:
            raise HTTPException(status_code=400, detail="The source dataset for this figure was deleted")
        dataset = await get_owned_resource(db, Dataset, fig.dataset_id, current_user, "Dataset")
        merged = {**(fig.spec or {}), **spec_changes}
        try:
            fig.spec = validate_spec(merged, [c["name"] for c in (dataset.column_info or [])])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        await _render(fig, dataset)
    await db.commit()
    await db.refresh(fig)
    return _to_response(fig, dataset.name if dataset else None)

@router.delete("/figures/{figure_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_figure(figure_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    fig = await get_owned_resource(db, Figure, figure_id, current_user, "Figure")
    if fig.s3_key:
        storage_service.delete_file(fig.s3_key)
    await db.delete(fig)
    await db.commit()
    return None

@router.post("/datasets/{dataset_id}/replace", response_model=DatasetReplaceResponse)
async def replace_dataset_file(
    dataset_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Swaps in a new version of the data file and re-renders every figure built from it."""
    dataset = await get_owned_resource(db, Dataset, dataset_id, current_user, "Dataset")
    file_bytes = await file.read()
    try:
        analysis = dataset_service.analyze_dataset_file(file_bytes, file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to analyze dataset: {e}")

    old_key = dataset.s3_key
    new_key = f"datasets/{dataset.project_id}/{dataset.id}.{analysis['file_type']}"
    storage_service.upload_bytes(file_bytes, new_key)
    if old_key != new_key:
        storage_service.delete_file(old_key)

    dataset.s3_key = new_key
    dataset.file_type = analysis["file_type"]
    dataset.file_size_bytes = len(file_bytes)
    dataset.row_count = analysis["row_count"]
    dataset.column_count = analysis["column_count"]
    dataset.column_info = analysis["column_info"]
    dataset.summary_stats = analysis["summary_stats"]

    f_res = await db.execute(select(Figure).where(Figure.dataset_id == dataset.id))
    figures = f_res.scalars().all()
    errors = []
    for fig in figures:
        await _render(fig, dataset)
        if fig.render_error:
            errors.append(f"{fig.label}: {fig.render_error}")
    await db.commit()

    return DatasetReplaceResponse(
        dataset_id=dataset.id,
        row_count=dataset.row_count,
        figures_updated=len(figures) - len(errors),
        figure_errors=errors,
    )
