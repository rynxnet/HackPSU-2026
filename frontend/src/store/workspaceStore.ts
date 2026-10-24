import { create } from "zustand";
import { TabItem, CitationItem } from "../lib/types";

interface WorkspaceState {
  activeProjectId: string | null;
  tabs: TabItem[];
  activeTabId: string | null;
  splitActiveTabId: string | null;
  isSplitView: boolean;
  
  // UI toggles
  searchModalOpen: boolean;
  uploadModalOpen: boolean;
  importDoiModalOpen: boolean;
  newProjectModalOpen: boolean;
  chatCollapsed: boolean;
  sidebarCollapsed: boolean;
  chatFocusTrigger: number; // incremented on Cmd+K to trigger focus

  // Actions
  setActiveProject: (projectId: string) => void;
  openTab: (tab: Omit<TabItem, "id" | "pane">, openInSplit?: boolean) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string, pane?: "left" | "right") => void;
  toggleSplitView: () => void;
  setSearchModalOpen: (open: boolean) => void;
  setUploadModalOpen: (open: boolean) => void;
  setImportDoiModalOpen: (open: boolean) => void;
  setNewProjectModalOpen: (open: boolean) => void;
  setChatCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  setSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  triggerChatFocus: () => void;
  jumpToCitation: (citation: CitationItem) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeProjectId: null,
  tabs: [],
  activeTabId: null,
  splitActiveTabId: null,
  isSplitView: false,

  searchModalOpen: false,
  uploadModalOpen: false,
  importDoiModalOpen: false,
  newProjectModalOpen: false,
  chatCollapsed: false,
  sidebarCollapsed: false,
  chatFocusTrigger: 0,

  setActiveProject: (projectId: string) => {
    set({ activeProjectId: projectId, tabs: [], activeTabId: null, splitActiveTabId: null });
  },

  openTab: (tabData, openInSplit = false) => {
    const { tabs, activeTabId, isSplitView } = get();
    const pane = openInSplit ? "right" : "left";

    // Check if already open
    const existing = tabs.find((t) => t.resourceId === tabData.resourceId && t.pane === pane);
    if (existing) {
      if (pane === "left") {
        set({ activeTabId: existing.id });
      } else {
        set({ splitActiveTabId: existing.id, isSplitView: true });
      }
      return;
    }

    const newTab: TabItem = {
      ...tabData,
      id: `${tabData.type}-${tabData.resourceId}-${pane}-${Date.now()}`,
      pane,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      ...(pane === "left"
        ? { activeTabId: newTab.id }
        : { splitActiveTabId: newTab.id, isSplitView: true }),
    }));
  },

  closeTab: (tabId: string) => {
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== tabId);
      let newActive = state.activeTabId;
      let newSplit = state.splitActiveTabId;

      if (state.activeTabId === tabId) {
        const leftTabs = remaining.filter((t) => t.pane === "left");
        newActive = leftTabs.length > 0 ? leftTabs[leftTabs.length - 1].id : null;
      }
      if (state.splitActiveTabId === tabId) {
        const rightTabs = remaining.filter((t) => t.pane === "right");
        newSplit = rightTabs.length > 0 ? rightTabs[rightTabs.length - 1].id : null;
      }

      return {
        tabs: remaining,
        activeTabId: newActive,
        splitActiveTabId: newSplit,
        isSplitView: state.isSplitView && (newSplit !== null || remaining.length > 1),
      };
    });
  },

  setActiveTab: (tabId: string, pane: "left" | "right" = "left") => {
    if (pane === "left") {
      set({ activeTabId: tabId });
    } else {
      set({ splitActiveTabId: tabId });
    }
  },

  toggleSplitView: () => {
    set((state) => {
      const nextSplit = !state.isSplitView;
      // If opening split and no tab in split pane, duplicate active tab to right
      if (nextSplit && !state.splitActiveTabId && state.activeTabId) {
        const current = state.tabs.find((t) => t.id === state.activeTabId);
        if (current) {
          const splitTab: TabItem = {
            ...current,
            id: `${current.resourceId}-split-${Date.now()}`,
            pane: "right",
          };
          return {
            isSplitView: true,
            tabs: [...state.tabs, splitTab],
            splitActiveTabId: splitTab.id,
          };
        }
      }
      return { isSplitView: nextSplit };
    });
  },

  setSearchModalOpen: (open: boolean) => set({ searchModalOpen: open }),
  setUploadModalOpen: (open: boolean) => set({ uploadModalOpen: open }),
  setImportDoiModalOpen: (open: boolean) => set({ importDoiModalOpen: open }),
  setNewProjectModalOpen: (open: boolean) => set({ newProjectModalOpen: open }),
  setChatCollapsed: (collapsed) =>
    set((state) => ({
      chatCollapsed: typeof collapsed === "function" ? collapsed(state.chatCollapsed) : collapsed,
    })),
  setSidebarCollapsed: (collapsed) =>
    set((state) => ({
      sidebarCollapsed: typeof collapsed === "function" ? collapsed(state.sidebarCollapsed) : collapsed,
    })),
  triggerChatFocus: () => set((state) => ({ chatFocusTrigger: state.chatFocusTrigger + 1 })),

  jumpToCitation: (citation: CitationItem) => {
    if (!citation.paper_id) return;
    const { openTab } = get();
    openTab({
      resourceId: citation.paper_id,
      title: citation.paper_title,
      type: "paper",
      metadata: {
        page: citation.page || 1,
        sectionTitle: citation.section,
      },
    });
  },
}));
