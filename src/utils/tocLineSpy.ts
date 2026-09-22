/**
 * Purpose: the **line-based** active-heading selection for the source (CodeMirror)
 * surface. Two pure exports, applied in this order by the caller:
 *
 *   1. `pickActiveKeyByLine` — "given the first line visible at the top of the
 *      viewport, which heading is the reader currently under?"
 *   2. `retainVisibleActiveKey` — "…unless the scroller has reached its limit **and**
 *      the heading that is already active is still on screen, in which case keep it."
 *      The tail-clamp guard; see its own section below.
 *
 * A third step, *retain-on-null* (`next = retained ?? current`), deliberately lives in
 * the **caller**, not here: `retainVisibleActiveKey` must be able to answer `null` for
 * "no heading qualifies and the current one has been scrolled past", and folding the
 * retain into it would make that answer unreachable.
 *
 * Why this is its own module and not a fourth export of `tocElementResolution.ts`:
 * that module's header declares itself **DOM-scoped** — it allocates `TOCEntry`s to
 * heading *elements*, and the WYSIWYG spy measures those elements in pixels. There
 * are no heading elements in the source surface. A line number is not a shorter way
 * of saying "element"; putting a line-space selector inside a DOM-space module would
 * make one file responsible for two coordinate systems that can never be mixed, which
 * is how a caller ends up passing one where the other was meant.
 *
 * Pure by construction and by requirement: no React, no Tauri, no DOM, no globals, no
 * module-scope mutable state, **and no logging** (rule 20's logging requirement is a
 * requirement on feature code, not on a comparison called once per animation frame —
 * per-call logging here would write thousands of lines per scroll). Two calls with the
 * same arguments return the same result. This applies to **both** exports.
 *
 * ---------------------------------------------------------------------------
 * `pickActiveKeyByLine` — the rule
 * ---------------------------------------------------------------------------
 * The result is the **last entry, in the order the caller passed them**, whose
 * `lineNumber <= topLine`; `null` when no entry qualifies.
 *
 * `null` is the *retain* signal, not "no heading": it means the viewport top is above
 * the first heading, and what to do about that is the caller's decision — the same
 * contract `selectActiveHeading` states in `tocGeometrySpy.ts`. Returning
 * `entries[0].key` as a "safe default" instead would make the sidebar highlight a
 * heading the reader has not reached.
 *
 * `lineNumber` is **1-based** and agrees with CodeMirror's
 * `EditorView.state.doc.line(n)`, so `topLine` must come from the same space.
 *
 * ---------------------------------------------------------------------------
 * Precondition, and what happens outside it
 * ---------------------------------------------------------------------------
 * `entries` are expected in **document order** (ascending `lineNumber`), which
 * `parseHeadingsFromContent` → `tocStore.setEntries` guarantees. The function is
 * nonetheless **total** for out-of-order input: it applies the rule above literally —
 * last *in the given order*, not last by line — and never sorts, never mutates the
 * caller's array, and never throws. Sorting internally would silently redefine the
 * contract and hand the caller back a reordered array it did not ask for; throwing
 * would turn a cosmetic ordering bug into a crashed scroll handler.
 *
 * ---------------------------------------------------------------------------
 * `topLine` is any `number` — the recorded behaviour of the degenerate ones
 * ---------------------------------------------------------------------------
 * There is no validation and no normalization, because every degenerate value already
 * has a defensible answer that falls out of `<=`:
 *
 *   | `topLine`                     | Result                                      |
 *   |-------------------------------|---------------------------------------------|
 *   | `NaN`                         | `null` — every `<=` against `NaN` is false  |
 *   | `0`, negative, `-Infinity`    | `null` (no heading sits on line ≤ 0)        |
 *   | `Infinity`, `MAX_SAFE_INTEGER`| the last qualifying entry                   |
 *   | non-integer (e.g. `4.999`)    | compared as-is; **no** rounding             |
 *   | `entries` empty               | `null`                                      |
 *
 * The no-rounding row is load-bearing: a `Math.floor(topLine)` would move the boundary
 * for `5.000001`, and an `if (!topLine)` guard would capture `0` and `NaN` together
 * with a value the caller never meant to special-case.
 *
 * Neither `text` nor `level` nor `anchorSlug` is read. Two headings with identical text
 * and level on different lines are therefore selected independently — the defect
 * `tocElementResolution.ts`'s header records as its reason for existing, kept out of
 * this surface by simply never looking at the fields that could cause it.
 *
 * ---------------------------------------------------------------------------
 * `retainVisibleActiveKey` — why a raw pick is not enough
 * ---------------------------------------------------------------------------
 * `pickActiveKeyByLine` answers from the viewport **top** alone. That is wrong in one
 * situation the user creates on purpose: clicking the *last* heading of a document.
 * `EditorView.scrollIntoView` cannot put line 90 of a 100-line file at the anchor —
 * the document ends first — so the anchor clamps short (say line 78) and the raw pick
 * snaps the highlight back to the *previous* heading, one frame after the click. The
 * heading the reader is plainly looking at loses the highlight.
 *
 * The fix is to ask a second question the top line cannot answer: is the heading that
 * is already active still **on screen**? Hence the `bottomLine` parameter, and hence
 * the whole viewport range rather than just its top.
 *
 * ---------------------------------------------------------------------------
 * …and why "still on screen" alone was **too much** — the directional freeze
 * ---------------------------------------------------------------------------
 * That rule originally ran on **every sample**, with no condition on where the
 * scroller was. A heading stays inside `[topLine, bottomLine]` for the whole distance
 * it takes to leave the viewport, so scrolling *upward* — away from the active heading
 * rather than toward it — retained that heading for an entire screenful before the
 * outline moved. Scrolling down looked correct (the newly-entered heading is *below*
 * the previous one, which has already left through the top) and scrolling up looked
 * stuck. Measured in manual QA on 2026-09-20 over a 111-line document: scrolling up
 * from first-visible-42 left the line-34 heading highlighted past the line-22 heading.
 *
 * The clamp is therefore **narrowed, not deleted** — QA equally confirmed that clicking
 * the line-99 and line-86 headings only lands and stays *because* of this retention.
 * It is narrowed to the one situation that motivated it: the scroller has run out of
 * room, so the anchor physically cannot reach the clicked heading. `atScrollLimit`
 * carries that measurement, computed once in the sole geometry seam
 * (`codemirrorViewportLine.ts`) and passed in as a decision-ready boolean.
 *
 *   result = currentKey   when `atScrollLimit`, `picked !== currentKey`, `currentKey`
 *                         is non-null, and the entry owning it has
 *                         `lineNumber ∈ [topLine, bottomLine]`
 *   result = picked       otherwise
 *
 * The interval is **closed at both ends**: a heading sitting exactly on the top or the
 * bottom visible line is visible.
 *
 * Four guards, each of which is a bug if removed, **in this order**:
 *
 *   | # | Condition                          | Answer   | Bug if retained instead       |
 *   |---|------------------------------------|----------|-------------------------------|
 *   | 1 | `picked === currentKey`            | `picked` | none — but the short-circuit  |
 *   |   |                                    |          | must run *first*, so an       |
 *   |   |                                    |          | already-active heading        |
 *   |   |                                    |          | scrolled past is not blanked  |
 *   | 2 | `currentKey === null`              | `picked` | nothing to retain             |
 *   | 3 | `!atScrollLimit`                   | `picked` | **the directional freeze**:   |
 *   |   |                                    |          | the highlight lags a whole    |
 *   |   |                                    |          | screenful on every upward     |
 *   |   |                                    |          | scroll                        |
 *   | 4 | `currentKey` absent from `entries` | `picked` | the sidebar would highlight a |
 *   |   |                                    |          | heading from a closed document|
 *   | 5 | current entry above `topLine`      | `picked` | the highlight would pin       |
 *   |   |                                    |          | forever — "the outline is     |
 *   |   |                                    |          | stuck"                        |
 *
 * **Guard 3 sits where it does on purpose.** Behaviourally it could go anywhere after
 * guard 2 — guards 4 and 5 also answer `picked`, so the result is the same either
 * side of them. It goes *before* the `entries.find` because `!atScrollLimit` is the
 * common case (every frame of every ordinary scroll) and `find` is an O(n) scan on a
 * path that runs once per animation frame. Two consequences a later reader should not
 * undo: moving it after `find` changes nothing observable but reinstates the scan,
 * and — recorded because the plan got this wrong — under `!atScrollLimit` the
 * stale-key and above-the-top rows exit through **guard 3**, not through guards 4/5.
 *
 * `picked` is returned **verbatim**, never validated against `entries`: it is by
 * construction the output of `pickActiveKeyByLine`, which already conserves. Two laws
 * follow, hold for **both** values of `atScrollLimit`, and are pinned by tests:
 * **idempotence** (`f(f(p, c, …, s), c, …, s) === f(p, c, …, s)`) and **non-invention**
 * (the result is always `picked`, `currentKey`, or `null`, and a key is never
 * synthesized or searched for). For `atScrollLimit === false` a third and stronger
 * statement holds: the function is the constant projection `f(p, …, false) === p`.
 * Like the picker, this function reads neither `text` nor `level` nor `anchorSlug`.
 *
 * What this deliberately does **not** do: select the final heading when the scroller
 * reaches the bottom. Identical geometry cannot answer both "ordinary scrolling selects
 * the section at the anchor" and "arriving at the bottom selects the last heading"
 * without extra state; the accepted policy is the former plus "an explicitly clicked
 * visible heading survives at a clamped destination". The residual asymmetry is
 * recorded, not fixed.
 */
