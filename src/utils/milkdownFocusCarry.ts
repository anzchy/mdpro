/**
 * Purpose: carry keyboard focus and the caret across a WYSIWYG wholesale rebuild (D37,
 * WI-3). A wholesale replace (`utils/wholesaleReplace.ts`) bumps the document's editor
 * generation, so Milkdown tears the focused view down and builds a new one; without a
 * carry the next keystroke goes to `<body>`. `prepareWholesaleReplace` captures the
 * focused view's doc and head here BEFORE `reloadEditor`, and arms a single-slot record
 * at the POST-reload generation. The rebuilt editor's restore hook (WI-4) consumes it,
 * maps the head with `anchorCaretAcrossReplace` (the new doc does not exist yet at
 * capture time) and focuses the new view.
 *
 * `@module src/utils/milkdownFocusCarry`
 * `@coordinates-with` `src/utils/wholesaleReplace.ts` (capture + arm / carry forward),
 * `src/stores/milkdownEditorStore.ts` (editor getter, generations),
 * `src/hooks/useReturnFocusOnClose.ts` (`pendingReturnTarget`, the D38 dialog check), `src/stores/editorStore.ts`
 * (viewMode), `src/stores/documentStore.ts` (activeDocumentId), `src/utils/caretAnchor.ts`
 * (the restore-time head mapping), `src/hooks/useMilkdownFocusRestore.ts` (the WI-4
 * consumer: restore + the `restored` / `skipped:focus-elsewhere` / `skipped:error` lines), `tests/milkdown-focus-carry.test.ts` and
 * `tests/milkdown-focus-carry-capture.test.ts` (the specification).
 *
 * Key decisions:
 * - **Capture is O(1) and only when focused.** `snapshotFocusedEditor` keeps a reference to
 *   the immutable `state.doc` plus `selection.head` (a range collapses to its head), and
 *   only when the document is active, the mode is WYSIWYG, an editor is registered and its
 *   view `hasFocus()`. An unfocused editor never pays for, or gains, a carry.
 * - **A prompt returning into the editor counts as focused** (D38, ADR-0060). Queued MCP confirm
 *   prompts hand focus from one prompt to the next, so a write approved in the first lands
 *   while the second holds focus. When focus is inside an open return-focus container
 *   (`useReturnFocusOnClose`; the MCP confirm dialog is its only adopter) whose pending
 *   return target is inside this view, the snapshot is taken with `viaDialog: true`, and the
 *   restore hands the rebuilt view to that container instead of stealing focus from it.
 *   Focus in any other dialog, or a prompt returning outside the editor, captures nothing.
 * - **The old `view.dom` rides along** (D38R, ADR-0061, amends ADR-0060). Rust shows one
 *   prompt at a time, so an approved write can land while focus is back on the old view,
 *   before the next prompt exists: the capture is a plain focused one (no `viaDialog`),
 *   and the next prompt opens afterwards, saving this view (soon removed) or nothing. The
 *   snapshot keeps `oldDom` so the restore can tell that prompt apart from one opened
 *   elsewhere (`wouldReturnIntoGone` in `useReturnFocusOnClose`). `carryForward` keeps it.
 * - **The generation is the primary guard** (coordinator amendment O1). `consumeFocusCarry`
 *   returns the record only for an exact `{documentId, generation}` match. A record for an
 *   older generation is dropped as stale; a record for a newer generation survives an older
 *   consumer (a remount that has not yet seen the bump); another document drops it (doc
 *   switch, detected lazily). `viewMode` leaving WYSIWYG drops it at once, via an
 *   editorStore subscription held only while a record is live.
 * - **The TTL is a safety net only**, for a mount that never finishes loading. It must not
 *   fire during a slow remount of a large document, hence the 10 s floor (O1).
 * - **Consume-once, single slot.** A hit clears the slot and the timer. Arming again
 *   supersedes the old record and restarts the timer. `carryForward` re-arms a live record
 *   at a new generation (keeping `oldDoc`, `oldDom` and `head`) when a second replace lands before
 *   the render, while the view is already gone; it acts only for the active document in
 *   WYSIWYG, otherwise it is a no-op.
 * - **Conservation.** Every armed record (including a carry-forward) ends in exactly one
 *   terminal event: a `skipped:*` log line here (`superseded`, `stale`, `doc-changed`,
 *   `mode-changed`, `expired`), or a consume hit, whose one line (`restored`,
 *   `skipped:focus-elsewhere` or `skipped:error`) the WI-4 hook writes. So `arms = terminal lines + (live ? 1 : 0)`. `resetFocusCarry` (tests) is the
 *   only silent exit.
 * - **No content in logs** (rule 20): the context is `{documentId, reason, outcome,
 *   generation}` only; the doc is never logged or serialised here.
 */
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { pendingReturnTarget } from "../hooks/useReturnFocusOnClose";
import type { WholesaleReason } from "./wholesaleReplace";

/**
 * Safety-net lifetime of an armed record. O1 floor: 10 s. Remount time is not yet
 * measured on device (the logged `durationMs` of WI-4 will supply it); WI-2 measured the
 * restore-side diff of a 10 MB-class doc at ~15–30 ms, so 10 s is a wide margin over
 * everything but a mount that never loads — the case this exists for.
 */
export const FOCUS_CARRY_TTL_MS = 10_000;

