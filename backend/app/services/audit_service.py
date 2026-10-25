"""
Paper "linter": finds problems in a draft the way an IDE finds bugs.

Instant checks (no model calls) run on every request:
  unknown citation keys, missing figures, close paraphrase of a source,
  numbers that disagree with the project's datasets, open reviewer comments.
The citation audit (one model call per run, cached) checks each claim against
the paper it cites and against the whole library.
"""
import difflib
import hashlib
import io
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.models.draft import Draft
from app.models.writing import DraftAudit, Figure, ReviewComment
from app.services.citation_service import project_bibliography
from app.services.embedding_service import embedding_service
from app.services.gemini_chat_agent import gemini_chat_agent, GeminiUnavailableError
from app.services.storage_service import storage_service
from app.services.vector_search import vector_search_service

logger = logging.getLogger(__name__)

MAX_AUDIT_CLAIMS = 30
PARAPHRASE_MIN_RUN = 10   # identical consecutive words that count as copied
CITE_GROUP = re.compile(r"\[(@[^\[\]]+)\]")
CITE_ITEM = re.compile(r"@([A-Za-z0-9_:.-]+)\s*(?:,\s*(?:p(?:p|age)?\.?\s*)?(\d+))?")
FACTUAL_SIGNAL = re.compile(
    r"\d|%|\b(show|shows|showed|demonstrat\w*|outperform\w*|achiev\w*|improv\w*|reduc\w*|increas\w*|"
    r"report\w*|found|find|finds|exceed\w*|surpass\w*|fail\w*|succeed\w*|solv\w*|exploit\w*|"
    r"more|less|better|worse|higher|lower|first|state-of-the-art|significant\w*)\b",
    re.I,
)
ABBREVIATIONS = ["et al.", "e.g.", "i.e.", "vs.", "Fig.", "fig.", "p.", "pp.", "Sec.", "Eq.", "approx.", "cf."]


