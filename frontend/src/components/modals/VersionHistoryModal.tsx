"use client";

import React, { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { DraftVersion } from "@/lib/types";
import { History, Loader2, RotateCcw, Save, Tag } from "lucide-react";

interface VersionHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: string;
  currentContent: string;
  language: string;
  beforeSnapshot: () => Promise<void>;
  onRestored: (content: string) => void;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function VersionHistoryModal({ open, onOpenChange, draftId, currentContent, language, beforeSnapshot, onRestored }: VersionHistoryModalProps) {
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [versions, setVersions] = useState<DraftVersion[] | null>(null);
  const [selected, setSelected] = useState<DraftVersion | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (selectId?: string) => {
    const list = await api.getDraftVersions(draftId);
    setVersions(list);
    const target = list.find((v) => v.id === selectId) || list[0];
    if (target) setSelected(await api.getDraftVersion(target.id));
    else setSelected(null);
  };

  useEffect(() => {
    if (open) {
      setVersions(null);
      setLabel("");
      load().catch((e) => pushToast(e.message, "error"));
    }
  }, [open, draftId]);

  const select = async (v: DraftVersion) => {
    setSelected(await api.getDraftVersion(v.id));
  };

  const saveVersion = async () => {
    setBusy(true);
    try {
      await beforeSnapshot();
      const v = await api.saveDraftVersion(draftId, label.trim() || undefined);
      setLabel("");
      await load(v.id);
      pushToast(`Saved version v${v.version}`, "success");
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await beforeSnapshot();
      const draft = await api.restoreDraftVersion(selected.id);
      onRestored(draft.content);
      pushToast(`Restored v${selected.version}. Your previous text was saved as a version.`, "success");
      onOpenChange(false);
    } catch (e: any) {
      pushToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const unchanged = selected?.content === currentContent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[85vh] bg-[#18181b] border-border flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            Version history
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Checkpoints are saved automatically every few minutes while you write. Compare any version with your current draft.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex gap-3">
          {/* Version list */}
          <div className="w-60 shrink-0 flex flex-col border border-border rounded-md overflow-hidden">
            <div className="p-2 border-b border-border space-y-1.5 bg-background/40">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveVersion()}
                placeholder='Label, e.g. "Submitted to ACL"'
                className="h-7 text-xs"
              />
              <Button size="sm" onClick={saveVersion} disabled={busy} className="w-full gap-1.5">
                <Save className="w-3 h-3" /> Save current as version
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
              {versions === null && (
                <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /></div>
              )}
              {versions?.length === 0 && (
                <div className="text-[11px] text-muted-foreground text-center py-6 px-2">No versions yet. Keep writing, or save one now.</div>
              )}
              {versions?.map((v) => (
                <button
                  key={v.id}
                  onClick={() => select(v)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs ${selected?.id === v.id ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono">v{v.version}</span>
                    <span className="text-[10px]">{timeAgo(v.created_at)}</span>
                  </div>
                  {v.label && (
                    <div className="flex items-center gap-1 text-[11px] text-amber-300 truncate">
                      <Tag className="w-2.5 h-2.5 shrink-0" /> {v.label}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground/70">{v.word_count} words</div>
                </button>
              ))}
            </div>
          </div>

          {/* Diff */}
          <div className="flex-1 min-w-0 flex flex-col border border-border rounded-md overflow-hidden">
            <div className="h-8 px-3 flex items-center justify-between border-b border-border bg-background/40 text-[11px] text-muted-foreground">
              <span>
                {selected ? <>v{selected.version}{selected.label ? ` · ${selected.label}` : ""} <span className="mx-1">→</span> current draft</> : "Select a version"}
                {unchanged && <span className="ml-2 text-emerald-400">identical</span>}
              </span>
              <Button size="sm" variant="outline" onClick={restore} disabled={!selected || busy || unchanged} className="h-6 gap-1">
                <RotateCcw className="w-3 h-3" /> Restore this version
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              {selected ? (
                <DiffEditor
                  height="100%"
                  language={language}
                  original={selected.content || ""}
                  modified={currentContent}
                  // Reuse the models instead of disposing them on close; disposing first crashes the diff widget
                  originalModelPath={`history-original-${draftId}`}
                  modifiedModelPath={`history-current-${draftId}`}
                  keepCurrentOriginalModel
                  keepCurrentModifiedModel
                  theme="vs-dark"
                  options={{ readOnly: true, renderSideBySide: true, wordWrap: "on", minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No version selected</div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
