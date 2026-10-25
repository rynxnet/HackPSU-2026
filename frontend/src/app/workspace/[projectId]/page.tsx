"use client";

import React, { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TopBar } from "@/components/layout/TopBar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { EditorWorkspace } from "@/components/editor/EditorWorkspace";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { GlobalSearchModal } from "@/components/modals/GlobalSearchModal";
import { UploadModal } from "@/components/modals/UploadModal";
import { ImportDoiModal } from "@/components/modals/ImportDoiModal";
import { NewProjectModal } from "@/components/modals/NewProjectModal";
import { Toaster } from "@/components/ui/toaster";

export default function WorkspacePage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const loadBibliography = useWorkspaceStore((s) => s.loadBibliography);
  const treeVersion = useWorkspaceStore((s) => s.treeVersion);

  // Initialize keyboard shortcuts (Cmd+P, Cmd+K, Cmd+\, Cmd+B)
  useKeyboardShortcuts();

  useEffect(() => {
    if (projectId) {
      setActiveProject(projectId);
    }
  }, [projectId, setActiveProject]);

  // Manuscript first: opening a project lands in its most recently edited draft, not an empty screen
  const openTab = useWorkspaceStore((s) => s.openTab);
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || openedFor.current === projectId) return;
    openedFor.current = projectId;
    api.getDrafts(projectId)
      .then((drafts) => {
        const state = useWorkspaceStore.getState();
        if (state.activeProjectId !== projectId || state.tabs.length > 0 || drafts.length === 0) return;
        const latest = [...drafts].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
        openTab({ resourceId: latest.id, title: latest.title, type: "draft", metadata: { contentType: latest.content_type } });
      })
      .catch(() => {});
  }, [projectId, openTab]);

  // Citation keys are needed by chat, the paper reader and the editor; refresh when files change
  useEffect(() => {
    if (projectId) loadBibliography(projectId, true).catch(() => {});
  }, [projectId, treeVersion, loadBibliography]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* 1. Top Bar */}
      <TopBar />

      {/* 2. Main IDE Workspace Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Sidebar: /library, /data, /drafts */}
        <LeftSidebar />

        {/* Center: Monaco, PDF.js, Sortable Datasets, Split View */}
        <EditorWorkspace />

        {/* Right Panel: Gemini Chat with Grounded Citations */}
        <ChatPanel />
      </div>

      {/* 3. Global Modals */}
      <GlobalSearchModal />
      <UploadModal />
      <ImportDoiModal />
      <NewProjectModal />
      <Toaster />
    </div>
  );
}
