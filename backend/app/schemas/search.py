from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID

class SearchQueryRequest(BaseModel):
    query: str
    search_type: str = "hybrid" # hybrid, semantic, keyword
    limit: int = 15

class SearchResultItem(BaseModel):
    id: UUID
    resource_type: str # paper, section, chunk, dataset, draft
    title: str
    snippet: str
    score: float
    metadata: Dict[str, Any] = {}

class SearchResultResponse(BaseModel):
    query: str
    results: List[SearchResultItem]
