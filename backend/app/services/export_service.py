import io
import re
import zipfile
from typing import Any, Dict, List, Optional, Tuple

from app.services.citation_service import latex_escape

# Journal / venue templates. Each is a complete preamble; the draft body is placed inside the document.
TEMPLATES: Dict[str, Dict[str, str]] = {
    "article": {
        "name": "Generic article",
        "description": "Standard LaTeX article with natbib author-year citations.",
        "preamble": r"""\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage[round]{natbib}
\usepackage{hyperref}
""",
        "bibstyle": "plainnat",
    },
    "ieee": {
        "name": "IEEE conference",
        "description": "IEEEtran two-column conference format with numeric citations.",
        "preamble": r"""\documentclass[conference]{IEEEtran}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{cite}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{hyperref}
""",
        "bibstyle": "IEEEtran",
    },
    "acm": {
        "name": "ACM (sigconf)",
        "description": "acmart sigconf format with ACM reference style.",
        "preamble": r"""\documentclass[sigconf,nonacm]{acmart}
\usepackage{graphicx}
\settopmatter{printacmref=false}
""",
        "bibstyle": "ACM-Reference-Format",
    },
    "apa": {
        "name": "APA-style manuscript",
        "description": "Double-spaced 12pt manuscript with APA author-year citations (apacite).",
        "preamble": r"""\documentclass[12pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[margin=1in]{geometry}
\usepackage{setspace}
\doublespacing
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage[natbibapa]{apacite}
\usepackage{hyperref}
""",
        "bibstyle": "apacite",
    },
}

def list_templates() -> List[Dict[str, str]]:
    return [{"id": k, "name": v["name"], "description": v["description"]} for k, v in TEMPLATES.items()]

# ---------------------------------------------------------------------------
# Markdown -> LaTeX
# ---------------------------------------------------------------------------

_CITE_GROUP = re.compile(r"\[(@[^\[\]]+)\]")
_FIG_REF = re.compile(r"@fig:([a-z0-9-]+)")
_FIGURE_LINE = re.compile(r"^!\[(?P<caption>[^\]]*)\]\(figure:(?P<label>[a-z0-9-]+)\)\s*$")
_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")

def _convert_citation_group(group: str, known_keys: set) -> str:
    """'@a; @b, p. 3' -> \\cite[p.~3]{a,b}; unknown keys are kept so LaTeX reports them."""
    keys, locator = [], ""
    for part in group.split(";"):
        part = part.strip()
        m = re.match(r"@([A-Za-z0-9_:.-]+)\s*(?:,\s*(.+))?$", part)
        if not m:
            continue
        if m.group(1).startswith("fig:"):
            continue
        keys.append(m.group(1))
        if m.group(2):
            locator = m.group(2).strip()
    if not keys:
        return ""
    locator = re.sub(r"\bp\.\s*", "p.~", latex_escape(locator)) if locator else ""
    opt = f"[{locator}]" if locator else ""
    return f"\\cite{opt}{{{','.join(keys)}}}"

def _inline(text: str, known_keys: set) -> str:
    """Converts inline Markdown to LaTeX, keeping math and code untouched."""
    placeholders: List[str] = []

    def stash(value: str) -> str:
        placeholders.append(value)
        return f"\x00{len(placeholders) - 1}\x00"

    # Protect math and inline code before escaping
    text = re.sub(r"\$\$(.+?)\$\$", lambda m: stash(f"\\[{m.group(1)}\\]"), text)
    text = re.sub(r"(?<!\\)\$(.+?)(?<!\\)\$", lambda m: stash(f"${m.group(1)}$"), text)
    text = re.sub(r"`([^`]+)`", lambda m: stash(f"\\texttt{{{latex_escape(m.group(1))}}}"), text)
    # Citations and figure references
    text = _CITE_GROUP.sub(lambda m: stash(_convert_citation_group(m.group(1), known_keys)) if "@fig:" not in m.group(1) else m.group(0), text)
    text = re.sub(r"\[?@fig:([a-z0-9-]+)\]?", lambda m: stash(f"Figure~\\ref{{fig:{m.group(1)}}}"), text)
    text = _LINK.sub(lambda m: stash(f"\\href{{{m.group(2)}}}{{{latex_escape(m.group(1))}}}"), text)

    text = latex_escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\\emph{\1}", text)
    text = re.sub(r"(?<![\w\\])\\_(?!\s)(.+?)(?<!\s)\\_(?!\w)", r"\\emph{\1}", text)
    text = re.sub(r'"(.+?)"', r"``\1''", text) # LaTeX curly quotes

    return re.sub(r"\x00(\d+)\x00", lambda m: placeholders[int(m.group(1))], text)

