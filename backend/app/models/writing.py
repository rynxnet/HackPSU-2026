import uuid
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base

class DraftVersion(Base):
    """Snapshot of a draft's content, used for history, diffs and restore."""
    __tablename__ = "draft_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    label = Column(String(255), nullable=True) # set for manual "Save version" snapshots
    content = Column(Text, nullable=False, default="")
    word_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ReviewComment(Base):
    """A peer-review comment tracked against a draft."""
    __tablename__ = "review_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    reviewer = Column(String(255), nullable=False, default="Reviewer 1")
    body = Column(Text, nullable=False)
    anchor_text = Column(Text, nullable=True) # passage of the draft the comment refers to
    status = Column(String(50), nullable=False, default="open") # open, addressed, declined
    response = Column(Text, nullable=False, default="")
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DraftAudit(Base):
    """Latest AI citation audit of a draft (cached because each run costs a model call)."""
    __tablename__ = "draft_audits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), ForeignKey("drafts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    content_hash = Column(String(64), nullable=False) # draft content the audit ran against
    results = Column(JSONB, nullable=False, default=list) # per-claim verdicts
    model_used = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LiteratureMatrix(Base):
    """A comparison table: one row per paper, one column per question, filled from the papers' text."""
    __tablename__ = "literature_matrices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    columns = Column(JSONB, nullable=False, default=list) # [{name, question, type: text|number|yes_no}]
    paper_ids = Column(JSONB, nullable=False, default=list) # row order
    status = Column(String(50), nullable=False, default="idle") # idle, filling, error
    progress = Column(JSONB, nullable=False, default=dict) # {done, total, message}
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MatrixCell(Base):
    __tablename__ = "matrix_cells"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matrix_id = Column(UUID(as_uuid=True), ForeignKey("literature_matrices.id", ondelete="CASCADE"), nullable=False, index=True)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    column = Column(String(255), nullable=False)
    value = Column(Text, nullable=True) # null = not reported in the paper
    evidence = Column(JSONB, nullable=True) # {page, section, snippet}
    edited = Column(Integer, nullable=False, default=0) # 1 once a person has corrected it
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Figure(Base):
    """A chart rendered from a dataset; re-rendered automatically when the dataset changes."""
    __tablename__ = "figures"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True, index=True)
    label = Column(String(255), nullable=False) # slug used in drafts: figure:<label>, \ref{fig:<label>}
    caption = Column(Text, nullable=False, default="")
    spec = Column(JSONB, nullable=False, default=dict) # {chart, x, y, title, xlabel, ylabel}
    s3_key = Column(String(512), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    render_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
