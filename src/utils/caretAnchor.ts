/**
 * Purpose: map a WYSIWYG caret across a wholesale document rebuild (D37). When the
 * Milkdown editor is torn down and rebuilt from new markdown, the old selection head
 * belongs to a document that no longer exists. `anchorCaretAcrossReplace` finds the
 * position in the rebuilt document that is "the same place", from the structural diff
 * of the two documents alone.
 *
 * `@module src/utils/caretAnchor`
 * `@coordinates-with` `tests/caret-anchor.test.ts`, `tests/caret-anchor-law.test.ts`
 * (the specification), `src/hooks/useMilkdownFocusRestore.ts` (the caller: maps the
 * carried head into the rebuilt doc), `src/utils/milkdownFocusCarry.ts` (holds the old
 * doc and head across the rebuild).
 *
 * Key decisions:
 * - **The old doc is rebuilt in the new schema first.** The live and the rebuilt editor
 *   hold separate `Schema` instances, and `findDiffStart` compares node types by
 *   identity, so a cross-schema diff reports a difference at position 0 for identical
 *   content. `newDoc.type.schema.nodeFromJSON(oldDoc.toJSON())` puts both sides in one
 *   schema.
 * - **Two candidates.** With `start = findDiffStart` and `{a, b} = findDiffEnd` (raw, no
 *   overlap normalisation) and `h` the head clamped to the old size: `pre = h` is valid
 *   when `h <= start` (the head is before the change); `suf = h - a + b` is valid when
 *   `h >= a` (the head is after it). Exactly one valid → use it.
 * - **A head strictly inside a rewritten region maps to the region's start.** Neither
 *   candidate valid means the text around the head was replaced; there is no equivalent
 *   position, and the start of the change is the least surprising one.
 * - **The diff is ambiguous, hence the tie rule.** `a → aba` is equally "ab inserted
 *   before" and "ba inserted after"; when both candidates are valid the diff cannot say
 *   which side of the insert the head was on. The tie goes to the candidate whose new
 *   textblock `eq`s the old head's textblock at the same `parentOffset` (`pre` checked
 *   first), else to `pre`. An old head that is not in a textblock takes `pre` outright.
 *   Example "XY / Zab": a paragraph `XY` inserted before the caret's paragraph `ab`, with
 *   the caret at its start — `pre` would land at the start of `XY`, whose textblock is
 *   not `ab`, so the caret follows its own paragraph to `suf`.
 * - **Known limit:** monotonicity (P4) is guaranteed only for inserts; for deletions and
 *   rewrites the raw end diff can give `b < start` (e.g. `P(abab)→P(ab)`: 3→3, 4→2). Only
 *   one head is carried, so the output is still a valid position.
 * - **Fallbacks, never a throw.** An old doc larger than `CARET_ANCHOR_MAX_DOC_SIZE` skips
 *   the diff (`fallback-size`); an old doc the new schema cannot hold (`nodeFromJSON`
 *   throws) skips it too (`fallback-json`). Both return the head clamped to the new doc.
 *
 * Pure: no store access, no DOM, no logging — no document content is logged. The caller
 * logs the returned `anchor` kind if it wants to.
 */
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";

/** How the returned position was derived. */
export type CaretAnchorKind = "diff" | "unchanged" | "fallback-json" | "fallback-size";

export interface CaretAnchorResult {
  /** Always an integer in `[0, newDoc.content.size]`. */
  pos: number;
  anchor: CaretAnchorKind;
}

/**
 * Largest old-doc `content.size` that is diffed; larger docs keep the clamped head.
 * Sized to clear the 10 MB open limit (`LARGE_FILE_BYTES`) with room for block
 * overhead: measured at 25k blocks / size 9.2M, rebuild plus both diffs took ~15–30 ms,
 * small beside the editor rebuild it follows. Past this, only the diff is skipped.
 */
export const CARET_ANCHOR_MAX_DOC_SIZE = 12_000_000;

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(n, max));
}

/** Is `c` in `newDoc` in a textblock equal to the old head's, at the same offset? */
function sameTextblockSpot(newDoc: Node, c: number, $old: ResolvedPos): boolean {
  const $c = newDoc.resolve(clamp(c, newDoc.content.size));
  return (
    $c.parent.isTextblock && $c.parentOffset === $old.parentOffset && $c.parent.eq($old.parent)
  );
}

/**
 * Map `head`, a position in `oldDoc`, to the equivalent position in `newDoc`.
 *
 * Total: `pos` is always an integer in `[0, newDoc.content.size]`, for any integer
 * `head` (negative and past-the-end heads are clamped) and any pair of docs. Inputs are
 * not mutated. See the header for the candidate rule, the tie rule and the fallbacks.
 */
export function anchorCaretAcrossReplace(
  oldDoc: Node,
  newDoc: Node,
  head: number,
): CaretAnchorResult {
  const newSize = newDoc.content.size;
  if (oldDoc.content.size > CARET_ANCHOR_MAX_DOC_SIZE) {
    return { pos: clamp(head, newSize), anchor: "fallback-size" };
  }

  let old: Node;
  try {
    old = newDoc.type.schema.nodeFromJSON(oldDoc.toJSON());
  } catch {
    return { pos: clamp(head, newSize), anchor: "fallback-json" };
  }

  const h = clamp(head, old.content.size);
  const start = old.content.findDiffStart(newDoc.content);
  const end = start === null ? null : old.content.findDiffEnd(newDoc.content);
  // `end` is null exactly when `start` is: the two fragments are equal.
  if (start === null || end === null) return { pos: clamp(head, newSize), anchor: "unchanged" };

  const pre = h;
  const suf = h - end.a + end.b;
  const preValid = h <= start;
  const sufValid = h >= end.a;

  let pos: number;
  if (preValid && !sufValid) pos = pre;
  else if (sufValid && !preValid) pos = suf;
  else if (!preValid && !sufValid) pos = start;
  else {
    const $old = old.resolve(h);
    if (!$old.parent.isTextblock) pos = pre;
    else if (sameTextblockSpot(newDoc, pre, $old)) pos = pre;
    else if (sameTextblockSpot(newDoc, suf, $old)) pos = suf;
    else pos = pre;
  }
  return { pos: clamp(pos, newSize), anchor: "diff" };
}
