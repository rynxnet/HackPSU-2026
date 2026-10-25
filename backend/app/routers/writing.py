import re
from typing import List, Dict, Any
from uuid import UUID
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.paper import Paper
from app.models.draft import Draft
from app.models.writing import DraftVersion, ReviewComment, Figure
from app.schemas.draft import DraftResponse
from app.schemas.writing import (
    BibliographyResponse, ExportTemplate, ExportRequest,
    DraftVersionSummary, DraftVersionDetail, DraftVersionCreate,
    ReviewCommentCreate, ReviewCommentUpdate, ReviewImportRequest, ReviewCommentResponse, SuggestionResponse,
)
from app.services.auth_service import get_current_user, get_owned_project, get_owned_resource
from app.services.citation_service import bibtex_file, project_bibliography
from app.services.draft_history import snapshot
from app.services import export_service, audit_service
from app.services.figure_service import slugify
from app.services.storage_service import storage_service
from app.services.gemini_chat_agent import gemini_chat_agent, GeminiUnavailableError

router = APIRouter(tags=["Writing"])

COMMENT_STATUSES = ("open", "addressed", "declined")

def _download(data: bytes, filename: str, media_type: str) -> Response:
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
    )

async def _owned_draft_child(db: AsyncSession, model, obj_id: UUID, user: User, label: str):
    """Fetches a DraftVersion / ReviewComment only if the user owns the draft's project."""
    res = await db.execute(
        select(model)
        .join(Draft, Draft.id == model.draft_id)
        .join(Project, Project.id == Draft.project_id)
        .where(model.id == obj_id, Project.user_id == user.id)
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return obj

# ---------------------------------------------------------------------------
# Bibliography
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/bibliography", response_model=BibliographyResponse)
async def get_bibliography(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_project(db, project_id, current_user)
    return BibliographyResponse(entries=await project_bibliography(db, project_id))

@router.get("/projects/{project_id}/bibliography.bib")
async def download_bibtex(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = await get_owned_project(db, project_id, current_user)
    entries = await project_bibliography(db, project_id)
    return _download(bibtex_file(entries).encode("utf-8"), f"{slugify(project.name)}-references.bib", "application/x-bibtex")

# ---------------------------------------------------------------------------
# Export / re-templating
# ---------------------------------------------------------------------------

@router.get("/export/templates", response_model=List[ExportTemplate])
async def get_export_templates():
    return [ExportTemplate(**t) for t in export_service.list_templates()] + [
        ExportTemplate(id="markdown", name="Markdown + reference list", description="Markdown with (Author, Year) citations and a formatted reference list.")
    ]

@router.post("/drafts/{draft_id}/export")
async def export_draft(draft_id: UUID, payload: ExportRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    template = payload.template
    if template != "markdown" and template not in export_service.TEMPLATES:
        raise HTTPException(status_code=400, detail=f"Unknown template '{template}'")

    entries = await project_bibliography(db, draft.project_id)
    known_keys = {e["key"] for e in entries}

    f_res = await db.execute(select(Figure).where(Figure.project_id == draft.project_id))
    figures = {f.label: {"caption": f.caption, "s3_key": f.s3_key} for f in f_res.scalars().all()}
    figure_files: Dict[str, bytes] = {}
    for label, info in figures.items():
        if not info["s3_key"]:
            continue
        try:
            figure_files[f"figures/{label}.png"] = storage_service.download_file(info["s3_key"])
        except FileNotFoundError:
            pass

    base_name = re.sub(r"\.(md|tex|txt|typ)$", "", draft.title, flags=re.I)
    content = draft.content or ""

    if template == "markdown":
        if draft.content_type == "latex":
            raise HTTPException(status_code=400, detail="Markdown export is only available for Markdown drafts")
        md = export_service.markdown_with_references(content, entries)
        md = re.sub(r"\(figure:([a-z0-9-]+)\)", r"(figures/\1.png)", md)
        files = {f"{slugify(base_name)}.md": md.encode("utf-8"), "references.bib": bibtex_file(entries).encode("utf-8"), **figure_files}
        return _download(export_service.build_zip(files), f"{slugify(base_name)}-markdown.zip", "application/zip")

    if draft.content_type == "latex":
        title, author, body = export_service.split_latex_document(content)
        abstract = None
        title = title or export_service.latex_escape(base_name)
    else:
        title, body = export_service.markdown_to_latex(content, known_keys, figures)
        abstract, body = export_service.extract_abstract(body)
        title = export_service._inline(title, known_keys) if title else export_service.latex_escape(base_name)
        author = None
    author = author or export_service.latex_escape(current_user.name or "Author")

    main_tex = export_service.build_latex(template, title, author, body, abstract)
    files = {
        "main.tex": main_tex.encode("utf-8"),
        "references.bib": bibtex_file(entries).encode("utf-8"),
        "README.txt": export_service.README.format(template=export_service.TEMPLATES[template]["name"]).encode("utf-8"),
        **figure_files,
    }
    return _download(export_service.build_zip(files), f"{slugify(base_name)}-{template}.zip", "application/zip")

# ---------------------------------------------------------------------------
# Problems panel ("linter" for the manuscript)
# ---------------------------------------------------------------------------

@router.get("/drafts/{draft_id}/problems")
async def get_problems(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Instant checks plus the cached citation audit. Cheap enough to call after every edit."""
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    return await audit_service.draft_problems(db, draft)

@router.post("/drafts/{draft_id}/audit")
async def audit_draft(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Runs the AI citation audit (one model call) and returns the refreshed problem list."""
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    try:
        return await audit_service.run_audit(db, draft)
    except GeminiUnavailableError as e:
        raise HTTPException(status_code=503, detail=f"Gemini is unavailable right now ({e}). Instant checks still work; try the audit again later.")
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"The audit response couldn't be read: {e}. Try again.")

# ---------------------------------------------------------------------------
# Version history
# ---------------------------------------------------------------------------

@router.get("/drafts/{draft_id}/versions", response_model=List[DraftVersionSummary])
async def list_versions(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    res = await db.execute(select(DraftVersion).where(DraftVersion.draft_id == draft_id).order_by(DraftVersion.version.desc()))
    return [DraftVersionSummary.model_validate(v) for v in res.scalars().all()]

@router.post("/drafts/{draft_id}/versions", response_model=DraftVersionSummary, status_code=status.HTTP_201_CREATED)
async def save_version(draft_id: UUID, payload: DraftVersionCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    version = await snapshot(db, draft, label=(payload.label or "").strip() or "Saved version")
    await db.commit()
    await db.refresh(version)
    return DraftVersionSummary.model_validate(version)

@router.get("/draft-versions/{version_id}", response_model=DraftVersionDetail)
async def get_version(version_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    version = await _owned_draft_child(db, DraftVersion, version_id, current_user, "Version")
    return DraftVersionDetail.model_validate(version)

@router.post("/draft-versions/{version_id}/restore", response_model=DraftResponse)
async def restore_version(version_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    version = await _owned_draft_child(db, DraftVersion, version_id, current_user, "Version")
    draft = await get_owned_resource(db, Draft, version.draft_id, current_user, "Draft")
    if draft.content != version.content:
        # Keep the current text so a restore can always be undone
        await snapshot(db, draft, label=f"Before restoring v{version.version}")
        draft.content = version.content
        draft.version += 1
    await db.commit()
    await db.refresh(draft)
    return DraftResponse.model_validate(draft)

# ---------------------------------------------------------------------------
# Peer review comments
# ---------------------------------------------------------------------------

_REVIEWER_HEADER = re.compile(r"^\s*(?:#+\s*)?\**\s*(reviewer|referee)\s*#?\s*([0-9]+|[A-Za-z])\b[^\n]{0,40}$", re.I)
_ITEM_START = re.compile(r"^\s*(?:\(?\d{1,3}[.)]|[-*•]|(?:comment|point|issue|R)\s*#?\d*\s*[.:)])\s+(.*)$", re.I)
_QUOTED = re.compile(r"[\"“]([^\"”]{20,400})[\"”]")

def parse_review_text(text: str, default_reviewer: str) -> List[Dict[str, str]]:
    """
    Splits a pasted review into individual comments. Understands 'Reviewer 2' headers,
    numbered / bulleted points, and falls back to blank-line separated paragraphs.
    A quoted passage of the manuscript inside a comment becomes its anchor.
    """
    reviewer = default_reviewer
    comments: List[Dict[str, str]] = []
    current: List[str] = []

    def flush():
        body = " ".join(" ".join(current).split())
        if body:
            quoted = _QUOTED.search(body)
            comments.append({"reviewer": reviewer, "body": body, "anchor_text": quoted.group(1).strip() if quoted else None})
        current.clear()

    for line in text.replace("\r\n", "\n").split("\n"):
        header = _REVIEWER_HEADER.match(line)
        if header:
            flush()
            ident = header.group(2)
            reviewer = f"Reviewer {ident.upper() if ident.isalpha() else ident}"
            continue
        item = _ITEM_START.match(line)
        if item:
            flush()
            current.append(item.group(1))
            continue
        if not line.strip():
            flush()
            continue
        current.append(line.strip())
    flush()
    return comments

@router.get("/drafts/{draft_id}/comments", response_model=List[ReviewCommentResponse])
async def list_comments(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    res = await db.execute(select(ReviewComment).where(ReviewComment.draft_id == draft_id).order_by(ReviewComment.position.asc(), ReviewComment.created_at.asc()))
    return [ReviewCommentResponse.model_validate(c) for c in res.scalars().all()]

async def _next_position(db: AsyncSession, draft_id: UUID) -> int:
    return ((await db.scalar(select(func.max(ReviewComment.position)).where(ReviewComment.draft_id == draft_id))) or 0) + 1

@router.post("/drafts/{draft_id}/comments", response_model=ReviewCommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(draft_id: UUID, payload: ReviewCommentCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Comment text is required")
    comment = ReviewComment(
        draft_id=draft_id,
        reviewer=payload.reviewer.strip() or "Reviewer 1",
        body=payload.body.strip(),
        anchor_text=(payload.anchor_text or "").strip() or None,
        position=await _next_position(db, draft_id),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return ReviewCommentResponse.model_validate(comment)

@router.post("/drafts/{draft_id}/comments/import", response_model=List[ReviewCommentResponse], status_code=status.HTTP_201_CREATED)
async def import_comments(draft_id: UUID, payload: ReviewImportRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    parsed = parse_review_text(payload.text, (payload.reviewer or "").strip() or "Reviewer 1")
    if not parsed:
        raise HTTPException(status_code=400, detail="No comments found in the pasted text")
    position = await _next_position(db, draft_id)
    created = []
    for i, item in enumerate(parsed):
        comment = ReviewComment(draft_id=draft_id, position=position + i, **item)
        db.add(comment)
        created.append(comment)
    await db.commit()
    for c in created:
        await db.refresh(c)
    return [ReviewCommentResponse.model_validate(c) for c in created]

@router.patch("/review-comments/{comment_id}", response_model=ReviewCommentResponse)
async def update_comment(comment_id: UUID, payload: ReviewCommentUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = await _owned_draft_child(db, ReviewComment, comment_id, current_user, "Comment")
    if payload.status is not None:
        if payload.status not in COMMENT_STATUSES:
            raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(COMMENT_STATUSES)}")
        comment.status = payload.status
    for field in ("body", "reviewer", "response"):
        value = getattr(payload, field)
        if value is not None:
            setattr(comment, field, value)
    if payload.anchor_text is not None:
        comment.anchor_text = payload.anchor_text.strip() or None
    await db.commit()
    await db.refresh(comment)
    return ReviewCommentResponse.model_validate(comment)

@router.delete("/review-comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(comment_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = await _owned_draft_child(db, ReviewComment, comment_id, current_user, "Comment")
    await db.delete(comment)
    await db.commit()
    return None

@router.post("/review-comments/{comment_id}/suggest", response_model=SuggestionResponse)
async def suggest_response(comment_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = await _owned_draft_child(db, ReviewComment, comment_id, current_user, "Comment")
    draft = await get_owned_resource(db, Draft, comment.draft_id, current_user, "Draft")
    manuscript = (draft.content or "")[:12000]
    prompt = f"""You are helping an academic author respond to peer review.

MANUSCRIPT (may be truncated):
{manuscript}

{"PASSAGE THE REVIEWER REFERS TO:" + chr(10) + comment.anchor_text if comment.anchor_text else ""}

REVIEWER COMMENT ({comment.reviewer}):
{comment.body}

Write the author's response for a response-to-reviewers letter: thank the reviewer briefly, address the point directly,
and state concretely what was or will be changed in the manuscript. Only rely on the manuscript above; if the comment
needs new results or citations, say what will be added rather than inventing them. 2-5 sentences, plain text, no heading."""
    try:
        suggestion = await gemini_chat_agent.generate_text(prompt)
    except GeminiUnavailableError as e:
        raise HTTPException(status_code=503, detail=f"Gemini is unavailable right now ({e}). Try again later.")
    if not suggestion:
        raise HTTPException(status_code=502, detail="Gemini returned an empty suggestion")
    return SuggestionResponse(suggestion=suggestion)

@router.get("/drafts/{draft_id}/response-letter")
async def response_letter(draft_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    draft = await get_owned_resource(db, Draft, draft_id, current_user, "Draft")
    res = await db.execute(select(ReviewComment).where(ReviewComment.draft_id == draft_id).order_by(ReviewComment.position.asc(), ReviewComment.created_at.asc()))
    comments = res.scalars().all()

    title = re.sub(r"\.(md|tex|txt|typ)$", "", draft.title, flags=re.I)
    lines = [
        "# Response to Reviewers",
        "",
        f"**Manuscript:** {title}",
        "",
        "We thank the reviewers for their careful reading and constructive feedback. "
        "Our point-by-point responses follow; reviewer comments are quoted.",
    ]
    status_label = {"open": "Pending", "addressed": "Addressed", "declined": "Respectfully declined"}
    current_reviewer = None
    number = 0
    for c in comments:
        if c.reviewer != current_reviewer:
            current_reviewer = c.reviewer
            number = 0
            lines += ["", f"## {c.reviewer}"]
        number += 1
        lines += ["", f"### Comment {number}", "", "> " + c.body.replace("\n", "\n> ")]
        if c.anchor_text:
            lines += ["", f"*Manuscript passage:* \"{c.anchor_text}\""]
        lines += ["", f"**Response ({status_label.get(c.status, c.status)}):** " + (c.response.strip() or "_Response pending._")]
    return _download(("\n".join(lines) + "\n").encode("utf-8"), f"{slugify(title)}-response-to-reviewers.md", "text/markdown")
