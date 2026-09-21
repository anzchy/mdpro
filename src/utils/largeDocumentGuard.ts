/**
 * Purpose: the pure decision function behind the WYSIWYG large-document
 * guardrail — "is this document too big to open in the WYSIWYG surface, and if
 * so what do we tell the user?". Extracted verbatim from the `useEffect` at
 * `src/App.tsx:511-531` so the arithmetic can be unit tested for behaviour
 * instead of existing only as six untested lines inside a 1200-line component.
 * Precedent for the shape: `src/utils/dataLossGuards.ts` — a pure `decideX(...)`
 * returning a discriminated union that App.tsx consumes with an exhaustive
 * `switch`.
 *
 * FILE LENGTH — over rule 50 §6's 300-line limit, knowingly. About two thirds
 * of this file is the contract header below; the executable part is ~70 lines.
 * The rule's prescribed remedy (extract types to `types.ts`) is unavailable:
 * case C7 pins this module's import list to zero, so a sibling module cannot be
 * imported. Splitting the contract into `docs/` was rejected — it would put the
 * contract and the code it constrains in separate files, which is exactly how
 * the "0 ms" claim that ADR-0019 had to undo got to survive as long as it did.
 *
 * WHAT IS FROZEN NOW — ADR-0016 (Accepted 2026-09-20), implemented as D6.3(c).
 *
 * The frozen thing is the **invariant set**, not the number: one forward pass
 * over `content`, constant auxiliary space, no Markdown parsing, no tokenizer,
 * and a decision made by comparing counts only. `LARGE_DOCUMENT_STRUCTURE_THRESHOLD`
 * may be re-fitted on new measurements without a new ADR; acquiring a parsing
 * rule, an allocation, or a second pass may not.
 *
 * The threshold's evidence is thin and should be treated as such: it is fitted
 * on five fixtures that are all ~472 KB, one measured run each, on one machine.
 * Their structure scores sort strictly with the measured block time
 * (57,190 -> 12,004 ms; 32,657 -> 7,409 ms; 20,664 -> 1,793 ms; 3 -> 0 ms), and
 * 25,000 sits between the 1.8 s and 7.4 s cases. That is the whole basis.
 *
 * WHAT CHANGED ON 2026-09-21 — ADR-0019 (Accepted), implemented as D6.3(d).
 *
 * ADR-0019 **extends** ADR-0016; it does not supersede it. Every invariant
 * Decision 1 freezes still holds, which is exactly why the change was allowed
 * to be made without superseding anything: a second counter in the same pass is
 * still one pass and still constant auxiliary space, and Decision 1's escape
 * clause permits adding counters.
 *
 * The predicate is now **two counts against two thresholds, either of which
 * degrades**: the structure score above, and the longest line in UTF-16 code
 * units against `LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD`. What forced it: the
 * 9,961,475-byte, 4-line document that ADR-0016 listed as a known-and-accepted
 * allow was measured on real hardware at **259,483 ms to mount**, with the UI
 * unreadable for at least two minutes
 * (`docs/test/20260921-d5-d6-real-device-measurement.md`). A limitation that
 * was argued for in the abstract turned out, when measured, to be the worst
 * case the guard had.
 *
 * Known and accepted, per ADR-0016 and ADR-0019 Consequences:
 * - **Still blind to inline structure, just less of it.** The two triggers see
 *   line breaks and line length; they see nothing else. A document of 12 lines
 *   of 900,000 characters each scores 11 and measures 900,000, so it passes
 *   *both* triggers while carrying 10.8 MB of inline content. The residual
 *   blindness is narrower than it was, not gone.
 * - **The line-length threshold is not fitted.** 359,285 units (155 ms) is the
 *   largest measured allow and 7,583,742 (259,483 ms) the smallest measured
 *   refuse; `1_000_000` is a round number picked in the unmeasured gap between
 *   them. Re-fitting it on new measurements needs no new ADR.
 * - **Pipe arithmetic errs in both directions** — a `|` inside a fenced code
 *   block over-counts, a table row written without outer pipes under-counts.
 * - **A degrade leaves no log trace.** The user sees a toast; `~/.mdpro/mdpro.log`
 *   records nothing — and `trigger` now exists but reaches no log. Out of scope
 *   for both ADRs, tracked separately.
 *
 * The retired-case mapping table (G11-G13, G15, G18, G21, C8b) lives in
 * `tests/large-document-guard.test.ts` next to the cases it maps, not here — one
 * copy, beside the tests it is about. The test-matrix entry for WI-6 asked for it
 * in this header and the entry for WI-5 asked for it in the test header; a second
 * copy in production code would only give the two somewhere to drift apart.
 *
 * CONTRACT — answers (1)-(6) are D6.3(c), what ADR-0016 leaves
 * underdetermined; (7)-(12) are D6.3(d), what ADR-0019 leaves underdetermined.
 *
 * Recorded before the first test of this change was written, so the tests
 * specify a stated contract instead of transcribing whatever the implementation
 * happened to do. Authority is marked per answer: **[ADR]** = decided by
 * ADR-0016; **[choice]** = an implementation choice the ADR leaves open. Every
 * answer respects the invariants ADR-0016 Decision 1 freezes: one forward pass
 * over `content`, constant auxiliary space, no Markdown parsing, no tokenizer,
 * and a decision made by comparing counts only.
 *
 * 1. **"Newline count" is the count of `\n` characters** — not the number of
 *    lines, not `\n` + 1. A document with no trailing newline therefore scores
 *    one below its line count.
 *    **[choice]** — Decision 1 says "newline count" and does not define it.
 * 2. **A "table-row start" is a line whose first non-whitespace character is
 *    `|`.** Whitespace is **space and tab only**, and the run of it is
 *    **unbounded**. GFM's 3-space indent limit is deliberately NOT modelled: it
 *    is a parser rule, and Decision 1 forbids parsing.
 *    **[choice]**, constrained by Decision 1's no-parsing invariant.
 * 3. **Early exit is not implemented in this change.** Decision 1 *permits*
 *    stopping once the score has irreversibly crossed the threshold; it does not
 *    require it. Declined here because a full scan keeps the reported count
 *    exact at every input size — an early-exit payload would mean "at least this
 *    much", which no test can assert deterministically — and because the guard
 *    already ran an allocating full-document encode on every unsaved document,
 *    so the allocation-free full scan is not a regression against that path.
 *    Recorded as a **deferral, not a rejection**: a later change may add it, but
 *    must then re-answer what the reported number means.
 *    **[choice]** — the ADR permits either.
 * 4. **The degrade payload keeps a number**, with the field renamed
 *    `bytes` → `elements`. `bytes` is now false — nothing byte-shaped is
 *    measured any more.
 *    **[ADR]** Decision 2: the judged quantity is "structural elements"; the
 *    field carries the ADR's own word for it.
 * 5. **The threshold constant is `LARGE_DOCUMENT_STRUCTURE_THRESHOLD = 25_000`**,
 *    replacing `LARGE_DOCUMENT_THRESHOLD_BYTES`. The underscore spelling is part
 *    of the contract, not cosmetics: the C8b' source-text anchor asserts on the
 *    literal as written.
 *    **[ADR]** Decision 2 fixes the value; **[choice]** for the name and the
 *    spelling.
 * 6. **The scanner compares `charCodeAt` results against named module
 *    constants** — `CHAR_NEWLINE`, `CHAR_PIPE`, `CHAR_SPACE`, `CHAR_TAB` — never
 *    inline literals. Rejected alternative, recorded: direct string comparison
 *    (`c === "\n"`), which would leave a *stronger* C8b' literal list (the
 *    threshold alone) but gives up the unambiguous allocation-free reading of
 *    Decision 1's "constant auxiliary space". The stronger anchor was traded for
 *    the stronger invariant, deliberately.
 *    **[choice]** — pinned by C12 and C8b'.
 * 7. **Line length is measured in UTF-16 code units** — `content.length` units,
 *    not code points and not grapheme clusters. An astral character counts 2.
 *    **[ADR]** ADR-0019 Decision 1 names the unit.
 * 8. **A line ends at `"\n"`, and the final line counts even without one.** A
 *    document containing no `\n` at all is one line, of its whole length; the
 *    empty string is one line of length 0.
 *    **[choice]** — the ADR says "longest line" and does not define the edges.
 * 9. **`\r` is an ordinary counted character.** A CRLF document therefore
 *    measures one code unit longer per line than the same text in LF, and a
 *    line of exactly the threshold in LF is refused in CRLF. Deliberate: the
 *    alternative — not counting a `\r` that immediately precedes `\n` — needs a
 *    lookback, and a lookback is a parsing rule, which Decision 1 forbids. The
 *    cost is a real one-unit asymmetry at the boundary, accepted because the
 *    boundary is a round number with an order of magnitude of slack either way.
 *    **[choice]**, constrained by Decision 1's no-parsing invariant.
 * 10. **Space and tab count toward line length**, even though they neither
 *    score nor end the line-start state. The two state machines are
 *    independent; the `currentLine++` sits outside the scoring chain precisely
 *    so a whitespace-only line measures its true length.
 *    **[choice]**.
 * 11. **The threshold constant is
 *    `LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD = 1_000_000`, and `<=` allows** —
 *    the same allow direction as the structure threshold, so "at the threshold"
 *    means the same thing for both. The underscore spelling is contract, for
 *    the same C8b' reason as answer (5).
 *    **[ADR]** Decision 2 fixes the value and the direction; **[choice]** for
 *    the name and the spelling.
 * 12. **The two counts are NOT folded into one number.** A single score such as
 *    `max(score, longestLine / 40)` would be behaviourally identical to the two
 *    thresholds for every input, so no behavioural test can tell them apart —
 *    the source-text anchor C8b' is the only thing that pins it. Kept separate
 *    because the two quantities have no defensible exchange rate, and a fold
 *    would silently invent one.
 *    **[ADR]** Decision 3.
 *
 * @module src/utils/largeDocumentGuard
 * @coordinates-with src/App.tsx (the WYSIWYG large-document guardrail effect)
 */

