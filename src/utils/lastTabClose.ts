/**
 * Purpose: decide whether a window closes after one of its tabs closes
 * (D253, ADR-0112): a secondary window emptied by a user close goes away, the
 * main window keeps its empty state.
 *
 * Key decisions:
 * - **One rule keyed on the label.** Only `"main"` is the app's home; every
 *   other label is a secondary window, however it was created (ADR-0112
 *   option 4 was rejected).
 * - **Only a user close counts.** A window emptied any other way (a quit in
 *   progress, an MCP-driven change) is left to its own path, so the caller
 *   names its trigger and anything but `"user-close"` keeps the window.
 *
 * - **`closeWindowIfLastTabClosed` is the glue App calls** after every user
 *   close (⌘W, File → Close, the dialog's Discard, the tab ×, and ⌘W on an
 *   already-empty window). It reads the document count from the store after
 *   the close resolved, so a document that arrived during the close's await
 *   keeps the window. A quit in progress (`quitGuard.quitPrompt`, the only
 *   quit signal App has) makes the trigger `"other"`.
 * - **Only the guard closes.** The glue never touches the window itself; it
 *   calls `requestWindowClose`, which re-enters `onCloseRequested`.
 *
 * @module src/utils/lastTabClose
 * @coordinates-with src/App.tsx — the call sites (`closeWindowIfEmptied`)
 * @coordinates-with src/hooks/useWindowCloseGuard.ts — `requestWindowClose`
 */
import type { WindowCloseRequestReason } from "../hooks/useWindowCloseGuard";
import { useDocumentStore } from "../stores/documentStore";
import { currentWindowLabel, UNKNOWN_WINDOW_LABEL } from "./currentWindowLabel";

/** What emptied the tab: a user close (⌘W, File → Close, the tab ×), or anything else. */
export type TabCloseTrigger = "user-close" | "other";
export type TabCloseDecision = "close-window" | "keep";

/** The one label that keeps its empty state (ADR-0112). */
export const MAIN_WINDOW_LABEL = "main";

export interface TabCloseInput {
  windowLabel: string;
  /** Documents left in the window after the close resolved. */
  remainingDocuments: number;
  trigger: TabCloseTrigger;
}

/** `"close-window"` only for a secondary window that a user close left with no document. */
export function decideAfterTabClose({ windowLabel, remainingDocuments, trigger }: TabCloseInput): TabCloseDecision {
  if (windowLabel === MAIN_WINDOW_LABEL) return "keep";
  if (remainingDocuments !== 0) return "keep";
  return trigger === "user-close" ? "close-window" : "keep";
}

export interface LastTabCloseDeps {
  /** `useWindowCloseGuard().requestWindowClose`: the guarded close, never `destroy()`. */
  requestWindowClose: (reason: WindowCloseRequestReason) => Promise<void>;
  /** A quit is asking this window (`quitGuard.quitPrompt !== null`): leave it to the quit. */
  quitInProgress: boolean;
}

/**
 * Run after a user close of a tab has resolved (or ⌘W found nothing to close):
 * reads the live label and document count NOW, never a value from before the
 * caller's await, and on `"close-window"` asks the guard to close the window.
 * Returns the decision it acted on. An unreadable label (web preview) keeps.
 */
export async function closeWindowIfLastTabClosed({
  requestWindowClose,
  quitInProgress,
}: LastTabCloseDeps): Promise<TabCloseDecision> {
  const windowLabel = currentWindowLabel();
  if (windowLabel === UNKNOWN_WINDOW_LABEL) return "keep";
  const decision = decideAfterTabClose({
    windowLabel,
    remainingDocuments: useDocumentStore.getState().documents.length,
    trigger: quitInProgress ? "other" : "user-close",
  });
  if (decision === "close-window") await requestWindowClose("last_tab_closed");
  return decision;
}
