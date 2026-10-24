import uuid
from sqlalchemy import Column, String, Text, Integer, BigInteger, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from app.database import Base

class Paper(Base):
    __tablename__ = "papers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(512), nullable=False)
    authors = Column(JSONB, default=list) # e.g. [{"name": "Jane Doe", "affiliation": "MIT"}]
    year = Column(Integer, nullable=True)
    abstract = Column(Text, nullable=True)
    doi = Column(String(255), nullable=True, index=True)
    arxiv_id = Column(String(255), nullable=True, index=True)
    s3_key = Column(String(512), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=True)
    page_count = Column(Integer, nullable=True)
    parsing_status = Column(String(50), default="pending") # pending, processing, completed, failed
    metadata = Column(JSONB, default=dict) # references, figures, extra headers
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project = relationship("Project", back_populates="papers")
    sections = relationship("PaperSection", back_populates="paper", cascade="all, delete-orphan", order_by="PaperSection.section_index")
    chunks = relationship("PaperChunk", back_populates="paper", cascade="all, delete-orphan")


class PaperSection(Base):
    __tablename__ = "paper_sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True)
    section_title = Column(String(255), nullable=False)
    section_index = Column(Integer, default=0, nullable=False)
    start_page = Column(Integer, nullable=True)
    end_page = Column(Integer, nullable=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    paper = relationship("Paper", back_populates="sections")
    chunks = relationship("PaperChunk", back_populates="section")


class PaperChunk(Base):
    __tablename__ = "paper_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    section_id = Column(UUID(as_uuid=True), ForeignKey("paper_sections.id", ondelete="SET NULL"), nullable=True)
    section_title = Column(String(255), nullable=True)
    page_number = Column(Integer, nullable=True)
    chunk_index = Column(Integer, nullable=False)
    chunk_text = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=True)
    embedding = Column(Vector(768), nullable=True) # Gemini text-embedding-004 dimension
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    paper = relationship("Paper", back_populates="chunks")
    section = relationship("PaperSection", back_populates="chunks")
