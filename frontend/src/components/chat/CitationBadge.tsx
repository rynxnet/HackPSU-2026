"use client";

import React from "react";
import { CitationItem } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { findEntry, citeSnippet, quoteSnippet } from "@/lib/citations";
import { BookOpen, Database, ExternalLink, Quote, TextCursorInput } from "lucide-react";

interface CitationBadgeProps {
  citation: CitationItem;
}

export function CitationBadge({ citation }: CitationBadgeProps) {
  const jumpToCitation = useWorkspaceStore((s) => s.jumpToCitation);
  const bibliography = useWorkspaceStore((s) => s.bibliography);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const pushToast = useWorkspaceStore((s) => s.pushToast);

  const entry = citation.data_source === "data" ? undefined : findEntry(bibliography, citation);

  const label = [
    citation.paper_title.length > 25 ? `${citation.paper_title.slice(0, 25)}...` : citation.paper_title,
    citation.section,
    citation.page ? `p.${citation.page}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const withEntry = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry) {
      pushToast("This source isn't in the project bibliography yet.", "error");
      return;
    }
    fn();
  };

  // The retrieval snippet starts with a "[Section]" marker; strip it for quoting
  const quoteText = citation.snippet.replace(/^\[[^\]]*\]\s*/, "").replace(/\.\.\.$/, "");

  return (
    <div
      onClick={() => jumpToCitation(citation)}
      className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-mono cursor-pointer transition-all select-none my-0.5 align-middle"
      title={`Click to open "${citation.paper_title}" at ${citation.section || 'section'}\n\nSnippet:\n${citation.snippet}`}
    >
      {citation.data_source === "data" ? (
        <Database className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : (
        <BookOpen className="w-3 h-3 text-amber-400 shrink-0" />
      )}
      <span className="truncate max-w-[200px]">[{label}]</span>
      <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      {entry && (
        <span className="flex items-center gap-0.5 border-l border-primary/30 pl-1 ml-0.5">
          <button
            onClick={withEntry(() => insertIntoDraft(citeSnippet(entry!, citation.page), "Citation"))}
            className="p-0.5 rounded hover:bg-primary/30"
            title={`Cite in draft as [@${entry.key}]`}
            aria-label="Insert citation into draft"
          >
            <TextCursorInput className="w-3 h-3" />
          </button>
          <button
            onClick={withEntry(() => insertIntoDraft(quoteSnippet(entry!, quoteText, citation.page), "Quote"))}
            className="p-0.5 rounded hover:bg-primary/30"
            title="Insert this passage as a cited quote"
            aria-label="Insert quote into draft"
          >
            <Quote className="w-3 h-3" />
          </button>
        </span>
      )}
    </div>
  );
}
