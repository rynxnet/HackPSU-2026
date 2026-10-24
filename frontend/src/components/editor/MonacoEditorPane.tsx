"use client";

import React, { useCallback, useEffect, useState, useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { api } from "@/lib/api";
import { Draft, Figure } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { DraftPreview } from "./DraftPreview";
import { ReviewPanel } from "./ReviewPanel";
import { CitePickerModal } from "@/components/modals/CitePickerModal";
import { FigurePickerModal } from "@/components/modals/FigurePickerModal";
import { ExportModal } from "@/components/modals/ExportModal";
import { VersionHistoryModal } from "@/components/modals/VersionHistoryModal";
import {
  Check, Loader2, BookOpen, BarChart2, Eye, EyeOff, History, MessageSquareText, FileDown,
} from "lucide-react";

interface MonacoEditorPaneProps {
  draftId: string;
}

type MonacoEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];

// Completion providers are global to the Monaco instance, so register them once
let citationCompletionRegistered = false;

function registerCitationCompletion(monaco: MonacoApi) {
  if (citationCompletionRegistered) return;
  citationCompletionRegistered = true;

  // Monaco ships without LaTeX; register a minimal language so .tex drafts get highlighting and completion
  if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "latex")) {
    monaco.languages.register({ id: "latex", extensions: [".tex"] });
    monaco.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%.*$/, "comment"],
          [/\\[a-zA-Z@]+\*?/, "keyword"],
          [/\$\$/, { token: "string", next: "@displaymath" }],
          [/\$/, { token: "string", next: "@math" }],
          [/[{}]/, "delimiter.bracket"],
          [/\[|\]/, "delimiter.square"],
        ],
        math: [[/[^$\\]+/, "string"], [/\\[a-zA-Z]+/, "string"], [/\$/, { token: "string", next: "@pop" }]],
        displaymath: [[/[^$]+/, "string"], [/\$\$/, { token: "string", next: "@pop" }]],
      },
    });
  }

  const provide = (pattern: RegExp) => (model: any, position: any) => {
    const line = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
    const m = line.match(pattern);
    if (!m) return { suggestions: [] };
    const word = model.getWordUntilPosition(position);
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    const { bibliography } = useWorkspaceStore.getState();
    return {
      suggestions: bibliography.map((e) => ({
        label: e.key,
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: e.short,
        documentation: e.formatted,
        insertText: e.key,
        filterText: `${e.key} ${e.title} ${e.authors.join(" ")}`,
        range,
      })),
    };
  };

  // Markdown: [@key  or  [@a; @key
  monaco.languages.registerCompletionItemProvider("markdown", {
    triggerCharacters: ["@"],
    provideCompletionItems: provide(/\[(?:[^\]]*;\s*)?@[\w:.-]*$/),
  });
  // LaTeX: \cite{key  \citep[p.~2]{a,key
  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["{", ","],
    provideCompletionItems: provide(/\\cite[a-zA-Z]*(\[[^\]]*\])?\{[^}]*$/),
  });
}

