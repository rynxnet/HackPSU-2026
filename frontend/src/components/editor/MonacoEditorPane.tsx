"use client";

import React, { useEffect, useState, useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { api } from "@/lib/api";
import { Draft } from "@/lib/types";
import { Check, Loader2, Save } from "lucide-react";

interface MonacoEditorPaneProps {
  draftId: string;
}

export function MonacoEditorPane({ draftId }: MonacoEditorPaneProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState("");
  const [savingStatus, setSavingStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    api.getDraft(draftId)
      .then((data) => {
        setDraft(data);
        setContent(data.content);
        setSavingStatus("saved");
      })
      .catch((err) => console.error("Error loading draft:", err));
  }, [draftId]);

  const handleEditorChange = (value: string | undefined) => {
    const newContent = value || "";
    setContent(newContent);
    setSavingStatus("unsaved");

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Debounced autosave after 800ms
    saveTimerRef.current = setTimeout(async () => {
      setSavingStatus("saving");
      try {
        await api.updateDraft(draftId, { content: newContent });
        setSavingStatus("saved");
      } catch (e) {
        console.error("Autosave failed:", e);
        setSavingStatus("unsaved");
      }
    }, 800);
  };

  const getLanguage = () => {
    if (!draft) return "markdown";
    if (draft.title.endsWith(".tex") || draft.content_type === "latex") return "latex";
    if (draft.title.endsWith(".py") || draft.content_type === "python") return "python";
    if (draft.title.endsWith(".json")) return "json";
    return "markdown";
  };

  if (!draft) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading draft...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Editor Main */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={getLanguage()}
          value={content}
          theme="vs-dark"
          onChange={handleEditorChange}
          options={{
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
            wordWrap: "on",
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            fontFamily: "JetBrains Mono, Menlo, monospace",
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>

      {/* Editor Status Bar */}
      <div className="h-6 border-t border-border bg-[#18181b] px-3 flex items-center justify-between text-[11px] text-muted-foreground select-none">
        <div className="flex items-center gap-3">
          <span className="font-mono">{getLanguage().toUpperCase()}</span>
          <span>{content.split(/\s+/).filter(Boolean).length} words</span>
          <span>{content.length} characters</span>
        </div>

        <div className="flex items-center gap-1.5">
          {savingStatus === "saving" && (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              <span>Autosaving...</span>
            </>
          )}
          {savingStatus === "saved" && (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span>Saved</span>
            </>
          )}
          {savingStatus === "unsaved" && (
            <span className="text-amber-400">● Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}
