/**
 * Purpose: the one step every wholesale replacement of a document's content runs, in
 * the same synchronous block as its store write (`upsertDocument` in place, or MCP
 * `write_document`'s `updateDocumentContent`). A wholesale write voids two things the
 * store cannot see:
 *   1. heading identities — `tocStore.resetCoordination` (WI-3.5.5);
 *   2. the WYSIWYG editor's doc — `milkdownEditorStore.reloadEditor` (D15-WI-5/6)
 *      discards the old editor's pending edits unwritten and bumps the document's
 *      editor generation, so `MilkdownEditor` rebuilds from the new content.
 *
 * Key decisions:
 * - Callable before the store write: the rebuild is a React render, which runs only
 *   after the synchronous block, so it always reads the new content; and a discarded
 *   controller never writes, so nothing stale can land in between.
 * - Keeping the store write at the call site keeps each upsert call line where
 *   `tests/wholesale-path-partition.test.ts` (W5) discovers and classifies it.
 * - Ordinary (incremental) writes must NOT call this: a reset would break heading
 *   coordination and a rebuild would drop the cursor on every edit.
 *
 * @coordinates-with src/stores/tocStore.ts — resetCoordination
 * @coordinates-with src/stores/milkdownEditorStore.ts — reloadEditor
 * @coordinates-with src/hooks/useDocument.ts — the reopen / recovery / reload sites
 * @coordinates-with src/hooks/useMcpEvents.ts — MCP write_document
 * @module utils/wholesaleReplace
 */
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useTOCStore } from "../stores/tocStore";

/** Why the buffer is being replaced; logged by `reloadEditor`. */
export type WholesaleReason =
  | "file-open"
  | "file-reload"
  | "encoding-reopen"
  | "draft-recovery"
  | "mcp-write";

/** Void heading identities and the WYSIWYG editor for `documentId`. */
export function prepareWholesaleReplace(documentId: string, reason: WholesaleReason): void {
  useTOCStore.getState().resetCoordination(documentId);
  useMilkdownEditorStore.getState().reloadEditor(documentId, reason);
}
