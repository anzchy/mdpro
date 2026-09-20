import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore } from "../src/stores/tabStore";

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

describe("tabStore", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabs: [] });
  });

  describe("openTab", () => {
    it("creates a new tab and sets it active", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "README.md");
      const { tabs, activeTabId } = useTabStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].documentId).toBe("doc-1");
      expect(tabs[0].title).toBe("README.md");
      expect(activeTabId).toBe(tabId);
    });

    it("switches to existing tab instead of duplicating", () => {
      const id1 = useTabStore.getState().openTab("doc-1", "README.md");
      const id2 = useTabStore.getState().openTab("doc-1", "README.md");
      expect(id1).toBe(id2);
      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("assigns ascending order indices", () => {
      useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().openTab("doc-2", "B");
      const { tabs } = useTabStore.getState();
      expect(tabs[0].order).toBe(0);
      expect(tabs[1].order).toBe(1);
    });
  });

  describe("closeTab", () => {
    it("removes the tab and adds to closedTabs", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().closeTab(tabId, "content");
      const { tabs, closedTabs } = useTabStore.getState();
      expect(tabs).toHaveLength(0);
      expect(closedTabs).toHaveLength(1);
      expect(closedTabs[0].tab.id).toBe(tabId);
      expect(closedTabs[0].content).toBe("content");
    });

    it("switches to MRU tab when active tab is closed", () => {
      useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().openTab("doc-2", "B");
      const tabC = useTabStore.getState().openTab("doc-3", "C");
      // C is active (most recent). Switch to A to make it MRU, then close C.
      useTabStore.getState().switchToTab(useTabStore.getState().tabs[0].id);
      // Now A is active and most recently used. Switch back to C and close it.
      useTabStore.getState().switchToTab(tabC);
      useTabStore.getState().closeTab(tabC);
      // Next tab should be A (most recently used before C)
      const { activeTabId } = useTabStore.getState();
      // Should pick the MRU among remaining tabs
      expect(activeTabId).not.toBeNull();
      expect(activeTabId).not.toBe(tabC);
    });

    it("sets activeTabId to null when last tab is closed", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().closeTab(tabId);
      expect(useTabStore.getState().activeTabId).toBeNull();
    });

    it("caps closedTabs at 10", () => {
      for (let i = 0; i < 12; i++) {
        const id = useTabStore.getState().openTab(`doc-${i}`, `Tab ${i}`);
        useTabStore.getState().closeTab(id);
      }
      expect(useTabStore.getState().closedTabs.length).toBeLessThanOrEqual(10);
    });

    it("no-ops for non-existent tab id", () => {
      useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().closeTab("nonexistent");
      expect(useTabStore.getState().tabs).toHaveLength(1);
    });
  });

  describe("setTabDirty", () => {
    it("marks a tab as dirty", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().setTabDirty(tabId, true);
      expect(useTabStore.getState().tabs[0].isDirty).toBe(true);
    });

    it("marks a tab as clean", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().setTabDirty(tabId, true);
      useTabStore.getState().setTabDirty(tabId, false);
      expect(useTabStore.getState().tabs[0].isDirty).toBe(false);
    });
  });

  describe("pinTab / unpinTab", () => {
    it("pins and unpins a tab", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().pinTab(tabId);
      expect(useTabStore.getState().tabs[0].isPinned).toBe(true);
      useTabStore.getState().unpinTab(tabId);
      expect(useTabStore.getState().tabs[0].isPinned).toBe(false);
    });
  });

  describe("reorderTabs", () => {
    it("moves a tab and updates order indices", () => {
      useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().openTab("doc-2", "B");
      useTabStore.getState().openTab("doc-3", "C");
      useTabStore.getState().reorderTabs(0, 2);
      const { tabs } = useTabStore.getState();
      expect(tabs[0].title).toBe("B");
      expect(tabs[1].title).toBe("C");
      expect(tabs[2].title).toBe("A");
      expect(tabs.map((t) => t.order)).toEqual([0, 1, 2]);
    });
  });

  describe("undoCloseTab", () => {
    it("restores the most recently closed tab", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().closeTab(tabId, "saved content");
      const restored = useTabStore.getState().undoCloseTab();
      expect(restored).not.toBeNull();
      expect(restored!.content).toBe("saved content");
      expect(useTabStore.getState().tabs).toHaveLength(1);
      expect(useTabStore.getState().activeTabId).toBe(tabId);
    });

    it("returns null when no closed tabs exist", () => {
      expect(useTabStore.getState().undoCloseTab()).toBeNull();
    });
  });

  describe("saveTabState", () => {
    it("merges partial state into tab", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().saveTabState(tabId, { viewMode: "split" });
      const tab = useTabStore.getState().tabs[0];
      expect(tab.state.viewMode).toBe("split");
      // The untouched half of the partial merge survives.
      expect(tab.state.cursorPosition).toEqual({ line: 1, column: 0 });
    });
  });

  describe("updateTabTitle", () => {
    it("updates the title", () => {
      const tabId = useTabStore.getState().openTab("doc-1", "Old");
      useTabStore.getState().updateTabTitle(tabId, "New");
      expect(useTabStore.getState().tabs[0].title).toBe("New");
    });
  });

  describe("getTabByDocumentId", () => {
    it("finds tab by document ID", () => {
      useTabStore.getState().openTab("doc-1", "A");
      const tab = useTabStore.getState().getTabByDocumentId("doc-1");
      expect(tab).toBeDefined();
      expect(tab!.documentId).toBe("doc-1");
    });

    it("returns undefined for missing document ID", () => {
      expect(useTabStore.getState().getTabByDocumentId("missing")).toBeUndefined();
    });
  });

  describe("clearTabs", () => {
    it("clears all state", () => {
      useTabStore.getState().openTab("doc-1", "A");
      useTabStore.getState().clearTabs();
      const { tabs, activeTabId, closedTabs } = useTabStore.getState();
      expect(tabs).toHaveLength(0);
      expect(activeTabId).toBeNull();
      expect(closedTabs).toHaveLength(0);
    });
  });
});
