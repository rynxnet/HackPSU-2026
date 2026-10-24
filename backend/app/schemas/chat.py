from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class CitationItem(BaseModel):
    paper_id: Optional[UUID] = None
    paper_title: str
    section: Optional[str] = None
    page: Optional[int] = None
    snippet: str
    score: Optional[float] = None
    data_source: Optional[str] = "library" # "library" or "data"

class ChatMessageCreate(BaseModel):
    content: str
    session_id: Optional[UUID] = None

class ChatMessageResponse(BaseModel):
    id: UUID
    session_id: UUID
    role: str
    content: str
    citations: List[CitationItem] = []
    tool_calls: List[Dict[str, Any]] = []
    created_at: datetime

    class Config:
        from_attributes = True

class ChatSessionResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: List[ChatMessageResponse] = []

    class Config:
        from_attributes = True
