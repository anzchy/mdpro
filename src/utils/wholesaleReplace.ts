/**
 * Purpose: the one step every wholesale replacement of a document's content runs, in
 * the same synchronous block as its store write (`upsertDocument` in place, or MCP
 * `write_document`'s `updateDocumentContent`). A wholesale write voids two things the
 * store cannot see:
 *   1. heading identities — `tocStore.resetCoordination` (WI-3.5.5);
 *   2. the WYSIWYG editor's doc — `milkdownEditorStore.reloadEditor` (D15-WI-5/6)
 *      discards the old editor's pending edits unwritten and bumps the document's
 *      editor generation, so `MilkdownEditor` rebuilds from the new content.
 * The rebuild also removes the focused view, so keyboard focus and the caret are carried
 * across it (D37): `snapshotFocusedEditor` runs BEFORE `reloadEditor` (while the old view
 * still exists) and the record is armed at the POST-reload generation, or an earlier live
 * record is carried forward to it when there is no focused view to snapshot.
 *
 * Key decisions:
 * - Callable before the store write: the rebuild is a React render, which runs only
 *   after the synchronous block, so it always reads the new content; and a discarded
 *   controller never writes, so nothing stale can land in between.
 * - Keeping the store write at the call site keeps each upsert call line where
 *   `tests/wholesale-path-partition.test.ts` (W5) discovers and classifies it.
 * - Ordinary (incremental) writes must NOT call this: a reset would break heading
 *   coordination and a rebuild would drop the cursor on every edit. The one exception
 *   is MCP `insert_content` into the document that is active in WYSIWYG (D35 /
 *   ADR-0044): Milkdown has no incremental path for it, so it is treated as wholesale
 *   (reason `"mcp-insert"`) after flushing pending edits, accepting the lost undo
 *   history and TOC collapse state; focus and the caret are carried when the editor
 *   was focused (D37). Source-mode and non-active inserts stay ordinary and do not
 *   call this.
 * - Arming at the post-reload generation is what lets the rebuilt editor, and only it,
 *   consume the record; armed at the pre-reload one it would be dropped as stale.
 *
 * @coordinates-with src/stores/tocStore.ts — resetCoordination
 * @coordinates-with src/stores/milkdownEditorStore.ts — reloadEditor
 * @coordinates-with src/utils/milkdownFocusCarry.ts — focus/caret capture and carry (D37)
 * @coordinates-with src/hooks/useDocument.ts — the draft-recovery and file-reload sites
 *   (`upsertAndActivateDocument`, `replaceDocument`); `createDocument` and the close
 *   paths call `tocStore.resetCoordination` directly instead
 * @coordinates-with src/utils/openWriteGuard.ts — the open sites, which call this only
 *   after the ADR-0028 guard has decided the target is clean (never on a dirty one)
 * @coordinates-with src/hooks/useMcpEvents.ts — MCP write_document
 * @coordinates-with src/hooks/mcpInsertContent.ts — MCP insert_content, WYSIWYG-active
 *   only (D35)
 * @module utils/wholesaleReplace
 */
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useTOCStore } from "../stores/tocStore";
import { armFocusCarry, carryForward, snapshotFocusedEditor } from "./milkdownFocusCarry";

/** Why the buffer is being replaced; logged by `reloadEditor`. */
export type WholesaleReason =
  | "file-open"
  | "file-reload"
  | "encoding-reopen"
  | "draft-recovery"
  | "mcp-write"
  | "mcp-insert";

/**
 * Void heading identities and the WYSIWYG editor for `documentId`, carrying focus and
 * the caret across the rebuild when the editor is focused (D37).
 */
export function prepareWholesaleReplace(documentId: string, reason: WholesaleReason): void {
  useTOCStore.getState().resetCoordination(documentId);
  const snapshot = snapshotFocusedEditor(documentId);
  useMilkdownEditorStore.getState().reloadEditor(documentId, reason);
  const generation = useMilkdownEditorStore.getState().editorGenerations[documentId] ?? 0;
  if (snapshot) armFocusCarry(snapshot, reason, generation);
  else carryForward(documentId, generation);
}
