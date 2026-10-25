"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LiteratureMatrix, MatrixColumn, MatrixRow } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table2, Loader2, Sparkles, Database, FileInput, Trash2, BookOpen, Pencil, Plus, X, AlertTriangle,
} from "lucide-react";

export function MatrixPane({ matrixId }: { matrixId: string }) {
  const [matrix, setMatrix] = useState<LiteratureMatrix | null>(null);
  const [selected, setSelected] = useState<{ row: MatrixRow; col: MatrixColumn } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newCol, setNewCol] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const jumpToCitation = useWorkspaceStore((s) => s.jumpToCitation);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const tabs = useWorkspaceStore((s) => s.tabs);

  const load = () => api.getMatrix(matrixId).then(setMatrix).catch((e) => pushToast(e.message, "error"));
  useEffect(() => { load(); }, [matrixId]);

  // Poll while the background job fills cells, so they appear as papers are read
  useEffect(() => {
    if (matrix?.status !== "filling") return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [matrix]);
  const wasFilling = React.useRef(false);
  useEffect(() => {
    if (!matrix) return;
    if (wasFilling.current && matrix.status !== "filling") {
      refreshTree();
      if (matrix.status === "error") pushToast(matrix.progress?.message || "Filling stopped", "error");
      else pushToast(`Matrix filled: ${matrix.rows.length} papers × ${matrix.columns.length} columns`, "success");
    }
    wasFilling.current = matrix.status === "filling";
  }, [matrix?.status]);

  if (!matrix) {
    return <div className="h-full flex items-center justify-center text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading matrix…</div>;
  }

  const filling = matrix.status === "filling";
  const filled = matrix.rows.reduce((n, r) => n + matrix.columns.filter((c) => r.cells[c.name]?.value != null).length, 0);
  const total = matrix.rows.length * matrix.columns.length;

  const select = (row: MatrixRow, col: MatrixColumn) => {
    setSelected({ row, col });
    setEditValue(row.cells[col.name]?.value ?? "");
  };

  const saveEdit = async () => {
    if (!selected) return;
    await api.updateMatrixCell(matrix.id, selected.row.paper_id, selected.col.name, editValue);
    await load();
    pushToast("Cell updated. Your correction won't be overwritten by future fills.", "success");
  };

  const fill = async () => {
    try {
      setMatrix(await api.fillMatrix(matrix.id));
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const addColumn = async () => {
    const q = newCol.trim();
    if (!q) return;
    const name = q.length > 32 ? q.slice(0, 30).trim() + "…" : q.replace(/\?$/, "");
    try {
      await api.updateMatrix(matrix.id, { columns: [...matrix.columns, { name, question: q, type: "text" }] });
      setNewCol("");
      setMatrix(await api.fillMatrix(matrix.id, [name]));
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const removeColumn = async (col: MatrixColumn) => {
    if (!window.confirm(`Remove the column "${col.name}" and its values?`)) return;
    setMatrix(await api.updateMatrix(matrix.id, { columns: matrix.columns.filter((c) => c.name !== col.name) }));
  };

  const toDataset = async () => {
    setBusy("dataset");
    try {
      const res = await api.matrixToDataset(matrix.id);
      refreshTree();
      pushToast(`Saved as ${res.name}${res.figures_updated ? `; ${res.figures_updated} linked figure(s) updated` : ""}. Open it in /data to chart it.`, "success");
      setMatrix(await api.getMatrix(matrix.id));
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const insertTable = async () => {
    setBusy("table");
    try {
      insertIntoDraft(await api.matrixTable(matrix.id), "Comparison table");
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the matrix "${matrix.name}"?`)) return;
    await api.deleteMatrix(matrix.id);
    refreshTree();
    tabs.filter((t) => t.resourceId === matrix.id).forEach((t) => closeTab(t.id));
  };

  const sel = selected ? matrix.rows.find((r) => r.paper_id === selected.row.paper_id)?.cells[selected.col.name] : null;

  return (
    <div className="h-full flex flex-col bg-[#141416]">
      {/* Toolbar */}
      <div className="h-9 border-b border-border bg-[#18181b] px-3 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <span className="font-semibold truncate">{matrix.name}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">{matrix.rows.length} papers · {filled}/{total} cells</span>
          {filling && (
            <span className="flex items-center gap-1 text-[11px] text-sky-300 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" /> {matrix.progress?.message || "Reading papers…"}
            </span>
          )}
          {matrix.status === "error" && (
            <span className="flex items-center gap-1 text-[11px] text-amber-300 truncate"><AlertTriangle className="w-3 h-3" /> {matrix.progress?.message}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" onClick={fill} disabled={filling} title="Fill cells that are still empty">
            <Sparkles className="w-3 h-3" /> Fill empty
          </Button>
          <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" onClick={toDataset} disabled={filling || busy === "dataset"} title="Save as a CSV in /data so you can chart it">
            {busy === "dataset" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />} {matrix.dataset_id ? "Update dataset" : "Save as dataset"}
          </Button>
          <Button size="sm" className="h-6 gap-1 text-[11px]" onClick={insertTable} disabled={busy === "table"} title="Insert as a cited comparison table at the cursor in your draft">
            <FileInput className="w-3 h-3" /> Insert table
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-400" onClick={remove} title="Delete matrix">
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Table */}
        <div className="flex-1 min-w-0 overflow-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead className="sticky top-0 z-10 bg-[#1f1f23] text-[11px] text-muted-foreground">
              <tr>
                <th className="text-left p-2 border-b border-r border-border min-w-[180px] sticky left-0 bg-[#1f1f23]">Paper</th>
                {matrix.columns.map((c) => (
                  <th key={c.name} className="text-left p-2 border-b border-r border-border min-w-[160px] max-w-[260px] group" title={c.question}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate">{c.name}</span>
                      <button onClick={() => removeColumn(c)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400" aria-label={`Remove ${c.name}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="p-1 border-b border-border min-w-[220px]">
                  <div className="flex gap-1">
                    <Input value={newCol} onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addColumn()} placeholder="Add a question…" className="h-6 text-[11px]" />
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={addColumn} disabled={filling} aria-label="Add column"><Plus className="w-3 h-3" /></Button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.paper_id} className="border-b border-border/40">
                  <td className="p-2 border-r border-border/60 align-top sticky left-0 bg-[#141416]">
                    <button onClick={() => openTab({ resourceId: r.paper_id, title: r.title, type: "paper" })} className="text-left hover:text-primary">
                      <div className="font-medium text-foreground line-clamp-2">{r.title}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.key ? `@${r.key}` : ""}</div>
                    </button>
                  </td>
                  {matrix.columns.map((c) => {
                    const cell = r.cells[c.name];
                    const isSel = selected?.row.paper_id === r.paper_id && selected?.col.name === c.name;
                    return (
                      <td
                        key={c.name}
                        onClick={() => select(r, c)}
                        className={`p-2 border-r border-border/40 align-top cursor-pointer max-w-[260px] ${isSel ? "bg-primary/15 outline outline-1 outline-primary" : "hover:bg-muted/30"}`}
                      >
                        {cell?.value != null ? (
                          <span className="flex items-start gap-1">
                            <span className="text-foreground">{cell.value}</span>
                            {cell.edited && <Pencil className="w-2.5 h-2.5 text-amber-300 shrink-0 mt-0.5" aria-label="Edited by you" />}
                          </span>
                        ) : cell ? (
                          <span className="text-muted-foreground/50 italic">not reported</span>
                        ) : filling ? (
                          <span className="inline-block w-12 h-2.5 rounded bg-muted/50 animate-pulse" />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                        {cell?.evidence?.page != null && <span className="block text-[9px] text-muted-foreground/70">p. {cell.evidence.page}</span>}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Evidence panel for the selected cell */}
        {selected && (
          <aside className="w-72 shrink-0 border-l border-border bg-[#18181b] p-3 space-y-3 overflow-y-auto text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{selected.col.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{selected.col.question}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="font-medium text-foreground">{selected.row.title}</div>

            <label className="block">
              <span className="text-[11px] text-muted-foreground mb-1 block">Value</span>
              <div className="flex gap-1">
                <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} placeholder="not reported" />
                <Button size="sm" onClick={saveEdit}>Save</Button>
              </div>
            </label>

            {sel?.evidence?.snippet ? (
              <div className="rounded border border-border bg-background/50 p-2 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><BookOpen className="w-3 h-3 text-amber-400" /> Evidence · p. {sel.evidence.page}</span>
                  <button
                    onClick={() => jumpToCitation({ paper_id: selected.row.paper_id, paper_title: selected.row.title, page: sel.evidence?.page, section: sel.evidence?.section, snippet: sel.evidence?.snippet || "" })}
                    className="text-primary hover:underline"
                  >
                    Open paper
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">“{sel.evidence.snippet}”</p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {sel?.value != null && sel?.edited ? "Entered by you." : "No supporting passage was found in this paper for this question."}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
