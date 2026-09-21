/**
 * Purpose: resolve the cursor position MCP should use for a document, in the
 * one place both sides of the MCP boundary can share.
 *
 * Two call sites have to agree on this answer or the shadow store and the
 * editor insert the same text in different places:
 *
 * - `useMcpSync.ts` reports it to the Rust shadow store, where it becomes
 *   `doc.cursor` and drives `InsertPosition::Cursor`.
 * - `useMcpEvents.ts` uses it when applying an `mcp:insert_content` event.
 *
 * They used to be two separate expressions that happened to be written
 * differently — `useMcpSync` returned a hardcoded `0` for every document,
 * `useMcpEvents` read the live editor — so "insert at cursor" put text at the
 * top of the document in the shadow store and at the caret in the editor.
 * Registered as D10(c); see ADR-0021.
 *
 * Key decisions:
 * - The unit is **UTF-16 code units**, per ADR-0021. CodeMirror positions
 *   already are, so nothing is converted here; the Rust side converts instead.
 * - A non-active document resolves to **end of document**, never to a stored
 *   caret. A caret belonging to a different document is not a position in this
 *   one, and using it corrupts across documents.
 */

/**
 * Resolve the MCP cursor for one document.
 *
 * @param content - the document's current text.
 * @param isActive - whether this is the focused document.
 * @param head - the live editor's caret offset, if there is a live editor.
 *   `undefined` in WYSIWYG mode, where `editorStore.editorView` is null
 *   because only the CodeMirror source editor ever sets it.
 */
export function resolveMcpCursor(
  content: string,
  isActive: boolean,
  head: number | undefined
): number {
  if (!isActive) {
    // End of document. Matches what useMcpEvents has always done for inactive
    // documents, with the comment "to avoid cross-document corruption".
    return content.length;
  }

  if (head === undefined) {
    // No live editor. Today this means WYSIWYG mode: Milkdown never calls
    // setEditorView, so the store holds null and there is no caret to read.
    // Both sides then agree on 0 — they insert in the same place, and that
    // place is the top of the document. Agreement is what this module
    // guarantees; the WYSIWYG caret being unavailable at all is a separate,
    // still-open gap recorded on the ledger row.
    return 0;
  }

  // Clamp: the store's content can lag the editor by a render, and a caret
  // past the end of the string we are reporting would be rejected downstream.
  return Math.max(0, Math.min(head, content.length));
}
