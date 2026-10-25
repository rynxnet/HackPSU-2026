import re
import unicodedata
from typing import Any, Dict, List, Optional

from app.models.paper import Paper

# Words skipped when picking the title word for a citation key
_STOPWORDS = {"a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "is", "are", "towards", "toward"}

_LATEX_SPECIALS = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}

def latex_escape(text: str) -> str:
    return "".join(_LATEX_SPECIALS.get(ch, ch) for ch in text or "")

def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")

def author_names(paper: Paper) -> List[str]:
    names = []
    for a in paper.authors or []:
        name = a.get("name") if isinstance(a, dict) else str(a)
        if name and name.strip():
            names.append(name.strip())
    return names

def _split_name(name: str):
    """Returns (given, family) for 'Given Family' or 'Family, Given'."""
    if "," in name:
        family, given = [p.strip() for p in name.split(",", 1)]
        return given, family
    parts = name.split()
    if len(parts) == 1:
        return "", parts[0]
    return " ".join(parts[:-1]), parts[-1]

def _base_key(paper: Paper) -> str:
    names = author_names(paper)
    family = _split_name(names[0])[1] if names else ""
    title_words = [w for w in re.findall(r"[A-Za-z0-9]+", _ascii(paper.title or "")) if w.lower() not in _STOPWORDS]
    word = title_words[0].lower() if title_words else ""
    family = re.sub(r"[^a-z]", "", _ascii(family).lower())
    key = f"{family}{paper.year or ''}{word}" if family else f"{word}{paper.year or ''}"
    return key or "ref"

def build_bibliography(papers: List[Paper]) -> List[Dict[str, Any]]:
    """
    Builds one entry per paper with a citation key that is unique within the project.
    Papers must be ordered consistently (oldest first) so keys stay stable as papers are added.
    """
    entries = []
    used: Dict[str, int] = {}
    for paper in papers:
        base = _base_key(paper)
        n = used.get(base, 0)
        used[base] = n + 1
        key = base if n == 0 else f"{base}{chr(ord('a') + n)}"
        entries.append({
            "paper_id": str(paper.id),
            "key": key,
            "title": paper.title,
            "authors": author_names(paper),
            "year": paper.year,
            "doi": paper.doi,
            "arxiv_id": paper.arxiv_id,
            "short": short_citation(paper),
            "formatted": formatted_reference(paper),
            "bibtex": bibtex_entry(paper, key),
        })
    return entries

def short_citation(paper: Paper) -> str:
    """In-text form, e.g. 'Vaswani et al., 2017'."""
    names = author_names(paper)
    families = [_split_name(n)[1] for n in names]
    if not families:
        who = paper.title if len(paper.title or "") <= 40 else (paper.title[:37] + "...")
    elif len(families) == 1:
        who = families[0]
    elif len(families) == 2:
        who = f"{families[0]} & {families[1]}"
    else:
        who = f"{families[0]} et al."
    return f"{who}, {paper.year}" if paper.year else who

def formatted_reference(paper: Paper) -> str:
    """APA-style reference list entry."""
    names = author_names(paper)
    formatted_names = []
    for n in names[:20]:
        given, family = _split_name(n)
        initials = " ".join(f"{g[0]}." for g in given.replace("-", " ").split() if g)
        formatted_names.append(f"{family}, {initials}".strip().rstrip(","))
    if len(formatted_names) > 1:
        authors = ", ".join(formatted_names[:-1]) + ", & " + formatted_names[-1]
    else:
        authors = formatted_names[0] if formatted_names else ""
    year = f"({paper.year})" if paper.year else "(n.d.)"
    title = (paper.title or "Untitled").rstrip(".")
    link = ""
    if paper.doi:
        link = f" https://doi.org/{paper.doi}"
    elif paper.arxiv_id:
        link = f" https://arxiv.org/abs/{paper.arxiv_id}"
    head = f"{authors} {year}." if authors else f"{title}. {year}."
    body = "" if not authors else f" {title}."
    return f"{head}{body}{link}".strip()

def bibtex_entry(paper: Paper, key: str) -> str:
    names = author_names(paper)
    fields = [("title", "{" + latex_escape(paper.title or "Untitled") + "}")]
    if names:
        fields.append(("author", " and ".join(latex_escape(n) for n in names)))
    if paper.year:
        fields.append(("year", str(paper.year)))
    if paper.doi:
        fields.append(("doi", latex_escape(paper.doi)))
    entry_type = "article" if paper.doi else "misc"
    if paper.arxiv_id:
        fields += [("eprint", paper.arxiv_id), ("archivePrefix", "arXiv"), ("url", f"https://arxiv.org/abs/{paper.arxiv_id}")]
    elif paper.doi:
        fields.append(("url", f"https://doi.org/{paper.doi}"))
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields)
    return f"@{entry_type}{{{key},\n{body}\n}}"

def bibtex_file(entries: List[Dict[str, Any]]) -> str:
    return "\n\n".join(e["bibtex"] for e in entries) + "\n"

def find_entry(entries: List[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    return next((e for e in entries if e["key"] == key), None)

async def project_bibliography(db, project_id) -> List[Dict[str, Any]]:
    """Bibliography for a project. Oldest papers first so citation keys stay stable as papers are added."""
    from sqlalchemy import select
    res = await db.execute(select(Paper).where(Paper.project_id == project_id).order_by(Paper.created_at.asc(), Paper.id.asc()))
    return build_bibliography(res.scalars().all())