def markdown_to_latex(markdown: str, known_keys: set, figures: Dict[str, Dict[str, Any]]) -> Tuple[Optional[str], str]:
    """Returns (title, body). A leading '# Heading' becomes the document title."""
    lines = markdown.replace("\r\n", "\n").split("\n")
    title = None
    out: List[str] = []
    list_stack: List[str] = []
    in_code = False
    in_quote = False
    in_display_math = False

    def close_lists():
        while list_stack:
            out.append(f"\\end{{{list_stack.pop()}}}")

    def close_quote():
        nonlocal in_quote
        if in_quote:
            out.append("\\end{quote}")
            in_quote = False

    first_content_seen = False
    for raw in lines:
        line = raw.rstrip()

        if in_code:
            if line.strip().startswith("```"):
                out.append("\\end{verbatim}")
                in_code = False
            else:
                out.append(raw)
            continue
        if line.strip().startswith("```"):
            close_lists(); close_quote()
            out.append("\\begin{verbatim}")
            in_code = True
            continue
        if line.strip() == "$$":
            close_lists(); close_quote()
            out.append("\\]" if in_display_math else "\\[")
            in_display_math = not in_display_math
            continue
        if in_display_math:
            out.append(line)
            continue

        if not line.strip():
            close_lists(); close_quote()
            out.append("")
            continue

        heading = re.match(r"^(#{1,4})\s+(.*)$", line)
        if heading:
            close_lists(); close_quote()
            level, text = len(heading.group(1)), heading.group(2).strip()
            if level == 1 and not first_content_seen and title is None:
                title = text
            else:
                command = {1: "section", 2: "section", 3: "subsection", 4: "subsubsection"}[level]
                if text.lower() in ("references", "bibliography"):
                    continue # the bibliography is generated from references.bib
                out.append(f"\\{command}{{{_inline(text, known_keys)}}}")
            first_content_seen = True
            continue
        first_content_seen = True

        fig = _FIGURE_LINE.match(line.strip())
        if fig:
            close_lists(); close_quote()
            label = fig.group("label")
            info = figures.get(label)
            caption = fig.group("caption") or (info or {}).get("caption", "")
            if info:
                out += [
                    "\\begin{figure}[htbp]",
                    "  \\centering",
                    f"  \\includegraphics[width=\\linewidth]{{figures/{label}.png}}",
                    f"  \\caption{{{_inline(caption, known_keys)}}}",
                    f"  \\label{{fig:{label}}}",
                    "\\end{figure}",
                ]
            else:
                out.append(f"% Missing figure: {label}")
            continue

        quote = re.match(r"^>\s?(.*)$", line)
        if quote:
            close_lists()
            if not in_quote:
                out.append("\\begin{quote}")
                in_quote = True
            out.append(_inline(quote.group(1), known_keys))
            continue
        close_quote()

        item = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", line)
        if item:
            env = "enumerate" if item.group(2)[0].isdigit() else "itemize"
            if not list_stack or list_stack[-1] != env:
                close_lists()
                out.append(f"\\begin{{{env}}}")
                list_stack.append(env)
            out.append(f"  \\item {_inline(item.group(3), known_keys)}")
            continue
        close_lists()

        if re.match(r"^(-{3,}|\*{3,})$", line.strip()):
            out.append("\\bigskip")
            continue

        out.append(_inline(line, known_keys))

    close_lists(); close_quote()
    if in_code:
        out.append("\\end{verbatim}")
    if in_display_math:
        out.append("\\]")
    return title, "\n".join(out).strip() + "\n"

# ---------------------------------------------------------------------------
# LaTeX re-templating
# ---------------------------------------------------------------------------

