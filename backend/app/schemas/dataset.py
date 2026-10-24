from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class DatasetResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    file_type: str
    s3_key: str
    file_size_bytes: Optional[int] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    column_info: List[Dict[str, Any]] = []
    summary_stats: Dict[str, Any] = {}
    created_at: datetime

    class Config:
        from_attributes = True

class DatasetPreviewResponse(BaseModel):
    id: UUID
    name: str
    columns: List[str]
    rows: List[Dict[str, Any]]
    total_rows: int
    page: int
    page_size: int
