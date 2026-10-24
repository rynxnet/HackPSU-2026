from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.draft import Draft
from app.models.writing import DraftVersion

# Autosave runs every keystroke pause, so automatic snapshots are throttled to one per window
AUTO_SNAPSHOT_INTERVAL = timedelta(minutes=5)

def _word_count(text: str) -> int:
    return len((text or "").split())

async def latest_version(db: AsyncSession, draft_id) -> Optional[DraftVersion]:
    res = await db.execute(
        select(DraftVersion).where(DraftVersion.draft_id == draft_id).order_by(DraftVersion.version.desc()).limit(1)
    )
    return res.scalar_one_or_none()

async def snapshot(db: AsyncSession, draft: Draft, label: Optional[str] = None, content: Optional[str] = None) -> DraftVersion:
    """Adds a version holding `content` (defaults to the draft's current content). Caller commits."""
    max_version = await db.scalar(select(func.max(DraftVersion.version)).where(DraftVersion.draft_id == draft.id))
    text = draft.content if content is None else content
    version = DraftVersion(
        draft_id=draft.id,
        version=(max_version or 0) + 1,
        label=label,
        content=text or "",
        word_count=_word_count(text),
    )
    db.add(version)
    return version

async def maybe_auto_snapshot(db: AsyncSession, draft: Draft, previous_content: str) -> None:
    """
    Called before an autosave overwrites the draft. Keeps the content as it was at the start
    of each editing window so history has meaningful checkpoints rather than every keystroke.
    """
    if previous_content == draft.content:
        return
    last = await latest_version(db, draft.id)
    now = datetime.now(timezone.utc)
    if last is None:
        await snapshot(db, draft, label="Initial version", content=previous_content)
    elif last.created_at is None or now - last.created_at >= AUTO_SNAPSHOT_INTERVAL:
        if last.content != previous_content:
            await snapshot(db, draft, content=previous_content)