def split_latex_document(source: str) -> Tuple[Optional[str], Optional[str], str]:
    """Returns (title, author, body) of an existing LaTeX draft, dropping its own preamble and bibliography commands."""
    title_m = re.search(r"\\title\{(.+?)\}", source, re.S)
    author_m = re.search(r"\\author\{(.+?)\}", source, re.S)
    body_m = re.search(r"\\begin\{document\}(.*?)\\end\{document\}", source, re.S)
    body = body_m.group(1) if body_m else source
    body = re.sub(r"\\(maketitle|bibliographystyle\{[^}]*\}|bibliography\{[^}]*\})", "", body)
    return (title_m.group(1).strip() if title_m else None,
            author_m.group(1).strip() if author_m else None,
            body.strip() + "\n")

def build_latex(template_id: str, title: str, author: str, body: str, abstract: Optional[str] = None) -> str:
    template = TEMPLATES[template_id]
    parts = [template["preamble"].rstrip(), "", f"\\title{{{title}}}", f"\\author{{{author}}}", "", "\\begin{document}", ""]
    if template_id == "acm":
        # acmart expects the abstract before \maketitle
        if abstract:
            parts += ["\\begin{abstract}", abstract, "\\end{abstract}", ""]
        parts.append("\\maketitle")
    else:
        parts.append("\\maketitle")
        if abstract:
            parts += ["", "\\begin{abstract}", abstract, "\\end{abstract}"]
    parts += ["", body.rstrip(), "", f"\\bibliographystyle{{{template['bibstyle']}}}", "\\bibliography{references}", "", "\\end{document}", ""]
    return "\n".join(parts)

def extract_abstract(body: str) -> Tuple[Optional[str], str]:
    """Pulls an 'Abstract' section out of a converted body so templates can place it correctly."""
    m = re.search(r"\\section\{Abstract\}\s*(.+?)(?=\\section\{|\Z)", body, re.S)
    if not m:
        return None, body
    return m.group(1).strip(), (body[:m.start()] + body[m.end():]).strip() + "\n"

# ---------------------------------------------------------------------------
# Markdown export with a formatted reference list
# ---------------------------------------------------------------------------

def markdown_with_references(markdown: str, entries: List[Dict[str, Any]]) -> str:
    """Replaces [@key] citations with (Author, Year) and appends a reference list of cited works."""
    by_key = {e["key"]: e for e in entries}
    cited: List[str] = []

    def replace(m):
        pieces = []
        for part in m.group(1).split(";"):
            pm = re.match(r"\s*@([A-Za-z0-9_:.-]+)\s*(?:,\s*(.+))?$", part)
            if not pm or pm.group(1).startswith("fig:"):
                return m.group(0)
            entry = by_key.get(pm.group(1))
            if not entry:
                pieces.append(f"{pm.group(1)}?")
                continue
            if entry["key"] not in cited:
                cited.append(entry["key"])
            pieces.append(entry["short"] + (f", {pm.group(2).strip()}" if pm.group(2) else ""))
        return "(" + "; ".join(pieces) + ")"

    text = _CITE_GROUP.sub(replace, markdown)

    # Number figures in order of appearance and resolve @fig:label references
    numbers: Dict[str, int] = {}
    for line in text.split("\n"):
        fm = _FIGURE_LINE.match(line.strip())
        if fm and fm.group("label") not in numbers:
            numbers[fm.group("label")] = len(numbers) + 1
    text = re.sub(r"\[?@fig:([a-z0-9-]+)\]?", lambda m: f"Figure {numbers[m.group(1)]}" if m.group(1) in numbers else m.group(0), text)
    text = re.sub(
        r"^!\[(?P<caption>[^\]]*)\]\(figure:(?P<label>[a-z0-9-]+)\)\s*$",
        lambda m: f"![Figure {numbers.get(m.group('label'), '?')}. {m.group('caption')}](figure:{m.group('label')})",
        text, flags=re.M,
    )

    # The generated reference list replaces any References heading the author left in the draft
    text = re.sub(r"\n#{1,3}\s*(references|bibliography)\s*\n?\s*$", "\n", text.rstrip() + "\n", flags=re.I)
    if cited:
        refs = sorted((by_key[k]["formatted"] for k in cited), key=str.lower)
        text = text.rstrip() + "\n\n## References\n\n" + "\n\n".join(refs) + "\n"
    return text

def build_zip(files: Dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()

README = """ResearchIDE export
==================

Upload this zip to Overleaf (New Project -> Upload Project), or compile locally:

    pdflatex main
    bibtex main
    pdflatex main
    pdflatex main

main.tex        the manuscript in the {template} template
references.bib  every paper in your project library (only cited ones are printed)
figures/        figures rendered from your project datasets
"""
