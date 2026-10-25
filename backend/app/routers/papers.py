from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID, uuid4
from typing import List
import io
import logging
from urllib.parse import quote

logger = logging.getLogger(__name__)

from app.database import get_db, AsyncSessionLocal
from app.models.user import User
from app.models.project import Project
from app.models.paper import Paper, PaperSection
from app.schemas.paper import PaperResponse, PaperDetailResponse, PaperImportDoiRequest, SectionResponse
from app.services.auth_service import get_current_user, get_owned_project, get_owned_resource
from app.services.storage_service import storage_service
from app.services.paper_ingestion import paper_ingestion_service
from app.services.doi_arxiv_service import doi_arxiv_service

router = APIRouter(tags=["Papers"])

async def background_ingest_pipeline(paper_id: UUID, pdf_bytes: bytes, pre_meta=None):
    async with AsyncSessionLocal() as db:
        try:
            await paper_ingestion_service.ingest_paper(db, paper_id, pdf_bytes, pre_meta)
        except Exception:
            # ingest_paper already marks the paper as failed; just record it
            logger.exception(f"Background ingestion failed for paper {paper_id}")

@router.post("/projects/{project_id}/papers/upload", response_model=List[PaperResponse])
async def upload_papers(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await get_owned_project(db, project_id, current_user)

    created_papers = []

    for file in files:
        if not file.filename.lower().endswith(".pdf"):
            continue

        pdf_bytes = await file.read()
        paper_id = uuid4()
        s3_key = f"papers/{project_id}/{paper_id}.pdf"

        # 1. Upload to S3
        storage_service.upload_bytes(pdf_bytes, s3_key, content_type="application/pdf")

        # 2. Create Paper record
        paper = Paper(
            id=paper_id,
            project_id=project_id,
            title=file.filename.replace(".pdf", "").replace("_", " "),
            s3_key=s3_key,
            file_size_bytes=len(pdf_bytes),
            parsing_status="pending"
        )
        db.add(paper)
        created_papers.append((paper, pdf_bytes))

    await db.commit()

    # 3. Trigger background ingestion
    for paper, p_bytes in created_papers:
        await db.refresh(paper)
        background_tasks.add_task(background_ingest_pipeline, paper.id, p_bytes)

    return [PaperResponse.model_validate(p[0]) for p in created_papers]

@router.post("/projects/{project_id}/papers/import-doi", response_model=PaperResponse)
async def import_paper_by_identifier(
    project_id: UUID,
    payload: PaperImportDoiRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    await get_owned_project(db, project_id, current_user)

    metadata, pdf_bytes = await doi_arxiv_service.resolve_identifier(payload.identifier)
    if not metadata:
        raise HTTPException(status_code=400, detail="Could not resolve metadata for the given DOI or arXiv ID")

    paper_id = uuid4()
    s3_key = f"papers/{project_id}/{paper_id}.pdf"

    if pdf_bytes:
        storage_service.upload_bytes(pdf_bytes, s3_key, content_type="application/pdf")
    else:
        # Create empty placeholder if direct open-access PDF couldn't be auto-fetched
        pdf_bytes = b"%PDF-1.4 empty placeholder"
        storage_service.upload_bytes(pdf_bytes, s3_key, content_type="application/pdf")

    paper = Paper(
        id=paper_id,
        project_id=project_id,
        title=metadata.get("title", f"Paper {payload.identifier}"),
        authors=metadata.get("authors", []),
        year=metadata.get("year"),
        abstract=metadata.get("abstract", ""),
        doi=metadata.get("doi"),
        arxiv_id=metadata.get("arxiv_id"),
        s3_key=s3_key,
        file_size_bytes=len(pdf_bytes),
        parsing_status="pending"
    )
    db.add(paper)
    await db.commit()
    await db.refresh(paper)

    if pdf_bytes and len(pdf_bytes) > 200:
        background_tasks.add_task(background_ingest_pipeline, paper.id, pdf_bytes, metadata)

    return PaperResponse.model_validate(paper)

@router.get("/papers/{paper_id}", response_model=PaperDetailResponse)
async def get_paper_details(paper_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    paper = await get_owned_resource(db, Paper, paper_id, current_user, "Paper")

    sec_res = await db.execute(select(PaperSection).where(PaperSection.paper_id == paper_id).order_by(PaperSection.section_index.asc()))
    sections = sec_res.scalars().all()

    return PaperDetailResponse(
        id=paper.id,
        project_id=paper.project_id,
        title=paper.title,
        authors=paper.authors or [],
        year=paper.year,
        abstract=paper.abstract,
        doi=paper.doi,
        arxiv_id=paper.arxiv_id,
        s3_key=paper.s3_key,
        file_size_bytes=paper.file_size_bytes,
        page_count=paper.page_count,
        parsing_status=paper.parsing_status,
        created_at=paper.created_at,
        sections=[SectionResponse.model_validate(s) for s in sections],
        metadata=paper.paper_metadata or {}
    )

@router.get("/papers/{paper_id}/pdf")
async def get_paper_pdf(paper_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    paper = await get_owned_resource(db, Paper, paper_id, current_user, "Paper")

    try:
        data = storage_service.download_file(paper.s3_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="PDF file not found in storage")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        # RFC 5987 encoding so titles with quotes or non-ASCII characters don't break the header
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(paper.title + '.pdf')}"}
    )

@router.post("/papers/{paper_id}/reindex")
async def reindex_paper(paper_id: UUID, all_chunks: bool = False, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Embeds chunks that are missing vectors (or every chunk with all_chunks=true), e.g. after a quota error."""
    await get_owned_resource(db, Paper, paper_id, current_user, "Paper")
    return await paper_ingestion_service.embed_chunks(db, paper_id, only_missing=not all_chunks)

@router.delete("/papers/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_paper(paper_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    paper = await get_owned_resource(db, Paper, paper_id, current_user, "Paper")

    storage_service.delete_file(paper.s3_key)
    await db.delete(paper)
    await db.commit()
    return None
