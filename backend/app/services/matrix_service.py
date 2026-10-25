"""
Literature matrix: a comparison table across papers (rows) and questions (columns),
filled from each paper's own text with the supporting passage kept as evidence.
"""
import io
import logging
import re
from typing import Any, Dict, List, Optional
from uuid import UUID

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.dataset import Dataset
from app.models.paper import Paper, PaperChunk
from app.models.writing import Figure, LiteratureMatrix, MatrixCell
from app.services.citation_service import project_bibliography
from app.services.dataset_service import dataset_service
from app.services.embedding_service import embedding_service
from app.services.figure_service import render_figure, slugify
from app.services.gemini_chat_agent import gemini_chat_agent, GeminiUnavailableError
from app.services.storage_service import storage_service
from app.services.vector_search import vector_search_service

logger = logging.getLogger(__name__)

PAPERS_PER_CALL = 3
EVIDENCE_PER_CELL = 3
COLUMN_TYPES = ("text", "number", "yes_no")


def normalize_columns(columns: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    out, seen = [], set()
    for c in columns or []:
        name = " ".join(str(c.get("name") or "").split())[:80]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        ctype = c.get("type") if c.get("type") in COLUMN_TYPES else "text"
        out.append({"name": name, "question": (c.get("question") or name).strip()[:400], "type": ctype})
    return out


async def matrix_rows(db: AsyncSession, matrix: LiteratureMatrix) -> List[Dict[str, Any]]:
    entries = {e["paper_id"]: e for e in await project_bibliography(db, matrix.project_id)}
    papers = {str(p.id): p for p in (await db.execute(select(Paper).where(Paper.project_id == matrix.project_id))).scalars().all()}
    cells = (await db.execute(select(MatrixCell).where(MatrixCell.matrix_id == matrix.id))).scalars().all()
    by_paper: Dict[str, Dict[str, Any]] = {}
    for c in cells:
        by_paper.setdefault(str(c.paper_id), {})[c.column] = {"value": c.value, "evidence": c.evidence, "edited": bool(c.edited)}
    rows = []
    for pid in matrix.paper_ids or []:
        paper = papers.get(pid)
        if not paper:
            continue
        e = entries.get(pid, {})
        rows.append({"paper_id": pid, "title": paper.title, "key": e.get("key"), "short": e.get("short"), "year": paper.year,
                     "status": paper.parsing_status, "cells": by_paper.get(pid, {})})
    return rows


async def fill_matrix(matrix_id: UUID, only_columns: Optional[List[str]] = None, only_empty: bool = True) -> None:
    """Background job: fills cells PAPERS_PER_CALL papers at a time, recording progress on the matrix."""
    async with AsyncSessionLocal() as db:
        matrix = await db.get(LiteratureMatrix, matrix_id)
        if not matrix:
            return
        columns = [c for c in matrix.columns if not only_columns or c["name"] in only_columns]
        paper_ids = list(matrix.paper_ids or [])
        existing = {(str(c.paper_id), c.column): c for c in (await db.execute(select(MatrixCell).where(MatrixCell.matrix_id == matrix.id))).scalars().all()}
        entries = {e["paper_id"]: e for e in await project_bibliography(db, matrix.project_id)}
        papers = {str(p.id): p for p in (await db.execute(select(Paper).where(Paper.id.in_([UUID(p) for p in paper_ids])))).scalars().all()}

        def needs(pid: str, col: Dict[str, str]) -> bool:
            cell = existing.get((pid, col["name"]))
            if cell and cell.edited:
                return False  # never overwrite a person's correction
            return not only_empty or cell is None or cell.value is None and not cell.evidence

        todo = [pid for pid in paper_ids if pid in papers and any(needs(pid, c) for c in columns)]
        matrix.status = "filling"
        matrix.progress = {"done": 0, "total": len(todo), "message": "Reading papers…"}
        await db.commit()

        # Column questions are the same for every paper, so embed them once
        vectors = await embedding_service.get_query_embeddings([c["question"] for c in columns])
        errors = []
        for start in range(0, len(todo), PAPERS_PER_CALL):
            batch = todo[start:start + PAPERS_PER_CALL]
            evidence: List[Dict[str, Any]] = []
            blocks = []
            for pi, pid in enumerate(batch):
                lines = [f"PAPER P{pi + 1}: {papers[pid].title}"]
                # The opening passages (abstract, introduction) answer most summary questions,
                # but per-question retrieval often misses them, so give them to every column
                opening = (await db.execute(
                    select(PaperChunk).where(PaperChunk.paper_id == UUID(pid)).order_by(PaperChunk.chunk_index.asc()).limit(2)
                )).scalars().all()
                if opening:
                    lines.append("  GENERAL (abstract / introduction, usable for any column):")
                for ch in opening:
                    evidence.append({"page": ch.page_number, "section": ch.section_title, "snippet": ch.chunk_text})
                    lines.append(f"    E{len(evidence)} (p. {ch.page_number}): {ch.chunk_text[:900].replace(chr(10), ' ')}")
                for ci, (col, vec) in enumerate(zip(columns, vectors)):
                    if not needs(pid, col):
                        continue
                    found = await vector_search_service.search_project(db, matrix.project_id, col["question"], paper_ids=[UUID(pid)],
                                                                       top_k=EVIDENCE_PER_CELL, query_vector=vec, diversify=False)
                    lines.append(f"  COLUMN \"{col['name']}\" ({col['type']}): {col['question']}")
                    for f in found:
                        evidence.append(f)
                        snippet = re.sub(r"^\[[^\]]*\]\s*", "", f["snippet"])[:650].replace("\n", " ")
                        lines.append(f"    E{len(evidence)} (p. {f['page']}): {snippet}")
                blocks.append("\n".join(lines))

            prompt = (
                "You are filling a literature comparison table for a systematic review. For each PAPER and each COLUMN, "
                "answer the column's question using ONLY that paper's evidence: its GENERAL passages plus the passages listed under the column.\n"
                "Rules: be concise (a few words, max 15). For number columns give only the number (e.g. 23.5); "
                "for yes_no columns answer \"yes\" or \"no\". If the evidence doesn't answer it, use null. "
                "Cite the single best passage as \"E<n>\".\n\n"
                'Return JSON: {"papers": [{"paper": "P1", "cells": {"<column name>": {"value": ..., "evidence": "E<n>" or null}}}]}\n\n'
                + "\n\n".join(blocks)
            )
            try:
                result = await gemini_chat_agent.generate_json(prompt)
            except (GeminiUnavailableError, ValueError) as e:
                errors.append(str(e))
                logger.warning(f"Matrix fill batch failed: {e}")
                break
            for item in (result.get("papers", []) if isinstance(result, dict) else result if isinstance(result, list) else []):
                try:
                    pid = batch[int(str(item.get("paper", "")).lstrip("Pp")) - 1]
                except (ValueError, IndexError):
                    continue
                for col in columns:
                    if not needs(pid, col):
                        continue
                    raw = (item.get("cells") or {}).get(col["name"]) or {}
                    value = raw.get("value") if isinstance(raw, dict) else raw
                    if isinstance(value, str) and value.strip().lower() in ("", "null", "none", "n/a", "not reported"):
                        value = None
                    if value is not None and col["type"] == "number":
                        m = re.search(r"-?\d+(?:\.\d+)?", str(value))
                        value = m.group(0) if m else None
                    if value is not None and col["type"] == "yes_no":
                        value = "yes" if str(value).strip().lower().startswith("y") else "no"
                    ev = str(raw.get("evidence") or "") if isinstance(raw, dict) else ""
                    ev_obj = None
                    if ev.upper().startswith("E") and ev[1:].isdigit() and 0 < int(ev[1:]) <= len(evidence):
                        f = evidence[int(ev[1:]) - 1]
                        ev_obj = {"page": f["page"], "section": f["section"], "snippet": re.sub(r"^\[[^\]]*\]\s*", "", f["snippet"])[:500]}
                    cell = existing.get((pid, col["name"]))
                    if cell is None:
                        cell = MatrixCell(matrix_id=matrix.id, paper_id=UUID(pid), column=col["name"])
                        db.add(cell)
                        existing[(pid, col["name"])] = cell
                    cell.value = None if value is None else str(value)[:300]
                    cell.evidence = ev_obj
            matrix.progress = {"done": min(start + PAPERS_PER_CALL, len(todo)), "total": len(todo), "message": f"Read {min(start + PAPERS_PER_CALL, len(todo))} of {len(todo)} papers"}
            await db.commit()

        matrix.status = "error" if errors else "idle"
        matrix.progress = {**(matrix.progress or {}), "message": f"Stopped: {errors[0]}" if errors else "Done"}
        await db.commit()


def _cell_text(cell: Optional[Dict[str, Any]]) -> str:
    return "—" if not cell or cell.get("value") in (None, "") else str(cell["value"])


def table_snippets(matrix: LiteratureMatrix, rows: List[Dict[str, Any]]) -> Dict[str, str]:
    """The matrix as a Markdown table and a LaTeX table, with each paper cited."""
    cols = [c["name"] for c in matrix.columns]
    md = ["| Paper | " + " | ".join(cols) + " |", "|" + "---|" * (len(cols) + 1)]
    for r in rows:
        cite = f"[@{r['key']}]" if r.get("key") else r["title"]
        cells = [_cell_text(r["cells"].get(c)).replace("|", "\\|") for c in cols]
        md.append(f"| {r.get('short') or r['title']} {cite} | " + " | ".join(cells) + " |")

    def esc(s: str) -> str:
        return re.sub(r"([&%$#_{}])", r"\\\1", s)

    spec = "l" + "p{0.16\\linewidth}" * len(cols)
    tex = ["\\begin{table*}[htbp]", "  \\centering", "  \\small", f"  \\caption{{{esc(matrix.name)}}}", f"  \\label{{tab:{slugify(matrix.name)}}}",
           f"  \\begin{{tabular}}{{{spec}}}", "    \\hline", "    Paper & " + " & ".join(esc(c) for c in cols) + " \\\\", "    \\hline"]
    for r in rows:
        cite = f"~\\cite{{{r['key']}}}" if r.get("key") else ""
        tex.append(f"    {esc(r.get('short') or r['title'])}{cite} & " + " & ".join(esc(_cell_text(r['cells'].get(c))) for c in cols) + " \\\\")
    tex += ["    \\hline", "  \\end{tabular}", "\\end{table*}"]
    return {"markdown": "\n" + "\n".join(md) + "\n\n", "latex": "\n" + "\n".join(tex) + "\n\n"}


async def save_as_dataset(db: AsyncSession, matrix: LiteratureMatrix) -> Dict[str, Any]:
    """Writes the matrix to a CSV dataset (created once, then replaced) and re-renders figures built from it."""
    rows = await matrix_rows(db, matrix)
    data = []
    for r in rows:
        record = {"paper": r.get("short") or r["title"], "citation_key": r.get("key") or "", "year": r.get("year")}
        for c in matrix.columns:
            v = (r["cells"].get(c["name"]) or {}).get("value")
            if c["type"] == "number":
                try:
                    v = float(v) if v is not None else None
                except ValueError:
                    v = None
            record[c["name"]] = v
        data.append(record)
    df = pd.DataFrame(data)
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    filename = f"matrix-{slugify(matrix.name)}.csv"
    analysis = dataset_service.analyze_dataset_file(csv_bytes, filename)

    dataset = await db.get(Dataset, matrix.dataset_id) if matrix.dataset_id else None
    if dataset is None:
        dataset = Dataset(project_id=matrix.project_id, name=filename, file_type="csv", s3_key="")
        db.add(dataset)
        await db.flush()
    dataset.s3_key = f"datasets/{matrix.project_id}/{dataset.id}.csv"
    storage_service.upload_bytes(csv_bytes, dataset.s3_key)
    dataset.name = filename
    dataset.file_size_bytes = len(csv_bytes)
    dataset.row_count = analysis["row_count"]
    dataset.column_count = analysis["column_count"]
    dataset.column_info = analysis["column_info"]
    dataset.summary_stats = analysis["summary_stats"]
    matrix.dataset_id = dataset.id

    figures = (await db.execute(select(Figure).where(Figure.dataset_id == dataset.id))).scalars().all()
    for fig in figures:
        await render_figure(fig, dataset)
    await db.commit()
    return {"dataset_id": str(dataset.id), "name": filename, "rows": len(data), "figures_updated": len(figures)}
