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
 * - Logs (`file.open.focus_dirty`, `file.open.reload_clean`) carry ids and flags only,
 *   never document content (rule 20).
 *
 * @coordinates-with src/utils/dataLossGuards.ts — assessWindowUnsaved("reopen")
 * @coordinates-with src/utils/wholesaleReplace.ts — prepareWholesaleReplace
 * @coordinates-with src/stores/documentStore.ts — upsertDocument / activeDocumentId
 * @coordinates-with src/stores/editorStore.ts — setActiveDocumentId
 * @coordinates-with src/hooks/useDocument.ts — the three open entry points that call it
 * @module utils/openWriteGuard
 */
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import type { Document } from "../types/document";
import { assessWindowUnsaved } from "./dataLossGuards";
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

function activate(documentId: string): void {
  useDocumentStore.setState({ activeDocumentId: documentId });
  useEditorStore.getState().setActiveDocumentId(documentId);
}

function logFocus(focus: Focus, entry: string, flushFailed: boolean, ctx: OpenWriteContext): void {
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
    activate(focus.document.id);
    logFocus(focus, reason, flushFailed, ctx);
    return { kind: "focused-dirty", document: focus.document, matchedBy: focus.matchedBy };
  }

  prepareWholesaleReplace(decoded.id, reason);
  useDocumentStore.getState().upsertDocument(decoded);
  activate(decoded.id);
  if (idMatch || pathMatches.length > 0) {
    loggingService.logEventSync({
      level: "info",
      event: "file.open.reload_clean",
      status: "success",
      actionId: ctx.actionId ?? loggingService.generateActionId(),
      context: { documentId: decoded.id, entry: reason },
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
  activate(focus.document.id);
  logFocus(focus, "decode-failure", flushFailed, ctx);
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
