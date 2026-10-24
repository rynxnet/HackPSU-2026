import os
import io
import shutil
import logging
from pathlib import Path
from typing import BinaryIO, Optional
from app.config import settings

logger = logging.getLogger(__name__)

class StorageService:
    def __init__(self):
        self.backend = (settings.STORAGE_BACKEND or "local").lower()
        self.local_dir = Path(settings.LOCAL_STORAGE_DIR or "/app/storage")

        if self.backend == "local":
            self.local_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Using local filesystem storage at: {self.local_dir}")
        else:
            try:
                import boto3
                from botocore.client import Config
                self.bucket = settings.S3_BUCKET_NAME
                self.client = boto3.client(
                    "s3",
                    endpoint_url=settings.S3_ENDPOINT_URL,
                    aws_access_key_id=settings.S3_ACCESS_KEY,
                    aws_secret_access_key=settings.S3_SECRET_KEY,
                    region_name=settings.S3_REGION,
                    config=Config(signature_version="s3v4")
                )
                self._ensure_bucket()
                logger.info(f"Using S3 storage bucket '{self.bucket}' at {settings.S3_ENDPOINT_URL}")
            except Exception as e:
                logger.warning(f"Failed to connect to S3 ({e}), falling back to local filesystem storage.")
                self.backend = "local"
                self.local_dir.mkdir(parents=True, exist_ok=True)

    def _ensure_bucket(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            try:
                self.client.create_bucket(Bucket=self.bucket)
            except Exception as e:
                logger.warning(f"Could not auto-create S3 bucket: {e}")

    def upload_file(self, file_obj: BinaryIO, s3_key: str, content_type: Optional[str] = None) -> str:
        if self.backend == "local":
            dest_path = self.local_dir / s3_key
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, "wb") as f:
                shutil.copyfileobj(file_obj, f)
            return s3_key
        else:
            extra_args = {}
            if content_type:
                extra_args["ContentType"] = content_type
            self.client.upload_fileobj(file_obj, self.bucket, s3_key, ExtraArgs=extra_args)
            return s3_key

    def upload_bytes(self, data: bytes, s3_key: str, content_type: Optional[str] = None) -> str:
        file_obj = io.BytesIO(data)
        return self.upload_file(file_obj, s3_key, content_type)

    def download_file(self, s3_key: str) -> bytes:
        if self.backend == "local":
            file_path = self.local_dir / s3_key
            if not file_path.exists():
                raise FileNotFoundError(f"Stored file {s3_key} not found at {file_path}")
            with open(file_path, "rb") as f:
                return f.read()
        else:
            response = self.client.get_object(Bucket=self.bucket, Key=s3_key)
            return response["Body"].read()

    def get_presigned_url(self, s3_key: str, expiration: int = 3600) -> str:
        if self.backend == "local":
            return f"{settings.API_V1_STR}/storage/{s3_key}"
        try:
            url = self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": s3_key},
                ExpiresIn=expiration
            )
            if "minio:9000" in url and settings.S3_PUBLIC_URL:
                url = url.replace("http://minio:9000", settings.S3_PUBLIC_URL)
            return url
        except Exception:
            return f"{settings.S3_PUBLIC_URL}/{self.bucket}/{s3_key}"

    def delete_file(self, s3_key: str) -> bool:
        if self.backend == "local":
            file_path = self.local_dir / s3_key
            if file_path.exists():
                file_path.unlink()
            return True
        else:
            try:
                self.client.delete_object(Bucket=self.bucket, Key=s3_key)
                return True
            except Exception:
                return False

storage_service = StorageService()
