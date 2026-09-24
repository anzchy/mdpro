/**
 * Purpose: pure decision functions for the highest data-loss-risk interactions —
 * leaving a window (close, app quit, relaunch) with unsaved changes, and
 * external-edit conflict resolution — plus the flush-then-read helpers (D15) that
 * feed those decisions fresh store state. Extracted from App.tsx so the decisions
 * can be unit tested for *behavior* (precedent: fake-IPC pattern in
 * useFileWatcher.test.ts) rather than only asserted as source-text contracts.
 *
 * The `decide*` functions stay pure. The `assess*` / `*AfterFlush` helpers are not:
 * they call `flushPendingEdits` so a WYSIWYG edit still inside the edit-sync delay
 * reaches documentStore before the decision reads it. A flush can only move a
 * decision toward "prompt", never away from it: a FAILED flush counts as unsaved
 * (D15-WI-5), because a history-less edit dirties the document only when its
 * write succeeds. App.tsx composes `decide*` over these helpers inline.
 *
 * D16 / ADR-0025: the three exit paths share ONE rule. `assessWindowUnsaved`
 * flushes, then reads `useDocumentStore.getState()` — never a captured value — and
 * reports every modified document, not only the active one. `decideWindowExit`
 * turns that assessment into `proceed` | `prompt`; each path then renames the
 * answer into its own vocabulary: window close via `windowCloseDecisionAfterFlush`
 * ("allow" | "prompt" | "save-and-close"), quit via `quitAnswerFor`
 * ("clean" | "dirty"), and relaunch by reading `dirtyDocuments` / `flushFailed`
 * directly. A path that computed its own answer could quit over a dirty tab that
 * the close path would have prompted for.
 *
 * The rule these encode: a dirty document must never be discarded or clobbered
 * without an explicit user decision. App.tsx and the guard hooks wire these into
 * the window `onCloseRequested` handler, the close-request handler, the quit
 * protocol and the file-change effect; the logic itself lives here.
 *
 * @coordinates-with src/hooks/useWindowCloseGuard.ts — onCloseRequested, which
 *   moved out of App.tsx in D16 WI-6
 * @coordinates-with src/App.tsx (handleCloseRequest, file-change effect)
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEdits
 * @coordinates-with src/services/quitGuardService.ts — the reply that carries
 *   `quitAnswerFor`'s answer and `dirtyDocuments`' ids to Rust
 * @coordinates-with src/hooks/useUpdater.ts — prepareForRelaunch (D16 WI-8)
 * @coordinates-with src/utils/openWriteGuard.ts — the open paths flush with reason
 *   "reopen" before deciding whether an open may replace a document (ADR-0028)
 */

import { useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";

/** What the window close handler should do when the OS requests a close. */
export type WindowCloseDecision = "allow" | "prompt" | "save-and-close";

/**
 * Decide how to handle an OS window-close request.
 *
 * - `allow`: a prior confirm already latched the close — let it through.
 * - `prompt`: unsaved changes exist — show the confirm dialog, do NOT close.
 * - `save-and-close`: clean document — persist window state and close.
 */
export function decideWindowClose(state: {
  allowWindowClose: boolean;
  hasUnsavedChanges: boolean;
}): WindowCloseDecision {
  return toCloseDecision(
    exitDecisionFor(state.hasUnsavedChanges, state.allowWindowClose),
    state.allowWindowClose,
  );
}

/** What the in-app close-request (⌘W) handler should do. */
export type CloseRequestDecision = "prompt" | "close";

/**
 * Decide how to handle a document close request. A modified document must
 * prompt before closing; a clean one closes directly.
 */
export function decideCloseRequest(doc: { isModified: boolean } | null): CloseRequestDecision | "noop" {
  if (!doc) return "noop";
  return doc.isModified ? "prompt" : "close";
}

export interface FileChangeEvent {
  path: string;
  changeType: "modified" | "deleted" | "renamed" | string;
  newPath?: string;
}

export type FileChangeAction =
  | { action: "ignore" }
  | { action: "rename"; newPath: string }
  | { action: "reload-prompt"; message: string }
  | { action: "deleted-prompt"; message: string };

/**
 * Decide how to respond to an external file change on the active document.
 *
 * Critically, a `modified` event must NOT auto-reload — that would clobber the
 * user's in-editor unsaved edits. It surfaces a prompt instead; the actual
 * reload is user-initiated. Events for a path other than the active document
 * are ignored (filter to the active doc only).
 */
export function decideFileChange(
  event: FileChangeEvent | null,
  activeDoc: { path: string | null } | null,
): FileChangeAction {
  if (!event || !activeDoc) return { action: "ignore" };
  if (event.path !== activeDoc.path) return { action: "ignore" };

  if (event.changeType === "renamed" && event.newPath) {
    return { action: "rename", newPath: event.newPath };
  }
  if (event.changeType === "deleted") {
    return {
      action: "deleted-prompt",
      message: "File was deleted externally. Save to a new location if needed.",
    };
  }
  return {
    action: "reload-prompt",
    message: "File was modified externally. Reload to update content?",
  };
}

/**
 * Push pending WYSIWYG edits into documentStore (D15), then return the fresh active
 * document for a ⌘W decision. Never the render closure: an edit typed less than the
 * edit-sync delay ago is only in documentStore after this flush. If the flush failed,
 * the returned copy reads modified (the store is left untouched) so the close prompts.
 */
export function activeDocumentAfterFlush(): Document | null {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits("tab-close");
  const doc = useDocumentStore.getState().getActiveDocument() ?? null;
  return doc && status === "failed" ? { ...doc, isModified: true } : doc;
}

/**
 * Flush, then report whether ANY open document is modified: a window close discards
 * every tab, not only the active one. A failed flush counts as unsaved.
 */
export function hasUnsavedChangesAfterFlush(): boolean {
  const assessment = assessWindowUnsaved("window-close");
  return assessment.flushFailed || assessment.dirtyDocuments.length > 0;
}

/* ------------------------------------------------------------------ *
 * D16 / ADR-0025 — the one shared per-window exit rule.
 * ------------------------------------------------------------------ */

/**
 * Why the flusher registry is being drained. Carried into the flusher logs.
 * `reopen` is not an exit: it is the open-write guard's flush (ADR-0028), which reuses
 * `assessWindowUnsaved` so "dirty" means the same thing on every path.
 */
export type WindowExitFlushReason = "window-close" | "app-quit" | "relaunch" | "reopen";

/** A modified document, as the exit paths need it: metadata only, never content. */
export interface DirtyDocumentRef {
  id: string;
  path: string | null;
}

/** What this window knows about its own unsaved work, after a flush. */
export interface WindowUnsavedAssessment {
  /** The flush reported `failed`: an edit exists that the store never received. */
  flushFailed: boolean;
  /** EVERY modified document in this window, in store order — not just the active one. */
  dirtyDocuments: DirtyDocumentRef[];
}

/** The shared answer. Each exit path renames it into its own vocabulary. */
export type WindowExitDecision = "proceed" | "prompt";

/** The whole rule, in one place. A latch means the user has already decided. */
function exitDecisionFor(unsaved: boolean, allowLatched: boolean): WindowExitDecision {
  if (allowLatched) return "proceed";
  return unsaved ? "prompt" : "proceed";
}

/** Rename the shared answer into the window-close vocabulary. */
function toCloseDecision(
  decision: WindowExitDecision,
  allowWindowClose: boolean,
): WindowCloseDecision {
  if (allowWindowClose) return "allow";
  return decision === "prompt" ? "prompt" : "save-and-close";
}

/**
 * Flush pending WYSIWYG edits, THEN read the store, and report this window's
 * unsaved work. The order is the point: an edit typed inside the edit-sync delay
 * only reaches documentStore when the flush runs, so reading first would answer
 * "clean" for a document the user is still typing into.
 *
 * The store is read through `getState()` at call time — never a captured value
 * (rule 50) — and is never mutated: a failed flush is reported as `flushFailed`
 * rather than by marking anything modified.
 */
export function assessWindowUnsaved(reason: WindowExitFlushReason): WindowUnsavedAssessment {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits(reason);
  const dirtyDocuments = useDocumentStore
    .getState()
    .documents.filter((doc) => doc.isModified)
    .map((doc) => ({ id: doc.id, path: doc.path }));
  return { flushFailed: status === "failed", dirtyDocuments };
}

/**
 * Decide whether this window may leave silently. `prompt` iff the flush failed or
 * any document is modified — unless a prior confirm already latched the exit.
 */
export function decideWindowExit(
  assessment: WindowUnsavedAssessment,
  options: { allowLatched: boolean },
): WindowExitDecision {
  return exitDecisionFor(
    assessment.flushFailed || assessment.dirtyDocuments.length > 0,
    options.allowLatched,
  );
}

/** The quit protocol's phase-1 answer (ADR-0025 §2) for a shared decision. */
export function quitAnswerFor(decision: WindowExitDecision): "clean" | "dirty" {
  return decision === "prompt" ? "dirty" : "clean";
}

/**
 * The window-close path's entry point: flush, assess, decide, rename. Used by the
 * OS `onCloseRequested` handler so a close makes exactly the same call the quit
 * and relaunch paths make on the same pre-state.
 */
export function windowCloseDecisionAfterFlush(options: {
  allowWindowClose: boolean;
}): WindowCloseDecision {
  const assessment = assessWindowUnsaved("window-close");
  return toCloseDecision(
    decideWindowExit(assessment, { allowLatched: options.allowWindowClose }),
    options.allowWindowClose,
  );
}
