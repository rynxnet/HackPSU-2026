"use client";

import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { TabItem } from "@/lib/types";
import {
  X,
  BookOpen,
  Database,
  FileCode,
  Columns,
  BarChart2,
  Table2,
} from "lucide-react";

interface TabBarProps {
  pane: "left" | "right";
}

export function TabBar({ pane }: TabBarProps) {
  const tabs = useWorkspaceStore((s) => s.tabs.filter((t) => t.pane === pane));
  const activeTabId = useWorkspaceStore((s) =>
    pane === "left" ? s.activeTabId : s.splitActiveTabId
  );
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const getIcon = (type: string) => {
    switch (type) {
      case "paper":
        return <BookOpen className="w-3.5 h-3.5 text-amber-400" />;
      case "dataset":
        return <Database className="w-3.5 h-3.5 text-emerald-400" />;
      case "draft":
        return <FileCode className="w-3.5 h-3.5 text-indigo-400" />;
      case "figure":
        return <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />;
      case "matrix":
        return <Table2 className="w-3.5 h-3.5 text-violet-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="h-8 border-b border-border bg-[#18181b] flex items-center overflow-x-auto select-none no-scrollbar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id, pane)}
            className={`group h-full flex items-center gap-2 px-3 border-r border-border cursor-pointer transition-colors text-xs ${
              isActive
                ? "bg-background text-foreground border-t-2 border-t-primary font-medium"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
          >
            {getIcon(tab.type)}
            <span className="truncate max-w-[150px]">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="p-0.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
