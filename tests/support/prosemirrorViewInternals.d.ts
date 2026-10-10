/**
 * Types for prosemirror-view's `__parseFromClipboard`, which it exports for
 * tests but leaves out of its declarations. `tests/table-paste-normalize.test.ts`
 * drives paste through it the way `doPaste` does (transformPastedHTML → DOM
 * parser → transformPasted), so the paste plugins run on a real slice.
 */
import type { ResolvedPos, Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

declare module "@milkdown/kit/prose/view" {
  export function __parseFromClipboard(
    view: EditorView,
    text: string,
    html: string | null,
    plainText: boolean,
    $context: ResolvedPos,
  ): Slice | null;
}
