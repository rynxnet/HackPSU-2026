import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from app.config import settings
from typing import BinaryIO, Optional
import io
import logging

logger = logging.getLogger(__name__)

class StorageService:
    def __init__(self):
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

    def _ensure_bucket(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            try:
                self.client.create_bucket(Bucket=self.bucket)
            except Exception as e:
                logger.warning(f"Failed to auto-create S3 bucket '{self.bucket}': {e}")

    def upload_file(self, file_obj: BinaryIO, s3_key: str, content_type: Optional[str] = None) -> str:
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        self.client.upload_fileobj(file_obj, self.bucket, s3_key, ExtraArgs=extra_args)
        return s3_key

    def upload_bytes(self, data: bytes, s3_key: str, content_type: Optional[str] = None) -> str:
        file_obj = io.BytesIO(data)
        return self.upload_file(file_obj, s3_key, content_type)

    def download_file(self, s3_key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=s3_key)
        return response["Body"].read()

    def get_presigned_url(self, s3_key: str, expiration: int = 3600) -> str:
        # Generate presigned URL for direct viewing or downloading
        try:
            url = self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": s3_key},
                ExpiresIn=expiration
            )
            # If running in local docker network, adjust endpoint for browser access if needed
            if "minio:9000" in url and settings.S3_PUBLIC_URL:
                url = url.replace("http://minio:9000", settings.S3_PUBLIC_URL)
            return url
        except Exception as e:
            logger.error(f"Error generating presigned url for {s3_key}: {e}")
            return f"{settings.S3_PUBLIC_URL}/{self.bucket}/{s3_key}"

    def delete_file(self, s3_key: str) -> bool:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=s3_key)
            return True
        except Exception as e:
            logger.error(f"Error deleting file {s3_key}: {e}")
            return False

storage_service = StorageService()
