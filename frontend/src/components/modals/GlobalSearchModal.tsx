"use client";

import React, { useState, useEffect } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { SearchResultItem } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, BookOpen, Database, FileCode, ArrowRight, Loader2 } from "lucide-react";

export function GlobalSearchModal() {
  const searchModalOpen = useWorkspaceStore((s) => s.searchModalOpen);
  const setSearchModalOpen = useWorkspaceStore((s) => s.setSearchModalOpen);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const openTab = useWorkspaceStore((s) => s.openTab);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim() || !activeProjectId) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchProject(activeProjectId, query);
        setResults(res.results);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, activeProjectId]);

  const handleSelectResult = (item: SearchResultItem) => {
    openTab({
      resourceId: item.metadata.paper_id || item.id,
      title: item.title,
      type: item.resource_type,
      metadata: {
        page: item.metadata.page,
        sectionTitle: item.metadata.section,
        contentType: item.metadata.content_type,
      },
    });
    setSearchModalOpen(false);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "paper":
        return <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case "dataset":
        return <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "draft":
        return <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={searchModalOpen} onOpenChange={setSearchModalOpen}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden bg-[#18181b] border-border shadow-2xl">
        <DialogTitle className="sr-only">Global Search</DialogTitle>
        {/* Search Input Bar */}
        <div className="flex items-center px-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground mr-2 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search papers, datasets, sections, drafts... (hybrid semantic)"
            className="w-full h-11 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-2 shrink-0" />}
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-1.5 space-y-1">
          {results.length > 0 ? (
            results.map((item) => (
              <div
                key={item.id}
                onClick={() => handleSelectResult(item)}
                className="group flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors text-xs"
              >
                <div className="mt-0.5">{getIcon(item.resource_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground truncate">{item.title}</span>
                    <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider ml-2">
                      {item.resource_type}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    {item.snippet}
                  </p>
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
              </div>
            ))
          ) : query ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No matching records found across project library and datasets
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Search by title, author, section content, or dataset column
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
