"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Dataset } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { FigureBuilderModal } from "@/components/modals/FigureBuilderModal";
import {
  RefreshCw,
  Database,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  BarChart2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DatasetTablePaneProps {
  datasetId: string;
}

export function DatasetTablePane({ datasetId }: DatasetTablePaneProps) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);

  useEffect(() => {
    api.getDataset(datasetId).then(setDataset).catch(() => {});
  }, [datasetId, reloadKey]);

  useEffect(() => {
    api.getDatasetPreview(datasetId, page, pageSize)
      .then((data) => {
        setColumns(data.columns);
        setRows(data.rows);
        setTotalRows(data.total_rows);
      })
      .catch((err) => console.error("Error fetching dataset preview:", err))
      .finally(() => setLoading(false));
  }, [datasetId, page, pageSize, reloadKey]);

  const replaceFile = async (file: File) => {
    setReplacing(true);
    try {
      const res = await api.replaceDatasetFile(datasetId, file);
      setPage(1);
      setReloadKey((k) => k + 1);
      refreshTree();
      const figs = res.figures_updated === 1 ? "1 linked figure" : `${res.figures_updated} linked figures`;
      pushToast(
        res.figure_errors.length
          ? `Data updated, but ${res.figure_errors.length} figure(s) could not re-render: ${res.figure_errors[0]}`
          : `Data updated (${res.row_count} rows). ${figs} re-rendered.`,
        res.figure_errors.length ? "error" : "success"
      );
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setReplacing(false);
    }
  };

  // Client-side filtering across current page
  const filteredRows = rows.filter((r) => {
    if (!filterQuery) return true;
    return Object.values(r).some((val) =>
      String(val).toLowerCase().includes(filterQuery.toLowerCase())
    );
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortCol) return 0;
    const aVal = a[sortCol];
    const bVal = b[sortCol];
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (sortAsc) return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  });

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading dataset preview...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#141416] select-none">
      {/* Table Toolbar */}
      <div className="h-9 border-b border-border bg-[#18181b] px-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
            <TableIcon className="w-3.5 h-3.5" />
            <span className="text-foreground">Data Preview</span>
          </div>
          <span className="text-muted-foreground text-[11px]">
            {totalRows.toLocaleString()} rows • {columns.length} columns
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setBuilderOpen(true)}
            disabled={!dataset}
            className="h-6 gap-1 text-[11px]"
            title="Make a publication figure from this data"
          >
            <BarChart2 className="w-3 h-3" /> Create figure
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={replacing}
            className="h-6 gap-1 text-[11px]"
            title="Upload a new version of this file; figures made from it re-render automatically"
          >
            {replacing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Replace data
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.parquet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) replaceFile(f);
            }}
          />

          {/* Quick Row Search */}
          <div className="relative w-44">
            <Search className="w-3 h-3 absolute left-2 top-2 text-muted-foreground" />
            <Input
              placeholder="Filter page rows..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="h-6 pl-7 text-[11px] bg-background/50"
            />
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-6 w-6 p-0"
            >
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <span className="text-[11px] text-muted-foreground px-1 font-mono">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-6 w-6 p-0"
            >
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sortable Table Container */}
      <div className="flex-1 overflow-auto bg-[#18181b]/50">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-[#1f1f23] sticky top-0 z-10 border-b border-border text-muted-foreground text-[11px]">
            <tr>
              <th className="p-2 border-r border-border font-mono text-[10px] w-12 text-center text-muted-foreground/60">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="p-2 border-r border-border font-medium hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{col}</span>
                    {sortCol === col && (
                      <span className="text-[9px] text-primary">
                        {sortAsc ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => (
              <tr
                key={idx}
                className="border-b border-border/40 hover:bg-muted/30 transition-colors font-mono text-[11px]"
              >
                <td className="p-1.5 border-r border-border/40 text-center text-muted-foreground/50 text-[10px]">
                  {(page - 1) * pageSize + idx + 1}
                </td>
                {columns.map((col) => (
                  <td key={col} className="p-1.5 border-r border-border/40 truncate max-w-xs">
                    {String(row[col] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dataset && <FigureBuilderModal open={builderOpen} onOpenChange={setBuilderOpen} dataset={dataset} />}
    </div>
  );
}
