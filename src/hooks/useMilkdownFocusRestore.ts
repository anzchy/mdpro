/**
 * Purpose: give keyboard focus and the caret back to a Milkdown editor rebuilt by a
 * wholesale replace (D37, WI-4). `prepareWholesaleReplace` armed a focus-carry record
 * for the post-reload generation (`utils/milkdownFocusCarry.ts`); once THIS instance has
 * loaded, the hook consumes it, maps the old head into the new doc with
 * `anchorCaretAcrossReplace`, selects there (scrolled into view, history off) and focuses
 * the view, so the next keystroke lands where the user was typing.
 *
 * Pipeline: `editor.loading` false → `consumeFocusCarry(activeDocumentId, generation)` →
 * no record: nothing (no log) · focus elsewhere: log `skipped:focus-elsewhere` (unless
 * D38's prompt case below) · else anchor → `setSelection(TextSelection.near(...))
 * .scrollIntoView()` → `view.focus()` → log `restored`.
 *
 * Key decisions:
 * - **`generation` is a prop** (FR-1): the value `MilkdownEditor` keyed this instance with.
 *   Reading `editorGenerations` from the store would let a stale instance, still mounted
 *   while a newer bump is pending, consume the newer instance's record.
 * - **Consume-once is the idempotence** (FR-4): the record module clears the slot on a
 *   hit, so an effect re-run finds nothing. Deps are `[editor.loading, activeDocumentId,
 *   generation]`, not `editor` (a new wrapper every render; the M3 precedent of
 *   `useMilkdownTableCursorRestore`).
 * - **Never steal focus.** Focus on anything but `<body>`/null (or the new view itself)
 *   means the user moved on: the record is still consumed and logged
 *   `skipped:focus-elsewhere`.
 * - **A prompt holding focus gets the view instead** (D38, ADR-0055). A `viaDialog` record (captured
 *   while a queued MCP confirm prompt held focus) whose prompt still holds focus: the
 *   prompt's return target is redirected to the new `view.dom`, the caret is selected and
 *   scrolled, but the view is NOT focused; the prompt's close focuses it. Logged
 *   `restored` with `focus: "deferred"`. Any other focus holder is still left alone.
 * - **The restore does not dirty** (G-11): a selection-only transaction with
 *   `addToHistory: false`; edit-sync ignores it and undo depth stays 0.
 * - **Every restore scrolls** (`scrollIntoView`), so the caret is visible after the rebuild.
 * - **Never throws** (FR-5): an error logs `skipped:error` (message only) and is dropped.
 * - **Logs carry no content** (rule 20): `{documentId, reason, outcome, anchor,
 *   durationMs}`; `durationMs` covers the anchor call (old-doc rebuild + diff), the
 *   number the device size-cap check reads.
 *
 * @module hooks/useMilkdownFocusRestore
 * @coordinates-with src/utils/milkdownFocusCarry.ts — consumeFocusCarry, the record
 * @coordinates-with src/utils/caretAnchor.ts — anchorCaretAcrossReplace
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — the caller; passes `generation`
 * @coordinates-with src/hooks/useReturnFocusOnClose.ts — `redirectReturnFocus` (D38)
 */
import { useEffect } from "react";
import type { useEditor } from "@milkdown/react";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { loggingService } from "../services/loggingService";
import type { LogStatus } from "../types/logging";
import { anchorCaretAcrossReplace } from "../utils/caretAnchor";
import { redirectReturnFocus } from "./useReturnFocusOnClose";
import {
  consumeFocusCarry,
  FOCUS_RESTORE_EVENT,
  type FocusCarryRecord,
} from "../utils/milkdownFocusCarry";

/** The part of `useEditor`'s return value this hook reads. */
export type MilkdownEditorHandle = Pick<ReturnType<typeof useEditor>, "loading" | "get">;

type RestoreOutcome = "restored" | "skipped:focus-elsewhere" | "skipped:error";

function logOutcome(
  record: FocusCarryRecord,
  status: LogStatus,
  outcome: RestoreOutcome,
  extra: Record<string, unknown>,
  error?: string,
): void {
  loggingService.logEventSync({
    level: status === "fail" ? "warn" : "info",
    event: FOCUS_RESTORE_EVENT,
    status,
    actionId: loggingService.generateActionId(),
    context: { documentId: record.documentId, reason: record.reason, outcome, ...extra },
    ...(error === undefined ? {} : { error }),
  });
}

/** True when nothing else holds focus: `<body>`, null, or already inside `dom`. */
function focusIsFree(dom: Element): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || dom.contains(active);
}

/** Map, select, scroll and focus; one terminal log line. Never throws. */
function restore(instance: Editor, record: FocusCarryRecord): void {
  try {
    const view = instance.action((ctx) => ctx.get(editorViewCtx));
    const free = focusIsFree(view.dom);
    const deferred =
      !free && record.viaDialog === true && redirectReturnFocus(document.activeElement, view.dom);
    if (!free && !deferred) {
      logOutcome(record, "cancel", "skipped:focus-elsewhere", { generation: record.generation });
      return;
    }
    const started = performance.now();
    const { pos, anchor } = anchorCaretAcrossReplace(record.oldDoc, view.state.doc, record.head);
    const durationMs = performance.now() - started;
    const doc = view.state.doc;
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.near(doc.resolve(pos)))
        .scrollIntoView()
        .setMeta("addToHistory", false),
    );
    if (!deferred) view.focus();
    logOutcome(record, "success", "restored", {
      anchor,
      durationMs,
      ...(deferred ? { focus: "deferred" } : {}),
    });
  } catch (error) {
    logOutcome(
      record,
      "fail",
      "skipped:error",
      { generation: record.generation },
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Once the editor keyed `${activeDocumentId}#${generation}` has loaded, consume the D37
 * focus-carry record for exactly that pair and restore focus and the caret.
 */
export function useMilkdownFocusRestore(
  editor: MilkdownEditorHandle,
  activeDocumentId: string | null,
  generation: number,
): void {
  useEffect(() => {
    if (editor.loading || activeDocumentId === null) return;
    const instance = editor.get();
    if (!instance) return;
    const record = consumeFocusCarry(activeDocumentId, generation);
    if (!record) return;
    restore(instance, record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.loading, activeDocumentId, generation]);
}
