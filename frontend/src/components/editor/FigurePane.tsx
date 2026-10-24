"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Figure } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { figureSnippet } from "@/lib/citations";
import { Button } from "@/components/ui/button";
import { BarChart2, Database, FileInput, Loader2, RefreshCw, Trash2, AlertCircle } from "lucide-react";

export function FigurePane({ figureId }: { figureId: string }) {
  const [figure, setFigure] = useState<Figure | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const treeVersion = useWorkspaceStore((s) => s.treeVersion);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const tabs = useWorkspaceStore((s) => s.tabs);

  // Reload when the source data changes (a dataset replace bumps treeVersion)
  useEffect(() => {
    api.getFigure(figureId)
      .then((f) => {
        setFigure(f);
        setCaption(f.caption);
      })
      .catch((e) => pushToast(e.message, "error"));
  }, [figureId, treeVersion]);

  const saveCaption = async () => {
    if (!figure || caption.trim() === figure.caption) return;
    try {
      setFigure(await api.updateFigure(figure.id, { caption: caption.trim() }));
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const rerender = async () => {
    if (!figure) return;
    setBusy(true);
    try {
      setFigure(await api.updateFigure(figure.id, {}));
      pushToast("Figure re-rendered from the latest data", "success");
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!figure || !window.confirm(`Delete figure "${figure.label}"? Drafts that reference figure:${figure.label} will show it as missing.`)) return;
    try {
      await api.deleteFigure(figure.id);
      refreshTree();
      tabs.filter((t) => t.resourceId === figure.id).forEach((t) => closeTab(t.id));
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  if (!figure) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading figure...
      </div>
    );
  }

  const spec = figure.spec;

  return (
    <div className="h-full flex flex-col bg-[#141416]">
      <div className="h-9 border-b border-border bg-[#18181b] px-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="font-mono text-sky-300 truncate">figure:{figure.label}</span>
          <span className="text-muted-foreground">v{figure.version}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-6 gap-1 text-[11px]" onClick={() => insertIntoDraft(figureSnippet({ ...figure, caption }), "Figure")}>
            <FileInput className="w-3 h-3" /> Insert into draft
          </Button>
          <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" onClick={rerender} disabled={busy || !figure.dataset_id}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Re-render
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-400" onClick={remove} title="Delete figure">
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {figure.render_error && (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Last render failed: {figure.render_error}. The previous image is shown.</span>
            </div>
          )}
          <div className="bg-white rounded-md border border-border overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={figure.image_url} alt={figure.caption} className="w-full" />
          </div>
          <label className="block text-xs">
            <span className="text-[11px] text-muted-foreground mb-1 block">Caption (used when inserted and exported)</span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={saveCaption}
              className="w-full min-h-[56px] rounded-md border border-border bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Info label="Chart" value={spec.chart} />
            <Info label="X" value={spec.x} />
            <Info label="Y" value={spec.y?.join(", ") || "count"} />
            <div className="rounded border border-border p-2">
              <div className="text-muted-foreground">Source data</div>
              {figure.dataset_id ? (
                <button
                  className="flex items-center gap-1 text-emerald-400 hover:underline truncate max-w-full"
                  onClick={() => openTab({ resourceId: figure.dataset_id!, title: figure.dataset_name || "dataset", type: "dataset" })}
                >
                  <Database className="w-3 h-3 shrink-0" /> <span className="truncate">{figure.dataset_name || "dataset"}</span>
                </button>
              ) : (
                <div className="text-rose-300">deleted</div>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Reference it in Markdown with <code className="font-mono text-sky-300">@fig:{figure.label}</code> or in LaTeX with{" "}
            <code className="font-mono text-sky-300">\ref{"{"}fig:{figure.label}{"}"}</code>. Replacing the source data re-renders it automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2 min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono text-foreground truncate">{value}</div>
    </div>
  );
}
