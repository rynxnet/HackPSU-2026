import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "ResearchIDE Backend"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/researchide"
    SYNC_DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/researchide"

    # Storage: "local" (default for lightweight/dev) or "s3"
    STORAGE_BACKEND: str = "local"
    LOCAL_STORAGE_DIR: str = "/app/storage"

    # S3 / MinIO (optional when STORAGE_BACKEND=s3)
    S3_ENDPOINT_URL: Optional[str] = "http://localhost:9000"
    S3_PUBLIC_URL: Optional[str] = "http://localhost:9000"
    S3_ACCESS_KEY: Optional[str] = "minioadmin"
    S3_SECRET_KEY: Optional[str] = "minioadmin"
    S3_BUCKET_NAME: str = "researchide"
    S3_REGION: str = "us-east-1"

    # GROBID
    GROBID_URL: str = "http://localhost:8070"
    GROBID_TIMEOUT_SECONDS: int = 60

    # Gemini
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_CHAT_MODEL: str = "gemini-flash-latest"
    GEMINI_EMBEDDING_MODEL: str = "gemini-embedding-001"

    # Security & Auth
    SECRET_KEY: str = "super-secret-jwt-and-session-encryption-key-change-in-production-32bytes"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    SESSION_COOKIE_NAME: str = "researchide_session"

    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
