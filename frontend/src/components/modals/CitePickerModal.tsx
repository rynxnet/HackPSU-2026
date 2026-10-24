"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { citeSnippet } from "@/lib/citations";
import { BibEntry } from "@/lib/types";
import { BookOpen, Download } from "lucide-react";
import { api } from "@/lib/api";

interface CitePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function CitePickerModal({ open, onOpenChange, projectId }: CitePickerModalProps) {
  const bibliography = useWorkspaceStore((s) => s.bibliography);
  const loadBibliography = useWorkspaceStore((s) => s.loadBibliography);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setPage("");
      setHighlight(0);
      loadBibliography(projectId, true).catch(() => {});
    }
  }, [open, projectId, loadBibliography]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bibliography;
    return bibliography.filter((e) =>
      [e.title, e.key, e.authors.join(" "), String(e.year || "")].some((v) => v.toLowerCase().includes(q))
    );
  }, [bibliography, query]);

  const cite = (entry: BibEntry) => {
    const pageNum = parseInt(page, 10);
    if (insertIntoDraft(citeSnippet(entry, Number.isFinite(pageNum) ? pageNum : undefined), "Citation")) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-400" />
            Insert citation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Citation keys come from your library; the bibliography is generated for you on export.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
              if (e.key === "Enter" && results[highlight]) { e.preventDefault(); cite(results[highlight]); }
            }}
            placeholder="Search title, author, year or key..."
            className="flex-1"
          />
          <Input
            value={page}
            onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))}
            placeholder="Page"
            className="w-20"
            aria-label="Page number (optional)"
          />
        </div>

        <div className="max-h-72 overflow-y-auto -mx-1 space-y-0.5">
          {results.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-6">
              {bibliography.length === 0 ? "Your library is empty. Upload a PDF or import a DOI first." : "No matching papers."}
            </div>
          )}
          {results.map((entry, i) => (
            <button
              key={entry.paper_id}
              onClick={() => cite(entry)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs ${i === highlight ? "bg-primary/15" : "hover:bg-muted/40"}`}
            >
              <div className="font-medium text-foreground truncate">{entry.title}</div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{entry.short}</span>
                <code className="font-mono text-sky-300 shrink-0">@{entry.key}</code>
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border text-[11px] text-muted-foreground">
          <span>Enter to insert · ↑↓ to choose</span>
          <button
            onClick={() => api.downloadBibtex(projectId).catch((e) => pushToast(e.message, "error"))}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Download className="w-3 h-3" />
            references.bib
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
