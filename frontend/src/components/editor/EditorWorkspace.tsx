"use client";

import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { TabBar } from "./TabBar";
import { MonacoEditorPane } from "./MonacoEditorPane";
import { PDFViewerPane } from "./PDFViewerPane";
import { DatasetTablePane } from "./DatasetTablePane";
import { Sparkles, Command, FileText, Database, BookOpen } from "lucide-react";

export function EditorWorkspace() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const splitActiveTabId = useWorkspaceStore((s) => s.splitActiveTabId);
  const isSplitView = useWorkspaceStore((s) => s.isSplitView);
  const setSearchModalOpen = useWorkspaceStore((s) => s.setSearchModalOpen);
  const triggerChatFocus = useWorkspaceStore((s) => s.triggerChatFocus);

  const leftActiveTab = tabs.find((t) => t.id === activeTabId && t.pane === "left");
  const rightActiveTab = tabs.find((t) => t.id === splitActiveTabId && t.pane === "right");

  const renderContent = (tab: typeof leftActiveTab) => {
    if (!tab) return null;
    switch (tab.type) {
      case "paper":
        return (
          <PDFViewerPane
            paperId={tab.resourceId}
            initialPage={tab.metadata?.page}
            initialSectionTitle={tab.metadata?.sectionTitle}
          />
        );
      case "draft":
        return <MonacoEditorPane draftId={tab.resourceId} />;
      case "dataset":
        return <DatasetTablePane datasetId={tab.resourceId} />;
      default:
        return null;
    }
  };

  if (tabs.length === 0) {
    return (
      <main className="flex-1 h-full bg-[#1e1e1e] flex flex-col items-center justify-center text-center p-6 select-none">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 text-primary">
          <Sparkles className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-white tracking-tight">
          ResearchIDE Workspace
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Open academic papers in <span className="text-primary font-mono">/library</span>, explore data in <span className="text-emerald-400 font-mono">/data</span>, or draft hypotheses in <span className="text-indigo-400 font-mono">/drafts</span>.
        </p>

        <div className="mt-6 flex flex-col gap-2 text-xs text-muted-foreground bg-card border border-border p-4 rounded-lg w-72 text-left">
          <div className="flex items-center justify-between">
            <span>Quick Open Files</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border border-border font-mono">⌘P</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Focus AI Research Chat</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border border-border font-mono">⌘K</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Toggle Split View</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border border-border font-mono">⌘\</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Toggle Explorer</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border border-border font-mono">⌘B</kbd>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 h-full flex flex-col min-w-0 overflow-hidden bg-background">
      {isSplitView ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Pane */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border overflow-hidden">
            <TabBar pane="left" />
            <div className="flex-1 min-h-0 overflow-hidden">
              {leftActiveTab ? renderContent(leftActiveTab) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  No active tab in left pane
                </div>
              )}
            </div>
          </div>

          {/* Right Split Pane */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <TabBar pane="right" />
            <div className="flex-1 min-h-0 overflow-hidden">
              {rightActiveTab ? renderContent(rightActiveTab) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  No active tab in right pane
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TabBar pane="left" />
          <div className="flex-1 min-h-0 overflow-hidden">
            {renderContent(leftActiveTab)}
          </div>
        </div>
      )}
    </main>
  );
}
