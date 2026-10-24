"use client";

import React, { useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { FileTreeItem } from "@/lib/types";
import {
  Folder,
  FolderOpen,
  FileText,
  Database,
  BookOpen,
  FileCode,
  Plus,
  ChevronRight,
  ChevronDown,
  Upload,
  Link as LinkIcon,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

interface FileTreeProps {
  tree: FileTreeItem[];
  onRefresh: () => void;
}

export function FileTree({ tree, onRefresh }: FileTreeProps) {
  const openTab = useWorkspaceStore((s) => s.openTab);
  const setUploadModalOpen = useWorkspaceStore((s) => s.setUploadModalOpen);
  const setImportDoiModalOpen = useWorkspaceStore((s) => s.setImportDoiModalOpen);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tabs = useWorkspaceStore((s) => s.tabs);

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    "folder-library": true,
    "folder-data": true,
    "folder-drafts": true,
  });

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const getStatusIcon = (status?: string) => {
    if (status === "completed") {
      return <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" title="Parsed & Vectorized" />;
    }
    if (status === "processing" || status === "pending") {
      return <Clock className="w-2.5 h-2.5 text-amber-400 animate-spin" title="Extracting sections & embedding" />;
    }
    if (status === "failed") {
      return <AlertCircle className="w-2.5 h-2.5 text-rose-400" title="Parsing error" />;
    }
    return null;
  };

  const isItemActive = (resourceId: string) => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.resourceId === resourceId;
  };

  return (
    <div className="py-1 text-xs select-none">
      {tree.map((folder) => {
        const isExpanded = expandedFolders[folder.id] ?? true;

        return (
          <div key={folder.id} className="mb-1">
            {/* Folder Header */}
            <div className="group flex items-center justify-between px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer rounded">
              <div
                className="flex items-center gap-1.5 flex-1 min-w-0"
                onClick={() => toggleFolder(folder.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-sky-400" />
                )}
                <span className="font-semibold tracking-wide uppercase text-[10px]">
                  /{folder.name}
                </span>
                <span className="text-[10px] text-muted-foreground/60 ml-1">
                  ({folder.children?.length || 0})
                </span>
              </div>

              {/* Action Buttons for Folder */}
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                {folder.name === "library" && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadModalOpen(true);
                      }}
                      title="Upload PDF"
                      className="p-0.5 hover:text-primary transition-colors"
                    >
                      <Upload className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setImportDoiModalOpen(true);
                      }}
                      title="Import by DOI / arXiv"
                      className="p-0.5 hover:text-primary transition-colors"
                    >
                      <LinkIcon className="w-3 h-3" />
                    </button>
                  </>
                )}
                {folder.name === "data" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadModalOpen(true);
                    }}
                    title="Upload Dataset"
                    className="p-0.5 hover:text-primary transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
                {folder.name === "drafts" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Quick prompt to create new draft
                      const name = window.prompt("Enter draft filename (e.g. thesis.tex or notes.md):", "thesis.tex");
                      if (name && name.trim()) {
                        // Will trigger creation
                        window.dispatchEvent(new CustomEvent("create-draft", { detail: { title: name.trim() } }));
                      }
                    }}
                    title="New Draft"
                    className="p-0.5 hover:text-primary transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Folder Children */}
            {isExpanded && (
              <div className="pl-4 pr-1 mt-0.5 space-y-0.5">
                {folder.children && folder.children.length > 0 ? (
                  folder.children.map((item) => {
                    const active = isItemActive(item.id);

                    return (
                      <div
                        key={item.id}
                        onClick={() =>
                          openTab({
                            resourceId: item.id,
                            title: item.displayName || item.name,
                            type: item.type as any,
                            metadata: {
                              contentType: item.contentType,
                            },
                          })
                        }
                        className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                          active
                            ? "bg-primary/15 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {item.type === "paper" && (
                            <BookOpen className="w-3.5 h-3.5 shrink-0 text-amber-400/90" />
                          )}
                          {item.type === "dataset" && (
                            <Database className="w-3.5 h-3.5 shrink-0 text-emerald-400/90" />
                          )}
                          {item.type === "draft" && (
                            <FileCode className="w-3.5 h-3.5 shrink-0 text-indigo-400/90" />
                          )}
                          <span className="truncate text-xs">{item.displayName || item.name}</span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {item.type === "paper" && getStatusIcon(item.status)}
                          {item.type === "dataset" && item.rowCount !== undefined && (
                            <span className="text-[9px] text-muted-foreground/60 font-mono">
                              {item.rowCount}r
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground/40 italic">
                    Empty folder
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