def content_hash(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Splitting the draft into sentences
# ---------------------------------------------------------------------------

def split_sentences(content: str) -> List[Dict[str, Any]]:
    """
    Returns prose sentences with their position. Skips headings, code, display math,
    figure lines and tables. Block quotes are kept but flagged (they're quoted on purpose).
    """
    sentences: List[Dict[str, Any]] = []
    in_code = in_math = False
    offset = 0
    for line in content.split("\n"):
        line_start = offset
        offset += len(line) + 1
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if stripped == "$$":
            in_math = not in_math
            continue
        if in_code or in_math or not stripped:
            continue
        if stripped.startswith(("#", "|", "![", "<!--")) or re.match(r"^(-{3,}|\*{3,})$", stripped):
            continue
        is_quote = stripped.startswith(">")
        body_start = line_start + (len(line) - len(line.lstrip()))
        body = line.lstrip()
        if is_quote:
            body_start += len(body) - len(body.lstrip(">").lstrip())
            body = body.lstrip(">").lstrip()
        body = re.sub(r"^([-*+]|\d+[.)])\s+", lambda m: " " * len(m.group(0)), body)  # list markers

        # Protect abbreviations and citation brackets from the sentence splitter
        protected = body
        for abbr in ABBREVIATIONS:
            protected = protected.replace(abbr, abbr.replace(".", "\x00"))
        protected = CITE_GROUP.sub(lambda m: m.group(0).replace(".", "\x00"), protected)
        protected = re.sub(r"(?<=\d)\.(?=\d)", "\x00", protected)  # decimals like 28.4 aren't sentence ends
        for m in re.finditer(r"[^.!?]+(?:[.!?]+(?:\s*\[[^\]]*\])?[\"”']?|$)", protected):
            raw = body[m.start():m.end()]
            sentence = raw.strip()
            if len(sentence.split()) < 4:
                continue
            start = body_start + m.start() + (len(raw) - len(raw.lstrip()))
            sentences.append({"text": sentence, "start": start, "end": start + len(sentence), "is_quote": is_quote})
    return sentences


def parse_citations(sentence: str) -> List[Dict[str, Any]]:
    cites = []
    for group in CITE_GROUP.finditer(sentence):
        for item in group.group(1).split(";"):
            m = CITE_ITEM.search(item.strip())
            if m and not m.group(1).startswith("fig:"):
                cites.append({"key": m.group(1), "page": int(m.group(2)) if m.group(2) else None, "token": group.group(0)})
    return cites


def strip_markup(sentence: str) -> str:
    s = CITE_GROUP.sub("", sentence)
    s = re.sub(r"[*_`]", "", s)
    return " ".join(s.split())


def _problem(kind: str, severity: str, title: str, message: str, excerpt: str, **extra) -> Dict[str, Any]:
    pid = hashlib.md5(f"{kind}|{excerpt}|{title}".encode()).hexdigest()[:12]
    return {"id": pid, "kind": kind, "severity": severity, "title": title, "message": message, "excerpt": excerpt, **extra}


def _cite_token(key: str, page: Optional[int]) -> str:
    return f"[@{key}, p. {page}]" if page else f"[@{key}]"


def _add_citation(sentence: str, token: str) -> str:
    """Inserts a citation before the sentence's final punctuation."""
    m = re.search(r"([.!?][\"”']?)\s*$", sentence)
    return f"{sentence[:m.start()].rstrip()} {token}{m.group(1)}" if m else f"{sentence} {token}"


def _source(entry: Optional[Dict[str, Any]], chunk: Dict[str, Any]) -> Dict[str, Any]:
    snippet = re.sub(r"^\[[^\]]*\]\s*", "", chunk.get("snippet") or "")
    return {
        "paper_id": str(chunk["paper_id"]),
        "paper_title": chunk.get("paper_title"),
        "key": entry["key"] if entry else None,
        "page": chunk.get("page"),
        "section": chunk.get("section"),
        "snippet": snippet[:400],
    }


# ---------------------------------------------------------------------------
# Instant checks
# ---------------------------------------------------------------------------

def check_citations_and_figures(content: str, sentences, entries, figures: List[Figure]) -> List[Dict[str, Any]]:
    problems = []
    keys = {e["key"] for e in entries}
    for s in sentences:
        for c in parse_citations(s["text"]):
            if c["key"] in keys:
                continue
            close = difflib.get_close_matches(c["key"], list(keys), n=1, cutoff=0.5)
            fix = None
            if close:
                new_token = c["token"].replace(f"@{c['key']}", f"@{close[0]}")
                fix = {"label": f"Use @{close[0]}", "find": c["token"], "replace": new_token}
            problems.append(_problem(
                "unknown_citation", "error", f"Unknown citation @{c['key']}",
                f"No paper in this project has the key @{c['key']}." + (f" Did you mean @{close[0]}?" if close else ""),
                s["text"], match=c["token"], fix=fix,
            ))
    labels = {f.label for f in figures}
    for m in re.finditer(r"^!\[[^\]]*\]\(figure:([a-z0-9-]+)\)", content, re.M):
        if m.group(1) not in labels:
            problems.append(_problem("missing_figure", "error", f"Missing figure {m.group(1)}",
                                     "This figure was deleted or never created, so it will be missing from the export.",
                                     m.group(0), match=m.group(0)))
    for m in re.finditer(r"@fig:([a-z0-9-]+)", content):
        if m.group(1) not in labels:
            problems.append(_problem("missing_figure", "warning", f"Reference to unknown figure {m.group(1)}",
                                     "The text refers to a figure that doesn't exist.", m.group(0), match=m.group(0)))
    return problems


async def check_paraphrase(db: AsyncSession, project_id, sentences, entries) -> List[Dict[str, Any]]:
    """Flags sentences that reuse a long run of words from a source without quotation marks."""
    problems = []
    by_paper = {e["paper_id"]: e for e in entries}
    for s in sentences:
        if s["is_quote"]:
            continue
        plain = strip_markup(s["text"])
        words = re.findall(r"\w+", plain.lower())
        if len(words) < PARAPHRASE_MIN_RUN:
            continue
        # Text already inside quotation marks is a deliberate quote
        quoted = " ".join(re.findall(r"[\"“]([^\"”]+)[\"”]", plain)).lower()
        try:
            async with db.begin_nested():
                rows = (await db.execute(text("""
                    SELECT c.paper_id, p.title AS paper_title, c.page_number, c.section_title, c.chunk_text
                    FROM paper_chunks c JOIN papers p ON p.id = c.paper_id
                    WHERE c.project_id = :pid
                      AND to_tsvector('english', c.chunk_text) @@ NULLIF(replace(plainto_tsquery('english', :q)::text, ' & ', ' | '), '')::tsquery
                    ORDER BY ts_rank_cd(to_tsvector('english', c.chunk_text), NULLIF(replace(plainto_tsquery('english', :q)::text, ' & ', ' | '), '')::tsquery) DESC
                    LIMIT 15
                """), {"pid": str(project_id), "q": plain})).mappings().all()
        except Exception as e:
            logger.warning(f"Paraphrase candidate search failed: {e}")
            continue
        best = None
        for r in rows:
            src_words = re.findall(r"\w+", (r["chunk_text"] or "").lower())
            m = difflib.SequenceMatcher(None, words, src_words, autojunk=False).find_longest_match(0, len(words), 0, len(src_words))
            if m.size >= PARAPHRASE_MIN_RUN and (not best or m.size > best[0]):
                best = (m.size, r, m)
        if not best:
            continue
        size, r, m = best
        run_text = " ".join(words[m.a:m.a + size])
        if run_text in quoted:
            continue
        entry = by_paper.get(str(r["paper_id"]))
        src_words_raw = (r["chunk_text"] or "").split()
        cite = parse_citations(s["text"])
        fix = None
        if entry and not any(c["key"] == entry["key"] for c in cite):
            fix = {"label": f"Cite {entry['short']}", "find": s["text"], "replace": _add_citation(s["text"], _cite_token(entry["key"], r["page_number"]))}
        problems.append(_problem(
            "close_paraphrase", "warning", f"{size} words copied from {entry['short'] if entry else r['paper_title']}",
            f"This sentence repeats {size} consecutive words from the source. Put the copied wording in quotation marks "
            f"with a citation, or rephrase it in your own words.",
            s["text"], match=None, fix=fix,
            source={"paper_id": str(r["paper_id"]), "paper_title": r["paper_title"], "key": entry["key"] if entry else None,
                    "page": r["page_number"], "section": r["section_title"],
                    "snippet": " ".join(src_words_raw[max(0, m.b - 5): m.b + size + 5])[:400]},
        ))
    return problems


def _load_datasets(datasets: List[Dataset]) -> List[Tuple[Dataset, pd.DataFrame]]:
    out = []
    for ds in datasets:
        try:
            buf = io.BytesIO(storage_service.download_file(ds.s3_key))
            df = pd.read_parquet(buf) if ds.file_type == "parquet" else pd.read_csv(buf, sep="\t" if ds.file_type == "tsv" else ",", nrows=5000)
            out.append((ds, df))
        except Exception as e:
            logger.warning(f"Skipping dataset {ds.name} in data check: {e}")
    return out


def check_data_numbers(sentences, frames: List[Tuple[Dataset, pd.DataFrame]]) -> List[Dict[str, Any]]:
    """
    For sentences that name a row of a dataset (e.g. a model name) and state a number,
    checks the number against that row. Flags values that are close to, but not equal to,
    a value in the data (likely stale or mistyped results).
    """
    problems = []
    for s in sentences:
        body = CITE_GROUP.sub("", s["text"])
        numbers = [(m.group(0), float(m.group(0)), m.start()) for m in re.finditer(r"(?<![\w.])\d+(?:\.\d+)?(?![\w.]*\d)", body)]
        numbers = [(raw, v, pos) for raw, v, pos in numbers if not (raw.isdigit() and 1900 <= v <= 2100)]
        if not numbers:
            continue
        lower = body.lower()
        for ds, df in frames:
            # pandas 3 gives text columns a dedicated string dtype instead of object
            label_cols = [c for c in df.columns if pd.api.types.is_string_dtype(df[c]) or df[c].dtype == object]
            num_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
            if not label_cols or not num_cols:
                continue
            # Where each row's label (e.g. a model name) is mentioned in the sentence
            mentions = []
            for _, row in df.iterrows():
                for c in label_cols:
                    lab = row[c]
                    if isinstance(lab, str) and len(lab) >= 3:
                        for lm in re.finditer(rf"(?<![\w-]){re.escape(lab.lower())}(?![\w-])", lower):
                            mentions.append((lm.start(), lm.end(), lab, row))
            if not mentions:
                continue
            for raw, v, pos in numbers:
                # Pair each number with the closest label named before it ("X reaches 28.4 while Y reaches 24.1")
                before = [m for m in mentions if m[1] <= pos]
                _, _, label, row = max(before, key=lambda m: m[1]) if before else min(mentions, key=lambda m: abs(m[0] - pos))
                values = {c: float(row[c]) for c in num_cols if pd.notna(row[c])}
                decimals = len(raw.split(".")[1]) if "." in raw else 0
                if any(round(x, decimals) == v for x in values.values()):
                    continue  # matches the data
                # Prefer a column the sentence mentions by name, else the closest value
                named = [c for c in values if c.lower().replace("_", " ") in lower]
                candidates = named or list(values)
                if not candidates:
                    continue
                col = min(candidates, key=lambda c: abs(values[c] - v))
                actual = values[col]
                if actual == 0 or abs(actual - v) / abs(actual) > 0.25:
                    continue  # probably a different quantity
                shown = f"{actual:.{decimals}f}" if decimals else (str(int(actual)) if actual.is_integer() else str(actual))
                problems.append(_problem(
                    "data_mismatch", "error", f"{raw} doesn't match {ds.name}",
                    f"The text says {raw} for {label}, but {ds.name} has {col} = {shown}.",
                    s["text"], match=raw,
                    fix={"label": f"Use {shown}", "find": s["text"], "replace": s["text"].replace(raw, shown, 1)},
                    dataset={"id": str(ds.id), "name": ds.name, "row": label, "column": col, "value": shown},
                ))
    return problems


# ---------------------------------------------------------------------------
# AI citation audit
# ---------------------------------------------------------------------------

def _claim_candidates(sentences, known_keys: set) -> List[Dict[str, Any]]:
    # Claims citing a non-existent key are already reported as unknown citations
    cited = [s for s in sentences if parse_citations(s["text"])
             and all(c["key"] in known_keys for c in parse_citations(s["text"]))]
    uncited = [s for s in sentences if not parse_citations(s["text"]) and not s["is_quote"] and len(s["text"].split()) >= 8]
    # Sentences with factual signals (numbers, "outperforms", ...) first; the model labels the rest
    uncited.sort(key=lambda s: 0 if FACTUAL_SIGNAL.search(strip_markup(s["text"])) else 1)
    return (cited + uncited)[:MAX_AUDIT_CLAIMS]


async def run_claim_audit(db: AsyncSession, draft: Draft) -> Tuple[List[Dict[str, Any]], str]:
    """Checks each claim against its cited source and the wider library. Returns (results, model_note)."""
    entries = await project_bibliography(db, draft.project_id)
    by_key = {e["key"]: e for e in entries}
    by_paper = {e["paper_id"]: e for e in entries}
    claims = _claim_candidates(split_sentences(draft.content or ""), set(by_key))
    if not claims:
        return [], "no claims"

    vectors = await embedding_service.get_query_embeddings([strip_markup(c["text"]) for c in claims])
    evidence: List[Dict[str, Any]] = []   # flat list, referenced as E1, E2, ...
    blocks = []
    for i, (claim, vec) in enumerate(zip(claims, vectors)):
        query = strip_markup(claim["text"])
        cites = parse_citations(claim["text"])
        cited_ids = [by_key[c["key"]]["paper_id"] for c in cites if c["key"] in by_key]
        found: List[Dict[str, Any]] = []
        if cited_ids:
            found += await vector_search_service.search_project(db, draft.project_id, query, paper_ids=cited_ids, top_k=3, query_vector=vec, diversify=False)
        others = await vector_search_service.search_project(db, draft.project_id, query, top_k=3, query_vector=vec)
        seen = {str(f["id"]) for f in found}
        found += [o for o in others if str(o["id"]) not in seen][:3]
        claim["evidence_ids"] = []
        lines = []
        for f in found:
            evidence.append(f)
            eid = len(evidence)
            claim["evidence_ids"].append(eid)
            key = by_paper.get(str(f["paper_id"]), {}).get("key", "?")
            text_ = re.sub(r"^\[[^\]]*\]\s*", "", f["snippet"])[:700].replace("\n", " ")
            lines.append(f"  E{eid} [@{key}, p. {f['page']}] {text_}")
        cited_str = ", ".join(f"@{c['key']}" for c in cites) or "none"
        blocks.append(f"CLAIM {i + 1} (cites: {cited_str}): {query}\n" + ("\n".join(lines) or "  (no evidence found)"))

    prompt = (
        "You are auditing citations in a research manuscript. For each CLAIM, decide using ONLY the evidence passages "
        "listed under it (E-numbers) whether the claim is supported.\n\n"
        "Verdicts:\n"
        "- supported: an evidence passage clearly states this claim\n"
        "- partially_supported: evidence supports part of it, but some detail (a number, scope, or strength) goes beyond it\n"
        "- unsupported: none of the evidence states this claim\n"
        "- author_claim: the authors' own contribution, plan, or opinion (e.g. 'we propose', 'in this review we'), so no citation is needed\n"
        "- not_factual: not a factual claim\n\n"
        "Return a JSON array, one object per claim: "
        '{"claim": <number>, "verdict": "...", "evidence": "E<n>" or null (the single best supporting passage), '
        '"explanation": "<one sentence>"}\n\n'
        + "\n\n".join(blocks)
    )
    raw = await gemini_chat_agent.generate_json(prompt)
    verdicts = raw if isinstance(raw, list) else raw.get("claims", []) if isinstance(raw, dict) else []

    results = []
    for v in verdicts:
        try:
            claim = claims[int(v.get("claim")) - 1]
        except (TypeError, ValueError, IndexError):
            continue
        best = None
        ev = str(v.get("evidence") or "")
        if ev.upper().startswith("E") and ev[1:].isdigit() and 0 < int(ev[1:]) <= len(evidence):
            best = evidence[int(ev[1:]) - 1]
        results.append({
            "sentence": claim["text"],
            "verdict": v.get("verdict"),
            "explanation": v.get("explanation") or "",
            "cites": [c["key"] for c in parse_citations(claim["text"])],
            "best": _source(by_paper.get(str(best["paper_id"])), best) if best else None,
        })
    return results, "ok"


def audit_problems(results: List[Dict[str, Any]], content: str, entries) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Turns cached audit verdicts into problems, skipping sentences that have since been edited."""
    by_key = {e["key"]: e for e in entries}
    problems, counts = [], {"claims": 0, "supported": 0, "misattributed": 0, "unsupported": 0, "uncited": 0, "partial": 0}
    for r in results:
        sentence, verdict, best = r["sentence"], r.get("verdict"), r.get("best")
        if sentence not in content or verdict in ("author_claim", "not_factual", None):
            continue
        counts["claims"] += 1
        cites = r.get("cites") or []
        best_key = best.get("key") if best else None
        if cites:
            if verdict == "supported" and best_key in cites:
                counts["supported"] += 1
                continue
            if verdict in ("supported", "partially_supported") and best_key and best_key not in cites:
                counts["misattributed"] += 1
                old = next((c for c in parse_citations(sentence)), None)
                fix = None
                if old:
                    new_sentence = sentence.replace(old["token"], _cite_token(best_key, best.get("page")), 1)
                    fix = {"label": f"Cite {by_key.get(best_key, {}).get('short', best_key)} instead", "find": sentence, "replace": new_sentence}
                problems.append(_problem("misattributed", "warning", "Cited source doesn't say this",
                                         f"The passage supporting this claim is in @{best_key}, not {', '.join('@' + c for c in cites)}. {r['explanation']}",
                                         sentence, source=best, fix=fix))
                continue
            if verdict == "partially_supported":
                counts["partial"] += 1
                problems.append(_problem("overstated", "warning", "Claim goes beyond the source",
                                         r["explanation"] or "The source supports only part of this claim.", sentence, source=best))
                continue
            counts["unsupported"] += 1
            problems.append(_problem("unsupported", "error", "Citation doesn't support this claim",
                                     r["explanation"] or "None of the cited text states this.", sentence, source=best))
        else:
            if verdict in ("supported", "partially_supported") and best_key:
                counts["uncited"] += 1
                fix = {"label": f"Cite {by_key.get(best_key, {}).get('short', best_key)}", "find": sentence,
                       "replace": _add_citation(sentence, _cite_token(best_key, best.get("page")))}
                problems.append(_problem("uncited", "info", "Claim needs a citation",
                                         f"This reads as a factual claim and your library supports it. {r['explanation']}",
                                         sentence, source=best, fix=fix))
            else:
                counts["unsupported"] += 1
                problems.append(_problem("unsupported", "warning", "Uncited claim with no support in your library",
                                         r["explanation"] or "Add a source, or rephrase it as your own finding.", sentence, source=best))
    return problems, counts


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def draft_problems(db: AsyncSession, draft: Draft) -> Dict[str, Any]:
    content = draft.content or ""
    sentences = split_sentences(content)
    entries = await project_bibliography(db, draft.project_id)
    figures = (await db.execute(select(Figure).where(Figure.project_id == draft.project_id))).scalars().all()
    datasets = (await db.execute(select(Dataset).where(Dataset.project_id == draft.project_id))).scalars().all()

    problems = check_citations_and_figures(content, sentences, entries, figures)
    problems += await check_paraphrase(db, draft.project_id, sentences, entries)
    problems += check_data_numbers(sentences, _load_datasets(datasets))

    audit = (await db.execute(select(DraftAudit).where(DraftAudit.draft_id == draft.id))).scalar_one_or_none()
    audit_info: Dict[str, Any] = {"ran": False}
    if audit:
        audit_list, counts = audit_problems(audit.results or [], content, entries)
        problems += audit_list
        audit_info = {"ran": True, "stale": audit.content_hash != content_hash(content), "audited_at": audit.created_at.isoformat() if audit.created_at else None, **counts}

    open_comments = (await db.execute(select(ReviewComment).where(ReviewComment.draft_id == draft.id, ReviewComment.status == "open"))).scalars().all()
    if open_comments:
        problems.append(_problem("open_review", "info", f"{len(open_comments)} reviewer comment{'s' if len(open_comments) != 1 else ''} still open",
                                 "Respond to or resolve them in the Review panel before resubmitting.", ""))

    order = {"error": 0, "warning": 1, "info": 2}
    problems.sort(key=lambda p: (order.get(p["severity"], 3), content.find(p["excerpt"]) if p["excerpt"] else 10**9))
    summary = {
        "errors": sum(p["severity"] == "error" for p in problems),
        "warnings": sum(p["severity"] == "warning" for p in problems),
        "infos": sum(p["severity"] == "info" for p in problems),
        "sentences": len(sentences),
        "audit": audit_info,
    }
    return {"summary": summary, "problems": problems}


async def run_audit(db: AsyncSession, draft: Draft) -> Dict[str, Any]:
    results, _ = await run_claim_audit(db, draft)
    audit = (await db.execute(select(DraftAudit).where(DraftAudit.draft_id == draft.id))).scalar_one_or_none()
    if not audit:
        audit = DraftAudit(draft_id=draft.id, content_hash="", results=[])
        db.add(audit)
    audit.content_hash = content_hash(draft.content or "")
    audit.results = results
    await db.commit()
    return await draft_problems(db, draft)
