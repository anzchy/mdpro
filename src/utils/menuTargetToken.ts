/**
 * @module utils/menuTargetToken
 * Purpose: the token a native menu action carries from its receipt to its final
 * mutation (D261). `useMenuEvents` captures it synchronously when a
 * `menu:action` addressed to this window arrives; a handler that mutates later
 * (after a dialog, a modal or an await) asks `abandonIfStale` first, so an
 * action never lands on a document or editor other than the one it was
 * clicked against.
 *
 * Key decisions:
 *   - A token is current iff the window label, the active document id and the
 *     editor generation (`stores/editorGeneration.ts`) are all unchanged. The
 *     generation is monotonic, so staleness is absorbing: switching away and
 *     back does not revive a token. Typing does not stale it.
 *   - The label is read here per check from `currentWindowLabel()`; a real
 *     window's label never changes. The hook reads its own label once at mount
 *     and passes it to `captureToken`.
 *   - `abandonIfStale` logs `ui.menu.select` with status `cancel` and
 *     `{ windowLabel, reason: "stale", stage }`. The status union is not
 *     widened, and no document id, path or content is logged.
 *   - The deferred mutations check at their final mutation (D261-WI-1d):
 *     `confirmDocumentClose` (stage `close_confirm`, against the token stored
 *     when the close prompt opened) and `saveIfCurrent` (stage `save_entry`).
 *     Neither captures a token itself, and a missing token fails closed.
 *     Table submit (`tableInsertTrigger.ts`) and the highlight effects call
 *     `abandonIfStale` directly; `HighlightRequest` carries the token to them.
 *
 * @coordinates-with src/hooks/useMenuEvents.ts — captures the token at receipt
 * @coordinates-with src/stores/editorGeneration.ts — the generation compared
 * @coordinates-with src/utils/currentWindowLabel.ts — this window's label
 * @coordinates-with src/utils/tableInsertTrigger.ts — table_submit check
 * @coordinates-with src/App.tsx — close_confirm and save_entry callers, HighlightRequest
 */
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { getEditorGeneration } from "../stores/editorGeneration";
import { currentWindowLabel } from "./currentWindowLabel";

/** Which window, document and editor a menu action was received against. */
export interface MenuTargetToken {
  windowLabel: string;
  documentId: string | null;
  generation: number;
}

/** The token for an action received now by the window labelled `windowLabel`. */
export function captureToken(windowLabel: string): MenuTargetToken {
  return {
    windowLabel,
    documentId: useDocumentStore.getState().activeDocumentId,
    generation: getEditorGeneration(),
  };
}

/** True iff this window, its active document and its editor are the token's. */
export function isTokenCurrent(token: MenuTargetToken): boolean {
  return (
    token.windowLabel === currentWindowLabel() &&
    token.documentId === useDocumentStore.getState().activeDocumentId &&
    token.generation === getEditorGeneration()
  );
}

/**
 * Returns true, and writes one `ui.menu.select` `cancel` line naming `stage`,
 * when the token is stale; returns false and writes nothing when it is current.
 */
export function abandonIfStale(token: MenuTargetToken, stage: string, actionId: string): boolean {
  if (isTokenCurrent(token)) return false;
  logStale(token.windowLabel, stage, actionId);
  return true;
}

function logStale(windowLabel: string, stage: string, actionId: string): void {
  loggingService.logEventSync({
    level: "info",
    event: "ui.menu.select",
    status: "cancel",
    actionId,
    context: { windowLabel, reason: "stale", stage },
  });
}

/**
 * One ⌘⇧H / Format → Highlight for the editors. `seq` makes each request a new
 * value; `token` is checked by the editor's effect before it touches the view,
 * so a request seen again after a remount or a switch changes nothing.
 */
export interface HighlightRequest {
  seq: number;
  token: MenuTargetToken;
}

/**
 * The Discard of a document-close prompt. Closes the active document (with
 * `discardChanges`) and resolves true only if `storedToken`, the token stored
 * when the prompt opened, is still current. A null token (nothing was stored)
 * fails closed. Never captures a token of its own: one taken now would always
 * be current. Stale or null resolves false and logs `stage:"close_confirm"`.
 */
export async function confirmDocumentClose(
  storedToken: MenuTargetToken | null,
  closeActiveDocument: (discardChanges: boolean) => Promise<unknown>,
): Promise<boolean> {
  const actionId = loggingService.generateActionId();
  if (storedToken === null) {
    logStale(currentWindowLabel(), "close_confirm", actionId);
    return false;
  }
  if (abandonIfStale(storedToken, "close_confirm", actionId)) return false;
  await closeActiveDocument(true);
  return true;
}

/**
 * The menu Save's entry check. Runs `run` (the save, which then commits by the
 * id it reads at entry) and resolves true only if `token` is current; a stale
 * or missing token saves nothing, resolves false and logs `stage:"save_entry"`.
 * Never captures a token of its own.
 */
export async function saveIfCurrent(
  token: MenuTargetToken | null | undefined,
  actionId: string | undefined,
  run: () => Promise<unknown>,
): Promise<boolean> {
  const id = actionId ?? loggingService.generateActionId();
  if (!token) {
    logStale(currentWindowLabel(), "save_entry", id);
    return false;
  }
  if (abandonIfStale(token, "save_entry", id)) return false;
  await run();
  return true;
}