/** The one log event for every terminal outcome of a record (`restored` is WI-4's). */
export const FOCUS_RESTORE_EVENT = "editor.milkdown.focus.restore";

const CAPTURE_EVENT = "editor.milkdown.focus.capture";

export interface FocusSnapshot {
  documentId: string;
  /** The old selection head; a range selection collapses to it. */
  head: number;
  /** The old view's immutable doc, held by reference. */
  oldDoc: Node;
  /**
   * D38R (ADR-0061): the old view's `view.dom`, held by reference. The restore uses it to
   * recognise a prompt that opened after this capture and saved this (now removed) view.
   */
  oldDom: Element;
  /** D38: focus was in a prompt that returns into this view, not in the view itself. */
  viaDialog?: true;
}

export interface FocusCarryRecord extends FocusSnapshot {
  /** The editor generation the rebuilt view will have (post-reload). */
  generation: number;
  reason: WholesaleReason;
  armedAt: number;
}

type SkipOutcome =
  | "skipped:superseded"
  | "skipped:stale"
  | "skipped:doc-changed"
  | "skipped:mode-changed"
  | "skipped:expired";

let slot: FocusCarryRecord | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeMode: (() => void) | null = null;

function clearSlot(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  unsubscribeMode?.();
  unsubscribeMode = null;
  slot = null;
}

/** End the live record (if any) with a terminal `skipped:*` log line. */
function drop(outcome: SkipOutcome): void {
  const record = slot;
  if (!record) return;
  clearSlot();
  loggingService.logEventSync({
    level: "info",
    event: FOCUS_RESTORE_EVENT,
    status: "cancel",
    actionId: loggingService.generateActionId(),
    context: {
      documentId: record.documentId,
      reason: record.reason,
      outcome,
      generation: record.generation,
    },
  });
}

/** Supersede any live record, then install `record` with a fresh timer and mode watch. */
function install(record: FocusCarryRecord): void {
  drop("skipped:superseded");
  slot = record;
  timer = setTimeout(() => drop("skipped:expired"), FOCUS_CARRY_TTL_MS);
  unsubscribeMode = useEditorStore.subscribe((state, prev) => {
    if (state.viewMode !== prev.viewMode && state.viewMode !== "wysiwyg") {
      drop("skipped:mode-changed");
    }
  });
}

function viewOf(editor: Editor, documentId: string): EditorView | null {
  try {
    return editor.action((ctx) => ctx.get(editorViewCtx));
  } catch (error) {
    loggingService.logEventSync({
      level: "warn",
      event: CAPTURE_EVENT,
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { documentId },
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** D38: focus is in an open return-focus container whose return target is inside `dom`. */
function promptReturnsInto(dom: Element): boolean {
  const target = pendingReturnTarget(document.activeElement);
  return target !== null && dom.contains(target);
}

/**
 * The focused WYSIWYG view's doc and head for `documentId`, or null unless the document
 * is active, the mode is WYSIWYG, an editor is registered and its view has focus — or
 * focus is in a prompt that will return it into this view (`viaDialog`, D38).
 */
export function snapshotFocusedEditor(documentId: string): FocusSnapshot | null {
  if (useDocumentStore.getState().activeDocumentId !== documentId) return null;
  if (useEditorStore.getState().viewMode !== "wysiwyg") return null;
  const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
  if (!editor) return null;
  const view = viewOf(editor, documentId);
  if (!view) return null;
  const snapshot = { documentId, head: view.state.selection.head, oldDoc: view.state.doc, oldDom: view.dom };
  if (view.hasFocus()) return snapshot;
  return promptReturnsInto(view.dom) ? { ...snapshot, viaDialog: true } : null;
}

/** Arm the single slot at `generation` (the post-reload one), superseding any record. */
export function armFocusCarry(
  snapshot: FocusSnapshot,
  reason: WholesaleReason,
  generation: number,
): void {
  install({ ...snapshot, reason, generation, armedAt: Date.now() });
}

/**
 * A replace whose snapshot was null (the focused view is already torn down, pending a
 * render): re-arm the live record for `documentId` at `generation`, keeping its `oldDoc`,
 * `oldDom` and `head`. No-op, silently, unless a record for `documentId` is live, `documentId` is
 * active and the mode is WYSIWYG.
 */
export function carryForward(documentId: string, generation: number): void {
  const record = slot;
  if (!record || record.documentId !== documentId) return;
  if (useDocumentStore.getState().activeDocumentId !== documentId) return;
  if (useEditorStore.getState().viewMode !== "wysiwyg") return;
  install({ ...record, generation, armedAt: Date.now() });
}

/**
 * Take the record for exactly `{documentId, generation}` (consume-once), else null.
 * Another document or an older record drops it (logged); a newer record is kept.
 */
export function consumeFocusCarry(documentId: string, generation: number): FocusCarryRecord | null {
  const record = slot;
  if (!record) return null;
  if (record.documentId !== documentId) {
    drop("skipped:doc-changed");
    return null;
  }
  if (record.generation > generation) return null;
  if (record.generation < generation) {
    drop("skipped:stale");
    return null;
  }
  clearSlot();
  return record;
}

/** Test-only: clear the slot, the timer and the mode watch without logging. */
export function resetFocusCarry(): void {
  clearSlot();
}
