import uuid
from sqlalchemy import Column, String, BigInteger, Integer, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base

class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False) # csv, parquet, tsv, json
    s3_key = Column(String(512), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=True)
    row_count = Column(BigInteger, nullable=True)
    column_count = Column(Integer, nullable=True)
    column_info = Column(JSONB, default=list) # [{name, type, sample_values}]
    summary_stats = Column(JSONB, default=dict) # descriptive statistics
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project = relationship("Project", back_populates="datasets")
