from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import List

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.paper import Paper
from app.models.dataset import Dataset
from app.models.draft import Draft
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectTreeResponse
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/projects", tags=["Projects"])

@router.get("", response_model=List[ProjectResponse])
async def list_projects(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(Project).where(Project.user_id == current_user.id).order_by(Project.updated_at.desc()))
    projects = res.scalars().all()

    output = []
    for p in projects:
        # Get counts
        paper_c = await db.scalar(select(func.count(Paper.id)).where(Paper.project_id == p.id))
        dataset_c = await db.scalar(select(func.count(Dataset.id)).where(Dataset.project_id == p.id))
        draft_c = await db.scalar(select(func.count(Draft.id)).where(Draft.project_id == p.id))

        output.append(ProjectResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            created_at=p.created_at,
            updated_at=p.updated_at,
            paper_count=paper_c or 0,
            dataset_count=dataset_c or 0,
            draft_count=draft_c or 0
        ))
    return output

@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = Project(
        user_id=current_user.id,
        name=payload.name,
        description=payload.description
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    # Automatically create a default draft (e.g. notes.md)
    default_draft = Draft(
        project_id=project.id,
        title="notes.md",
        content_type="markdown",
        content="# Research Notes\n\nWelcome to your ResearchIDE workspace.\n- Use `/library` for academic papers (PDFs/DOI/arXiv)\n- Use `/data` for datasets (CSV, Parquet)\n- Ask questions in the right panel chat!"
    )
    db.add(default_draft)
    await db.commit()

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        updated_at=project.updated_at,
        paper_count=0,
        dataset_count=0,
        draft_count=1
    )

@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(Project).where(Project.id == project_id, Project.user_id == current_user.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    paper_c = await db.scalar(select(func.count(Paper.id)).where(Paper.project_id == p.id))
    dataset_c = await db.scalar(select(func.count(Dataset.id)).where(Dataset.project_id == p.id))
    draft_c = await db.scalar(select(func.count(Draft.id)).where(Draft.project_id == p.id))

    return ProjectResponse(
        id=p.id,
        name=p.name,
        description=p.description,
        created_at=p.created_at,
        updated_at=p.updated_at,
        paper_count=paper_c or 0,
        dataset_count=dataset_c or 0,
        draft_count=draft_c or 0
    )

@router.get("/{project_id}/tree", response_model=ProjectTreeResponse)
async def get_project_file_tree(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Returns hierarchical file tree:
    ├── /library (academic papers)
    ├── /data (CSV / Parquet datasets)
    └── /drafts (LaTeX / Markdown notes)
    """
    res = await db.execute(select(Project).where(Project.id == project_id, Project.user_id == current_user.id))
    proj = res.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Fetch all papers, datasets, drafts
    p_res = await db.execute(select(Paper).where(Paper.project_id == project_id).order_by(Paper.created_at.desc()))
    papers = p_res.scalars().all()

    d_res = await db.execute(select(Dataset).where(Dataset.project_id == project_id).order_by(Dataset.created_at.desc()))
    datasets = d_res.scalars().all()

    dr_res = await db.execute(select(Draft).where(Draft.project_id == project_id).order_by(Draft.updated_at.desc()))
    drafts = dr_res.scalars().all()

    tree = [
        {
            "id": "folder-library",
            "name": "library",
            "type": "folder",
            "path": "/library",
            "children": [
                {
                    "id": str(p.id),
                    "name": f"{p.title[:45]}.pdf" if not p.title.endswith(".pdf") else p.title[:45],
                    "displayName": p.title,
                    "type": "paper",
                    "path": f"/library/{p.id}",
                    "status": p.parsing_status,
                    "year": p.year,
                    "size": p.file_size_bytes,
                    "authors": p.authors,
                    "doi": p.doi,
                    "arxiv_id": p.arxiv_id,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None
                } for p in papers
            ]
        },
        {
            "id": "folder-data",
            "name": "data",
            "type": "folder",
            "path": "/data",
            "children": [
                {
                    "id": str(d.id),
                    "name": d.name,
                    "type": "dataset",
                    "file_type": d.file_type,
                    "path": f"/data/{d.id}",
                    "rowCount": d.row_count,
                    "columnCount": d.column_count,
                    "size": d.file_size_bytes,
                    "updated_at": d.updated_at.isoformat() if d.updated_at else None
                } for d in datasets
            ]
        },
        {
            "id": "folder-drafts",
            "name": "drafts",
            "type": "folder",
            "path": "/drafts",
            "children": [
                {
                    "id": str(dr.id),
                    "name": dr.title,
                    "type": "draft",
                    "contentType": dr.content_type,
                    "path": f"/drafts/{dr.id}",
                    "updated_at": dr.updated_at.isoformat() if dr.updated_at else None
                } for dr in drafts
            ]
        }
    ]

    return ProjectTreeResponse(
        project_id=proj.id,
        project_name=proj.name,
        tree=tree
    )

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(Project).where(Project.id == project_id, Project.user_id == current_user.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(p)
    await db.commit()
    return None
