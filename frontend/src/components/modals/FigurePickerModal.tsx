"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { figureSnippet } from "@/lib/citations";
import { api } from "@/lib/api";
import { Figure } from "@/lib/types";
import { BarChart2, Loader2 } from "lucide-react";

interface FigurePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function FigurePickerModal({ open, onOpenChange, projectId }: FigurePickerModalProps) {
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const [figures, setFigures] = useState<Figure[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setFigures(null);
    api.getFigures(projectId).then(setFigures).catch(() => setFigures([]));
  }, [open, projectId]);

  const insert = (figure: Figure) => {
    if (insertIntoDraft(figureSnippet(figure), "Figure")) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            Insert figure
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Figures stay linked to their dataset: replace the data and the figure in your paper updates on its own.
          </DialogDescription>
        </DialogHeader>

        {figures === null ? (
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading figures...
          </div>
        ) : figures.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-10">
            No figures yet. Open a dataset in <span className="font-mono text-emerald-400">/data</span> and click <b>Create figure</b>.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto">
            {figures.map((fig) => (
              <button
                key={fig.id}
                onClick={() => insert(fig)}
                disabled={!!fig.render_error}
                className="text-left rounded-md border border-border hover:border-primary/60 bg-background/40 overflow-hidden disabled:opacity-50"
                title={fig.render_error || `Insert ${fig.label}`}
              >
                <div className="aspect-[16/10] bg-white flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fig.image_url} alt={fig.caption} className="w-full h-full object-contain" />
                </div>
                <div className="p-1.5">
                  <div className="text-[11px] font-mono text-sky-300 truncate">{fig.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{fig.caption}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