export function MonacoEditorPane({ draftId }: MonacoEditorPaneProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [content, setContent] = useState("");
  const [savingStatus, setSavingStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingContentRef = useRef<string | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [openReviewCount, setOpenReviewCount] = useState<number | null>(null);
  const [modal, setModal] = useState<null | "cite" | "figure" | "export" | "history">(null);
  const [figures, setFigures] = useState<Figure[]>([]);

  const bibliography = useWorkspaceStore((s) => s.bibliography);
  const treeVersion = useWorkspaceStore((s) => s.treeVersion);
  const setDraftTarget = useWorkspaceStore((s) => s.setDraftTarget);
  const detachDraftTarget = useWorkspaceStore((s) => s.detachDraftTarget);

  useEffect(() => {
    api.getDraft(draftId)
      .then((data) => {
        setDraft(data);
        setContent(data.content);
        setSavingStatus("saved");
      })
      .catch((err) => console.error("Error loading draft:", err));
    api.getReviewComments(draftId)
      .then((c) => setOpenReviewCount(c.filter((x) => x.status === "open").length))
      .catch(() => {});
  }, [draftId]);

  // Figures are needed for the preview; refresh when a figure is created or re-rendered
  useEffect(() => {
    if (draft && showPreview) api.getFigures(draft.project_id).then(setFigures).catch(() => {});
  }, [draft?.project_id, showPreview, treeVersion]);

  const save = async (value: string) => {
    setSavingStatus("saving");
    try {
      await api.updateDraft(draftId, { content: value });
      if (pendingContentRef.current === value) pendingContentRef.current = null;
      setSavingStatus(pendingContentRef.current === null ? "saved" : "unsaved");
    } catch (e) {
      console.error("Autosave failed:", e);
      setSavingStatus("unsaved");
    }
  };

  /** Saves immediately if an autosave is pending (used before export / snapshots). */
  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingContentRef.current !== null) await save(pendingContentRef.current);
  }, [draftId]);

  // When the tab is hidden or closed, flush pending edits and keep this draft as the insert target
  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;
  const cursorOffsetRef = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    detachDraftTarget(draftId, cursorOffsetRef.current, flushSaveRef.current());
  }, [draftId, detachDraftTarget]);

  const handleEditorChange = (value: string | undefined) => {
    const newContent = value || "";
    setContent(newContent);
    setSavingStatus("unsaved");
    pendingContentRef.current = newContent;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Debounced autosave after 800ms
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      save(newContent);
    }, 800);
  };

  const getLanguage = () => {
    if (!draft) return "markdown";
    if (draft.title.endsWith(".tex") || draft.content_type === "latex") return "latex";
    if (draft.title.endsWith(".py") || draft.content_type === "python") return "python";
    if (draft.title.endsWith(".json")) return "json";
    return "markdown";
  };
  const language = getLanguage();

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const selection = editor.getSelection() ?? {
      startLineNumber: model.getLineCount(), startColumn: model.getLineMaxColumn(model.getLineCount()),
      endLineNumber: model.getLineCount(), endColumn: model.getLineMaxColumn(model.getLineCount()),
    };
    editor.executeEdits("researchide-insert", [{ range: selection as any, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
  }, []);

  const registerAsTarget = useCallback(() => {
    if (!draft) return;
    setDraftTarget({ draftId, title: draft.title, contentType: language, insert: insertAtCursor });
  }, [draft, draftId, language, insertAtCursor, setDraftTarget]);

  // The most recently opened or focused draft receives inserts from chat, papers and figures
  useEffect(() => {
    if (draft && editorRef.current) registerAsTarget();
  }, [draft, registerAsTarget]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.onDidFocusEditorText(() => registerAsTargetRef.current());
    // Remembered so inserts still land at the cursor after this tab is hidden
    editor.onDidChangeCursorPosition((e) => {
      const model = editor.getModel();
      if (model) cursorOffsetRef.current = model.getOffsetAt(e.position);
    });
    registerAsTargetRef.current();
  };
  const registerAsTargetRef = useRef(registerAsTarget);
  registerAsTargetRef.current = registerAsTarget;

  const getSelectionText = () => {
    const editor = editorRef.current;
    const sel = editor?.getSelection();
    if (!editor || !sel || sel.isEmpty()) return "";
    return editor.getModel()?.getValueInRange(sel).trim() || "";
  };

  const locate = (text: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return false;
    const candidates = [text, text.slice(0, 80), text.split(/\s+/).slice(0, 6).join(" ")];
    for (const needle of candidates) {
      if (needle.trim().length < 8) continue;
      const match = model.findMatches(needle, false, false, false, null, false)[0];
      if (match) {
        editor.setSelection(match.range);
        editor.revealRangeInCenter(match.range);
        editor.focus();
        return true;
      }
    }
    return false;
  };

  const handleRestored = (restored: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingContentRef.current = null;
    setContent(restored);
    setSavingStatus("saved");
  };

  if (!draft) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading draft...
      </div>
    );
  }

  const isMarkdown = language === "markdown";
  const isLatex = language === "latex";
  const canCite = isMarkdown || isLatex;

  const ToolButton = ({ onClick, active, icon, label, title, badge }: { onClick: () => void; active?: boolean; icon: React.ReactNode; label: string; title: string; badge?: number | null }) => (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-2 h-6 rounded text-[11px] transition-colors ${
        active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
      {!!badge && <span className="ml-0.5 px-1 rounded-full bg-amber-400/20 text-amber-300 text-[9px] font-semibold">{badge}</span>}
    </button>
  );

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="h-8 border-b border-border bg-[#18181b] px-2 flex items-center gap-0.5 select-none">
        {canCite && (
          <>
            <ToolButton onClick={() => { registerAsTarget(); setModal("cite"); }} icon={<BookOpen className="w-3 h-3 text-amber-400" />} label="Cite" title={isMarkdown ? "Insert citation (or type [@ to autocomplete)" : "Insert citation (or type \\cite{ to autocomplete)"} />
            <ToolButton onClick={() => { registerAsTarget(); setModal("figure"); }} icon={<BarChart2 className="w-3 h-3 text-emerald-400" />} label="Figure" title="Insert a figure linked to a dataset" />
            <div className="w-px h-4 bg-border mx-1" />
          </>
        )}
        {isMarkdown && (
          <ToolButton
            onClick={() => setShowPreview((v) => !v)}
            active={showPreview}
            icon={showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            label="Preview"
            title="Side-by-side manuscript preview with formatted citations and figures"
          />
        )}
        <ToolButton onClick={async () => { await flushSave(); setModal("history"); }} icon={<History className="w-3 h-3" />} label="History" title="Version history and diffs" />
        <ToolButton
          onClick={() => setShowReview((v) => !v)}
          active={showReview}
          icon={<MessageSquareText className="w-3 h-3" />}
          label="Review"
          title="Reviewer comments, responses and response letter"
          badge={openReviewCount}
        />
        <div className="flex-1" />
        {canCite && (
          <button
            onClick={() => setModal("export")}
            className="flex items-center gap-1 px-2.5 h-6 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90"
            title="Export to a journal template (LaTeX zip for Overleaf)"
          >
            <FileDown className="w-3 h-3" />
            Export
          </button>
        )}
      </div>

      {/* Editor + optional preview + optional review panel */}
      <div className="flex-1 min-h-0 flex">
        <div className={`min-w-0 ${showPreview ? "w-1/2 border-r border-border" : "flex-1"}`}>
          <Editor
            height="100%"
            language={language}
            value={content}
            theme="vs-dark"
            onChange={handleEditorChange}
            beforeMount={registerCitationCompletion}
            onMount={handleMount}
            options={{
              fontSize: 13,
              lineHeight: 20,
              minimap: { enabled: false },
              wordWrap: "on",
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              fontFamily: "JetBrains Mono, Menlo, monospace",
              padding: { top: 12, bottom: 12 },
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
            }}
          />
        </div>
        {showPreview && isMarkdown && (
          <div className="w-1/2 min-w-0">
            <DraftPreview content={content} bibliography={bibliography} figures={figures} />
          </div>
        )}
        {showReview && (
          <ReviewPanel
            draftId={draftId}
            getSelection={getSelectionText}
            locate={locate}
            onClose={() => setShowReview(false)}
            onCountsChange={setOpenReviewCount}
          />
        )}
      </div>

      {/* Editor Status Bar */}
      <div className="h-6 border-t border-border bg-[#18181b] px-3 flex items-center justify-between text-[11px] text-muted-foreground select-none">
        <div className="flex items-center gap-3">
          <span className="font-mono">{language.toUpperCase()}</span>
          <span>{content.split(/\s+/).filter(Boolean).length} words</span>
          <span>{content.length} characters</span>
          {canCite && <span className="hidden md:inline text-muted-foreground/60">Type {isMarkdown ? "[@" : "\\cite{"} to cite</span>}
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

      <CitePickerModal open={modal === "cite"} onOpenChange={(o) => setModal(o ? "cite" : null)} projectId={draft.project_id} />
      <FigurePickerModal open={modal === "figure"} onOpenChange={(o) => setModal(o ? "figure" : null)} projectId={draft.project_id} />
      <ExportModal
        open={modal === "export"}
        onOpenChange={(o) => setModal(o ? "export" : null)}
        draftId={draftId}
        draftTitle={draft.title}
        isLatex={isLatex}
        beforeExport={flushSave}
      />
      <VersionHistoryModal
        open={modal === "history"}
        onOpenChange={(o) => setModal(o ? "history" : null)}
        draftId={draftId}
        currentContent={content}
        language={language}
        beforeSnapshot={flushSave}
        onRestored={handleRestored}
      />
    </div>
  );
}
