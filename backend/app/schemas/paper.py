from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class SectionResponse(BaseModel):
    id: UUID
    section_title: str
    section_index: int
    start_page: Optional[int] = None
    end_page: Optional[int] = None
    content: str

    class Config:
        from_attributes = True

class PaperResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    authors: List[Dict[str, Any]] = []
    year: Optional[int] = None
    abstract: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    s3_key: str
    file_size_bytes: Optional[int] = None
    page_count: Optional[int] = None
    parsing_status: str
    created_at: datetime

    class Config:
        from_attributes = True

class PaperDetailResponse(PaperResponse):
    sections: List[SectionResponse] = []
    metadata: Dict[str, Any] = {}

class PaperImportDoiRequest(BaseModel):
    identifier: str # DOI (e.g. 10.1145/...) or arXiv ID (e.g. 1706.03762 or arXiv:1706.03762)
