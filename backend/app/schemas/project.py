from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    paper_count: Optional[int] = 0
    dataset_count: Optional[int] = 0
    draft_count: Optional[int] = 0

    class Config:
        from_attributes = True

class TreeItem(BaseModel):
    id: str
    name: str
    path: str
    type: str # folder, paper, dataset, draft
    size: Optional[int] = None
    updated_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None

class ProjectTreeResponse(BaseModel):
    project_id: UUID
    project_name: str
    tree: List[Dict[str, Any]]
