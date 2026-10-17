/**
 * @module utils/tableInsertTrigger
 * Purpose: open the Insert Table modal for ⌘⌥T (`useKeyboardShortcuts`) and
 * Format → Insert Table (`useMenuEvents`), one flow for both. The modal's
 * submit callback inserts the table into the live Milkdown editor, but only if
 * the menu-target token is still current at submit (D261): a submit after a
 * document switch or an editor remount inserts nothing anywhere.
 *
 * Key decisions:
 *   - Source mode keeps its toast and opens no modal (audit fix M11): the
 *     Source editor has no table insertion path. The mode is checked before
 *     the token, so a stale Source request still gets the mode toast.
 *   - The token defaults to one captured at call time, so the keyboard path,
 *     which has no receipt, mints its own when the modal opens. The menu path
 *     passes the token captured at receipt.
 *   - A stale submit closes the modal and shows "Document changed; table not
 *     inserted" in the ordinary toast. It does not return `false`, which the
 *     modal would show as the "cursor inside another table" inline error.
 *
 * Moved out of `App.tsx` in D261-WI-1d.
 *
 * @coordinates-with src/components/Editor/TableInsertModal/index.tsx — calls the submit callback
 * @coordinates-with src/stores/tableInsertStore.ts — requestInsert opens the modal
 * @coordinates-with src/utils/menuTargetToken.ts — captureToken, abandonIfStale
 * @coordinates-with src/App.tsx — both callers
 */
import { runInsertTable } from "../plugins/milkdown/table/insertTable";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useTableInsertStore } from "../stores/tableInsertStore";
import { useToastStore } from "../stores/toastStore";
import { currentWindowLabel } from "./currentWindowLabel";
import { abandonIfStale, captureToken, type MenuTargetToken } from "./menuTargetToken";

export const SOURCE_MODE_TABLE_TOAST = "Insert Table is available in WYSIWYG mode";
export const STALE_TABLE_TOAST = "Document changed; table not inserted";

/** Open the Insert Table modal; its submit inserts only while `token` is current. */
export function triggerTableInsert(token: MenuTargetToken = captureToken(currentWindowLabel())): void {
  if (useEditorStore.getState().viewMode === "source") {
    useToastStore.getState().showToast(SOURCE_MODE_TABLE_TOAST);
    return;
  }
  // Defensive: clear any stale pending callback from a previous open.
  if (useTableInsertStore.getState().pendingCallback) useTableInsertStore.getState().clearPending();
  useTableInsertStore.getState().requestInsert((rows, cols) => {
    if (abandonIfStale(token, "table_submit", loggingService.generateActionId())) {
      useTableInsertStore.getState().clearPending();
      useToastStore.getState().showToast(STALE_TABLE_TOAST);
      return true; // handled: the modal closes without its inline error
    }
    const editor = useMilkdownEditorStore.getState().getEditor();
    if (!editor) return false;
    return runInsertTable(editor as Parameters<typeof runInsertTable>[0], rows, cols);
  });
}
