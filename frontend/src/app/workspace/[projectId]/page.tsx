"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TopBar } from "@/components/layout/TopBar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { EditorWorkspace } from "@/components/editor/EditorWorkspace";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { GlobalSearchModal } from "@/components/modals/GlobalSearchModal";
import { UploadModal } from "@/components/modals/UploadModal";
import { ImportDoiModal } from "@/components/modals/ImportDoiModal";
import { NewProjectModal } from "@/components/modals/NewProjectModal";

export default function WorkspacePage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);

  // Initialize keyboard shortcuts (Cmd+P, Cmd+K, Cmd+\, Cmd+B)
  useKeyboardShortcuts();

  useEffect(() => {
    if (projectId) {
      setActiveProject(projectId);
    }
  }, [projectId, setActiveProject]);

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
    </div>
  );
}
