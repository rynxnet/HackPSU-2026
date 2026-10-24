"use client";

import React, { useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link as LinkIcon, Loader2, Sparkles } from "lucide-react";

export function ImportDoiModal() {
  const importDoiModalOpen = useWorkspaceStore((s) => s.importDoiModalOpen);
  const setImportDoiModalOpen = useWorkspaceStore((s) => s.setImportDoiModalOpen);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const pushToast = useWorkspaceStore((s) => s.pushToast);

  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!identifier.trim() || !activeProjectId) return;
    setLoading(true);

    try {
      const paper = await api.importDoiOrArxiv(activeProjectId, identifier.trim());
      setImportDoiModalOpen(false);
      setIdentifier("");
      // Refresh the explorer in place so open tabs and drafts are kept
      refreshTree();
      pushToast(`Imported "${paper.title}". It's ready to cite.`, "success");
    } catch (err: any) {
      pushToast(`Import failed: ${err.message || "Could not resolve identifier"}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={importDoiModalOpen} onOpenChange={setImportDoiModalOpen}>
      <DialogContent className="max-w-md bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-amber-400" />
            <span>Import Paper via DOI / arXiv</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            ResearchIDE automatically queries CrossRef / arXiv APIs, pulls paper metadata, downloads open-access PDFs, and vectorizes sections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
              DOI or arXiv Identifier
            </label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. 1706.03762 or 10.1145/3318464.3389700"
              className="text-xs font-mono"
              autoFocus
            />
          </div>

          <div className="p-2.5 rounded bg-muted/30 border border-border/60 text-[11px] text-muted-foreground space-y-1">
            <span className="font-semibold text-foreground block">Examples supported:</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIdentifier("1706.03762")}
                className="text-primary hover:underline font-mono"
              >
                1706.03762 (Attention Is All You Need)
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIdentifier("2303.08774")}
                className="text-primary hover:underline font-mono"
              >
                2303.08774 (GPT-4 Tech Report)
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportDoiModalOpen(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={!identifier.trim() || loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{loading ? "Resolving & Ingesting..." : "Import Paper"}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
