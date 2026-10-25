"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { MatrixColumn } from "@/lib/types";
import { Table2, Plus, X, Loader2 } from "lucide-react";

interface NewMatrixModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

// Starting points a researcher can toggle or edit; the questions are what the model answers per paper
const SUGGESTED: MatrixColumn[] = [
  { name: "Approach", question: "What system, method or agent architecture does the paper propose or evaluate?", type: "text" },
  { name: "Task / setting", question: "What task, environment or benchmark is it evaluated on?", type: "text" },
  { name: "Main result", question: "What is the headline quantitative result?", type: "text" },
  { name: "Success rate (%)", question: "What success, solve or accuracy rate (percent) does the best system achieve?", type: "number" },
  { name: "Human in the loop?", question: "Does the system require a human operator in the loop?", type: "yes_no" },
  { name: "Models used", question: "Which language models or AI models are used or evaluated?", type: "text" },
  { name: "Key limitation", question: "What main limitation or failure mode do the authors report?", type: "text" },
];

const TYPE_LABEL: Record<MatrixColumn["type"], string> = { text: "Text", number: "Number", yes_no: "Yes / No" };

export function NewMatrixModal({ open, onOpenChange, projectId }: NewMatrixModalProps) {
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const [name, setName] = useState("Comparison of approaches");
  const [columns, setColumns] = useState<MatrixColumn[]>(SUGGESTED.slice(0, 5));
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (c: MatrixColumn) =>
    setColumns((prev) => (prev.some((x) => x.name === c.name) ? prev.filter((x) => x.name !== c.name) : [...prev, c]));

  const addCustom = () => {
    const q = custom.trim();
    if (!q) return;
    const colName = q.length > 32 ? q.slice(0, 30).trim() + "…" : q.replace(/\?$/, "");
    setColumns((prev) => [...prev, { name: colName, question: q, type: "text" }]);
    setCustom("");
  };

  const create = async () => {
    setBusy(true);
    try {
      const m = await api.createMatrix(projectId, name.trim() || "Literature matrix", columns);
      refreshTree();
      openTab({ resourceId: m.id, title: m.name, type: "matrix" });
      pushToast(`Reading ${m.rows.length} papers to fill ${columns.length} columns…`, "info");
      onOpenChange(false);
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Table2 className="w-4 h-4 text-violet-400" />
            New literature matrix
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            One row per paper, one column per question. Every cell is filled from the paper's own text and links to the page it came from.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <label className="block">
            <span className="text-[11px] text-muted-foreground mb-1 block">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div>
            <span className="text-[11px] text-muted-foreground mb-1 block">Suggested columns (click to toggle)</span>
            <div className="flex flex-wrap gap-1">
              {SUGGESTED.map((c) => {
                const on = columns.some((x) => x.name === c.name);
                return (
                  <button
                    key={c.name}
                    onClick={() => toggle(c)}
                    title={c.question}
                    className={`px-2 py-1 rounded border text-[11px] ${on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-[11px] text-muted-foreground mb-1 block">Columns ({columns.length})</span>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {columns.map((c, i) => (
                <div key={c.name} className="flex items-center gap-1.5 rounded border border-border bg-background/40 px-2 py-1">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{c.question}</div>
                  </div>
                  <select
                    value={c.type}
                    onChange={(e) => setColumns((prev) => prev.map((x, j) => (j === i ? { ...x, type: e.target.value as MatrixColumn["type"] } : x)))}
                    className="h-6 rounded border border-border bg-background px-1 text-[10px]"
                    aria-label="Column type"
                  >
                    {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={() => setColumns((prev) => prev.filter((_, j) => j !== i))} className="p-0.5 text-muted-foreground hover:text-rose-400" aria-label="Remove column">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="Your own question, e.g. Which vulnerability classes are targeted?"
              />
              <Button size="sm" variant="outline" onClick={addCustom} className="gap-1"><Plus className="w-3 h-3" /> Add</Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-[10px] text-muted-foreground">Uses about one AI request per 3 papers.</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={create} disabled={busy || columns.length === 0} className="gap-1.5">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Create and fill
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
