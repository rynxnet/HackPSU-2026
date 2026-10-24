from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime

class DraftCreate(BaseModel):
    title: str
    content_type: str = "markdown" # markdown, latex, code
    content: Optional[str] = ""

class DraftUpdate(BaseModel):
    title: Optional[str] = None
    content_type: Optional[str] = None
    content: Optional[str] = None

class DraftResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    content_type: str
    content: str
    version: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
