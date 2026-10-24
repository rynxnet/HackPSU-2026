"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { FileTreeItem } from "@/lib/types";
import { FileTree } from "./FileTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  FolderGit2,
  PanelLeftClose,
  ChevronLeft,
} from "lucide-react";

export function LeftSidebar() {
  // The URL is the source of truth for the open project; the store can briefly
  // hold the previous project's id while navigating
  const params = useParams();
  const storeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeProjectId = (params?.projectId as string | undefined) ?? storeProjectId;
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useWorkspaceStore((s) => s.setSidebarCollapsed);
  const setUploadModalOpen = useWorkspaceStore((s) => s.setUploadModalOpen);
  const setImportDoiModalOpen = useWorkspaceStore((s) => s.setImportDoiModalOpen);

  const [tree, setTree] = useState<FileTreeItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Bumped on every fetch so only the newest response is applied; responses can
  // arrive out of order while navigating between projects
  const requestSeq = useRef(0);

  const fetchTree = async () => {
    if (!activeProjectId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await api.getProjectTree(activeProjectId);
      if (seq !== requestSeq.current) return;
      setTree(res.tree);
    } catch (e) {
      console.error(e);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    setTree([]);
    fetchTree();
  }, [activeProjectId]);

  // Other panels (figure builder, uploads) bump treeVersion after changing project files
  const treeVersion = useWorkspaceStore((s) => s.treeVersion);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  useEffect(() => {
    if (treeVersion > 0) fetchTree();
  }, [treeVersion]);

  // While papers are still being parsed, poll so status icons and the bibliography update on their own
  const parsing = tree.some((folder) =>
    (folder.children || []).some((c) => c.type === "paper" && (c.status === "pending" || c.status === "processing"))
  );
  useEffect(() => {
    if (!parsing) return;
    const timer = setTimeout(refreshTree, 3000);
    return () => clearTimeout(timer);
  }, [parsing, tree, refreshTree]);

  // Listen for custom draft creation events from file tree
  useEffect(() => {
    const handleCreateDraft = async (e: any) => {
      if (!activeProjectId) return;
      try {
        await api.createDraft(activeProjectId, e.detail.title);
        fetchTree();
      } catch (err) {
        alert("Failed to create draft");
      }
    };

    window.addEventListener("create-draft", handleCreateDraft);
    return () => window.removeEventListener("create-draft", handleCreateDraft);
  }, [activeProjectId]);

  if (sidebarCollapsed) {
    return (
      <div className="w-9 border-r border-border bg-[#141416] flex flex-col items-center py-2 select-none">
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-white"
          title="Expand Sidebar (Cmd+B)"
        >
          <FolderGit2 className="w-4 h-4 text-primary" />
        </button>
      </div>
    );
  }

  return (
    <aside className="w-64 border-r border-border bg-[#141416] flex flex-col select-none shrink-0">
      {/* Sidebar Header */}
      <div className="h-8 border-b border-border flex items-center justify-between px-3 text-xs">
        <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchTree}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Refresh Files"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Collapse Sidebar (Cmd+B)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Action Toolbar */}
      <div className="p-2 border-b border-border/60 bg-[#161619] grid grid-cols-2 gap-1.5 text-xs">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setUploadModalOpen(true)}
          className="h-7 text-[11px] gap-1 justify-start px-2 bg-background/50 hover:bg-muted"
        >
          <Upload className="w-3 h-3 text-sky-400" />
          <span>Upload PDF</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setImportDoiModalOpen(true)}
          className="h-7 text-[11px] gap-1 justify-start px-2 bg-background/50 hover:bg-muted"
        >
          <LinkIcon className="w-3 h-3 text-amber-400" />
          <span>Import DOI</span>
        </Button>
      </div>

      {/* File Tree Area */}
      <ScrollArea className="flex-1 px-1">
        <FileTree tree={tree} onRefresh={fetchTree} />
      </ScrollArea>
    </aside>
  );
}
