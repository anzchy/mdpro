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
 *
 * @coordinates-with src/hooks/useMenuEvents.ts — captures the token at receipt
 * @coordinates-with src/stores/editorGeneration.ts — the generation compared
 * @coordinates-with src/utils/currentWindowLabel.ts — this window's label
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
  loggingService.logEventSync({
    level: "info",
    event: "ui.menu.select",
    status: "cancel",
    actionId,
    context: { windowLabel: token.windowLabel, reason: "stale", stage },
  });
  return true;
}