import type { ViewMode } from "../types/editor";

/**
 * The structural-element count at or below which a document may stay in
 * WYSIWYG. See contract answer (5): the `25_000` spelling is part of the
 * contract, because the C8b' source-text anchor asserts on the literal as
 * written.
 */
export const LARGE_DOCUMENT_STRUCTURE_THRESHOLD = 25_000;

/**
 * The longest-line length, in UTF-16 code units, at or below which a document
 * may stay in WYSIWYG. See contract answer (11): like the threshold above, the
 * `1_000_000` spelling is part of the contract because C8b' asserts on the
 * literal as written.
 *
 * Between the only two observations that bracket it — 359,285 units mounting in
 * 155 ms, 7,583,742 units mounting in 259,483 ms — sits an order of magnitude
 * with nothing measured in it. The constant is a round number chosen inside
 * that gap, not a fitted one (ADR-0019 Consequences).
 */
export const LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD = 1_000_000;

/** The toast copy shown when the guardrail forces a document into Source mode. */
export const LARGE_DOCUMENT_DOWNGRADE_MESSAGE =
  "This document is too complex for WYSIWYG. Switched to Source mode for performance.";

/**
 * Everything the guardrail needs to decide: exactly two members.
 *
 * `fileSize` was removed by ADR-0016 Decision 5 — the predicate judges the live
 * in-memory source, never an on-disk byte count.
 *
 * Deliberately NOT nullable: the `!activeDocument` early return stays in the
 * caller, exactly as it does for the `decideFileChange` effect above it.
 */
