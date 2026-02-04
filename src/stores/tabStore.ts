import { create } from "zustand";
import { loggingService } from "../services/loggingService";

/**
 * Preserved state for context restoration when switching tabs
 */
export interface TabState {
  /** Scroll position (pixels from top) */
  scrollTop: number;

  /** Cursor position in document */
  cursorPosition: {
    line: number;
    column: number;
  };

  /** View mode when tab was last active */
  viewMode: "split" | "editor" | "preview" | "wysiwyg";
}

/**
 * Represents an open document in the tab bar
 */
export interface Tab {
  /** Unique identifier for this tab instance */
  id: string;

  /** Reference to the document this tab displays */
  documentId: string;

  /** Display title (filename or "Untitled") */
  title: string;

  /** Whether the tab has unsaved changes */
  isDirty: boolean;

  /** Whether the tab is pinned (cannot be auto-closed) */
  isPinned: boolean;

  /** Order index in the tab bar (0 = leftmost) */
  order: number;

  /** Preserved state for context restoration */
  state: TabState;

  /** Timestamp of last activation (for MRU sorting) */
  lastActiveAt: number;
}

/**
 * Closed tab data for undo close functionality
 */
export interface ClosedTab {
  /** Original tab data for restoration */
  tab: Tab;

  /** Document content at time of close (for unsaved recovery) */
  content?: string;

  /** Timestamp when closed */
  closedAt: number;
}

interface TabStoreState {
  /** All open tabs */
  tabs: Tab[];

  /** Currently active tab ID */
  activeTabId: string | null;

  /** Recently closed tabs (max 10, LIFO) */
  closedTabs: ClosedTab[];
}

interface TabStoreActions {
  /** Open a new tab for a document, returns tab ID */
  openTab: (documentId: string, title: string, filePath?: string) => string;

  /** Close a tab by ID */
  closeTab: (tabId: string, content?: string) => void;

  /** Switch to a specific tab */
  switchToTab: (tabId: string) => void;

  /** Mark a tab as dirty/clean */
  setTabDirty: (tabId: string, isDirty: boolean) => void;

  /** Reorder tabs (drag and drop) */
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  /** Pin a tab */
  pinTab: (tabId: string) => void;

  /** Unpin a tab */
  unpinTab: (tabId: string) => void;

  /** Restore the most recently closed tab */
  undoCloseTab: () => ClosedTab | null;

  /** Save tab state (scroll, cursor, viewMode) */
  saveTabState: (tabId: string, state: Partial<TabState>) => void;

  /** Update tab title */
  updateTabTitle: (tabId: string, title: string) => void;

  /** Get tab by document ID */
  getTabByDocumentId: (documentId: string) => Tab | undefined;

  /** Get the next tab to focus when closing the active tab (MRU logic) */
  getNextTabOnClose: (closingTabId: string) => Tab | null;

  /** Clear all tabs */
  clearTabs: () => void;
}

type TabStore = TabStoreState & TabStoreActions;

const MAX_CLOSED_TABS = 10;

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const useTabStore = create<TabStore>((set, get) => ({
  // Initial state
  tabs: [],
  activeTabId: null,
  closedTabs: [],

  // Actions
  openTab: (documentId, title, filePath) => {
    const state = get();

    // Check if tab already exists for this document
    const existingTab = state.tabs.find((t) => t.documentId === documentId);
    if (existingTab) {
      // Switch to existing tab
      set({
        activeTabId: existingTab.id,
        tabs: state.tabs.map((t) =>
          t.id === existingTab.id ? { ...t, lastActiveAt: Date.now() } : t
        ),
      });
      return existingTab.id;
    }

    // Create new tab
    const tabId = generateTabId();
    const newTab: Tab = {
      id: tabId,
      documentId,
      title,
      isDirty: false,
      isPinned: false,
      order: state.tabs.length,
      state: {
        scrollTop: 0,
        cursorPosition: { line: 1, column: 0 },
        viewMode: "wysiwyg",
      },
      lastActiveAt: Date.now(),
    };

    loggingService.logEventSync({
      level: "info",
      event: "tab.open",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        tabId,
        documentId,
        title,
        filePath,
        tabIndex: state.tabs.length,
      },
    });

    set({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    });

    return tabId;
  },

  closeTab: (tabId, content) => {
    const state = get();
    const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const closingTab = state.tabs[tabIndex];

    // Add to closed tabs for undo
    const closedTab: ClosedTab = {
      tab: closingTab,
      content,
      closedAt: Date.now(),
    };

    // Determine next tab to focus
    let nextActiveId: string | null = null;
    if (state.activeTabId === tabId) {
      const nextTab = get().getNextTabOnClose(tabId);
      nextActiveId = nextTab?.id ?? null;
    } else {
      nextActiveId = state.activeTabId;
    }

    loggingService.logEventSync({
      level: "info",
      event: "tab.close",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        tabId,
        documentId: closingTab.documentId,
        wasDirty: closingTab.isDirty,
        nextActiveTabId: nextActiveId,
      },
    });

    // Update order for remaining tabs
    const remainingTabs = state.tabs
      .filter((t) => t.id !== tabId)
      .map((t, index) => ({ ...t, order: index }));

    set({
      tabs: remainingTabs,
      activeTabId: nextActiveId,
      closedTabs: [closedTab, ...state.closedTabs].slice(0, MAX_CLOSED_TABS),
    });
  },

  switchToTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (state.activeTabId !== tabId) {
      loggingService.logEventSync({
        level: "info",
        event: "tab.switch",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          fromTabId: state.activeTabId,
          toTabId: tabId,
          documentId: tab.documentId,
        },
      });
    }

    set({
      activeTabId: tabId,
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, lastActiveAt: Date.now() } : t
      ),
    });
  },

  setTabDirty: (tabId, isDirty) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, isDirty } : t)),
    }));
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const newTabs = [...state.tabs];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);

      // Update order indices
      return {
        tabs: newTabs.map((t, index) => ({ ...t, order: index })),
      };
    });
  },

  pinTab: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, isPinned: true } : t)),
    }));
  },

  unpinTab: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isPinned: false } : t
      ),
    }));
  },

  undoCloseTab: () => {
    const state = get();
    if (state.closedTabs.length === 0) return null;

    const [restoredClosedTab, ...remainingClosedTabs] = state.closedTabs;
    const restoredTab = restoredClosedTab.tab;

    // Add back with new order
    const newTab: Tab = {
      ...restoredTab,
      order: state.tabs.length,
      lastActiveAt: Date.now(),
    };

    loggingService.logEventSync({
      level: "info",
      event: "tab.restore",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        tabId: newTab.id,
        documentId: newTab.documentId,
        title: newTab.title,
      },
    });

    set({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
      closedTabs: remainingClosedTabs,
    });

    return restoredClosedTab;
  },

  saveTabState: (tabId, partialState) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, state: { ...t.state, ...partialState } } : t
      ),
    }));
  },

  updateTabTitle: (tabId, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    }));
  },

  getTabByDocumentId: (documentId) => {
    return get().tabs.find((t) => t.documentId === documentId);
  },

  getNextTabOnClose: (closingTabId) => {
    const state = get();
    const remainingTabs = state.tabs.filter((t) => t.id !== closingTabId);

    if (remainingTabs.length === 0) return null;

    // MRU (Most Recently Used) - sort by lastActiveAt descending
    const sortedByMRU = [...remainingTabs].sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt
    );

    return sortedByMRU[0];
  },

  clearTabs: () => {
    set({
      tabs: [],
      activeTabId: null,
      closedTabs: [],
    });
  },
}));
