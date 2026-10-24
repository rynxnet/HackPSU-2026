"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { figureSnippet } from "@/lib/citations";
import { api } from "@/lib/api";
import { Dataset, Figure, FigureSpec } from "@/lib/types";
import { BarChart2, LineChart, ScatterChart, BarChartHorizontal, Loader2, FileInput, ArrowLeft } from "lucide-react";

interface FigureBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset;
}

const CHARTS: { id: FigureSpec["chart"]; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "line", label: "Line", icon: <LineChart className="w-4 h-4" />, hint: "Trends over an ordered x" },
  { id: "bar", label: "Bar", icon: <BarChart2 className="w-4 h-4" />, hint: "Compare categories (averages repeated x values)" },
  { id: "scatter", label: "Scatter", icon: <ScatterChart className="w-4 h-4" />, hint: "Relationship between two variables" },
  { id: "histogram", label: "Histogram", icon: <BarChartHorizontal className="w-4 h-4" />, hint: "Distribution of one column" },
];

const isNumericType = (t: string) => /int|float|double|decimal|number/i.test(t);

export function FigureBuilderModal({ open, onOpenChange, dataset }: FigureBuilderModalProps) {
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const openTab = useWorkspaceStore((s) => s.openTab);

  const columns = dataset.column_info || [];
  const numeric = useMemo(() => columns.filter((c) => isNumericType(c.type)).map((c) => c.name), [columns]);
  const nonNumeric = columns.filter((c) => !isNumericType(c.type)).map((c) => c.name);

  const [chart, setChart] = useState<FigureSpec["chart"]>("line");
  const [x, setX] = useState("");
  const [y, setY] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Figure | null>(null);

  // Sensible defaults: categorical x for bars, first numeric otherwise
  useEffect(() => {
    if (!open) return;
    setCreated(null);
    const defaultChart: FigureSpec["chart"] = nonNumeric.length > 0 ? "bar" : "line";
    setChart(defaultChart);
    setX(nonNumeric[0] || numeric[0] || columns[0]?.name || "");
    setY(numeric.filter((c) => c !== (nonNumeric[0] || numeric[0])).slice(0, 1));
    setTitle("");
    setCaption("");
  }, [open, dataset.id]);

  const toggleY = (col: string) => setY((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));

  const yChoices = numeric.filter((c) => c !== x);
  const canCreate = !!x && (chart === "histogram" || y.length > 0);

  const create = async () => {
    setBusy(true);
    try {
      const fig = await api.createFigure(dataset.id, { chart, x, y: chart === "histogram" ? [] : y, title: title || undefined, caption: caption || undefined });
      setCreated(fig);
      refreshTree();
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
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            {created ? "Figure ready" : `Create figure from ${dataset.name}`}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {created
              ? "It stays linked to the dataset: replace the data file and this figure re-renders everywhere it's used."
              : "Rendered as a 300 dpi publication-style PNG, ready for your manuscript."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <div className="bg-white rounded border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={created.image_url} alt={created.caption} className="w-full" />
            </div>
            <div className="text-xs">
              <div className="font-mono text-sky-300">figure:{created.label}</div>
              <div className="text-muted-foreground">{created.caption}</div>
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t border-border">
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => setCreated(null)}>
                <ArrowLeft className="w-3 h-3" /> Make another
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    openTab({ resourceId: created.id, title: `${created.label}.png`, type: "figure" });
                    onOpenChange(false);
                  }}
                >
                  Open figure
                </Button>
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    if (insertIntoDraft(figureSnippet(created), "Figure")) onOpenChange(false);
                  }}
                >
                  <FileInput className="w-3 h-3" /> Insert into draft
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-4 gap-1.5">
              {CHARTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChart(c.id)}
                  title={c.hint}
                  className={`flex flex-col items-center gap-1 py-2 rounded-md border ${chart === c.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                >
                  {c.icon}
                  <span className="text-[11px]">{c.label}</span>
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-[11px] text-muted-foreground mb-1 block">{chart === "histogram" ? "Column" : "X axis"}</span>
              <select
                value={x}
                onChange={(e) => {
                  setX(e.target.value);
                  setY((prev) => prev.filter((c) => c !== e.target.value));
                }}
                className="w-full h-8 rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {(chart === "histogram" ? numeric : columns.map((c) => c.name)).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            {chart !== "histogram" && (
              <div>
                <span className="text-[11px] text-muted-foreground mb-1 block">Y axis (numeric, pick one or more)</span>
                {yChoices.length === 0 ? (
                  <div className="text-[11px] text-amber-400">This dataset has no other numeric columns to plot.</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {yChoices.map((c) => (
                      <button
                        key={c}
                        onClick={() => toggleY(c)}
                        className={`px-2 py-1 rounded border font-mono text-[11px] ${y.includes(c) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground mb-1 block">Title (optional)</span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shown above the chart" />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground mb-1 block">Caption</span>
                <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Used in the manuscript" />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={create} disabled={!canCreate || busy} className="gap-1.5">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                {busy ? "Rendering..." : "Create figure"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
