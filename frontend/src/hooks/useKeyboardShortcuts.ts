"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";

export function useKeyboardShortcuts() {
  const setSearchModalOpen = useWorkspaceStore((s) => s.setSearchModalOpen);
  const triggerChatFocus = useWorkspaceStore((s) => s.triggerChatFocus);
  const toggleSplitView = useWorkspaceStore((s) => s.toggleSplitView);
  const setSidebarCollapsed = useWorkspaceStore((s) => s.setSidebarCollapsed);
  const setChatCollapsed = useWorkspaceStore((s) => s.setChatCollapsed);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Cmd+P: Quick open / Global Search
      if (isCmdOrCtrl && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setSearchModalOpen(true);
      }

      // Cmd+K: Focus AI Chat
      if (isCmdOrCtrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setChatCollapsed(false);
        triggerChatFocus();
      }

      // Cmd+\: Toggle Split View
      if (isCmdOrCtrl && e.key === "\\") {
        e.preventDefault();
        toggleSplitView();
      }

      // Cmd+B: Toggle Sidebar
      if (isCmdOrCtrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchModalOpen, triggerChatFocus, toggleSplitView, setSidebarCollapsed, setChatCollapsed]);
}
