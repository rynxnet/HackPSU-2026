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
