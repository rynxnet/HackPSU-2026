"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ReviewComment, ReviewStatus } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { Button } from "@/components/ui/button";
import {
  MessageSquareText, ClipboardPaste, Plus, FileDown, Crosshair, Sparkles, Trash2, Loader2, X, CheckCircle2, Circle, Ban,
} from "lucide-react";

interface ReviewPanelProps {
  draftId: string;
  /** Currently selected text in the editor, used to anchor new comments. */
  getSelection: () => string;
  /** Selects and reveals a passage in the editor; returns false if it is no longer in the draft. */
  locate: (text: string) => boolean;
  onClose: () => void;
  onCountsChange?: (open: number) => void;
}

const STATUS_META: Record<ReviewStatus, { label: string; className: string; icon: React.ReactNode }> = {
  open: { label: "Open", className: "text-amber-300 border-amber-400/40 bg-amber-400/10", icon: <Circle className="w-2.5 h-2.5" /> },
  addressed: { label: "Addressed", className: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10", icon: <CheckCircle2 className="w-2.5 h-2.5" /> },
  declined: { label: "Declined", className: "text-muted-foreground border-border bg-muted/40", icon: <Ban className="w-2.5 h-2.5" /> },
};
const NEXT_STATUS: Record<ReviewStatus, ReviewStatus> = { open: "addressed", addressed: "declined", declined: "open" };

export function ReviewPanel({ draftId, getSelection, locate, onClose, onCountsChange }: ReviewPanelProps) {
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [comments, setComments] = useState<ReviewComment[] | null>(null);
  const [mode, setMode] = useState<"list" | "import" | "add">("list");
  const [importText, setImportText] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newAnchor, setNewAnchor] = useState("");
  const [newReviewer, setNewReviewer] = useState("Reviewer 1");
  const [filter, setFilter] = useState<"all" | "open">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // unsaved response text per comment

  useEffect(() => {
    setComments(null);
    api.getReviewComments(draftId).then(setComments).catch((e) => pushToast(e.message, "error"));
  }, [draftId]);

  useEffect(() => {
    if (comments) onCountsChange?.(comments.filter((c) => c.status === "open").length);
  }, [comments]);

  const replace = (updated: ReviewComment) => setComments((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);

  const runImport = async () => {
    if (!importText.trim()) return;
    try {
      const created = await api.importReviewComments(draftId, importText);
      setComments((prev) => [...(prev ?? []), ...created]);
      setImportText("");
      setMode("list");
      const anchored = created.filter((c) => c.anchor_text).length;
      pushToast(`Imported ${created.length} comment${created.length === 1 ? "" : "s"}${anchored ? `, ${anchored} linked to passages` : ""}`, "success");
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const startAdd = () => {
    setNewAnchor(getSelection());
    setNewBody("");
    setMode("add");
  };

  const runAdd = async () => {
    if (!newBody.trim()) return;
    try {
      const created = await api.addReviewComment(draftId, { body: newBody, reviewer: newReviewer, anchor_text: newAnchor || undefined });
      setComments((prev) => [...(prev ?? []), created]);
      setMode("list");
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const cycleStatus = async (c: ReviewComment) => {
    try {
      replace(await api.updateReviewComment(c.id, { status: NEXT_STATUS[c.status] }));
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const saveResponse = async (c: ReviewComment) => {
    const text = drafts[c.id];
    if (text === undefined || text === c.response) return;
    try {
      replace(await api.updateReviewComment(c.id, { response: text }));
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const suggest = async (c: ReviewComment) => {
    setBusyId(c.id);
    try {
      const suggestion = await api.suggestReviewResponse(c.id);
      setDrafts((d) => ({ ...d, [c.id]: suggestion }));
      replace(await api.updateReviewComment(c.id, { response: suggestion }));
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: ReviewComment) => {
    try {
      await api.deleteReviewComment(c.id);
      setComments((prev) => prev?.filter((x) => x.id !== c.id) ?? null);
    } catch (e: any) {
      pushToast(e.message, "error");
    }
  };

  const visible = (comments ?? []).filter((c) => filter === "all" || c.status === "open");
  const openCount = (comments ?? []).filter((c) => c.status === "open").length;

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-[#141416] flex flex-col min-h-0">
      <div className="h-9 px-3 border-b border-border flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold">
          <MessageSquareText className="w-3.5 h-3.5 text-primary" />
          Peer review
          {comments && (
            <span className="text-[10px] font-normal text-muted-foreground">
              {openCount} open / {comments.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label="Close review panel">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 border-b border-border flex items-center gap-1">
        <Button size="sm" variant="outline" className="h-7 gap-1 flex-1" onClick={() => setMode(mode === "import" ? "list" : "import")}>
          <ClipboardPaste className="w-3 h-3" /> Paste review
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 flex-1" onClick={startAdd} title="Select text in the draft first to anchor the comment">
          <Plus className="w-3 h-3" /> Comment
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          title="Download response-to-reviewers letter"
          onClick={() => api.downloadResponseLetter(draftId).catch((e) => pushToast(e.message, "error"))}
        >
          <FileDown className="w-3 h-3" />
        </Button>
      </div>

      {mode === "import" && (
        <div className="p-2 border-b border-border space-y-1.5">
          <textarea
            autoFocus
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={"Paste the decision letter or reviews.\n\nReviewer 1\n1. The claim that \"...\" needs support.\n2. Please report variance.\n\nReviewer 2\n- ..."}
            className="w-full h-40 resize-none rounded-md border border-border bg-background p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-muted-foreground">Split by reviewer and numbered points. Quoted passages get linked.</span>
            <Button size="sm" className="h-7" onClick={runImport} disabled={!importText.trim()}>Import</Button>
          </div>
        </div>
      )}

      {mode === "add" && (
        <div className="p-2 border-b border-border space-y-1.5 text-xs">
          <input
            value={newReviewer}
            onChange={(e) => setNewReviewer(e.target.value)}
            className="w-full h-7 rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Reviewer"
          />
          {newAnchor ? (
            <div className="rounded border border-primary/30 bg-primary/5 p-1.5 text-[11px] text-muted-foreground italic line-clamp-3">"{newAnchor}"</div>
          ) : (
            <div className="text-[10px] text-muted-foreground">Tip: select a passage in the draft first to link this comment to it.</div>
          )}
          <textarea
            autoFocus
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Reviewer's comment..."
            className="w-full h-20 resize-none rounded-md border border-border bg-background p-2 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setMode("list")}>Cancel</Button>
            <Button size="sm" className="h-7" onClick={runAdd} disabled={!newBody.trim()}>Add</Button>
          </div>
        </div>
      )}

      {comments && comments.length > 0 && (
        <div className="px-2 pt-2 flex gap-1 text-[11px]">
          {(["all", "open"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded ${filter === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "All" : "Open only"}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {comments === null && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /></div>}
        {comments?.length === 0 && mode === "list" && (
          <div className="text-center text-[11px] text-muted-foreground py-8 px-3 leading-relaxed">
            Got reviews back? Click <b>Paste review</b> to turn them into a checklist you can answer next to your manuscript,
            then download a ready-made response letter.
          </div>
        )}
        {visible.map((c) => {
          const meta = STATUS_META[c.status];
          const responseText = drafts[c.id] ?? c.response;
          return (
            <div key={c.id} className="rounded-md border border-border bg-background/40 p-2 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.reviewer}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => cycleStatus(c)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${meta.className}`}
                    title="Click to change status"
                  >
                    {meta.icon} {meta.label}
                  </button>
                  <button onClick={() => remove(c)} className="p-0.5 text-muted-foreground hover:text-rose-400" aria-label="Delete comment">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <p className="text-foreground leading-relaxed">{c.body}</p>
              {c.anchor_text && (
                <button
                  onClick={() => {
                    if (!locate(c.anchor_text!)) pushToast("That passage is no longer in the draft (it may have been revised).", "info");
                  }}
                  className="w-full text-left flex items-start gap-1 rounded border border-primary/20 bg-primary/5 p-1.5 text-[11px] text-muted-foreground italic hover:border-primary/50"
                  title="Show this passage in the draft"
                >
                  <Crosshair className="w-3 h-3 mt-0.5 shrink-0 text-primary not-italic" />
                  <span className="line-clamp-2">"{c.anchor_text}"</span>
                </button>
              )}
              <textarea
                value={responseText}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                onBlur={() => saveResponse(c)}
                placeholder="Your response..."
                className="w-full min-h-[56px] resize-y rounded border border-border bg-background p-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex justify-between items-center">
                <button
                  onClick={() => suggest(c)}
                  disabled={busyId === c.id}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary disabled:opacity-50"
                >
                  {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {busyId === c.id ? "Drafting..." : "Draft a response with AI"}
                </button>
                {drafts[c.id] !== undefined && drafts[c.id] !== c.response && (
                  <span className="text-[10px] text-amber-400">unsaved</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
