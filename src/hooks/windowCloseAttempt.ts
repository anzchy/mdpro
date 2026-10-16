/**
 * Purpose: the bookkeeping `useWindowCloseGuard` needs to close the D253
 * close-race (ADR-0112, merged review): where an allow latch came from, what a
 * Discard consented to, and the enum-only log line. Extracted to keep the hook
 * under 300 lines.
 *
 * Key decisions:
 * - **A latch carries its origin.** `clean-save` means "allow if still clean":
 *   the pass that lets the close through re-runs the shared rule
 *   (`windowCloseDecisionAfterFlush` with no latch). `discard` allows only
 *   while the dirty set is within the consent the prompt captured.
 * - **`dataLossGuards.ts` is not changed.** The latch origin is applied here,
 *   on top of the shared rule called without a latch, so the quit and
 *   relaunch paths that share `exitDecisionFor` cannot change.
 * - **Consent is `{ id → content }` of the documents dirty when the prompt went
 *   up, plus whether the flush had failed.** A document that is new, or whose
 *   content differs, is not covered; one saved meanwhile (no longer dirty) is.
 *   A flush that fails now but did not then is not covered either; one that
 *   already failed when the user chose Discard is.
 * - **Over a failing flush, the editor's doc is the stamp (audit b180, H3).**
 *   The store cannot show an edit the serializer could not write (a paste that
 *   resolves during the save), so the consent also keeps the active Milkdown
 *   view's `state.doc`. ProseMirror docs are immutable: any doc-changing
 *   transaction yields a new object, so identity is a revision. It is compared
 *   only when the flush fails now; otherwise the store's content is exact. No
 *   editor (source mode, tests) reads as `null` on both sides.
 *
 * - **`requestGuardedClose` is `requestWindowClose`'s body** (moved here for the
 *   300-line limit): it logs, re-checks that no document is open (one may have
 *   arrived during the caller's awaits), then calls `close()`. In Tauri v2 that
 *   emits CloseRequested, so the guard's handler decides; `destroy()` would
 *   skip the flush, the save and the prompt.
 *
 * @module src/hooks/windowCloseAttempt
 * @coordinates-with src/hooks/useWindowCloseGuard.ts — the only caller
 * @coordinates-with src/utils/dataLossGuards.ts — `assessWindowUnsaved`, `windowCloseDecisionAfterFlush`
 */
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { assessWindowUnsaved, windowCloseDecisionAfterFlush } from "../utils/dataLossGuards";

/** What a Discard agreed to throw away. */
export interface DiscardConsent {
  flushFailed: boolean;
  contents: ReadonlyMap<string, string>;
  /** The active editor's ProseMirror doc (identity = revision), or `null`. */
  editorDoc: unknown;
}

/** The allow latch and where it came from; `null` when no close is latched. */
export type CloseLatch = { kind: "clean-save" } | { kind: "discard"; consent: DiscardConsent } | null;

/** The latched pass's verdict: let the close through, or prompt again. */
export type LatchedDecision = "allow" | "prompt";

/** Why a prompt went up; logged as the `action` enum. */
export type PromptAction = "prevented_showing_dialog" | "dirty_after_state_save" | "dirty_after_discard";

/** The active Milkdown view's doc, or `null` when no editor is mounted or ready. */
function currentEditorDoc(): unknown {
  try {
    const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
    return editor ? editor.action((ctx) => ctx.get(editorViewCtx)).state.doc : null;
  } catch {
    return null; // the view is not ready yet: nothing to stamp
  }
}

function dirtyContents(): DiscardConsent {
  const assessment = assessWindowUnsaved("window-close");
  const documents = useDocumentStore.getState().documents;
  const contents = new Map<string, string>();
  for (const ref of assessment.dirtyDocuments) {
    contents.set(ref.id, documents.find((doc) => doc.id === ref.id)?.content ?? "");
  }
  return { flushFailed: assessment.flushFailed, contents, editorDoc: currentEditorDoc() };
}

/** Flush, then capture the dirty documents the prompt is showing. */
export function snapshotDiscardConsent(): DiscardConsent {
  return dirtyContents();
}

/** Flush, then: is every dirty document one the consent covers, unchanged? */
export function consentCovers(consent: DiscardConsent): boolean {
  const now = dirtyContents();
  if (now.flushFailed && !consent.flushFailed) return false;
  // H3: an edit the serializer could not write shows only in the editor.
  if (now.flushFailed && now.editorDoc !== consent.editorDoc) return false;
  for (const [id, content] of now.contents) {
    if (consent.contents.get(id) !== content) return false;
  }
  return true;
}

/** The pass that a latch lets through takes the final decision (ADR-0112 review). */
export function decideLatchedPass(latch: Exclude<CloseLatch, null>): LatchedDecision {
  if (latch.kind === "discard") return consentCovers(latch.consent) ? "allow" : "prompt";
  return windowCloseDecisionAfterFlush({ allowWindowClose: false }) === "save-and-close" ? "allow" : "prompt";
}

/** The prompt reason for a latched pass that found new or changed unsaved work. */
export function promptActionFor(latch: CloseLatch): PromptAction {
  if (latch === null) return "prevented_showing_dialog";
  return latch.kind === "discard" ? "dirty_after_discard" : "dirty_after_state_save";
}

/** One `window.close_requested` line. Context carries the label and enums only. */
export function logCloseRequested(
  status: "start" | "success" | "cancel" | "fail",
  context: Record<string, string | boolean>,
): void {
  loggingService.logEventSync({
    level: status === "fail" ? "error" : "info",
    event: "window.close_requested",
    status,
    actionId: loggingService.generateActionId(),
    context,
  });
}

/** The cancelled-prompt line; `notified` says whether `onCloseCancelled` was set. */
export function logCloseCancelled(notified: boolean): void {
  loggingService.logEventSync({
    level: "info",
    event: "window.close_cancelled",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { notified },
  });
}

/**
 * `useWindowCloseGuard().requestWindowClose`: a logged no-op without a window
 * handle (web preview) or when a document is open; otherwise `close()` through
 * the guard. Never rejects.
 */
export async function requestGuardedClose(
  currentWindow: { label: string; close: () => Promise<void> | void } | null,
  reason: string,
): Promise<void> {
  if (!currentWindow) {
    logCloseRequested("cancel", { action: reason, outcome: "no_window" });
    return;
  }
  const windowLabel = currentWindow.label;
  if (useDocumentStore.getState().documents.length > 0) {
    logCloseRequested("cancel", { windowLabel, action: reason, outcome: "not_empty" });
    return;
  }
  logCloseRequested("start", { windowLabel, action: reason });
  try {
    await currentWindow.close();
  } catch {
    logCloseRequested("fail", { windowLabel, action: reason, reason: "close_rejected" });
  }
}
