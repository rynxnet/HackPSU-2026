"use client";

import React, { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FolderGit2,
  Search,
  Columns,
  MessageSquare,
  Plus,
  ChevronDown,
  Layers,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";

export function TopBar() {
  const router = useRouter();
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const setSearchModalOpen = useWorkspaceStore((s) => s.setSearchModalOpen);
  const setNewProjectModalOpen = useWorkspaceStore((s) => s.setNewProjectModalOpen);
  const toggleSplitView = useWorkspaceStore((s) => s.toggleSplitView);
  const isSplitView = useWorkspaceStore((s) => s.isSplitView);
  const chatCollapsed = useWorkspaceStore((s) => s.chatCollapsed);
  const setChatCollapsed = useWorkspaceStore((s) => s.setChatCollapsed);

  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  useEffect(() => {
    api.getProjects()
      .then((data) => {
        setProjects(data);
        if (activeProjectId) {
          const match = data.find((p) => p.id === activeProjectId);
          if (match) setCurrentProject(match);
        }
      })
      .catch(() => {});
  }, [activeProjectId]);

  return (
    <header className="h-9 border-b border-border bg-[#18181b] flex items-center justify-between px-3 text-xs select-none z-30">
      {/* Left: App Logo & Project Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-semibold text-primary">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="tracking-tight text-white font-mono">ResearchIDE</span>
        </div>

        <div className="h-4 w-[1px] bg-border/60" />

        {/* Project Switcher Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-white transition-colors">
              <FolderGit2 className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium truncate max-w-[160px]">
                {currentProject ? currentProject.name : "Select Project"}
              </span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Research Repos
            </div>
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => router.push(`/workspace/${p.id}`)}
                className="flex items-center justify-between"
              >
                <span className="truncate">{p.name}</span>
                {p.id === activeProjectId && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setNewProjectModalOpen(true)}
              className="text-primary flex items-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create New Project...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Center: Global Search Bar Trigger (Cmd+P) */}
      <div className="flex-1 max-w-md mx-4">
        <button
          onClick={() => setSearchModalOpen(true)}
          className="w-full h-6 px-2.5 rounded bg-black/40 hover:bg-black/60 border border-border/80 flex items-center justify-between text-muted-foreground hover:text-foreground text-[11px] transition-all"
        >
          <div className="flex items-center gap-1.5">
            <Search className="w-3 h-3 text-muted-foreground" />
            <span className="truncate">Search library, data & drafts...</span>
          </div>
          <kbd className="px-1.5 py-0.5 text-[9px] bg-muted/60 rounded border border-border text-muted-foreground font-mono">
            ⌘P
          </kbd>
        </button>
      </div>

      {/* Right: View Toggles & Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSplitView}
          className={`h-6 px-2 text-[11px] gap-1 ${isSplitView ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
          title="Toggle Split View (Cmd+\)"
        >
          <Columns className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Split</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setChatCollapsed(!chatCollapsed)}
          className={`h-6 px-2 text-[11px] gap-1 ${!chatCollapsed ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
          title="Toggle AI Chat (Cmd+K)"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Chat</span>
        </Button>
      </div>
    </header>
  );
}
