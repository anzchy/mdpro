/**
 * Purpose: keep the production document tabs represented in tabStore so the
 * Switch Documents command can choose the most recent other tab.
 * @coordinates-with src/stores/tabStore.ts — owns the Zustand state
 * @coordinates-with src/hooks/switchDocuments.ts — activates the chosen document
 */
import type { Document } from "../types/document";
import type { Tab } from "./tabStore";

/** A monotonic activation rank even when two activations share a millisecond. */
export function nextActivationAt(tabs: readonly Tab[]): number {
  return Math.max(Date.now(), ...tabs.map((tab) => tab.lastActiveAt + 1));
}

/** Reconcile real documents into the MRU list, preserving existing ranks. */
export function reconcileDocumentTabs(tabs: readonly Tab[], documents: readonly Document[], activeId: string | null, priorActiveTabId: string | null): { tabs: Tab[]; activeTabId: string | null } {
  const available = new Set(documents.map((doc) => doc.id));
  const retained = tabs.filter((tab) => available.has(tab.documentId));
  const byDocument = new Map(retained.map((tab) => [tab.documentId, tab]));
  const next = documents.map((doc, order) => byDocument.get(doc.id) ?? ({
    id: `document-${doc.id}`,
    documentId: doc.id,
    title: doc.path?.split(/[/\\]/).pop() || "Untitled",
    isDirty: doc.isModified,
    isPinned: false,
    order,
    state: { cursorPosition: { line: 1, column: 0 }, viewMode: "wysiwyg" },
    lastActiveAt: 0,
  } as Tab));
  const activeTab = next.find((tab) => tab.documentId === activeId);
  const activeTabId = activeTab?.id ?? null;
  if (activeTab && (activeTabId !== priorActiveTabId || activeTab.lastActiveAt === 0)) {
    const at = nextActivationAt(next);
    return { tabs: next.map((tab) => tab.id === activeTabId ? { ...tab, lastActiveAt: at } : tab), activeTabId };
  }
  return { tabs: next, activeTabId };
}

/** The latest other tab; ties use stable document order. */
export function mostRecentOther(tabs: readonly Tab[], activeTabId: string | null): Tab | null {
  return tabs.filter((tab) => tab.id !== activeTabId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.order - b.order)[0] ?? null;
}
