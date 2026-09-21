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
 * SCOPE — the freeze that used to sit here has been LIFTED.
 *
 * Until 2026-09-21 this block said the threshold was frozen at `500 * 1024`
 * pending a real-device sweep, that the sweep "has not run", and that the real
 * cost tracks cells in the largest single table rather than document bytes.
 * All three statements are now false, and they were false in different ways:
 *
 * - The **sweep ran** on 2026-09-20 and was independently re-checked
 *   (`docs/plans/20260920-d61-wkwebview-sweep-record.md`). It is D6.1, and D6.1
 *   owns the *sweep*, not the threshold value — the old text misassigned that.
 * - **"Largest single table" was refuted by the sweep it was waiting for.** A
 *   zero-table, 32,658-line document (`many-short-nodes.wysiwyg.md`, 471,867 B)
 *   blocked the main thread for ~7,409 ms. A predicate that treats zero cells as
 *   zero risk misses it. Cells are part of the answer, not the answer.
 * - The `fileSize ?? measure(content)` precedence the old text protected no
 *   longer exists: `fileSize` was removed from `LargeDocumentGuardInput`
 *   outright, so there is no second source of truth left to order.
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
 * Known and accepted, per ADR-0016 Consequences:
 * - **Blind to inline structure.** A 9,961,475-byte, 4-line document scores 3
 *   and is ALLOWED, where the old byte predicate would have refused it.
 * - **Pipe arithmetic errs in both directions** — a `|` inside a fenced code
 *   block over-counts, a table row written without outer pipes under-counts.
 * - **A degrade leaves no log trace.** The user sees a toast; `~/.mdpro/mdpro.log`
 *   records nothing. Out of ADR-0016's scope, tracked separately.
 *
 * The retired-case mapping table (G11-G13, G15, G18, G21, C8b) lives in
 * `tests/large-document-guard.test.ts` next to the cases it maps, not here — one
 * copy, beside the tests it is about. The test-matrix entry for WI-6 asked for it
 * in this header and the entry for WI-5 asked for it in the test header; a second
 * copy in production code would only give the two somewhere to drift apart.
 *
 * CONTRACT (D6.3(c)) — the six points ADR-0016 leaves underdetermined.
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
 * - `allow`: leave the view mode alone, say nothing.
 * - `degrade-to-source`: show `message`, then switch to Source mode. `elements`
 *   is the structural-element score the predicate actually judged, carried so
 *   callers and tests can see *which* number produced the decision. See
 *   contract answer (4) for why the field is no longer called `bytes`.
 */
export type LargeDocumentGuardDecision =
  | { action: "allow" }
  | { action: "degrade-to-source"; message: string; elements: number };

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
 * `score = newlines + (pipes − tableRowStarts)`, allowed while
 * `score <= LARGE_DOCUMENT_STRUCTURE_THRESHOLD`.
 *
 * One forward pass, constant auxiliary space, no parsing and no tokenizer —
 * ADR-0016 Decision 1 freezes all four. Nothing derived from `content` is
 * allocated: no `split`, no `match`, no `trimStart`, no regex, no encode. The
 * whole scan state is two numbers and a boolean.
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

  for (let index = 0; index < length; index++) {
    const code = content.charCodeAt(index);

    if (code === CHAR_NEWLINE) {
      score++;
      atLineStart = true;
    } else if (code === CHAR_PIPE) {
      score++;
      if (atLineStart) score--; // a table-row start cancels its own pipe
      atLineStart = false;
    } else if (code !== CHAR_SPACE && code !== CHAR_TAB) {
      atLineStart = false;
    }
    // Space and tab fall through deliberately: they neither score nor end the
    // line-start state.
  }

  if (score <= LARGE_DOCUMENT_STRUCTURE_THRESHOLD) return { action: "allow" };

  return {
    action: "degrade-to-source",
    message: LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
    elements: score,
  };
}
