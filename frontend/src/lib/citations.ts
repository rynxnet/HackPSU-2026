import { BibEntry, CitationItem, DraftSnippet, Figure } from "./types";

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Finds the bibliography entry for a chat/search citation (matched by paper id, then by title). */
export function findEntry(bibliography: BibEntry[], citation: { paper_id?: string; paper_title?: string }): BibEntry | undefined {
  if (citation.paper_id) {
    const byId = bibliography.find((e) => e.paper_id === citation.paper_id);
    if (byId) return byId;
  }
  if (!citation.paper_title) return undefined;
  const title = normalize(citation.paper_title);
  return bibliography.find((e) => normalize(e.title) === title) ||
    bibliography.find((e) => normalize(e.title).startsWith(title) || title.startsWith(normalize(e.title)));
}

function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (ch) =>
    ({ "\\": "\\textbackslash{}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" } as Record<string, string>)[ch] ?? `\\${ch}`
  );
}

/** In-text citation: [@key, p. 3] in Markdown, \cite[p.~3]{key} in LaTeX. */
export function citeSnippet(entry: BibEntry, page?: number): DraftSnippet {
  return {
    markdown: page ? `[@${entry.key}, p. ${page}]` : `[@${entry.key}]`,
    latex: page ? `\\cite[p.~${page}]{${entry.key}}` : `\\cite{${entry.key}}`,
  };
}

/** Block quote of a passage followed by its citation. */
export function quoteSnippet(entry: BibEntry, text: string, page?: number): DraftSnippet {
  const clean = text.replace(/\s+/g, " ").trim();
  const cite = citeSnippet(entry, page);
  return {
    markdown: `\n> "${clean}" ${cite.markdown}\n\n`,
    latex: `\n\\begin{quote}\n\`\`${escapeLatex(clean)}'' ${cite.latex}\n\\end{quote}\n\n`,
  };
}

export function figureSnippet(figure: Figure): DraftSnippet {
  return {
    markdown: `\n![${figure.caption}](figure:${figure.label})\n\n`,
    latex: [
      "",
      "\\begin{figure}[htbp]",
      "  \\centering",
      `  \\includegraphics[width=\\linewidth]{figures/${figure.label}.png}`,
      `  \\caption{${escapeLatex(figure.caption)}}`,
      `  \\label{fig:${figure.label}}`,
      "\\end{figure}",
      "",
      "",
    ].join("\n"),
  };
}

/**
 * Converts an assistant answer into draft text: inline badges such as
 * `[Paper Title, Section, p. 3]` become real citations of the matching bibliography entry.
 */
export function answerSnippet(content: string, citations: CitationItem[], bibliography: BibEntry[]): DraftSnippet {
  // Any bracketed group, optionally wrapped in backticks inside or outside the brackets:
  // [Title, Section, p. 3]  `[Title, p. 3]`  [`Title, Section, p. 3`]
  const badge = /`?\[`?([^\[\]`]+?)`?\]`?(?!\()/g;
  // Longest titles first so "BERT: Pre-training…" wins over a shorter title that is its prefix
  const known = [
    ...bibliography.map((e) => ({ title: e.title, entry: e as BibEntry | undefined })),
    ...citations.map((c) => ({ title: c.paper_title, entry: findEntry(bibliography, c) })),
  ].filter((k) => k.entry && k.title).sort((a, b) => b.title.length - a.title.length);

  const convert = (format: "markdown" | "latex") =>
    content.replace(badge, (match, inner: string) => {
      const text = inner.trim();
      if (text.startsWith("@")) return match; // already a citation key
      const datasetMatch = text.match(/^Dataset:\s*(.+)$/i);
      if (datasetMatch) return format === "latex" ? `(dataset: ${escapeLatex(datasetMatch[1])})` : `(dataset: ${datasetMatch[1]})`;
      // Match on the paper title rather than splitting on commas, since titles can contain commas
      const norm = normalize(text);
      const hit = known.find((k) => norm.startsWith(normalize(k.title)));
      if (!hit?.entry) return match;
      const page = text.match(/\bp(?:p|age)?\.?\s*(\d+)\s*$/i);
      return citeSnippet(hit.entry, page ? parseInt(page[1], 10) : undefined)[format];
    });

  return { markdown: `\n${convert("markdown").trim()}\n\n`, latex: `\n${escapeAnswerForLatex(convert("latex")).trim()}\n\n` };
}

/** Escapes plain answer text for LaTeX while leaving \cite commands and $math$ intact. */
function escapeAnswerForLatex(text: string): string {
  const keep: string[] = [];
  const stash = (s: string) => {
    keep.push(s);
    return `\u0000${keep.length - 1}\u0000`;
  };
  let out = text
    .replace(/\\cite(\[[^\]]*\])?\{[^}]*\}/g, stash)
    .replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, stash);
  out = escapeLatex(out)
    .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1\\emph{$2}")
    .replace(/^\s*[-*]\s+/gm, "\\textbullet{} ");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

/** Renders [@key] citations as (Author, Year) for the live draft preview. */
export function renderCitationsForPreview(markdown: string, bibliography: BibEntry[]): { text: string; cited: BibEntry[] } {
  const byKey = new Map(bibliography.map((e) => [e.key, e]));
  const cited: BibEntry[] = [];
  const text = markdown.replace(/\[(@[^\[\]]+)\]/g, (match, group: string) => {
    const parts = group.split(";").map((p) => p.trim());
    const rendered: string[] = [];
    for (const part of parts) {
      const m = part.match(/^@([A-Za-z0-9_:.-]+)\s*(?:,\s*(.+))?$/);
      if (!m) return match;
      if (m[1].startsWith("fig:")) return match;
      const entry = byKey.get(m[1]);
      if (!entry) {
        rendered.push(`${m[1]}?`);
        continue;
      }
      if (!cited.includes(entry)) cited.push(entry);
      rendered.push(m[2] ? `${entry.short}, ${m[2]}` : entry.short);
    }
    return `(${rendered.join("; ")})`;
  });
  return { text, cited };
}
