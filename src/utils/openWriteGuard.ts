/**
 * Purpose: the one guard every open path writes through (D20 / ADR-0028). A document's
 * id is derived from its path, so reopening an open file lands on an existing entry;
 * this module decides, in one synchronous block, whether the freshly decoded document
 * may replace it or whether the existing (dirty) tab is focused instead.
 *
 * Pipeline (synchronous end to end, no suspension point — ADR-0028 decision 4):
 *   flush pending WYSIWYG edits (`assessWindowUnsaved("reopen")`)
 *   → read `useDocumentStore.getState()`
 *   → collect the candidates: the doc whose id equals `decoded.id`, plus every doc
 *     whose path equals `decoded.path`
 *   → decide → either focus the existing tab (nothing written), or
 *     `prepareWholesaleReplace` → `upsertDocument` → activate.
 *
 * Key decisions:
 * - The write happens only when every candidate is clean after the flush AND the
 *   flush did not fail (decisions 4 and 5). Dirtiness is judged on candidates only;
 *   a dirty unrelated tab never blocks the reload, and a failed flush with no
 *   candidate still writes (a fresh open is not blocked).
 * - Focus priority: the dirty id match; else the first dirty path match in store
 *   order; else (failed flush) the id match, else the first path match.
 * - The guard runs BEFORE `prepareWholesaleReplace`, because preparation discards
 *   pending editor edits unwritten.
 * - Activation writes `activeDocumentId` directly rather than through
 *   `documentStore.setActiveDocumentId`: that action flushes again with reason
 *   "tab-switch", which is redundant — the "reopen" flush above already ran every
 *   live flusher in this same synchronous block.
 * - D92: when that flush FAILED and the active document's own flusher still fails
 *   (`flushPendingEditsFor`, asked only on that path), activation never moves away
 *   from it — moving would unmount the WYSIWYG editor whose edits the store never
 *   received. The guard's decision (focus or write) is unchanged; only the activation
 *   is withheld (`refuseTabSwitch`: warn log + toast), so a fresh open still writes its
 *   tab, inactive. Both stores keep the same active id. A failure that belongs to
 *   another document's flusher still focuses as decision 5 says. The refusal log
 *   carries the open's own `ctx.actionId` when it has one (D95).
 * - Callers learn whether the tab became active by reading `activeDocumentId` after
 *   the call (`useDocument.openPathOutcome`, D95); the result shape is unchanged.
 * - Logs (`file.open.focus_dirty`, `file.open.reload_clean`) carry ids and flags only,
 *   never document content (rule 20). Their `success` is the guard's decision; the
 *   `activated` flag says whether the tab actually became active (false after a D92
 *   refusal, which also logs `tab.switch` fail).
 *
 * @coordinates-with src/utils/dataLossGuards.ts — assessWindowUnsaved("reopen")
 * @coordinates-with src/utils/wholesaleReplace.ts — prepareWholesaleReplace
 * @coordinates-with src/stores/documentStore.ts — upsertDocument / activeDocumentId
 * @coordinates-with src/stores/editorStore.ts — setActiveDocumentId
 * @coordinates-with src/hooks/useDocument.ts — the three open entry points that call it
 * @coordinates-with src/utils/flushRefusal.ts — refuseTabSwitch (D92)
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEditsFor (D92)
 * @module utils/openWriteGuard
 */
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";
import { assessWindowUnsaved } from "./dataLossGuards";
import { refuseTabSwitch } from "./flushRefusal";
import { prepareWholesaleReplace } from "./wholesaleReplace";

/** Files above this size open with a performance warning. */
export const LARGE_FILE_BYTES = 10 * 1024 * 1024;

/** Which open action produced the decoded document; logged as `entry`. */
export type OpenWriteReason = "file-open" | "encoding-reopen";

/** How the focused document relates to the decoded one. */
export type OpenMatch = "id" | "path";

export type OpenWriteResult =
  | { kind: "focused-dirty"; document: Document; matchedBy: OpenMatch }
  | { kind: "written"; document: Document; largeFile: boolean };

/**
 * What `useDocument.openDocumentWithEncoding` returns (ADR-0028 decision 2): the
 * re-decoded document, or an explicit refusal naming the dirty tab that was focused.
 */
export type EncodingReopenResult =
  | { kind: "opened"; document: Document }
  | { kind: "refused-dirty"; documentId: string };

export interface OpenWriteContext {
  actionId?: string;
}

interface Focus {
  document: Document;
  matchedBy: OpenMatch;
}

/**
 * Pick the document to focus instead of writing, or `null` when the write may go
 * ahead. `pathMatches` must exclude `idMatch` and be in store order.
 */
function pickFocus(
  idMatch: Document | undefined,
  pathMatches: Document[],
  flushFailed: boolean,
): Focus | null {
  if (idMatch?.isModified) return { document: idMatch, matchedBy: "id" };
  const dirtyPath = pathMatches.find((doc) => doc.isModified);
  if (dirtyPath) return { document: dirtyPath, matchedBy: "path" };
  if (!flushFailed) return null;
  if (idMatch) return { document: idMatch, matchedBy: "id" };
  const firstPath = pathMatches[0];
  return firstPath ? { document: firstPath, matchedBy: "path" } : null;
}