export interface LargeDocumentGuardInput {
  viewMode: ViewMode;
  content: string;
}

/**
 * - `allow`: leave the view mode alone, say nothing. Deliberately carries NO
 *   numbers: a score on the allow arm would leak the measurement of every
 *   document the guard lets through, and a test pins that it does not.
 * - `degrade-to-source`: show `message`, then switch to Source mode. Both
 *   counts and the reason ride along, so a degrade is self-explaining —
 *   `elements` is the structural-element score, `longestLine` is the longest
 *   line in UTF-16 code units, and `trigger` names which threshold (or both)
 *   produced the decision. See contract answer (4) for why the first field is
 *   no longer called `bytes`; ADR-0019 Decision 4 for the other two.
 */
export type LargeDocumentGuardDecision =
  | { action: "allow" }
  | {
      action: "degrade-to-source";
      message: string;
      elements: number;
      longestLine: number;
      trigger: "structure" | "line-length" | "both";
    };

/**
 * The four character codes the scan compares against, named rather than
 * inlined — see contract answer (6).
 *
 * `charCodeAt` returns UTF-16 code units, which is safe here: no surrogate half
 * can equal any of these four values, so a code-unit scan and a code-point scan
 * produce identical scores.
 */
const CHAR_TAB = 9; // "\t"
const CHAR_NEWLINE = 10; // "\n"
const CHAR_SPACE = 32; // " "
const CHAR_PIPE = 124; // "|"

