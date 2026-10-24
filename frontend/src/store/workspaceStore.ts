import { create } from "zustand";
import { TabItem, CitationItem, BibEntry, DraftSnippet } from "../lib/types";
import { api } from "../lib/api";

export interface Toast {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

/**
 * The draft that receives "insert into draft" actions (the most recently focused one).
 * While its editor is open, `insert` edits it at the cursor. After the tab is closed or hidden,
 * the target is kept "detached": inserts go through the API at the last cursor offset.
 */
export interface DraftTarget {
  draftId: string;
  title: string;
  contentType: "markdown" | "latex" | string;
  insert?: (text: string) => void;
  cursorOffset?: number;
  /** Resolves once the editor's last autosave has finished (detached targets only). */
  ready?: Promise<void>;
}

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

  // Cross-tool glue: inserting citations, quotes, answers and figures into the open draft
  draftTarget: DraftTarget | null;
  setDraftTarget: (target: DraftTarget | null) => void;
  detachDraftTarget: (draftId: string, cursorOffset: number | undefined, ready: Promise<void>) => void;
  insertIntoDraft: (snippet: DraftSnippet, what?: string) => boolean;

  bibliography: BibEntry[];
  bibliographyProjectId: string | null;
  loadBibliography: (projectId: string, force?: boolean) => Promise<BibEntry[]>;

  treeVersion: number; // bumped when files change so the explorer refetches
  refreshTree: () => void;

  toasts: Toast[];
  pushToast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

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
    if (get().activeProjectId === projectId) return;
    set({ activeProjectId: projectId, tabs: [], activeTabId: null, splitActiveTabId: null, draftTarget: null });
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

  draftTarget: null,
  setDraftTarget: (target) => set({ draftTarget: target }),
  detachDraftTarget: (draftId, cursorOffset, ready) => {
    const target = get().draftTarget;
    if (target?.draftId === draftId) {
      set({ draftTarget: { draftId, title: target.title, contentType: target.contentType, cursorOffset, ready } });
    }
  },
  insertIntoDraft: (snippet, what = "Text") => {
    const target = get().draftTarget;
    if (!target) {
      get().pushToast("Open a draft first, then try again. It will be inserted at your cursor.", "info");
      return false;
    }
    const text = target.contentType === "latex" ? snippet.latex : snippet.markdown;
    if (target.insert) {
      target.insert(text);
      get().pushToast(`${what} inserted into ${target.title}`, "success");
      return true;
    }

    // Editor isn't open: insert server-side at the last cursor position, then advance the cursor
    (async () => {
      try {
        await target.ready;
        const draft = await api.getDraft(target.draftId);
        const offset = Math.min(target.cursorOffset ?? draft.content.length, draft.content.length);
        await api.updateDraft(target.draftId, { content: draft.content.slice(0, offset) + text + draft.content.slice(offset) });
        const current = get().draftTarget;
        if (current?.draftId === target.draftId && !current.insert) {
          set({ draftTarget: { ...current, cursorOffset: offset + text.length } });
        }
        get().pushToast(`${what} inserted into ${target.title}`, "success");
      } catch (e: any) {
        get().pushToast(`Couldn't insert into ${target.title}: ${e.message}`, "error");
      }
    })();
    return true;
  },

  bibliography: [],
  bibliographyProjectId: null,
  loadBibliography: async (projectId, force = false) => {
    const state = get();
    if (!force && state.bibliographyProjectId === projectId && state.bibliography.length > 0) {
      return state.bibliography;
    }
    const entries = await api.getBibliography(projectId);
    // Ignore the response if the user switched projects while it loaded
    if (get().activeProjectId === projectId || get().activeProjectId === null) {
      set({ bibliography: entries, bibliographyProjectId: projectId });
    }
    return entries;
  },

  treeVersion: 0,
  refreshTree: () => set((state) => ({ treeVersion: state.treeVersion + 1 })),

  toasts: [],
  pushToast: (message, kind = "info") => {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3500);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
