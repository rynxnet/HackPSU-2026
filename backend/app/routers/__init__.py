from app.routers.auth import router as auth_router
from app.routers.projects import router as projects_router
from app.routers.papers import router as papers_router
from app.routers.datasets import router as datasets_router
from app.routers.drafts import router as drafts_router
from app.routers.chat import router as chat_router
from app.routers.search import router as search_router
from app.routers.writing import router as writing_router
from app.routers.figures import router as figures_router

__all__ = [
    "auth_router",
    "projects_router",
    "papers_router",
    "datasets_router",
    "drafts_router",
    "chat_router",
    "search_router",
    "writing_router",
    "figures_router",
]