/**
 * D92: true when moving off the active document would unmount an editor whose edits
 * the store never received. Only asked after the "reopen" flush failed; the aggregate
 * cannot say whose flusher failed, so the active document's own flusher is asked.
 */
function activeEditorFailed(from: string | null, flushFailed: boolean): boolean {
  if (!flushFailed || from === null) return false;
  return useMilkdownEditorStore.getState().flushPendingEditsFor(from, "tab-switch").status === "failed";
}

/** Activate `documentId` in both stores, unless that would move away from an active
 *  document whose flush failed (D92). Returns whether it is now active. */
function activate(documentId: string, flushFailed: boolean, ctx: OpenWriteContext): boolean {
  const from = useDocumentStore.getState().activeDocumentId;
  if (documentId !== from && activeEditorFailed(from, flushFailed)) {
    refuseTabSwitch(from, documentId, "open-write-guard", ctx.actionId);
    return false;
  }
  useDocumentStore.setState({ activeDocumentId: documentId });
  useEditorStore.getState().setActiveDocumentId(documentId);
  return true;
}

function logFocus(
  focus: Focus,
  entry: string,
  flushFailed: boolean,
  activated: boolean,
  ctx: OpenWriteContext,
): void {
  loggingService.logEventSync({
    level: "info",
    event: "file.open.focus_dirty",
    status: "success",
    actionId: ctx.actionId ?? loggingService.generateActionId(),
    context: {
      documentId: focus.document.id,
      entry,
      matchedBy: focus.matchedBy,
      flushFailed,
      activated,
    },
  });
}

/**
 * Write the decoded document for an open action, unless a candidate is dirty (or the
 * flush failed while a candidate exists), in which case the existing tab is focused
 * and nothing is written. Synchronous by contract: never returns a thenable.
 */
export function commitOpenedDocument(
  decoded: Document,
  reason: OpenWriteReason,
  ctx: OpenWriteContext = {},
): OpenWriteResult {
  const { flushFailed } = assessWindowUnsaved("reopen");
  const { documents } = useDocumentStore.getState();
  const idMatch = documents.find((doc) => doc.id === decoded.id);
  const pathMatches = documents.filter(
    (doc) => doc.id !== decoded.id && decoded.path !== null && doc.path === decoded.path,
  );

  const focus = pickFocus(idMatch, pathMatches, flushFailed);
  if (focus) {
    const activated = activate(focus.document.id, flushFailed, ctx);
    logFocus(focus, reason, flushFailed, activated, ctx);
    return { kind: "focused-dirty", document: focus.document, matchedBy: focus.matchedBy };
  }

  prepareWholesaleReplace(decoded.id, reason);
  useDocumentStore.getState().upsertDocument(decoded);
  const activated = activate(decoded.id, flushFailed, ctx);
  if (idMatch || pathMatches.length > 0) {
    loggingService.logEventSync({
      level: "info",
      event: "file.open.reload_clean",
      status: "success",
      actionId: ctx.actionId ?? loggingService.generateActionId(),
      context: { documentId: decoded.id, entry: reason, activated },
    });
  }
  const largeFile = decoded.fileSize !== null && decoded.fileSize > LARGE_FILE_BYTES;
  return { kind: "written", document: decoded, largeFile };
}

/**
 * The decode-failure exit: flush, then focus and return the open document at `path`
 * that must not be handed to `EncodingDialog` — the first dirty one in store order,
 * or with a failed flush the first one. Returns `null` (and changes nothing) otherwise.
 */
export function focusDirtyOpenAt(path: string, ctx: OpenWriteContext = {}): Document | null {
  const { flushFailed } = assessWindowUnsaved("reopen");
  const pathMatches = useDocumentStore
    .getState()
    .documents.filter((doc) => doc.path !== null && doc.path === path);
  const focus = pickFocus(undefined, pathMatches, flushFailed);
  if (!focus) return null;
  const activated = activate(focus.document.id, flushFailed, ctx);
  logFocus(focus, "decode-failure", flushFailed, activated, ctx);
  return focus.document;
}

/** What `handleEncodingSelect` shows and records for an encoding-reopen result. */
export interface EncodingReopenOutcome {
  toast: string | null;
  recentPath: string | null;
}

/** Toast shown when an encoding reopen is refused because the open tab is dirty. */
export const ENCODING_REOPEN_REFUSED_TOAST =
  "Kept your unsaved changes; the file was not re-decoded";

/**
 * Map an encoding-reopen result to its single user signal: `refused-dirty` gives
 * one toast and no recent-files update; `opened` gives no toast and the path to record.
 */
export function encodingReopenOutcome(result: EncodingReopenResult): EncodingReopenOutcome {
  switch (result.kind) {
    case "refused-dirty":
      return { toast: ENCODING_REOPEN_REFUSED_TOAST, recentPath: null };
    case "opened":
      return { toast: null, recentPath: result.document.path };
    default:
      return result satisfies never;
  }
}
