"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { ExportTemplate } from "@/lib/types";
import { FileDown, Loader2, Check } from "lucide-react";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: string;
  draftTitle: string;
  isLatex: boolean;
  /** Flushes pending autosave so the export includes the latest edits. */
  beforeExport: () => Promise<void>;
}

export function ExportModal({ open, onOpenChange, draftId, draftTitle, isLatex, beforeExport }: ExportModalProps) {
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [selected, setSelected] = useState("article");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && templates.length === 0) {
      api.getExportTemplates().then(setTemplates).catch(() => {});
    }
  }, [open, templates.length]);

  const available = templates.filter((t) => !(isLatex && t.id === "markdown"));

  const runExport = async () => {
    setBusy(true);
    try {
      await beforeExport();
      await api.exportDraft(draftId, selected);
      const name = templates.find((t) => t.id === selected)?.name || selected;
      pushToast(`Exported ${draftTitle} as ${name}`, "success");
      onOpenChange(false);
    } catch (e: any) {
      pushToast(e.message || "Export failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <FileDown className="w-4 h-4 text-primary" />
            Export for submission
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isLatex
              ? "Re-templates your LaTeX: the preamble is replaced, your body text is kept."
              : "Converts your Markdown to LaTeX: citations become \\cite, figures become figure environments."}{" "}
            Includes references.bib and figures, ready to upload to Overleaf.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {available.length === 0 && (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading templates...
            </div>
          )}
          {available.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`w-full text-left px-3 py-2 rounded-md border text-xs flex items-start gap-2 ${
                selected === t.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
              }`}
            >
              <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${selected === t.id ? "border-primary bg-primary" : "border-muted-foreground/50"}`}>
                {selected === t.id && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
              </span>
              <span>
                <span className="font-medium text-foreground block">{t.name}</span>
                <span className="text-muted-foreground">{t.description}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={runExport} disabled={busy || available.length === 0} className="gap-1.5">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
            {busy ? "Exporting..." : "Download .zip"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
