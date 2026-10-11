/**
 * Minimal text change
 *
 * Purpose: Turns "replace all of `oldText` with `newText`" into the one change that
 * actually differs — the span between the longest common prefix and the longest common
 * suffix — so an editor applying it (CodeMirror `changes`) maps carets and selections
 * outside that span instead of collapsing them into a whole-document replacement.
 *
 * Key decisions (D66):
 * - Pure and linear: one forward and one backward scan over UTF-16 code units, no
 *   diff algorithm. A single span is enough for the callers, which change one region.
 * - Prefix and suffix never overlap (the suffix scan stops at the shorter text's
 *   remaining length), so `from <= to` always holds.
 * - Neither edge splits a surrogate pair: an edge that would fall between a high and a
 *   low surrogate moves outward by one code unit.
 * - Identical texts give an empty change at the end, which a dispatch treats as a no-op.
 *
 * @coordinates-with src/hooks/mcpTableAction.ts — the source-mode table apply uses it
 * @module utils/minimalTextChange
 */

/** One replacement, in `oldText` offsets: `oldText[from, to)` becomes `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The single narrowest change that turns `oldText` into `newText`. Applying it,
 * `oldText.slice(0, from) + insert + oldText.slice(to)`, yields `newText` exactly.
 */
export function minimalTextChange(oldText: string, newText: string): TextChange {
  const oldLen = oldText.length;
  const newLen = newText.length;
  const minLen = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  // The prefix is shared, so its last unit is the same in both texts.
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) {
    prefix--;
  }

  let suffix = 0;
  const maxSuffix = minLen - prefix;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldLen - 1 - suffix) === newText.charCodeAt(newLen - 1 - suffix)
  ) {
    suffix++;
  }
  // The suffix may start on a low surrogate whose high half differs between the texts.
  if (
    suffix > 0 &&
    (isHighSurrogate(oldText.charCodeAt(oldLen - suffix - 1)) ||
      isHighSurrogate(newText.charCodeAt(newLen - suffix - 1)))
  ) {
    suffix--;
  }

  return {
    from: prefix,
    to: oldLen - suffix,
    insert: newText.slice(prefix, newLen - suffix),
  };
}
