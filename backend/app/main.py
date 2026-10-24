import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.routers import (
    auth_router,
    projects_router,
    papers_router,
    datasets_router,
    drafts_router,
    chat_router,
    search_router,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing ResearchIDE Backend...")
    # Auto-create tables in development if needed
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schemas verified.")
    except Exception as e:
        logger.warning(f"Database table verification notice: {e}")
    yield
    logger.info("Shutting down ResearchIDE Backend...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS setup: allow all origins regex for cloud previews (Cloud Shell, Codespaces, localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
api_v1 = settings.API_V1_STR
app.include_router(auth_router, prefix=api_v1)
app.include_router(projects_router, prefix=api_v1)
app.include_router(papers_router, prefix=api_v1)
app.include_router(datasets_router, prefix=api_v1)
app.include_router(drafts_router, prefix=api_v1)
app.include_router(chat_router, prefix=api_v1)
app.include_router(search_router, prefix=api_v1)

@app.get("/health")
@app.get(f"{api_v1}/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION
    }
