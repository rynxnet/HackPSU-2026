"use client";

import React from "react";
import { CitationItem } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Database, ExternalLink } from "lucide-react";

interface CitationBadgeProps {
  citation: CitationItem;
}

export function CitationBadge({ citation }: CitationBadgeProps) {
  const jumpToCitation = useWorkspaceStore((s) => s.jumpToCitation);

  const label = [
    citation.paper_title.length > 25 ? `${citation.paper_title.slice(0, 25)}...` : citation.paper_title,
    citation.section,
    citation.page ? `p.${citation.page}` : null,
  ]
    .filter(Boolean)
    .join(", ");

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
    </div>
  );
}
