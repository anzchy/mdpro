/**
 * @module stores/editorGeneration
 * Purpose: a monotonic counter of "which editor is in front of the user". It
 * goes up by one whenever the identity of any of three references changes:
 * `documentStore.activeDocumentId`, the CodeMirror `editorStore.editorView`, or
 * the Milkdown getter `milkdownEditorStore.getEditor`. A menu-target token
 * (`utils/menuTargetToken.ts`) captures it at receipt, so a deferred menu
 * mutation can tell that its editor has gone (D261).
 *
 * Key decisions:
 *   - Driven by zustand `subscribe` from here, so `documentStore.ts` and
 *     `editorStore.ts` (at the rule-50 size limit) do not grow.
 *   - Identity only: content, selection and view-mode changes, and setting the
 *     same value again, never bump. Typing never invalidates a token.
 *   - Teardown bumps: a view set to `null` and an unregistered getter are
 *     identity changes, so a token captured against a torn-down editor fails
 *     closed (delegator ruling, 2026-10-17).
 *   - It only goes up and is never reset: switching away and back leaves a
 *     token stale for good. Tests read deltas.
 *
 * @coordinates-with src/utils/menuTargetToken.ts — captures and compares it
 * @coordinates-with src/stores/documentStore.ts — activeDocumentId
 * @coordinates-with src/stores/editorStore.ts — editorView
 * @coordinates-with src/stores/milkdownEditorStore.ts — getEditor
 */
import { useDocumentStore } from "./documentStore";
import { useEditorStore } from "./editorStore";
import { useMilkdownEditorStore } from "./milkdownEditorStore";

let generation = 0;

const bumpOnChange =
  <S, V>(select: (state: S) => V) =>
  (state: S, previous: S) => {
    if (select(state) !== select(previous)) generation += 1;
  };

useDocumentStore.subscribe(bumpOnChange((s) => s.activeDocumentId));
useEditorStore.subscribe(bumpOnChange((s) => s.editorView));
useMilkdownEditorStore.subscribe(bumpOnChange((s) => s.getEditor));

/** The current editor generation. */
export function getEditorGeneration(): number {
  return generation;
}
