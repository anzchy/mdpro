/**
 * @module utils/modalTabActionGuard
 * Purpose: refuse the actions that change this window's tabs (close, new, open,
 * open recent), and the actions that open a modal of their own (Insert Table,
 * Preferences), while a modal dialog is on screen, and log the refusal (D165,
 * D235).
 *
 * On macOS the native menu accelerator (⌘W, ⌘N, ⌘O) fires through `menu:action`
 * whatever the DOM is doing, so a modal's backdrop or a keydown `stopPropagation`
 * cannot stop it. The device run closed the tab behind an open external-change
 * prompt this way and left the prompt orphaned. The refusal therefore sits in the
 * two dispatchers, `useMenuEvents` and `useKeyboardShortcuts`, before the handler.
 *
 * Key decisions:
 * - **"A modal is open" = an `[aria-modal="true"]` element is in the document**, the
 *   same notion `useDialogEscape` uses for an unregistered open modal. Every modal
 *   renders that attribute only while open: the six App-level dialogs (Recovery,
 *   Reload, Encoding, the Unsaved-changes / quit ConfirmDialog, Settings, MCP
 *   confirm), the BottomTabs and Sidebar ConfirmDialogs, LinkInsertModal and
 *   TableInsertModal. `AppDialogs`' open order is component state that misses the
 *   last four, so it is not used.
 * - **Refused: tab-changing actions, and actions that open a second modal.**
 *   Insert Table and Preferences opened their dialog over an open one (D235: Format
 *   › Insert Table over Insert Link). Save, export (a native panel), view mode,
 *   theme, highlight and New Window open no DOM modal and still run.
 * - **Log line**: `tab.close` for a close, `tab.open` for new / open / open recent,
 *   `ui.dialog.open` for Insert Table / Preferences, status `cancel`, context
 *   `{ action, source, reason: "modal-open" }`, with the dispatcher's actionId when
 *   it has one. Ids and enums only, no paths.
 *
 * @coordinates-with src/hooks/useMenuEvents.ts — guards file.close / new / open / open_recent, paragraph.table, file.preferences
 * @coordinates-with src/hooks/useKeyboardShortcuts.ts — guards fileClose / fileNew / fileOpen, paragraphTable, filePreferences
 * @coordinates-with src/hooks/useDialogEscape.ts — the same `aria-modal` selector
 * @coordinates-with tests/d165-modal-blocks-tab-actions.test.tsx
 * @coordinates-with tests/d235-modal-opening-actions-refused.test.tsx
 */
import { loggingService } from "../services/loggingService";

/** The actions that change which tabs this window has. */
export type TabChangingAction = "file.close" | "file.new" | "file.open" | "file.open_recent";

/** Which dispatcher refused: the native menu (incl. its accelerators) or a JS keydown. */
export type TabActionSource = "menu" | "shortcut";

/** Rendered by every open modal's card, and only while it is open. */
const OPEN_MODAL_SELECTOR = '[aria-modal="true"]';
const REFUSAL_REASON = "modal-open";

const REFUSAL_EVENT: Record<TabChangingAction, "tab.close" | "tab.open"> = {
  "file.close": "tab.close",
  "file.new": "tab.open",
  "file.open": "tab.open",
  "file.open_recent": "tab.open",
};

/** True while any modal dialog is on screen. */
export function isModalOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector(OPEN_MODAL_SELECTOR) !== null;
}

/**
 * Returns true, after logging the refusal, when `action` must not run because a modal
 * is open; false (and logs nothing) otherwise. The caller skips its handler on true.
 */
export function refuseTabActionWhileModalOpen(
  action: TabChangingAction,
  source: TabActionSource,
  actionId: string = loggingService.generateActionId(),
): boolean {
  if (!isModalOpen()) return false;
  loggingService.logEventSync({
    level: "info",
    event: REFUSAL_EVENT[action],
    status: "cancel",
    actionId,
    context: { action, source, reason: REFUSAL_REASON },
  });
  return true;
}

/** The actions that open a modal of their own (D235). */
export type ModalOpeningAction = "paragraph.table" | "file.preferences";

/**
 * Returns true, after logging the refusal, when `action` must not run because a modal
 * is already open, so a second one would stack on it (D235); false (and logs nothing)
 * otherwise. The caller skips its handler on true.
 */
export function refuseModalOpenWhileModalOpen(
  action: ModalOpeningAction,
  source: TabActionSource,
  actionId: string = loggingService.generateActionId(),
): boolean {
  if (!isModalOpen()) return false;
  loggingService.logEventSync({
    level: "info",
    event: "ui.dialog.open",
    status: "cancel",
    actionId,
    context: { action, source, reason: REFUSAL_REASON },
  });
  return true;
}
