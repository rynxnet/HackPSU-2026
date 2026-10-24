from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class BibliographyEntry(BaseModel):
    paper_id: UUID
    key: str
    title: str
    authors: List[str] = []
    year: Optional[int] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    short: str
    formatted: str
    bibtex: str

class BibliographyResponse(BaseModel):
    entries: List[BibliographyEntry]

class ExportTemplate(BaseModel):
    id: str
    name: str
    description: str

class ExportRequest(BaseModel):
    template: str = "article" # one of the LaTeX templates, or "markdown"

class DraftVersionSummary(BaseModel):
    id: UUID
    draft_id: UUID
    version: int
    label: Optional[str] = None
    word_count: int
    created_at: datetime

    class Config:
        from_attributes = True

class DraftVersionDetail(DraftVersionSummary):
    content: str

class DraftVersionCreate(BaseModel):
    label: Optional[str] = None

class ReviewCommentCreate(BaseModel):
    body: str
    reviewer: str = "Reviewer 1"
    anchor_text: Optional[str] = None

class ReviewCommentUpdate(BaseModel):
    body: Optional[str] = None
    reviewer: Optional[str] = None
    anchor_text: Optional[str] = None
    status: Optional[str] = None # open, addressed, declined
    response: Optional[str] = None

class ReviewImportRequest(BaseModel):
    text: str
    reviewer: Optional[str] = None

class ReviewCommentResponse(BaseModel):
    id: UUID
    draft_id: UUID
    reviewer: str
    body: str
    anchor_text: Optional[str] = None
    status: str
    response: str
    position: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class SuggestionResponse(BaseModel):
    suggestion: str

class FigureCreate(BaseModel):
    chart: str = "line" # line, bar, scatter, histogram
    x: str
    y: List[str] = []
    title: Optional[str] = None
    xlabel: Optional[str] = None
    ylabel: Optional[str] = None
    caption: Optional[str] = None
    label: Optional[str] = None

class FigureUpdate(BaseModel):
    chart: Optional[str] = None
    x: Optional[str] = None
    y: Optional[List[str]] = None
    title: Optional[str] = None
    xlabel: Optional[str] = None
    ylabel: Optional[str] = None
    caption: Optional[str] = None

class FigureResponse(BaseModel):
    id: UUID
    project_id: UUID
    dataset_id: Optional[UUID] = None
    dataset_name: Optional[str] = None
    label: str
    caption: str
    spec: Dict[str, Any]
    version: int
    render_error: Optional[str] = None
    image_url: str
    created_at: datetime
    updated_at: datetime

class DatasetReplaceResponse(BaseModel):
    dataset_id: UUID
    row_count: Optional[int] = None
    figures_updated: int
    figure_errors: List[str] = []
