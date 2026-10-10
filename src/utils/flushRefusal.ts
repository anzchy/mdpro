/**
 * Purpose: the one place a transition refuses itself because the WYSIWYG flush
 * failed (D92). A tab switch or a move out of WYSIWYG unmounts the Milkdown editor;
 * when the flush that should have pushed its edits into documentStore failed (the
 * markdown serializer threw), going ahead loses every edit since the last good write.
 * The transition is refused instead: the editor stays mounted with the user's edits,
 * the shared toast says so, and a warn log records the refusal.
 *
 * Pipeline: caller flushes (`activeFlushFailed`: every live flusher runs, only the
 * active document's own result counts) → `true` → `refuseTabSwitch` /
 * `refuseViewModeChange` → `logEventSync` (warn, status `fail`,
 * `cause: "flush-failed"`) → `useToastStore.showToast(...)` → caller returns without
 * changing state.
 *
 * Key decisions:
 * - Only the ACTIVE document's flush refuses (D95, ADR-0071 decision 1): its editor is
 *   the one the transition unmounts. Another document's failing flusher never blocks,
 *   but still runs, so a transition never skips a flusher (D15).
 * - The toast copy uses the same cause wording as the ⌘S failure in
 *   `saveService.ts` ("editor changes could not be captured").
 * - The log event names are the ones the successful transition already uses
 *   (`tab.switch`, `document.activate` for `setActiveDocument`, `view.mode.change`), so
 *   a refusal sits next to the successes it replaced in `~/.mdpro/mdpro.log` (D95). A
 *   caller with an actionId of its own (the open-write guard) passes it through.
 *   Context carries ids and modes only, never content.
 * - Closing a tab is not routed here: a close is a deliberate discard that the close
 *   prompt (`dataLossGuards.ts`) already guards.
 *
 * @coordinates-with src/stores/documentStore.ts — setActiveDocumentId / setActiveDocument
 * @coordinates-with src/stores/editorStore.ts — setViewMode / cycleViewMode
 * @coordinates-with src/utils/openWriteGuard.ts — activation after the "reopen" flush
 * @coordinates-with src/stores/toastStore.ts — the shared toast
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEditsFor
 * @module utils/flushRefusal
 */
import { loggingService } from "../services/loggingService";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useToastStore } from "../stores/toastStore";
import type { ViewMode, ViewModeIntent } from "../types/editor";

/** Shown when a tab switch is refused because the WYSIWYG flush failed. */
export const TAB_SWITCH_FLUSH_FAILED_TOAST =
  "Editor changes could not be captured; stayed on this document";

/** Shown when leaving WYSIWYG is refused because the WYSIWYG flush failed. */
export const VIEW_MODE_FLUSH_FAILED_TOAST =
  "Editor changes could not be captured; stayed in WYSIWYG";

/** The `cause` every D92 refusal log carries. */
export const FLUSH_FAILED_CAUSE = "flush-failed";

/** Which action refused the tab switch; logged as `entry`. */
export type TabSwitchEntry = "setActiveDocumentId" | "setActiveDocument" | "open-write-guard";

/**
 * D95: run every live flusher (each through `flushPendingEditsFor`, so one throwing
 * cannot stop the rest) and report whether `activeDocumentId`'s own flush failed.
 * A failure that belongs to another document's flusher is ignored: that editor is not
 * the one the transition unmounts. `false` when there is no active document.
 */
export function activeFlushFailed(activeDocumentId: string | null, reason: string): boolean {
  let failed = false;
  for (const documentId of Object.keys(useMilkdownEditorStore.getState().flushers)) {
    const { status } = useMilkdownEditorStore.getState().flushPendingEditsFor(documentId, reason);
    if (documentId === activeDocumentId && status === "failed") failed = true;
  }
  return failed;
}

/**
 * Log and toast a refused tab switch. The caller leaves every store untouched. The
 * log event is the refused entry's own success event (`document.activate` for
 * `setActiveDocument`, else `tab.switch`); `actionId` defaults to a fresh one.
 */
export function refuseTabSwitch(
  fromDocumentId: string | null,
  toDocumentId: string | null,
  entry: TabSwitchEntry,
  actionId?: string,
): void {
  loggingService.logEventSync({
    level: "warn",
    event: entry === "setActiveDocument" ? "document.activate" : "tab.switch",
    status: "fail",
    actionId: actionId ?? loggingService.generateActionId(),
    context: { fromDocumentId, toDocumentId, entry, cause: FLUSH_FAILED_CAUSE },
  });
  useToastStore.getState().showToast(TAB_SWITCH_FLUSH_FAILED_TOAST);
}

/** Log and toast a refused move out of WYSIWYG. The caller leaves the mode as it is. */
export function refuseViewModeChange(
  fromMode: ViewMode,
  toMode: ViewMode,
  source: "setViewMode" | "cycleViewMode",
  intent: ViewModeIntent,
): void {
  loggingService.logEventSync({
    level: "warn",
    event: "view.mode.change",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { fromMode, toMode, source, intent, cause: FLUSH_FAILED_CAUSE },
  });
  useToastStore.getState().showToast(VIEW_MODE_FLUSH_FAILED_TOAST);
}