import type { HeadingKey, TOCEntry } from "../types/toc";

/**
 * The key of the last entry, in the given order, whose `lineNumber <= topLine`, or
 * `null` if none qualifies.
 *
 * Returns a key **taken from** `entries` — never a synthesized or recomputed value.
 * See the module header for the document-order precondition, the out-of-order
 * fallback, and the behaviour of degenerate `topLine` values.
 *
 * @param entries Headings in document order (see precondition). Not mutated.
 * @param topLine 1-based line number currently at the top of the viewport.
 */
export function pickActiveKeyByLine(
  entries: readonly TOCEntry[],
  topLine: number,
): HeadingKey | null {
  let active: HeadingKey | null = null;

  // Forward scan with last-wins rather than a reverse scan with an early return: the
  // two agree on ordered input, and this one states the "last in the given order"
  // rule literally, so the out-of-precondition answer is readable from the code.
  for (const entry of entries) {
    if (entry.lineNumber <= topLine) active = entry.key;
  }

  return active;
}

/**
 * Keep the already-active heading when the scroller has reached its limit and that
 * heading is still inside the visible line range; otherwise accept what the picker
 * chose.
 *
 * See the module header for the full rule, the closed interval, the five-row guard
 * table, why guard 3 sits before the `entries.find`, and the laws. Returns `picked`
 * unchanged whenever no retention applies — including when `picked` is `null`, which
 * is the caller's signal to fall back to its own previous value (the retain-on-null
 * step, which deliberately is **not** done here).
 *
 * @param picked        What `pickActiveKeyByLine` chose for this frame.
 * @param currentKey    The key currently highlighted in the sidebar, or `null`.
 * @param entries       Headings in document order. Not mutated; only `key` and
 *                      `lineNumber` are read.
 * @param topLine       1-based first visible line. Inclusive.
 * @param bottomLine    1-based last visible line. Inclusive.
 * @param atScrollLimit `SpyLineRange.atScrollLimit` — the scroller has run out of room,
 *                      so the anchor cannot reach a heading near the end of the
 *                      document. Retention applies only here. `false` on untrustworthy
 *                      geometry, which degrades to "the highlight tracks the anchor".
 */
export function retainVisibleActiveKey(
  picked: HeadingKey | null,
  currentKey: HeadingKey | null,
  entries: readonly TOCEntry[],
  topLine: number,
  bottomLine: number,
  atScrollLimit: boolean,
): HeadingKey | null {
  // Order matters: the equality short-circuit runs before the range test, so an entry
  // that is both current and scrolled past is returned rather than blanked.
  if (picked === currentKey) return picked;
  if (currentKey === null) return picked;

  // Guard 3 — the narrowing. Placed before the `find` so the common per-frame path
  // (every frame of every ordinary scroll) costs no array scan. See the header.
  if (!atScrollLimit) return picked;

  // Resolve the key to a live entry. A key left over from a closed document resolves
  // to nothing and is never retained — that is the non-invention law.
  const current = entries.find((entry) => entry.key === currentKey);
  if (current === undefined) return picked;

  const visible = current.lineNumber >= topLine && current.lineNumber <= bottomLine;

  // `current.key` rather than `currentKey`: identical by construction, but taking the
  // returned key *from* `entries` makes conservation structural rather than incidental.
  return visible ? current.key : picked;
}
