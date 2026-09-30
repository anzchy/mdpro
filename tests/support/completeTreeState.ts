/**
 * @module tests/support/completeTreeState
 * Purpose: Build an `EditorState` whose detection field was CREATED over a
 * complete markdown syntax tree, so the fence check cannot depend on CPU
 * load. Shared by the D12 WI-6 suites (`source-table-span-reuse*.test.ts`).
 *
 * `EditorState.create` parses only up to `Work.InitViewport` within a
 * `Work.Apply` time budget (@codemirror/language `LanguageState.init`).
 * Under CPU load a created state's tree can stop short of a code fence even
 * in a tiny document, and its field then reports a table inside the fence.
 * Two load-dependent failures were observed: corpus#6 step 183 in REUSE-1,
 * where a fresh state gave cell "fenced", and REUSE-4 (e), where the
 * `isPositionInFencedCode` precondition failed.
 *
 * Three steps, each needed:
 *  1. create WITHOUT the detection field, then force the full parse with
 *     `ensureSyntaxTree`. It must return non-null.
 *  2. dispatch an empty transaction, which makes `LanguageState.apply`
 *     adopt the completed `context.tree`. `ensureSyntaxTree` alone leaves
 *     `syntaxTree(state)` on the partial tree.
 *  3. add the field with `appendConfig`. Its `create` then runs over the
 *     adopted tree, the same code path as `EditorState.create`, and never
 *     touches the field's `update` (the reuse path).
 *
 * Step 2 cannot be folded into step 3. `EditorState.applyTransaction`
 * creates newly configured fields on an intermediate state that copies the
 * OLD `Language.state`. The field would see the partial tree, and its
 * `update` keeps that value because the selection did not change. A probe
 * that forced partial parses (a fast-forwarded `Date.now`) at every offset
 * of the seeded corpus measured 542 of 18,820 mismatches without step 2
 * and 0 with it.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { EditorState, StateEffect, type EditorSelection, type Extension, type Text } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";

/** Budget for the forced full parse; generous so load never cuts it short. */
export const FULL_PARSE_MS = 20_000;

/**
 * `doc` at `selection`, with `language` parsed to the end and then
 * `detection` created over that complete tree. Throws, rather than
 * returning a partial-tree state, when any step does not hold.
 */
export function completeTreeState(
  doc: string | Text,
  selection: EditorSelection | { anchor: number; head?: number },
  language: Extension,
  detection: Extension,
): EditorState {
  const bare = EditorState.create({ doc, selection, extensions: [language] });
  const tree = ensureSyntaxTree(bare, bare.doc.length, FULL_PARSE_MS);
  if (tree === null) throw new Error("completeTreeState: full parse did not finish");
  const adopted = bare.update({}).state;
  if (syntaxTree(adopted) !== tree) {
    throw new Error("completeTreeState: completed tree was not adopted");
  }
  const state = adopted.update({ effects: StateEffect.appendConfig.of(detection) }).state;
  if (!syntaxTreeAvailable(state, state.doc.length) || syntaxTree(state) !== tree) {
    throw new Error("completeTreeState: detection field was not created over the complete tree");
  }
  return state;
}
