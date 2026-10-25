"use client";

import React, { useState } from "react";
import { Problem, ProblemsResponse } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  AlertCircle, AlertTriangle, Info, ShieldCheck, Loader2, Sparkles, ChevronDown, ChevronUp, BookOpen, Wand2, Crosshair,
} from "lucide-react";

interface ProblemsPanelProps {
  data: ProblemsResponse | null;
  loading: boolean;
  auditing: boolean;
  open: boolean;
  onToggle: () => void;
  onRunAudit: () => void;
  onLocate: (p: Problem) => void;
  onFix: (p: Problem) => void;
  onOpenReview: () => void;
}

const SEVERITY = {
  error: { icon: <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />, label: "Errors" },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />, label: "Warnings" },
  info: { icon: <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />, label: "Suggestions" },
} as const;

const KIND_LABEL: Record<string, string> = {
  unknown_citation: "Citation",
  missing_figure: "Figure",
  close_paraphrase: "Copied wording",
  data_mismatch: "Data",
  misattributed: "Wrong source",
  unsupported: "Unsupported",
  overstated: "Overstated",
  uncited: "Needs citation",
  open_review: "Review",
};

function timeAgo(iso?: string) {
  if (!iso) return "";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** One-line health summary shown in the editor toolbar. */
export function HealthBadge({ data, loading, onClick }: { data: ProblemsResponse | null; loading: boolean; onClick: () => void }) {
  if (!data) {
    return (
      <button onClick={onClick} className="flex items-center gap-1 px-2 h-6 rounded text-[11px] text-muted-foreground hover:bg-muted/60">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Checking…
      </button>
    );
  }
  const { errors, warnings, infos, audit } = data.summary;
  const clean = errors + warnings === 0;
  return (
    <button
      onClick={onClick}
      title="Problems found in this draft"
      className={`flex items-center gap-1.5 px-2 h-6 rounded text-[11px] border ${
        errors ? "border-rose-500/40 bg-rose-500/10" : warnings ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"
      }`}
    >
      {clean ? <ShieldCheck className="w-3 h-3 text-emerald-400" /> : null}
      {errors > 0 && <span className="flex items-center gap-0.5 text-rose-300"><AlertCircle className="w-3 h-3" />{errors}</span>}
      {warnings > 0 && <span className="flex items-center gap-0.5 text-amber-300"><AlertTriangle className="w-3 h-3" />{warnings}</span>}
      {infos > 0 && <span className="flex items-center gap-0.5 text-sky-300"><Info className="w-3 h-3" />{infos}</span>}
      {audit.ran && (
        <span className="hidden xl:inline text-muted-foreground">
          · {audit.supported}/{audit.claims} claims verified
        </span>
      )}
      {clean && !audit.ran && <span className="text-emerald-300">No problems</span>}
    </button>
  );
}

export function ProblemsPanel({ data, loading, auditing, open, onToggle, onRunAudit, onLocate, onFix, onOpenReview }: ProblemsPanelProps) {
  const jumpToCitation = useWorkspaceStore((s) => s.jumpToCitation);
  const [expanded, setExpanded] = useState<string | null>(null);
  const audit = data?.summary.audit;
  const problems = data?.problems ?? [];

  return (
    <div className={`border-t border-border bg-[#141416] flex flex-col ${open ? "h-64" : "h-8"} transition-[height] shrink-0`}>
      {/* Header */}
      <div className="h-8 px-3 flex items-center justify-between text-[11px] border-b border-border/60 shrink-0">
        <button onClick={onToggle} className="flex items-center gap-2 font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          Problems
          {data && (
            <span className="normal-case tracking-normal font-normal flex items-center gap-2">
              <span className="text-rose-300">{data.summary.errors} errors</span>
              <span className="text-amber-300">{data.summary.warnings} warnings</span>
              <span className="text-sky-300">{data.summary.infos} suggestions</span>
            </span>
          )}
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        </button>

        <div className="flex items-center gap-2">
          {audit?.ran ? (
            <span className={`text-muted-foreground ${audit.stale ? "text-amber-300" : ""}`}>
              Citation audit: {audit.supported}/{audit.claims} claims verified · {timeAgo(audit.audited_at)}
              {audit.stale && " · draft changed since"}
            </span>
          ) : (
            <span className="text-muted-foreground">Citation audit not run yet</span>
          )}
          <button
            onClick={onRunAudit}
            disabled={auditing}
            className="flex items-center gap-1 px-2 h-6 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60"
            title="Check every claim against the papers it cites and the rest of your library"
          >
            {auditing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {auditing ? "Auditing…" : audit?.ran ? "Re-run audit" : "Audit citations"}
          </button>
        </div>
      </div>

      {/* List */}
      {open && (
        <div className="flex-1 overflow-y-auto">
          {problems.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>No problems found.</span>
              {!audit?.ran && <span className="text-[11px]">Run the citation audit to verify every claim against your sources.</span>}
            </div>
          )}
          {problems.map((p) => {
            const isOpen = expanded === p.id;
            return (
              <div key={p.id} className="border-b border-border/40 text-xs">
                <div
                  onClick={() => {
                    setExpanded(isOpen ? null : p.id);
                    if (p.kind === "open_review") onOpenReview();
                    else onLocate(p);
                  }}
                  className="px-3 py-1.5 flex items-start gap-2 cursor-pointer hover:bg-muted/30"
                >
                  {SEVERITY[p.severity].icon}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{p.title}</span>
                      <span className="text-[10px] px-1.5 rounded bg-muted text-muted-foreground">{KIND_LABEL[p.kind] || p.kind}</span>
                    </div>
                    {p.excerpt && !isOpen && <div className="text-[11px] text-muted-foreground truncate">“{p.excerpt}”</div>}
                  </div>
                  {p.fix && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onFix(p); }}
                      className="shrink-0 flex items-center gap-1 px-2 h-6 rounded border border-primary/40 text-primary hover:bg-primary/15 text-[11px]"
                    >
                      <Wand2 className="w-3 h-3" /> {p.fix.label}
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="px-9 pb-2 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{p.message}</p>
                    {p.excerpt && p.kind !== "open_review" && (
                      <button onClick={() => onLocate(p)} className="flex items-start gap-1 text-left text-[11px] italic text-foreground/80 hover:text-foreground">
                        <Crosshair className="w-3 h-3 mt-0.5 shrink-0 text-primary not-italic" /> “{p.excerpt}”
                      </button>
                    )}
                    {p.source && (
                      <div className="rounded border border-border bg-background/50 p-2 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1 truncate">
                            <BookOpen className="w-3 h-3 text-amber-400 shrink-0" />
                            {p.source.key ? `@${p.source.key}` : p.source.paper_title}
                            {p.source.page ? ` · p. ${p.source.page}` : ""}
                            {p.source.section ? ` · ${p.source.section}` : ""}
                          </span>
                          <button
                            onClick={() => jumpToCitation({ paper_id: p.source!.paper_id, paper_title: p.source!.paper_title || "", page: p.source!.page, section: p.source!.section, snippet: p.source!.snippet || "" })}
                            className="text-primary hover:underline shrink-0"
                          >
                            Open source
                          </button>
                        </div>
                        {p.source.snippet && <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">“{p.source.snippet}”</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