/**
 * Decide whether a document may stay in WYSIWYG mode.
 *
 * `score = newlines + (pipes − tableRowStarts)` and `longestLine` = the longest
 * run of code units between newlines. Allowed only while **both**
 * `score <= LARGE_DOCUMENT_STRUCTURE_THRESHOLD` and
 * `longestLine <= LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD`.
 *
 * One forward pass, constant auxiliary space, no parsing and no tokenizer —
 * ADR-0016 Decision 1 freezes all four, and ADR-0019 preserves all four.
 * Nothing derived from `content` is allocated: no `split`, no `match`, no
 * `trimStart`, no regex, no encode. The whole scan state is four numbers and a
 * boolean, regardless of input size.
 *
 * `atLineStart` starts `true` because the first line of the document is a line
 * like any other; it stays `true` across a run of spaces and tabs (contract
 * answer (2)'s unbounded whitespace), and any other character clears it. A pipe
 * seen while it is still set is a table-row start, so it contributes its `+1`
 * as a pipe and its `−1` as a row start in the same step — which is why one
 * accumulator suffices for all three counts.
 */
export function decideLargeDocumentGuard(
  input: LargeDocumentGuardInput,
): LargeDocumentGuardDecision {
  if (input.viewMode !== "wysiwyg") return { action: "allow" };

  // Read once, into a local: the getter-counting case G18' pins this.
  const content = input.content;
  const length = content.length;
  let score = 0;
  let atLineStart = true;
  // The second counter (ADR-0019 Decision 1). Two integers, same forward pass,
  // still constant auxiliary space. `currentLine` is the run since the last
  // "\n"; `longestLine` is the maximum completed run seen.
  let currentLine = 0;
  let longestLine = 0;

  for (let index = 0; index < length; index++) {
    const code = content.charCodeAt(index);

    if (code === CHAR_NEWLINE) {
      score++;
      atLineStart = true;
      if (currentLine > longestLine) longestLine = currentLine;
      currentLine = 0;
      continue;
    }

    // OUTSIDE the scoring chain, and that placement is the contract (answer
    // 10): space and tab fall through every arm below, so an increment placed
    // inside the chain would silently under-measure a whitespace line. The two
    // state machines are independent — a character can lengthen the line
    // without scoring and without ending the line-start state.
    currentLine++;

    if (code === CHAR_PIPE) {
      score++;
      if (atLineStart) score--; // a table-row start cancels its own pipe
      atLineStart = false;
    } else if (code !== CHAR_SPACE && code !== CHAR_TAB) {
      atLineStart = false;
    }
  }

  // The final line counts even with no trailing newline (contract answer 8).
  if (currentLine > longestLine) longestLine = currentLine;

  // Two independent counts, two independent thresholds, either one degrades
  // (ADR-0019 Decisions 3 and 4). They are deliberately NOT summed: there is
  // no evidence for an exchange rate between "characters on one line" and
  // "structural elements", and a sum would let two individually-harmless
  // quantities combine into a degrade that neither observation supports.
  const structureOk = score <= LARGE_DOCUMENT_STRUCTURE_THRESHOLD;
  const lineOk = longestLine <= LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD;

  if (structureOk && lineOk) return { action: "allow" };

  return {
    action: "degrade-to-source",
    message: LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
    elements: score,
    longestLine,
    trigger: structureOk ? "line-length" : lineOk ? "structure" : "both",
  };
}
