/**
 * Unit matrix for `src/utils/largeDocumentGuard.ts#decideLargeDocumentGuard`
 * and its exported constants.
 *
 * Cases of `.claude/tdd-guardian/tests-20260920-211524.md` (revision 3):
 * G1', G2', G2b, G4', G5', G6', G7', G14', G17', G18', G20', G21', G22',
 * N1, N2, N3, N4, N5, N6, N8, N9, N-NL, N10, N11, N12, N13, N14, N15, N16,
 * N17 (the predicate) and M1, M2, M3 (the exported constants, WI-2).
 *
 * Mock boundary: NONE, in every case. Real implementation throughout.
 *
 * SCOPE — ADR-0016 freezes INVARIANTS, not a number.
 *
 * ADR-0016 (`docs/adr/0016-large-document-guard-predicate-is-a-source-structure-score.md`)
 * supersedes ADR-0006 for this decision. What is frozen is the *shape* of the
 * computation, not the constant: one forward pass over `content`, constant
 * auxiliary space, no Markdown parsing, no tokenizer, and a decision made by
 * comparing counts only. A later reweighting inside those invariants needs no
 * new ADR; a change TO the invariants does. Several cases below exist purely as
 * tripwires on that distinction and say so in their comments.
 *
 * The predicate: `score = newlines + (pipes − tableRowStarts)`, allow when
 * `score <= 25_000`. A "table-row start" is a line whose first non-whitespace
 * character is `|`, where whitespace is space and tab only and the leading run
 * is unbounded. The six contract points are recorded in the module header.
 *
 * Global rules obeyed throughout, because the matrix's mutation-killing power
 * depends on them:
 *  - every expectation is `toEqual` on the WHOLE decision object;
 *  - every degrade expectation writes `message` as the full string literal,
 *    never the imported constant (that would be a tautology);
 *  - every degrade expectation pins `elements` to an exact integer;
 *  - loop cases collect the returned value UNWRAPPED and assert after the loop;
 *    row labels live in a parallel array. A spread at push time would snapshot
 *    the object and re-hide the aliased-singleton bug G22' hunts.
 *  - ESCAPING CONVENTION: every fragment in a score table is written as a
 *    JavaScript string literal exactly as it must be typed. All non-ASCII and
 *    all invisible characters use escape form — `"\u00A0"` is one NBSP,
 *    `"\u{1F600}"` one astral character, `"\t"` one tab, `"\r"` one carriage
 *    return. Nothing here uses Markdown-style escaping. This is load-bearing:
 *    if an editor or formatter normalised a raw NBSP to a space, N1 row 10
 *    would become identical to row 7 while the two assert different scores, and
 *    the table would be silently self-contradictory. N1's fragment-uniqueness
 *    assertion is the structural guard behind this convention.
 *  - NO TIMING VALUE appears anywhere in this file or in the module (ADR-0016
 *    Decision 7 / E39 / G0). No duration is asserted and no `timeout` option is
 *    set on any case.
 *
 * Retired-case mapping table — carried here because ADR-0016 names G11-G13,
 * G15, G18, G21 and C8b by name and those references would otherwise dangle.
 *
 *  | Old                        | Fate                   | Successor / reason |
 *  |----------------------------|------------------------|--------------------|
 *  | G1                         | re-expressed           | G1' — source mode inert, keyed on score |
 *  | G2                         | re-expressed           | G2' — score table replaces byte table |
 *  | G2b                        | survives unchanged     | compile-time `ViewMode` exhaustiveness |
 *  | G3                         | still deliberately absent | lives in the caller as C5; recorded, not rediscovered |
 *  | G4 / G5                    | re-expressed           | G4' / G5' at 25,000 / 25,001 |
 *  | G6 / G7                    | re-expressed           | G6' / G7' over the score ladder |
 *  | G8 (negative fileSize)     | DISSOLVED              | no external number enters; the score is computed internally and is a non-negative integer. Successor: the invariant assertions inside N1. |
 *  | G9 (NaN, CHARACTERIZATION) | DISSOLVED              | same reason; the characterization has no subject left |
 *  | G10 (`??` vs `||`)         | DISSOLVED              | the `??` went with `fileSize`. Partial successor: G14' + G18'. |
 *  | G11 / G12 / G12b / G13     | RETIRED                | the `<=` boundary now compares a different quantity, so UTF-8 byte widths are meaningless here, not relocated. Sole descendant: N1 row 12 (astral safety), labelled as defensive. |
 *  | G14                        | re-expressed           | G14' |
 *  | G15 (stale size wins)      | FLIPPED                | ADR-0016 Decision 5 expected it to flip. Successor: N2, which asserts the opposite outcome. Not deleted — inverted, and the inversion is the case. |
 *  | G16 (content irrelevant)   | INVERTED               | content is now the only input. Successor: N3 (byte-length invariance) — volume is irrelevant, structure is not. |
 *  | G17                        | re-expressed           | G17' |
 *  | G18                        | re-expressed           | G18' — arm (a) retained, arm (b) ("a present fileSize must not read content") retired BY CONSTRUCTION, arm (c) strengthened from `>= 1` to `=== 1` |
 *  | G19                        | moved to WI-2          | M1 / M2 |
 *  | G20                        | re-expressed           | G20' — `["action","elements","message"]` |
 *  | G21                        | re-expressed           | G21' — `LARGE_DOCUMENT_STRUCTURE_THRESHOLD` |
 *  | G22                        | re-expressed           | G22' |
 *  | "G20 (shape, restated)"    | DISSOLVED              | it existed only to keep the shared ALLOW fixture honest; that fixture is gone, and G14'/G20' make the same claim about the allow arm's exact shape |
 *  | C2 / C8 / C8b              | rewritten              | C2' / C8' / C8b' — in the CALL-SITE file (WI-4, WI-5), not here |
 *  | —                          | added in rev 2         | N1 rows 23/24 (a leading `|` is sufficient) and N17 (escaped / inline-code pipes still count) |
 */

import { describe, expect, it } from "vitest";
import type { ViewMode } from "../src/types/editor";
import {
  decideLargeDocumentGuard,
  LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
  LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD,
  LARGE_DOCUMENT_STRUCTURE_THRESHOLD,
  type LargeDocumentGuardDecision,
  type LargeDocumentGuardInput,
} from "../src/utils/largeDocumentGuard";

// --- G2b -------------------------------------------------------------------
// L1's exhaustiveness enforced at compile time, not assumed. This contributes
// no runtime test: the "assertion" is that `pnpm typecheck:tests` exits 0. The
// day a third ViewMode member is added, this fails TS2322 and forces whoever
// added it to visit the test matrix instead of silently shrinking G2''s
// quantifier to "the modes someone typed in 2026".
//
// PAIRING, stated precisely: G2' does NOT detect a new ViewMode member — its
// NON_WYSIWYG_MODES list simply grows by one and it rubber-stamps whatever
// `viewMode !== "wysiwyg"` happens to do. G2b is what breaks, and the revisit
// it forces is where the new member's guard behaviour gets decided.
//
// `export` is mandatory, not stylistic: tsconfig.json:19 sets noUnusedLocals and
// tsconfig.test.json extends it, so a module-scope `const _viewModeExhaustive`
// would fail TS6133 today — the wrong diagnostic on the wrong day. TypeScript's
// leading-underscore exemption covers parameters and destructured elements, NOT
// module-scope locals. `export` is exempt from noUnusedLocals; `void x;` would
// have been the equivalent alternative.
const ALL_VIEW_MODES = ["wysiwyg", "source"] as const;
type _ViewModeExhaustive =
  Exclude<ViewMode, (typeof ALL_VIEW_MODES)[number]> extends never ? true : never;
export const _viewModeExhaustive: _ViewModeExhaustive = true;

// --- Shared harnesses ------------------------------------------------------

// Written out in full on purpose. `toBe(LARGE_DOCUMENT_DOWNGRADE_MESSAGE)` is a
// tautology; this constant is the test's own independent copy of the contract.
const EXPECTED_MESSAGE =
  "This document is too complex for WYSIWYG. Switched to Source mode for performance.";

/**
 * A document whose score is exactly 25,000 — 25,000 newline characters, no
 * pipes, no row starts (an empty line has no first non-whitespace character).
 * It ALLOWS, which G4' pins independently.
 */
const AT_THRESHOLD = "\n".repeat(25_000);

/**
 * The measurement instrument for N1, N13(b), N14 and N17.
 *
 * Deliberately NOT a large pad plus a subtraction: placing every fragment at
 * the tightest possible margin makes each row simultaneously (a) an exact-score
 * assertion via `elements === 25_000 + s` and (b) an allow/degrade
 * discrimination at distance 1 from the cut point — so a score-0 fragment and a
 * score-1 fragment produce DIFFERENT ACTIONS, not merely different numbers.
 *
 * Because `AT_THRESHOLD` ends in `"\n"`, every fragment passed here begins at a
 * FRESH LINE START. That is load-bearing for N1 rows 3-24, N13(b) and N17.
 */
const atMargin = (fragment: string): LargeDocumentGuardDecision =>
  decideLargeDocumentGuard({ viewMode: "wysiwyg", content: AT_THRESHOLD + fragment });

/** Narrows the union and fails loudly rather than skipping the assertion. */
const elementsOf = (content: string): number => {
  const decision = decideLargeDocumentGuard({ viewMode: "wysiwyg", content });
  if (decision.action !== "degrade-to-source") {
    throw new Error(`expected a degrade decision, got "${decision.action}"`);
  }
  return decision.elements;
};

/** The fragment score `s` a document contributes when measured at the margin. */
const scoreAtMargin = (fragment: string): number =>
  elementsOf(AT_THRESHOLD + fragment) - 25_000;

/**
 * A document whose score is exactly 25,001 — one over the structure cut, so it
 * ALWAYS degrades, and every one of its lines is empty (length 0).
 *
 * This is the instrument that makes line lengths of *allowing* shapes
 * observable. The allow arm carries no numbers by design (ADR-0019 Decision 4 /
 * G14' / N12 / LL-12), so `longestLine` can only be read off a document that
 * degrades. Prefixing a fragment with 25,001 newlines forces the degrade
 * WITHOUT touching the fragment's own longest line, because every prefix line
 * is empty.
 */
const OVER_THRESHOLD = AT_THRESHOLD + "\n";

/**
 * Narrows the union and fails loudly rather than skipping the assertion —
 * the `longestLine` mirror of `elementsOf`.
 */
const longestLineOf = (content: string): number => {
  const decision = decideLargeDocumentGuard({ viewMode: "wysiwyg", content });
  if (decision.action !== "degrade-to-source") {
    throw new Error(`expected a degrade decision, got "${decision.action}"`);
  }
  return decision.longestLine;
};

/**
 * THE DERIVATION RULE, written once and relied on throughout: `OVER_THRESHOLD`
 * consists only of `\n` and ends with one, so every prefix line is empty and
 * the fragment starts at a fresh line start. Therefore
 * `longestLineAfter(fragment)` IS the longest line inside `fragment`.
 *
 * This is what makes the hand-written `maxLine` columns in N1/N17/N5 checkable
 * without computing them in the test. Computing them here (e.g.
 * `fragment.split("\n")`) would re-implement the unit under test, and the test
 * would be asserting its own re-implementation.
 */
const longestLineAfter = (fragment: string): number =>
  longestLineOf(OVER_THRESHOLD + fragment);

describe("decideLargeDocumentGuard", () => {
  // --- harness self-check --------------------------------------------------
  it("harness: AT_THRESHOLD scores exactly 25,000, so atMargin measures fragments at distance 1 from the cut", () => {
    // Without these two, a drifted AT_THRESHOLD would silently re-base every
    // N1 row instead of failing loudly in one place.
    expect(atMargin("")).toEqual({ action: "allow" });
    expect(atMargin("\n")).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    });

    // And the ADR-0019 counterpart: OVER_THRESHOLD is AT_THRESHOLD + "\n", so
    // it is the same document as the assertion above, which is what licenses
    // `longestLineAfter` to report "the longest line inside the fragment".
    expect(longestLineAfter("")).toBe(0);
    expect(longestLineAfter("abc")).toBe(3);
  });

  // === A. The view-mode gate ==============================================

  // --- G1' -----------------------------------------------------------------
  it("G1': source mode is inert at any structural size", () => {
    const result = decideLargeDocumentGuard({
      viewMode: "source",
      content: "| a | b | c | d |\n".repeat(11_438), // score 57,190
    });
    // Whole-object equality, so a stray `elements` on the allow arm fails.
    expect(result).toEqual({ action: "allow" });
  });

  // --- G2' -----------------------------------------------------------------
  it("G2': L1 — every non-wysiwyg mode allows over the whole score table", () => {
    const NON_WYSIWYG_MODES = ALL_VIEW_MODES.filter((m) => m !== "wysiwyg");
    const CONTENT_TABLE: Array<{ content: string; label: string }> = [
      { content: "", label: "empty" },
      { content: "x", label: "one non-structural char" },
      { content: "\n", label: "one newline" },
      { content: AT_THRESHOLD, label: "exactly at threshold" },
      { content: AT_THRESHOLD + "\n", label: "one over threshold" },
      { content: "\n".repeat(57_190), label: "57,190 newlines" },
      { content: "|".repeat(30_000), label: "30,000 pipes, no line structure" },
      {
        content: "| a | b | c | d |\n".repeat(11_438),
        label: "large-table shape (score 57,190)",
      },
      { content: "x".repeat(600 * 1024), label: "600 KB single line (score 0)" },
    ];

    // Push UNWRAPPED — no spread, no clone. Labels go in a parallel array.
    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const mode of NON_WYSIWYG_MODES) {
      for (const row of CONTENT_TABLE) {
        results.push(decideLargeDocumentGuard({ viewMode: mode, content: row.content }));
        labels.push(`mode=${mode}, ${row.label}`);
      }
    }

    expect(results).toHaveLength(NON_WYSIWYG_MODES.length * CONTENT_TABLE.length);
    results.forEach((result, i) => {
      expect(result, labels[i]).toEqual({ action: "allow" });
    });
  });

  // G3 is DELIBERATELY ABSENT, exactly as before. Under the non-nullable input
  // shape, "inert when no document is open" leaves this unit entirely and
  // survives only as `if (!activeDocument) return;` in the caller, pinned by
  // case C5 in the call-site file (source text, below Level 6). Recorded so the
  // lost Level 1 coverage is visible rather than rediscovered.

  // === B. The threshold and the cut point =================================

  // --- G4' -----------------------------------------------------------------
  it("G4': boundary — a document scoring exactly 25,000 allows (<=, not <)", () => {
    // This case also silently pins WI-1 contract answer (1): `"\n".repeat(25_000)`
    // has 25,000 NEWLINE CHARACTERS but 25,001 LINES. An implementation counting
    // lines (`\n` + 1) scores it 25,001 and degrades here.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(25_000) }),
    ).toEqual({ action: "allow" });

    // A structurally different document at the same score: 5,000 × (1 newline +
    // 5 pipes − 1 row start) = 25,000.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b | c | d |\n".repeat(5_000),
      }),
    ).toEqual({ action: "allow" });
  });

  // --- G5' -----------------------------------------------------------------
  it("G5': boundary — one element over degrades and reports the exact total", () => {
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(25_001) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    });

    // Mixed-path sibling: 25,000 from the table, then the line `x|` — one pipe
    // that is NOT a row start, because the line's first non-whitespace
    // character is `x`. Breaks if the row-start rule mis-fires.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b | c | d |\n".repeat(5_000) + "x|",
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      // `| a | b | c | d |` is 17 UTF-16 code units (9 non-space + 8 spaces);
      // the trailing unterminated `x|` line is 2. The same 17 appears in N6,
      // N14, N16 and LL-5 for this same string.
      longestLine: 17,
      trigger: "structure",
    });
  });

  // --- G21' ----------------------------------------------------------------
  it("G21': the boundary re-stated against the exported constant", () => {
    // The behavioural half of the C8b' anchor (WI-5). The source-text half
    // cannot detect a constant that moved AND a comparison inlined to match;
    // this case can.
    expect(LARGE_DOCUMENT_STRUCTURE_THRESHOLD).toBe(25_000);

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD),
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD - 1),
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 1),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 1,
      longestLine: 0,
      trigger: "structure",
    });
  });

  // --- G6' / G7' -----------------------------------------------------------
  const SCORE_LADDER = [0, 1, 24_999, 25_000, 25_001, 25_002, 30_000, 250_000];

  it("G6': L3 — monotone and pointwise-correct over an ascending score ladder", () => {
    // Collected UNWRAPPED and asserted AFTER the loop, both deliberately: an
    // implementation returning a hoisted, per-call-mutated DEGRADE object passes
    // an in-loop version and fails this one (see G22'). A spread at push time
    // would restore exactly that hole.
    //
    // SCOPE NOTE (L3): this ladder is `\n`-only, so it establishes monotonicity
    // of the DECISION IN THE SCORE, not monotonicity of the score under
    // arbitrary append. General append-monotonicity is deliberately not
    // asserted anywhere — see the matrix's Deferred 12.
    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const n of SCORE_LADDER) {
      results.push(
        decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(n) }),
      );
      labels.push(`score=${n}`);
    }

    expect(results).toHaveLength(SCORE_LADDER.length);

    results.forEach((result, i) => {
      const n = SCORE_LADDER[i];
      if (n > 25_000) {
        expect(result, labels[i]).toEqual({
          action: "degrade-to-source",
          message: EXPECTED_MESSAGE,
          elements: n,
          // Every ladder row is `\n`-only, so every line is empty.
          longestLine: 0,
          trigger: "structure",
        });
      } else {
        expect(result, labels[i]).toEqual({ action: "allow" });
      }
    });

    // Monotonicity: the boolean sequence never returns to false after a true.
    const degraded = results.map((r) => r.action === "degrade-to-source");
    const firstTrue = degraded.indexOf(true);
    if (firstTrue !== -1) {
      expect(degraded.slice(firstTrue), "no allow after the first degrade").toEqual(
        degraded.slice(firstTrue).map(() => true),
      );
    }
  });

  it("G7': L3/L5 — the same ladder descending yields the mirrored results (no hidden state)", () => {
    const ascendingResults = SCORE_LADDER.map((n) =>
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(n) }),
    );
    const descendingResults = [...SCORE_LADDER]
      .reverse()
      .map((n) =>
        decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(n) }),
      );

    expect(descendingResults).toEqual([...ascendingResults].reverse());
  });

  // === C. The score arithmetic — the line-start state machine ==============

  // --- N1 ------------------------------------------------------------------
  it("N1: the fragment score table at the margin — every line-start state transition", () => {
    // The branch-coverage workhorse. Every row names the transition it
    // exercises; together they cover document start treated as a line start,
    // line start after `\n`, whitespace skip (space), whitespace skip (tab),
    // unbounded whitespace skip, line-start state left by a non-whitespace
    // non-pipe character, pipe at line start, pipe not at line start, a row
    // start whose line does NOT close with a pipe, empty line, all-whitespace
    // line, EOF mid-line, and EOF immediately after `\n`.
    //
    // Fragments follow the file header's ESCAPING CONVENTION. See N17 for the
    // partition's boundary: "first non-whitespace character is a backslash,
    // therefore not a row start" lives there, because it is a characterization
    // of an accepted defect and folding it in here would read as endorsement.
    // THE `maxLine` COLUMN (ADR-0019) IS HAND-WRITTEN, exactly as `s` is.
    // It is the longest line inside the fragment, in UTF-16 code units, with
    // `\r` counted as an ordinary character (contract answer 9) and the final
    // unterminated segment counted (contract answer 8). Do NOT derive it in
    // this file with `fragment.split("\n")`: that re-implements the unit under
    // test, and the table would then assert its own re-implementation.
    const rows: Array<{
      n: number;
      fragment: string;
      s: number;
      maxLine: number;
      transition: string;
    }> = [
      { n: 1, fragment: "", s: 0, maxLine: 0, transition: 'EOF immediately after "\\n"' },
      { n: 2, fragment: "\n", s: 1, maxLine: 0, transition: "empty line" },
      { n: 3, fragment: "x", s: 0, maxLine: 1, transition: "line-start state left by a non-ws non-pipe char; EOF mid-line" },
      { n: 4, fragment: "|", s: 0, maxLine: 1, transition: "pipe at line start => +1 pipe, -1 row start" },
      { n: 5, fragment: "||", s: 1, maxLine: 2, transition: "one row start per LINE, not per pipe" },
      { n: 6, fragment: "x|", s: 1, maxLine: 2, transition: "pipe after the line-start state was left => no subtraction" },
      { n: 7, fragment: " |", s: 0, maxLine: 2, transition: "single leading space skipped" },
      { n: 8, fragment: "\t|", s: 0, maxLine: 2, transition: "leading tab skipped (tab IS whitespace)" },
      { n: 9, fragment: "       |", s: 0, maxLine: 8, transition: "UNBOUNDED skip (7 spaces) - kills a GFM 3-space implementation" },
      { n: 10, fragment: "\u00A0|", s: 1, maxLine: 2, transition: "NBSP is NOT whitespace - kills trimStart() / /\\s/" },
      { n: 11, fragment: "\r|", s: 1, maxLine: 2, transition: "lone CR is not whitespace and not a newline" },
      { n: 12, fragment: "\u{1F600}|", s: 1, maxLine: 3, transition: "astral char does not perturb the scan; it is TWO code units of line length" },
      { n: 13, fragment: "| a | b |", s: 2, maxLine: 9, transition: "3 pipes - 1 row start" },
      { n: 14, fragment: "a | b", s: 1, maxLine: 5, transition: "omitted outer pipes - ADR-accepted UNDER-count" },
      { n: 15, fragment: "|---|---|", s: 2, maxLine: 9, transition: "delimiter row - ADR-accepted OVER-count (3 pipes - 1 row start)" },
      { n: 16, fragment: "| a | b |\n", s: 3, maxLine: 9, transition: "one full LF table row" },
      { n: 17, fragment: "   | a | b |\n", s: 3, maxLine: 12, transition: "indented table row" },
      { n: 18, fragment: "\t| a | b |\n", s: 3, maxLine: 10, transition: "tab-indented table row" },
      { n: 19, fragment: "| a | b |\r\n", s: 3, maxLine: 10, transition: "CRLF table row scores as LF, but measures ONE LONGER: the `\\r` counts" },
      { n: 20, fragment: "```\na|b\n```\n", s: 4, maxLine: 3, transition: "fenced code - ADR-accepted OVER-count" },
      { n: 21, fragment: "\n|", s: 1, maxLine: 1, transition: 'line start re-armed after "\\n"' },
      { n: 22, fragment: " \n |", s: 1, maxLine: 2, transition: "all-whitespace line, then indented pipe" },
      { n: 23, fragment: "| a | b\n", s: 2, maxLine: 7, transition: "ROW START WITHOUT A CLOSING PIPE: 1 newline + 2 pipes - 1 row start" },
      { n: 24, fragment: "| a | b", s: 1, maxLine: 7, transition: "same, unterminated at EOF: 2 pipes - 1 row start" },
    ];

    // Rows 7-11 kill four distinct plausible-but-wrong implementations:
    // `trimStart`, `/\s/`, a 3-space GFM bound, and per-pipe subtraction. Row
    // 10's failure is what enforces the constant-auxiliary-space invariant
    // BEHAVIOURALLY: `trimStart()` allocates a string per line, and rejecting
    // NBSP is the observable consequence of not calling it.
    //
    // ROWS 23 AND 24 kill the "delimited on both sides" implementation — the
    // one wrong implementation that is single-pass, allocation-free, adds no
    // `<=` and no numeric literal, and is therefore invisible to C12 and C8b'.
    // The rule is "the first non-whitespace character of the line is `|`",
    // FULL STOP: a closing pipe is neither required nor consulted (contract
    // answer (2)). GFM makes outer pipes optional, so requiring one is wrong on
    // real documents, not merely unspecified. Such an implementation reports
    // 25,003 / 25,002 here against the correct 25,002 / 25,001. Paired with
    // N11, which records the mirror cost on the LEADING pipe.
    //
    // Row 12 is recorded honestly: IT KILLS NOTHING KNOWN. Code-unit versus
    // code-point iteration cannot change the score, because no surrogate half
    // can equal 10, 124, 32 or 9. It is a defensive regression guard (the D6.1
    // corpus contains emoji; a throw or a mis-index here would be a real bug),
    // not a discriminator.

    const results: LargeDocumentGuardDecision[] = [];
    const observedMaxLines: number[] = [];
    const labels: string[] = [];
    for (const row of rows) {
      results.push(atMargin(row.fragment));
      // ADR-0019: the margin observation, collected for ALL 24 rows. Six rows
      // (1, 3, 4, 7, 8, 9) score 0 and therefore ALLOW, and the allow arm
      // carries no numbers — without this device their hand-written `maxLine`
      // would be dead weight a reader would wrongly believe is checked.
      observedMaxLines.push(longestLineAfter(row.fragment));
      labels.push(`row ${row.n} (s=${row.s}, maxLine=${row.maxLine}): ${row.transition}`);
    }

    expect(results).toHaveLength(rows.length);
    results.forEach((result, i) => {
      const row = rows[i];
      if (row.s === 0) {
        expect(result, labels[i]).toEqual({ action: "allow" });
      } else {
        expect(result, labels[i]).toEqual({
          action: "degrade-to-source",
          message: EXPECTED_MESSAGE,
          elements: 25_000 + row.s,
          longestLine: row.maxLine,
          trigger: "structure",
        });
      }
    });

    expect(observedMaxLines).toHaveLength(rows.length);
    observedMaxLines.forEach((observed, i) => {
      expect(observed, labels[i]).toBe(rows[i].maxLine);
    });

    // Three invariant assertions over the collected set.
    const reported = results
      .filter((r) => r.action === "degrade-to-source")
      .map((r) => (r.action === "degrade-to-source" ? r.elements : -1));
    // (i) + (ii) L3 non-negativity — the honest successor to the retired G8/G9,
    // which asserted things about an externally supplied number that no longer
    // enters the function.
    reported.forEach((elements, i) => {
      expect(Number.isInteger(elements), `reported[${i}] is an integer`).toBe(true);
      expect(elements, `reported[${i}] >= 25_000`).toBeGreaterThanOrEqual(25_000);
    });
    // (iii) Fragment uniqueness. Two rows that collide assert different scores
    // for the SAME input — a self-contradictory table that fails in a way
    // nobody can localise. This is the structural guard behind the escaping
    // convention, and it holds for every row, not just those written with an
    // escape today.
    expect(new Set(rows.map((r) => r.fragment)).size).toBe(rows.length);
  });

  // --- N8 ------------------------------------------------------------------
  it("N8: pipes alone cross the threshold, and the document's first line is a line start", () => {
    // The PAIR is the case, neither half alone: an implementation that only
    // subtracts row starts AFTER a `\n` (i.e. does not initialise the scanner
    // in the line-start state) reports 30,000 for (a) and passes (b). The
    // difference between the two is exactly 1, and that 1 is the subtraction.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "|".repeat(30_000) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 29_999,
      // One unterminated line of 30,000 pipes — far under the 1,000,000 line
      // cut, so this still degrades on `structure` alone. LL-9's third row is
      // the same shape scaled past the line cut, where the trigger is "both".
      longestLine: 30_000,
      trigger: "structure",
    });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x" + "|".repeat(30_000),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 30_000,
      longestLine: 30_001,
      trigger: "structure",
    });
  });

  // --- N9 ------------------------------------------------------------------
  it("N9: table rows score 3N, with and without a trailing newline", () => {
    // Dropping the `− rowStarts` term reports 40,000 for (a); counting lines
    // rather than newlines reports 30,001; mishandling the final unterminated
    // line reports 29,997 or 30,000 for (b).
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b |\n".repeat(10_000),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 30_000,
      longestLine: 9, // "| a | b |"
      trigger: "structure",
    });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b |\n".repeat(9_999) + "| a | b |",
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 29_999, // 3 × 9,999 + (3 pipes − 1 row start)
      longestLine: 9,
      trigger: "structure",
    });
  });

  // --- N-NL ----------------------------------------------------------------
  it("N-NL: newline-only scoring counts `\\n` characters, off-by-one included", () => {
    // THE DEDICATED PIN FOR CONTRACT ANSWER (1). A line-count implementation
    // reports 30,001 / 57,191 / 25,003 and fails all three.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(30_000) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 30_000,
      longestLine: 0,
      trigger: "structure",
    });

    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(57_190) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
      longestLine: 0,
      trigger: "structure",
    });

    // "a\nb\nc" is 2 newline characters across 3 lines.
    expect(atMargin("a\nb\nc")).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_002,
      longestLine: 1, // segments "a", "b", "c"
      trigger: "structure",
    });
  });

  // === D. The laws ========================================================

  // --- N4 ------------------------------------------------------------------
  it("N4: L2 — the score is exactly additive over `\\n`-aligned concatenation", () => {
    // THE SINGLE STRONGEST CASE IN THE MATRIX, and the behavioural encoding of
    // ADR-0016 Decision 3 and of contract answer (3)'s "no early exit".
    //
    // Broken by: EARLY EXIT on threshold crossing (the concatenation stops at
    // the same character as A alone, so elements(A⧺B) === elements(A));
    // ADR-0006's PER-TABLE-MAXIMUM accounting (the concatenation of two tables
    // reports the larger, not the sum); any prefix-limited scan; any per-chunk
    // state reset.
    //
    // Every fragment is `\n`-terminated AND independently above the threshold,
    // so its own `elements` is directly observable — that independence is what
    // kills early exit without relying on the property under test.
    //
    // SCOPE NOTE (L3): all four fragments are `\n`-aligned and above threshold,
    // so this case does NOT generalise to arbitrary append. The narrowing is
    // deliberate; see the matrix's Deferred 12.
    //
    // ADR-0019 PAIRING: N4 is now HALF OF A PAIR with LL-14. The score is
    // exactly ADDITIVE over `\n`-aligned concatenation (here); the longest line
    // is the MAX over the same operation (LL-14). An implementation that treats
    // the two quantities the same way — folding one into the other, which is
    // the option ADR-0019 Decision 3 rejects — fails exactly one of the two.
    // Neither case is redundant with the other.
    const FRAGMENTS: Array<{ name: string; text: string }> = [
      { name: "F1 newlines", text: "\n".repeat(26_000) },
      { name: "F2 4-col table", text: "| a | b | c | d |\n".repeat(6_000) },
      { name: "F3 indented table", text: "   | a | b |\n".repeat(9_000) },
      { name: "F4 CRLF table", text: "| a | b |\r\n".repeat(9_000) },
    ];

    const observed: Array<{ sum: number; parts: number }> = [];
    const labels: string[] = [];
    for (const a of FRAGMENTS) {
      for (const b of FRAGMENTS) {
        observed.push({
          sum: elementsOf(a.text + b.text),
          parts: elementsOf(a.text) + elementsOf(b.text),
        });
        labels.push(`${a.name} ⧺ ${b.name}`);
      }
    }

    expect(observed).toHaveLength(FRAGMENTS.length * FRAGMENTS.length);
    // No expected constant on the right-hand side: the RELATION is the
    // assertion, and all three numbers come from real calls.
    observed.forEach((row, i) => {
      expect(row.sum, labels[i]).toBe(row.parts);
    });
  });

  // --- N6 ------------------------------------------------------------------
  it("N6: L2 applied — a whole-document total, not the largest single table (ADR-0016 Decision 3)", () => {
    // The PAIR is the case: allow-then-degrade is what refutes ADR-0006's
    // superseded accounting. Either half alone proves nothing. Reverting to
    // "cells in the largest single table" allows DOC at 2,400 rendered cells.
    const TABLE = "| a | b | c | d |\n".repeat(600); // score 3,000
    const DOC = Array.from({ length: 10 }, () => TABLE).join("\n"); // 30,000 + 9 joiners

    expect(decideLargeDocumentGuard({ viewMode: "wysiwyg", content: TABLE })).toEqual({
      action: "allow",
    });

    expect(decideLargeDocumentGuard({ viewMode: "wysiwyg", content: DOC })).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 30_009,
      longestLine: 17, // "| a | b | c | d |"; the join adds empty lines only
      trigger: "structure",
    });
  });

  // --- N5 ------------------------------------------------------------------
  it("N5: L4/L5 — CRLF leaves the SCORE invariant and lengthens every measured line by exactly one", () => {
    // ── CHANGE NOTE (policy-core rule 12): why a recorded assertion moved ────
    //
    // Until D6.3(d) this case asserted `expect(pair.crlf).toEqual(pair.lf)` —
    // whole-payload CRLF invariance. ADR-0019 Decision 1 makes that FALSE BY
    // DESIGN, not by defect: `\r` is an ordinary counted character, so a
    // CRLF-terminated line measures exactly one code unit longer than its LF
    // twin. The alternative (a `\r` lookback before the `\n`) is a PARSING
    // RULE, and ADR-0016 Decision 1 freezes parsing out; it is therefore not an
    // implementer's choice and would need its own ADR.
    //
    // The claim is re-specified UPWARD, never relaxed to a subset comparison:
    //   (1) `action`, `message` and `elements` stay identical across LF/CRLF —
    //       the half that survives, and the half that is the actual invariance
    //       claim about the SCORE;
    //   (2) BOTH endpoints and the delta are pinned as hand-written literals.
    //       A delta-only assertion is satisfied by (0, 1) on every row, which
    //       is precisely the weakening this case must not accept;
    //   (3) the three allow rows keep a bare one-key arm.
    //
    // CRLF invariance therefore now holds FOR THE SCORE and deliberately NOT
    // for the line length. The counterpart note to N13 stands: N13 pins that a
    // lone `\r` is neither a newline nor whitespace; N5 pins that a trailing
    // `\r` costs exactly one unit of line length. Together they fix the `\r`
    // rule from both sides.
    //
    // `.split("\n").join("\r\n")`, NOT `replaceAll`: the latter is ES2021 and
    // fails TS2550 under tsconfig.json's `lib: ES2020` — the same diagnostic
    // G20' records for `Object.hasOwn`.
    //
    // Both sides are real calls and nothing is hard-coded on the invariance
    // half, so it cannot be satisfied by a constant. Grounded in reality: the
    // D6.1 perf corpus ships `normal-prose.wysiwyg.crlf.md`.
    //
    // WHY EVERY DELTA IS +1 HERE, so "+1 always" does not become folklore:
    // LF→CRLF grows every `\n`-TERMINATED line by one code unit and leaves a
    // final UNTERMINATED line untouched. Every row below has its maximum on a
    // `\n`-terminated line (or has no characters at all). A document whose
    // unique longest line is its final unterminated one would have delta 0.
    // That shape is deliberately not in this table; LL-7 is where it lives.
    const crlf = (d: string): string => d.split("\n").join("\r\n");

    // Hand-written columns — transcribed, not derived. `lfMax`/`crlfMax` are
    // the longest line in UTF-16 code units under each line ending.
    const DOCS: Array<{
      text: string;
      label: string;
      degrades: boolean;
      lfMax: number;
      crlfMax: number;
      delta: number;
    }> = [
      { text: "", label: "empty", degrades: false, lfMax: 0, crlfMax: 0, delta: 0 },
      { text: "\n", label: "one newline", degrades: false, lfMax: 0, crlfMax: 1, delta: 1 },
      { text: AT_THRESHOLD, label: "at threshold", degrades: false, lfMax: 0, crlfMax: 1, delta: 1 },
      { text: AT_THRESHOLD + "\n", label: "one over threshold", degrades: true, lfMax: 0, crlfMax: 1, delta: 1 },
      { text: "| a | b |\n".repeat(10_000), label: "2-col table", degrades: true, lfMax: 9, crlfMax: 10, delta: 1 },
      { text: "   | a | b |\n".repeat(9_000), label: "indented table", degrades: true, lfMax: 12, crlfMax: 13, delta: 1 },
      { text: "a | b\n".repeat(20_000), label: "outer pipes omitted", degrades: true, lfMax: 5, crlfMax: 6, delta: 1 },
      { text: "- item\n".repeat(32_657), label: "many short nodes", degrades: true, lfMax: 6, crlfMax: 7, delta: 1 },
    ];

    const pairs: Array<{ lf: LargeDocumentGuardDecision; crlf: LargeDocumentGuardDecision }> =
      [];
    // Rows 1-3 allow, so their line lengths are NOT readable off the decision.
    // They are observed at the margin — the only admissible way to make the
    // claim total over all eight rows without putting numbers on the allow arm.
    const observedLfMax: number[] = [];
    const observedCrlfMax: number[] = [];
    const labels: string[] = [];
    for (const doc of DOCS) {
      pairs.push({
        lf: decideLargeDocumentGuard({ viewMode: "wysiwyg", content: doc.text }),
        crlf: decideLargeDocumentGuard({ viewMode: "wysiwyg", content: crlf(doc.text) }),
      });
      observedLfMax.push(longestLineAfter(doc.text));
      observedCrlfMax.push(longestLineAfter(crlf(doc.text)));
      labels.push(doc.label);
    }

    expect(pairs).toHaveLength(DOCS.length);

    // (1) The score half of the invariance, from real calls on both sides.
    pairs.forEach((pair, i) => {
      expect(pair.crlf.action, `${labels[i]}: action invariant`).toBe(pair.lf.action);
      if (pair.lf.action === "degrade-to-source" && pair.crlf.action === "degrade-to-source") {
        expect(pair.crlf.elements, `${labels[i]}: elements invariant`).toBe(
          pair.lf.elements,
        );
        expect(pair.crlf.message, `${labels[i]}: message invariant`).toBe(pair.lf.message);
      }
    });

    // (2) Both endpoints as exact literals, plus the derived delta.
    DOCS.forEach((doc, i) => {
      expect(observedLfMax[i], `${doc.label}: LF longest line`).toBe(doc.lfMax);
      expect(observedCrlfMax[i], `${doc.label}: CRLF longest line`).toBe(doc.crlfMax);
      expect(
        observedCrlfMax[i] - observedLfMax[i],
        `${doc.label}: CRLF − LF delta`,
      ).toBe(doc.delta);

      // The degrading rows report the SAME number on the decision itself, so
      // the margin instrument is cross-checked against the live payload.
      if (doc.degrades) {
        const lf = pairs[i].lf;
        const crlfDecision = pairs[i].crlf;
        if (lf.action !== "degrade-to-source" || crlfDecision.action !== "degrade-to-source") {
          throw new Error(`${doc.label}: expected both arms to degrade`);
        }
        expect(lf.longestLine, `${doc.label}: LF longestLine on the payload`).toBe(doc.lfMax);
        expect(crlfDecision.longestLine, `${doc.label}: CRLF longestLine on the payload`).toBe(
          doc.crlfMax,
        );
      }
    });

    // (3) The allow rows keep a bare arm — no number leaks onto it.
    DOCS.forEach((doc, i) => {
      if (doc.degrades) return;
      expect(Object.keys(pairs[i].lf), `${doc.label}: LF allow arm is bare`).toEqual([
        "action",
      ]);
      expect(Object.keys(pairs[i].crlf), `${doc.label}: CRLF allow arm is bare`).toEqual([
        "action",
      ]);
    });
  });

  // --- N3 ------------------------------------------------------------------
  it("N3: byte-length invariance — volume is irrelevant, structure is not", () => {
    // Successor to the retired G16, inverted. Any residual byte term
    // (`TextEncoder`, `content.length`, a `Math.max(score, bytes/K)` hybrid)
    // fails here; family 1's ~600 KB member is the one the OLD predicate
    // degraded, so a partial revert fails here first.
    //
    // ── COMMENT CORRECTION (ADR-0019, policy-core rule 12) ──────────────────
    //
    // The sentence above used to read "any residual byte term … fails here"
    // full stop. That is now only half true, and the half it omits is the
    // entire content of ADR-0019 Decision 3:
    //
    //   - a whole-document BYTE/VOLUME term is still FORBIDDEN, and familyOne
    //     (filler up to 60,000 with a decision that does not move) is what
    //     forbids it;
    //   - a per-line LENGTH term is now REQUIRED, and familyTwo is what
    //     requires it.
    //
    // familyTwo is therefore no longer an invariance case: `longestLine` is
    // exactly `fillerLen`, so the three payloads are three distinct objects.
    // The old `Set(JSON.stringify).size === 1` over the whole payload is
    // re-specified below — narrowed to what is genuinely invariant, with the
    // NON-invariance asserted positively so nobody "repairs" it back.
    //
    // Bonus, and the reason this is a better case than it was: familyTwo
    // becomes a second independent kill of the never-reset-`currentLine`
    // mutant. With filler 100 over 30,000 lines an unreset accumulator reports
    // 3,030,000 and flips the trigger to "both". LL-8 is the first kill.
    const familyOne: LargeDocumentGuardDecision[] = [];
    const familyOneLabels: string[] = [];
    for (const fillerLen of [0, 1, 10, 1_000, 60_000]) {
      familyOne.push(
        decideLargeDocumentGuard({
          viewMode: "wysiwyg",
          content: ("x".repeat(fillerLen) + "\n").repeat(10),
        }),
      );
      familyOneLabels.push(`fillerLen=${fillerLen}, score 10`);
    }
    familyOne.forEach((result, i) => {
      expect(result, familyOneLabels[i]).toEqual({ action: "allow" });
    });
    expect(new Set(familyOne.map((r) => JSON.stringify(r))).size).toBe(1);

    // Hand-written expectations. The loop variable is deliberately NOT reused
    // as the expected value — the literals are written out, so the case is not
    // asserting its own arithmetic.
    const FAMILY_TWO: Array<{ fillerLen: number; maxLine: number }> = [
      { fillerLen: 0, maxLine: 0 },
      { fillerLen: 1, maxLine: 1 },
      { fillerLen: 100, maxLine: 100 },
    ];
    const familyTwo: LargeDocumentGuardDecision[] = [];
    const familyTwoLabels: string[] = [];
    for (const row of FAMILY_TWO) {
      familyTwo.push(
        decideLargeDocumentGuard({
          viewMode: "wysiwyg",
          content: ("x".repeat(row.fillerLen) + "\n").repeat(30_000),
        }),
      );
      familyTwoLabels.push(`fillerLen=${row.fillerLen}, score 30,000`);
    }
    familyTwo.forEach((result, i) => {
      expect(result, familyTwoLabels[i]).toEqual({
        action: "degrade-to-source",
        message: EXPECTED_MESSAGE,
        elements: 30_000,
        longestLine: FAMILY_TWO[i].maxLine,
        trigger: "structure",
      });
    });
    // Invariance RETAINED, narrowed to what is actually invariant — this
    // replaces the old whole-payload check rather than deleting it.
    expect(
      new Set(
        familyTwo.map((r) =>
          JSON.stringify(
            r.action === "degrade-to-source"
              ? {
                  action: r.action,
                  message: r.message,
                  elements: r.elements,
                  trigger: r.trigger,
                }
              : { action: r.action },
          ),
        ),
      ).size,
    ).toBe(1);
    // Non-invariance asserted POSITIVELY, so nobody "repairs" it back.
    expect(
      new Set(
        familyTwo.map((r) => (r.action === "degrade-to-source" ? r.longestLine : -1)),
      ).size,
    ).toBe(3);
  });

  // --- G17' ----------------------------------------------------------------
  it("G17': L5 — purity: the argument is never mutated and repeat calls agree", () => {
    const ROWS: LargeDocumentGuardInput[] = [
      { viewMode: "source", content: "| a |\n".repeat(30_000) },
      { viewMode: "source", content: "" },
      { viewMode: "wysiwyg", content: "x" },
      { viewMode: "wysiwyg", content: "\n".repeat(25_001) },
    ];

    for (const input of ROWS) {
      const snapshot = structuredClone(input);
      Object.freeze(input);

      // ES modules are strict mode, so a write to a frozen property throws a
      // TypeError rather than silently no-opping. This is a real assertion.
      expect(() => decideLargeDocumentGuard(input)).not.toThrow();

      const first = decideLargeDocumentGuard(input);
      const second = decideLargeDocumentGuard(input);

      expect(first).toEqual(second);
      expect(input).toEqual(snapshot);
      expect(input.content).toBe(snapshot.content);
    }
  });

  // --- G22' ----------------------------------------------------------------
  it("G22': L5 — a returned degrade decision is not invalidated by the next call", () => {
    // The ORDERING is the case. Asserting on `first` before the second call
    // would make this G5' again and would let a hoisted, per-call-mutated
    // singleton pass.
    const first = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "\n".repeat(25_001),
    });
    const second = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "\n".repeat(57_190),
    });

    expect(first).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    });
    expect(second).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
      longestLine: 0,
      trigger: "structure",
    });
    // SCOPE LIMIT ADR-0019 ADDS: both degrades here are STRUCTURE degrades, so
    // a hoisted object mutating only `elements` would still pass this case.
    // LL-15 is the extension — two degrades with DIFFERENT triggers, where
    // `trigger` and `longestLine` must both survive the second call.
    // Scope limit, carried forward verbatim: this applies only to two DEGRADE
    // decisions. A shared frozen ALLOW singleton remains a legitimate
    // implementation choice, which is why no identity claim is made on the
    // allow arm anywhere in this file.
    expect(first).not.toBe(second);
  });

  // --- G18' ----------------------------------------------------------------
  it("G18': `content` is read exactly once, and never in source mode", () => {
    // A getter on a plain object the test constructs is NOT a mock: it is a
    // legal inhabitant of LargeDocumentGuardInput returning the real value.
    //
    // HONEST LIMIT: `reads === 1` proves the PROPERTY is read once. It does NOT
    // prove the scan is single-pass — `input.content.split("\n")` also reads
    // the property exactly once. Constant auxiliary space is enforced by C12,
    // a source-text case in the call-site file; ONE FORWARD PASS is enforced
    // by C13 (added with ADR-0019, because the two-loop implementation is
    // output-identical and no behavioural case at any level can see it); and
    // "no parsing" has N17 and N1 rows 23/24 as its behavioural tripwires.
    //
    // Old arm (b) — "a present fileSize must not read content" — is RETIRED BY
    // CONSTRUCTION: `fileSize` no longer exists. Old arm (c)'s
    // `toBeGreaterThanOrEqual(1)` is strengthened here to an exact 1.
    const makeInput = (viewMode: ViewMode) => {
      const state = { reads: 0 };
      const input: LargeDocumentGuardInput = {
        viewMode,
        get content() {
          state.reads += 1;
          return "\n".repeat(25_001);
        },
      };
      return { input, state };
    };

    // (a) the mode gate short-circuits before any character of content is read.
    const a = makeInput("source");
    expect(decideLargeDocumentGuard(a.input)).toEqual({ action: "allow" });
    expect(a.state.reads, "source mode must not read content").toBe(0);

    // (b) positive control — in wysiwyg the content IS read, exactly once.
    const b = makeInput("wysiwyg");
    expect(decideLargeDocumentGuard(b.input)).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    });
    // MUST STAY EXACTLY 1: the second counter is computed in the SAME pass, so
    // the implementation must not acquire a second `input.content` read.
    expect(b.state.reads, "wysiwyg must read content exactly once").toBe(1);
  });

  // === E. ADR-accepted costs — characterization, recorded not endorsed ======

  // --- N10 -----------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed (N10): a fenced code block and a GFM delimiter row both contribute cells", () => {
    // ADR-0016 Consequences accepts this OVER-COUNT knowingly. Adding fence
    // tracking or delimiter-row detection would be MARKDOWN PARSING, which
    // Decision 1 freezes out — this case is the tripwire on that invariant.
    // Do not "fix" the predicate to make it pass differently.
    //
    // (a) per block: 3 newlines + 1 pipe − 0 row starts = 4; × 7,000 = 28,000.
    // A fence-tracking implementation scores 3 per block = 21,000 and ALLOWS,
    // which is why the repeat count must keep the document above the cut.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "```\na|b\n```\n".repeat(7_000),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 28_000,
      longestLine: 3, // "```" and "a|b" are both 3
      trigger: "structure",
    });

    // (b) per table: 3 newlines + 9 pipes − 3 row starts = 9; × 3,000 = 27,000.
    // The honest RENDERED count is 3 newlines + 4 cells = 7 per table (21,000);
    // the 6,000-element excess is the accepted over-count.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b |\n|---|---|\n| 1 | 2 |\n".repeat(3_000),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 27_000,
      longestLine: 9, // all three row shapes are 9 code units
      trigger: "structure",
    });

    // DELIBERATE REDUNDANCY, recorded: N1 row 20 covers the same fenced-code
    // attack at the margin (fragment score 4). N1 gives the branch coverage and
    // the exact arithmetic; this case gives the named, labelled case a future
    // reader finds when they ask "why does a code fence count". Neither is
    // redundant with the other's purpose; neither should be deleted because the
    // other exists.
  });

  // --- N11 -----------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed (N11): omitted outer pipes score one cell, not two", () => {
    // ADR-0016 Consequences accepts this UNDER-COUNT knowingly: 2 rendered
    // cells per row are counted as 1. Inferring column counts from a header row
    // would again be parsing.
    //
    // PAIRING: GFM makes outer pipes optional at BOTH ends. This case records
    // that dropping the LEADING pipe loses a cell (accepted). N1 rows 23/24
    // record that dropping the TRAILING pipe must still produce a row start
    // (required, not optional) — an implementation that demands a closing pipe
    // converts the second into an UNRECORDED over-count, which is what makes it
    // a defect rather than a cost.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "a | b\n".repeat(20_000), // per row: 1 newline + 1 pipe − 0 row starts
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 40_000,
      longestLine: 5, // "a | b"
      trigger: "structure",
    });
  });

  // --- N12 -----------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed (N12): 20,000 inline links in one paragraph are ALLOWED", () => {
    // ADR-0016's SHARPEST RECORDED HOLE. THIS CASE GOING RED MEANS SOMEONE
    // ADDED AN INLINE-DENSITY PROXY (a `[` counter). That is exactly the change
    // the ADR's Deliberation note DECLINES — shipping an unmeasured counter is
    // the error the ADR exists to correct. It requires A NEW ADR, not a green
    // suite. Do not "fix" this.
    //
    // NUMBER NOTE — do NOT "correct" this case to match the ADR's figure.
    // ADR-0016 Consequences says the 20,000-link document "scores 1"; this
    // document scores 0. Both are right about their own document: the ADR's
    // prose assumes a paragraph terminated by one newline (0 pipes + 1
    // newline), and this input ends in a space with no trailing newline. The
    // discrepancy is one trailing `\n`, not a disagreement about the predicate.
    // Changing the expectation to 1 would make this case red against a correct
    // implementation.
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "[asset](./a/b.png) ".repeat(20_000),
    });
    expect(result).toEqual({ action: "allow" });
    expect(Object.keys(result)).toEqual(["action"]);
  });

  // --- N13 -----------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed (N13): lone `\\r` line endings score zero newlines and suppress the row-start subtraction", () => {
    // Adding `\r` to the newline set or to the whitespace set breaks this.
    // Deliberate counterpart to N5 — see that case's comment for why the two
    // together pin the exact boundary of the `\r` rule.
    //
    // ADR-0019 NOTE (row (a) now allows for a SECOND reason, and a reader must
    // not over-generalise from it): this document is ONE line of 30,000 code
    // units — no `\n` anywhere — so it clears the structure cut (score 0) AND
    // the 1,000,000 line cut. It does NOT follow that a `\r`-only document of
    // any length allows: at 1,000,001 lone carriage returns it is a single
    // line over the cut and degrades with `trigger: "line-length"`.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\r".repeat(30_000) }),
    ).toEqual({ action: "allow" });

    // 3 pipes, NO row start: the line's first character is `\r`, which is
    // neither whitespace nor a newline under contract answer (2).
    expect(atMargin("\r| a | b |")).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_003,
      longestLine: 10, // the `\r` plus "| a | b |" — the `\r` counts (answer 9)
      trigger: "structure",
    });
  });

  // --- N17 -----------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed (N17): an escaped `\\|` and an inline-code pipe both still count, and neither opens a row", () => {
    // THIS CASE GOING RED MEANS SOMEONE HAS ADDED A PARSING RULE to a predicate
    // whose frozen invariant is "no Markdown parsing, no tokenizer". That is a
    // change to the INVARIANTS, not to the arithmetic, and ADR-0016 Decision 1
    // says changing the invariants REQUIRES A NEW ADR. A green suite is not the
    // remedy.
    //
    // The two implementations this kills — a one-character lookback that skips
    // `\|`, and backtick-span tracking that suppresses pipes inside inline code
    // — are both single-pass and constant-space, so C12 cannot see them and
    // C8b' cannot see them (neither adds a numeric literal or a `<=`).
    //
    // Row 1 is also the ONLY place anywhere that pins whether `\|` at column 0
    // is a row start. Under contract answer (2) it is NOT: the rule is "first
    // non-whitespace character is `|`", and the first non-whitespace character
    // here is `\`.
    //
    // Kept separate from N1 because N1 carries an S4 partition claim and these
    // carry an S1 characterization claim; mixing them would either inflate this
    // case's claim or launder the accepted-defect labelling into a "the scanner
    // is correct here" reading.
    // `maxLine` is hand-written, as `s` is. Row 1's segment is `\`, `|`, ` `,
    // `a` — the backslash is one code unit and counts. Row 2's is a backtick,
    // `a`, `|`, `b`, a backtick.
    const rows: Array<{
      n: number;
      fragment: string;
      s: number;
      maxLine: number;
      transition: string;
    }> = [
      {
        n: 1,
        fragment: "\\| a\n",
        s: 2,
        maxLine: 4,
        transition:
          "escaped pipe STILL COUNTS as a cell (1 newline + 1 pipe); the line is NOT a row start, because the first non-whitespace character is a backslash",
      },
      {
        n: 2,
        fragment: "`a|b`\n",
        s: 2,
        maxLine: 5,
        transition:
          "inline-code pipe STILL COUNTS - there is no span tracking (1 newline + 1 pipe - 0 row starts)",
      },
    ];

    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const row of rows) {
      results.push(atMargin(row.fragment));
      labels.push(`N17 row ${row.n} (s=${row.s}, maxLine=${row.maxLine}): ${row.transition}`);
    }

    expect(results).toHaveLength(rows.length);
    results.forEach((result, i) => {
      expect(result, labels[i]).toEqual({
        action: "degrade-to-source",
        message: EXPECTED_MESSAGE,
        elements: 25_000 + rows[i].s,
        longestLine: rows[i].maxLine,
        trigger: "structure",
      });
    });
  });

  // === F. Decision shape and the union =====================================

  // --- G14' ----------------------------------------------------------------
  it("G14': empty content allows, and the allow arm carries no payload", () => {
    // Reporting `elements: 0` on the allow arm would leak the score into a
    // decision that does not need it and change the union's shape.
    const result = decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "" });
    expect(result).toEqual({ action: "allow" });
    expect(Object.keys(result)).toEqual(["action"]);
  });

  // --- G20' ----------------------------------------------------------------
  it("G20': the union discriminates cleanly — exact key sets on both arms", () => {
    const allowResult = decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "x" });
    const degradeResult = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "\n".repeat(25_001),
    });

    // Object.keys, not Object.hasOwn — the latter is ES2022 and does not
    // compile under this tsconfig's lib (TS2550).
    expect(Object.keys(allowResult)).toEqual(["action"]);
    // THE DEDICATED PIN FOR CONTRACT ANSWERS (4) AND (12): renaming `elements`,
    // adding an undeclared field, leaking `bytes` back in, or dropping either
    // of the two ADR-0019 members all fail here. The degrade arm has exactly
    // FIVE keys; the allow arm still has exactly one.
    expect(Object.keys(degradeResult).sort()).toEqual(
      ["action", "elements", "longestLine", "message", "trigger"].sort(),
    );
  });

  // === G. Evidence anchors — the ADR's empirical claims =====================

  // --- N15 -----------------------------------------------------------------
  it("N15: the headline inversion — a 600 KB single line is ALLOWED", () => {
    // THE RED-RECEIPT CASE FOR THE WHOLE CHANGE. Against the old byte predicate
    // this returned `{action:"degrade-to-source", message:"Document exceeds
    // 500KB…", bytes:614_400}`. It must NOT be softened if someone later panics
    // about large files: softening it re-adopts the predicate ADR-0016 refutes.
    //
    // ADR-0019 NOTE: this survives BY THE NUMBERS, not by accident. 600 × 1024
    // = 614,400 UTF-16 code units on one line, which clears the new 1,000,000
    // line threshold with 385,600 to spare. LL-1 is where that cut is pinned.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(600 * 1024), // no newline, no pipe: score 0
      }),
    ).toEqual({ action: "allow" });
  });

  // --- N2 ------------------------------------------------------------------
  it("N2: the ex-G15 flip — live in-memory content is what is judged", () => {
    // G15 was a CHARACTERIZATION case ("the stale on-disk fileSize wins over
    // live content"). ADR-0016 Decision 5 deliberately FLIPPED it, and this is
    // the flip: the scenario reduces to the live content the caller supplies
    // from `activeDocument.content`, and it degrades. Reintroducing any on-disk
    // short circuit breaks this.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "- item\n".repeat(32_657),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 32_657,
      longestLine: 6, // "- item"
      trigger: "structure",
    });
  });

  // --- N14 -----------------------------------------------------------------
  it("N14: sweep-shape ranking — the five D6.1 shapes land on the ADR's side of the cut", () => {
    // ADR-0016's central empirical claim (5/5 rank agreement with measured open
    // cost), reproduced from the corpus's STRUCTURAL COUNTS. No fixture file is
    // read, no duration is measured, and nothing here is a timing gate.
    //
    // RISK 18 HANDLED: the expected large-table score is computed from the
    // string this test builds (11,438 × 5 = 57,190), so it depends on NEITHER
    // ADR-0016's 45,752 NOR plan M's 45,744.
    //
    // This is the only case that would notice a REWEIGHTING of the cell
    // coefficient that keeps the boundary pair green (below 0.464 the
    // large-table / many-short-nodes order breaks).
    const veryLongLine = "x".repeat(471_845) + "\n" + "x\n" + "x\n";
    const normalProse = "lorem ipsum dolor sit amet\n".repeat(2_574);
    const denseMath = "$x^2 + y^2 = z^2$\n".repeat(20_664);
    const manyShortNodes = "- item\n".repeat(32_657);
    const largeTable = "| a | b | c | d |\n".repeat(11_438);

    const decisions: LargeDocumentGuardDecision[] = [
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: veryLongLine }),
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: normalProse }),
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: denseMath }),
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: manyShortNodes }),
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: largeTable }),
    ];
    const labels = [
      "very-long-line",
      "normal-prose",
      "dense-math",
      "many-short-nodes",
      "large-table",
    ];

    // ADR-0019 NOTE on row 0, so nobody concludes `very-long-line` is always
    // allowed: `veryLongLine` here is the `.wysiwyg` SHAPE — 471,845 code
    // units on its first line — and it stays allowed under both triggers. Its
    // `.source` twin, whose longest line is 7,583,742, now DEGRADES, and that
    // is case LL-2. Note also that 471,845 is NOT ADR-0019's 359,285 for the
    // same fixture: one is a byte count, the other the measured longest line.
    // Both are legitimate; do not conflate them or "correct" either.
    expect(decisions[0], labels[0]).toEqual({ action: "allow" });
    expect(decisions[1], labels[1]).toEqual({ action: "allow" });
    expect(decisions[2], labels[2]).toEqual({ action: "allow" });
    expect(decisions[3], labels[3]).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 32_657,
      longestLine: 6, // "- item"
      trigger: "structure",
    });
    expect(decisions[4], labels[4]).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
      longestLine: 17, // "| a | b | c | d |"
      trigger: "structure",
    });

    // The three allow rows' scores are read at the margin, where they are
    // observable; the two degrade rows report theirs directly.
    const scores = [
      scoreAtMargin(veryLongLine),
      scoreAtMargin(normalProse),
      scoreAtMargin(denseMath),
      32_657,
      57_190,
    ];
    expect(scores.slice(0, 3)).toEqual([3, 2_574, 20_664]);
    // The rank-agreement claim, stated directly.
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(new Set(scores).size).toBe(scores.length);
  });

  // --- N16 -----------------------------------------------------------------
  it("N16: a multi-megabyte structured document reports an exact score", () => {
    // The top of the practical input domain (the app's open limit is 10 MB).
    // Breaks on an accumulator overflow or a chunked scan that loses a row
    // boundary.
    //
    // EXPLICITLY NOT A TIMING GATE: no duration is asserted and no `timeout`
    // option is set (ADR-0016 Decision 7 / E39 / G0). Its incidental value — an
    // accidentally quadratic scan would hang and hit vitest's default timeout —
    // is a SIDE EFFECT of the case, never its contract.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b | c | d |\n".repeat(100_000),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 500_000,
      longestLine: 17, // "| a | b | c | d |" — 1.8 M code units across 100,000 short lines
      trigger: "structure",
    });
  });

  // =========================================================================
  // H. The LL family — the longest-line trigger (D6.3(d) / ADR-0019)
  //
  // Prefix chosen to avoid collision: `G` = inherited, `N` = D6.3(c),
  // `M` = constants, `C` = call-site, `D` = defect ids, `LL` = these.
  //
  // Every input is built with `.repeat(n)`. No fixture file is read, no
  // multi-megabyte literal appears, no duration is asserted and no `timeout:`
  // option is set anywhere (E39 / G0 / ADR-0019 Decision 6).
  // =========================================================================

  // --- LL-1 ----------------------------------------------------------------
  it("LL-1: boundary — the line-length cut allows at 1,000,000 and degrades at 1,000,001", () => {
    // S2. Two points on one threshold, in one direction each, so `<=` cannot
    // be read as `<`.
    //
    // WHAT THIS CASE DOES *NOT* CATCH, stated because an earlier reading of it
    // claimed otherwise: folding the line length into the score does NOT break
    // LL-1. `score + longestLine / 40 > 25_000` allows at (score 0, line
    // 1,000,000) — `0 + 25_000` is not greater than 25,000 — and degrades at
    // (0, 1,000,001). It passes BOTH halves here exactly. The fold is killed
    // by LL-17 quadrant 1 and by LL-10's first half, and by nothing else in
    // this file. Do not read LL-1 as covering ADR-0019 Decision 3.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "x".repeat(1_000_000) }),
    ).toEqual({ action: "allow" });

    // `elements: 0` on a degrade arm is itself the claim that the STRUCTURE
    // counter did not fire. It is not filler.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "x".repeat(1_000_001) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 0,
      longestLine: 1_000_001,
      trigger: "line-length",
    });
  });

  // --- LL-2 ----------------------------------------------------------------
  it("LL-2: regression — the measured defect shape degrades and reports its exact longest line", () => {
    // S1, one concrete measured point; it claims nothing about neighbours.
    //
    // This reproduces the SHAPE of `very-long-line.source.md` (9,961,475 B,
    // structure score 3, longest line 7,583,742), NOT the fixture — nothing is
    // read from disk. Total input here is 7,583,747 code units.
    //
    // The 259,483 ms Milkdown mount measured on that fixture is CONTEXT for
    // why the threshold exists. It is never a gate: no duration is asserted,
    // no `timeout:` is set, and the input's size is a SIZE claim only.
    //
    // Under the shipped D6.3(c) predicate this document scored 3 and was
    // ALLOWED — the protection regression ADR-0019 Context measures.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(7_583_742) + "\n" + "x\n" + "x\n",
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 3,
      longestLine: 7_583_742,
      trigger: "line-length",
    });
  });

  // --- LL-3 ----------------------------------------------------------------
  it("LL-3: the other side of the measured interval — 359,285 on one line stays allowed", () => {
    // S1. 359,285 is the measured longest line of `very-long-line.wysiwyg.md`
    // (ADR-0019 Context table), the ALLOWED observation the threshold sits
    // 2.8x above. It is NOT the same number as N14's synthetic `veryLongLine`,
    // which is built from that fixture's 471,845-byte first line. Two
    // different numbers for the same fixture, both legitimate.
    const fragment = "x".repeat(359_285);

    const result = decideLargeDocumentGuard({ viewMode: "wysiwyg", content: fragment });
    expect(result).toEqual({ action: "allow" });
    expect(Object.keys(result)).toEqual(["action"]);

    // The margin half is what stops this being satisfied by "allow
    // everything": the line length is observed exactly, at a document that
    // degrades on structure.
    expect(longestLineAfter(fragment)).toBe(359_285);
  });

  // --- LL-4 ----------------------------------------------------------------
  it('LL-4: both counters fire — `trigger: "both"`', () => {
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "\n".repeat(25_001) + "x".repeat(1_000_001),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 1_000_001,
      trigger: "both",
    });
  });

  // --- LL-5 ----------------------------------------------------------------
  it('LL-5: a `trigger: "structure"` degrade still reports its REAL longest line', () => {
    // S1, two named corpus shapes. An implementation that hard-codes
    // `longestLine: 0` on the structure arm dies here.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "- item\n".repeat(32_657),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 32_657,
      longestLine: 6,
      trigger: "structure",
    });

    // `| a | b | c | d |` is 17 UTF-16 code units: 5 pipes + 4 letters + 8
    // spaces. The same 17 appears in G5'(b), N6, N14 and N16 for this string.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "| a | b | c | d |\n".repeat(11_438),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
      longestLine: 17,
      trigger: "structure",
    });
  });

  // --- LL-6 ----------------------------------------------------------------
  it("LL-6: the final line counts even with no trailing newline (contract answer 8)", () => {
    // Kills the implementation whose max is only ever updated inside the `\n`
    // arm: without the post-loop flush it reports `longestLine: 1` and ALLOWS
    // — a silent protection hole. LL-1's second half is the independent second
    // kill of the same mutant (there the document has no `\n` at all).
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "a\n" + "x".repeat(1_000_001),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 1,
      longestLine: 1_000_001,
      trigger: "line-length",
    });
  });

  // --- LL-7 ----------------------------------------------------------------
  it("LL-7: the longest line is not the last line", () => {
    // Kills "last line wins" and "longestLine = currentLine at end of scan",
    // both of which report 5 here and ALLOW.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(1_000_001) + "\nshort",
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 1,
      longestLine: 1_000_001,
      trigger: "line-length",
    });
  });

  // --- LL-8 ----------------------------------------------------------------
  it("LL-8: the line counter RESETS per line — total length over the cut, every line under it", () => {
    // S4. The partition: "total length above the threshold, every individual
    // line at or below it ⇒ allow". Represented by its defining member.
    //
    // `longestLine = content.length`, a `currentLine` never zeroed in the `\n`
    // arm, and a smuggled-back byte term all report 1,200,002 and DEGRADE.
    // N3 familyTwo is the second independent kill.
    const doc = ("x".repeat(600_000) + "\n").repeat(2); // 1,200,002 units, lines of 600,000

    const result = decideLargeDocumentGuard({ viewMode: "wysiwyg", content: doc });
    expect(result).toEqual({ action: "allow" });
    expect(Object.keys(result)).toEqual(["action"]);

    // Without this exact number, "allow everything" passes the half above.
    expect(longestLineAfter("x".repeat(600_000) + "\n" + "x".repeat(600_000) + "\n")).toBe(
      600_000,
    );
  });

  // --- LL-9 ----------------------------------------------------------------
  it("LL-9: space, tab and pipe all count toward line length (contract answer 10)", () => {
    // S4, the equivalence class "characters the SCORING chain treats
    // specially": space and tab fall through every arm of the if/else chain,
    // and a pipe at line start cancels its own contribution.
    //
    // THE SINGLE MOST LIKELY IMPLEMENTATION SLIP THIS FILE GUARDS: placing
    // `currentLine++` INSIDE the scoring if/else chain. Space and tab fall
    // through that chain, so they would be silently unmeasured and the first
    // two rows would ALLOW. The increment must sit OUTSIDE the chain.
    const rows: Array<{ content: string; expected: LargeDocumentGuardDecision; label: string }> =
      [
        {
          content: " ".repeat(1_000_001),
          label: "1,000,001 spaces — score 0, never leaves the line-start state",
          expected: {
            action: "degrade-to-source",
            message: EXPECTED_MESSAGE,
            elements: 0,
            longestLine: 1_000_001,
            trigger: "line-length",
          },
        },
        {
          content: "\t".repeat(1_000_001),
          label: "1,000,001 tabs — same class as space",
          expected: {
            action: "degrade-to-source",
            message: EXPECTED_MESSAGE,
            elements: 0,
            longestLine: 1_000_001,
            trigger: "line-length",
          },
        },
        {
          content: "|".repeat(1_000_001),
          label: "1,000,001 pipes — 1,000,001 pipes minus the one row start",
          expected: {
            action: "degrade-to-source",
            message: EXPECTED_MESSAGE,
            elements: 1_000_000,
            longestLine: 1_000_001,
            trigger: "both",
          },
        },
      ];

    // Pushed UNWRAPPED with labels in a parallel array (the G22' aliased-
    // singleton hole); asserted after the loop.
    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const row of rows) {
      results.push(decideLargeDocumentGuard({ viewMode: "wysiwyg", content: row.content }));
      labels.push(row.label);
    }

    expect(results).toHaveLength(rows.length);
    results.forEach((result, i) => {
      expect(result, labels[i]).toEqual(rows[i].expected);
    });
  });

  // --- LL-10 ---------------------------------------------------------------
  it("LL-10: one `\\r` straddles the cut — CRLF measures exactly one longer (contract answer 9)", () => {
    // S2, pinned in ONE direction each so the answer cannot be read either
    // way. `\r` is an ordinary counted character; the alternative is a
    // lookback, which is a parsing rule ADR-0016 Decision 1 freezes out.
    //
    // THE FIRST HALF IS A NON-OBVIOUS SECOND KILL OF THE ADDITIVE FOLD, and
    // the half a reader is most likely to dismiss as "just the CRLF case": at
    // (score 1, line 1,000,000), `1 + 1_000_000/40 = 25_001 > 25_000` would
    // DEGRADE where allow is required. Together with LL-17 quadrant 1 this is
    // the complete behavioural defence of ADR-0019 Decision 3.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(1_000_000) + "\n",
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(1_000_000) + "\r\n",
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 1,
      longestLine: 1_000_001,
      trigger: "line-length",
    });
  });

  // --- LL-11 ---------------------------------------------------------------
  it("LL-11: the unit is UTF-16 code units, not graphemes (ADR-0019 Decision 1)", () => {
    // S1. 500,001 emoji = 1,000,002 code units on one line. Pins the stated
    // unit at one point so nobody later reads it as a bug. Escape form per the
    // file's ESCAPING CONVENTION.
    //
    // Switching the scan to `for…of`, `Array.from` or `Intl.Segmenter` counts
    // code POINTS and reports 500,001 — allowing. The first two also allocate,
    // so C12 and C13 catch them by source text as well.
    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "\u{1F600}".repeat(500_001),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 0,
      longestLine: 1_000_002,
      trigger: "line-length",
    });
  });

  // --- LL-12 ---------------------------------------------------------------
  it("LL-12: degenerate inputs, and the allow arm stays bare", () => {
    const empty = decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "" });
    expect(empty).toEqual({ action: "allow" });
    expect(Object.keys(empty)).toEqual(["action"]);

    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(10) }),
    ).toEqual({ action: "allow" });

    // A document of ONLY newlines has longest line 0, not 1. An off-by-one in
    // the flush or in the reset reports 1.
    //
    // OVERLAP, stated rather than left to be discovered: this row duplicates
    // the harness self-check and G5'(a). It is kept because this is the
    // degenerate-input grouping a reader looks for.
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(25_001) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    });
  });

  // --- LL-13 ---------------------------------------------------------------
  const LINE_LENGTH_LADDER = [0, 1, 999_999, 1_000_000, 1_000_001, 1_100_000];

  it("LL-13: L3 — monotone and pointwise-correct over an ascending line-length ladder", () => {
    // S4, an ordered hand-written domain with the ordering relation itself
    // asserted (no property library exists in this repo — see the file
    // header). Mirrors G6' exactly, on the other counter.
    //
    // Every row is a SINGLE line, so the structure score is 0 throughout and
    // the only thing moving is the line length.
    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const n of LINE_LENGTH_LADDER) {
      results.push(
        decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "x".repeat(n) }),
      );
      labels.push(`lineLength=${n}`);
    }

    expect(results).toHaveLength(LINE_LENGTH_LADDER.length);

    results.forEach((result, i) => {
      const n = LINE_LENGTH_LADDER[i];
      if (n > 1_000_000) {
        expect(result, labels[i]).toEqual({
          action: "degrade-to-source",
          message: EXPECTED_MESSAGE,
          elements: 0,
          longestLine: n,
          trigger: "line-length",
        });
      } else {
        expect(result, labels[i]).toEqual({ action: "allow" });
      }
    });

    const degraded = results.map((r) => r.action === "degrade-to-source");
    const firstTrue = degraded.indexOf(true);
    if (firstTrue !== -1) {
      expect(degraded.slice(firstTrue), "no allow after the first degrade").toEqual(
        degraded.slice(firstTrue).map(() => true),
      );
    }
  });

  // --- LL-14 ---------------------------------------------------------------
  it("LL-14: L2 — the longest line is the MAX over `\\n`-aligned concatenation", () => {
    // S5, a metamorphic relation over a hand-crossed domain with NO expected
    // constant on the right-hand side: all three numbers come from real calls,
    // so no constant-returning implementation satisfies it pointwise… with one
    // stated exception, below.
    //
    // KNOWN LIMIT, written here rather than left for a reader to find: an
    // implementation returning `longestLine = 0` always satisfies
    // `0 === max(0, 0)`. LL-14 is therefore SOUND ONLY IN COMBINATION WITH the
    // exact-value cases LL-1 / LL-2 / LL-5 / LL-9 / LL-13. It is not
    // self-sufficient.
    //
    // SCOPE NOTE: LL-14 constrains the REPORTED NUMBER. It does not by itself
    // refute the score-fold — a folding implementation can report an honest
    // maxing `longestLine` while using it additively in the predicate. LL-17
    // quadrant 1 and LL-10's first half are what refute the fold.
    //
    // PAIRED WITH N4: the score is additive over the same operation, the line
    // length is a max. An implementation treating the two the same way fails
    // exactly one of the two.
    //
    // `\n`-TERMINATION IS LOAD-BEARING: it is what stops concatenation from
    // joining A's last line to B's first. Unterminated fragments are
    // deliberately excluded — the max law does not hold for that shape, and
    // that is a scope limit, not a gap.
    const FRAGMENTS: Array<{ name: string; text: string }> = [
      { name: "F1 bare newline", text: "\n" },
      { name: "F2 two letters", text: "ab\n" },
      { name: "F3 table row", text: "| a | b |\n" },
      { name: "F4 fifty x", text: "x".repeat(50) + "\n" },
      { name: "F5 CRLF", text: "\r\n" },
      { name: "F6 indented table row", text: "   | a | b |\n" },
    ];

    const observed: Array<{ lhs: number; max: number }> = [];
    const labels: string[] = [];
    for (const a of FRAGMENTS) {
      for (const b of FRAGMENTS) {
        observed.push({
          lhs: longestLineAfter(a.text + b.text),
          max: Math.max(longestLineAfter(a.text), longestLineAfter(b.text)),
        });
        labels.push(`${a.name} ⧺ ${b.name}`);
      }
    }

    expect(observed).toHaveLength(FRAGMENTS.length * FRAGMENTS.length);
    observed.forEach((row, i) => {
      expect(row.lhs, labels[i]).toBe(row.max);
    });
  });

  // --- LL-15 ---------------------------------------------------------------
  it("LL-15: L4 — the new fields survive the next call, across DIFFERENT triggers", () => {
    // The ORDERING is the case, exactly as G22' records: asserting on `first`
    // before the second call would let a hoisted, per-call-mutated singleton
    // pass.
    //
    // What extends G22': G22' used two STRUCTURE degrades, so an object
    // mutating only `elements` passed it. Here `trigger` and `longestLine`
    // must both survive too.
    const first = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "x".repeat(1_000_001),
    });
    const second = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "\n".repeat(25_001),
    });

    expect(first).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 0,
      longestLine: 1_000_001,
      trigger: "line-length",
    });
    expect(second).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    });
    expect(first).not.toBe(second);
  });

  // --- LL-16 ---------------------------------------------------------------
  it("LL-16: `trigger` agrees with the two reported counters at six points", () => {
    // S4 — a SIX-POINT consistency check across the payload's own fields, not
    // a law over a generated domain. It does NOT establish that `trigger` is a
    // function of the two counters; it kills hard-coded and mis-wired
    // triggers, which LL-1/4/5/9's four memorised answers leave gaps between.
    //
    // Nothing is recomputed from the INPUT here — this is a relation between
    // three members of one returned payload, not a re-implementation of the
    // scan.
    const DOCS: Array<{ content: string; label: string }> = [
      { content: "\n".repeat(25_001), label: "newlines only (structure)" },
      { content: "x".repeat(1_000_001), label: "one long line (line-length)" },
      {
        content: "\n".repeat(25_001) + "x".repeat(1_000_001),
        label: "newlines then one long line (both)",
      },
      { content: "|".repeat(1_000_001), label: "pipes (both)" },
      { content: "- item\n".repeat(32_657), label: "many short nodes (structure)" },
      { content: "a\n" + "x".repeat(1_000_001), label: "short line then long (line-length)" },
    ];

    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const doc of DOCS) {
      results.push(decideLargeDocumentGuard({ viewMode: "wysiwyg", content: doc.content }));
      labels.push(doc.label);
    }

    expect(results).toHaveLength(DOCS.length);

    const observedTriggers: string[] = [];
    results.forEach((result, i) => {
      if (result.action !== "degrade-to-source") {
        throw new Error(`${labels[i]}: expected a degrade decision`);
      }
      const structureFired = result.elements > LARGE_DOCUMENT_STRUCTURE_THRESHOLD;
      const lineFired = result.longestLine > LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD;

      expect(structureFired || lineFired, `${labels[i]}: at least one counter fired`).toBe(
        true,
      );
      expect(result.trigger, `${labels[i]}: trigger agrees with the counters`).toBe(
        structureFired && lineFired ? "both" : structureFired ? "structure" : "line-length",
      );
      observedTriggers.push(result.trigger);
    });

    expect(new Set(observedTriggers)).toEqual(
      new Set(["structure", "line-length", "both"]),
    );
  });

  // --- LL-17 ---------------------------------------------------------------
  it("LL-17: the joint boundary corner — all four quadrants around (25,000, 1,000,000)", () => {
    // S4, the four-quadrant partition of the 2-D decision surface at the one
    // point where both counters sit exactly on their thresholds.
    //
    // ── DO NOT TRIM THIS CASE. ──────────────────────────────────────────────
    //
    // THIS IS THE CASE THAT REFUTES THE OPTION ADR-0019 DECISION 3 REJECTS.
    // The additive fold `score + longestLine / k > 25_000` passes LL-1, LL-2,
    // LL-4, LL-5, LL-13, LL-14, LL-16 and M4. QUADRANT 1 IS WHERE IT DIES: at
    // (25,000, 1,000,000) any fold with `k <= 40` sums two individually-allowed
    // quantities past the threshold and degrades a document the ADR requires
    // to be allowed — the "two individually-harmless quantities combine into a
    // degrade that neither observation supports" false positive Decision 3
    // names in as many words. LL-10's first half is the second, independent
    // kill. If this case is trimmed as an "extra", Decision 3 goes unenforced
    // by the entire behavioural suite.
    //
    // It also kills: `structureOk && lineOk` written as `structureOk ||
    // lineOk` (quadrants 2 and 3 would allow — a guard that fires only when
    // BOTH trigger, i.e. almost never); `<` for `<=` on either axis (quadrant
    // 1 would degrade); and any implementation that checks only one counter.
    const QUADRANTS: Array<{
      content: string;
      label: string;
      expected: LargeDocumentGuardDecision;
    }> = [
      {
        content: "\n".repeat(25_000) + "x".repeat(1_000_000),
        label: "q1 (25,000 / 1,000,000) — both AT threshold, both allow",
        expected: { action: "allow" },
      },
      {
        content: "\n".repeat(25_001) + "x".repeat(1_000_000),
        label: "q2 (25,001 / 1,000,000) — structure only",
        expected: {
          action: "degrade-to-source",
          message: EXPECTED_MESSAGE,
          elements: 25_001,
          longestLine: 1_000_000,
          trigger: "structure",
        },
      },
      {
        content: "\n".repeat(25_000) + "x".repeat(1_000_001),
        label: "q3 (25,000 / 1,000,001) — line length only",
        expected: {
          action: "degrade-to-source",
          message: EXPECTED_MESSAGE,
          // NOTE `elements: 25_000` ON A DEGRADE ARM: a degrade may report an
          // AT-threshold score. That is the claim, not an oversight.
          elements: 25_000,
          longestLine: 1_000_001,
          trigger: "line-length",
        },
      },
      {
        content: "\n".repeat(25_001) + "x".repeat(1_000_001),
        // Same input as LL-4 — cross-referenced rather than re-explained.
        label: "q4 (25,001 / 1,000,001) — both; see LL-4",
        expected: {
          action: "degrade-to-source",
          message: EXPECTED_MESSAGE,
          elements: 25_001,
          longestLine: 1_000_001,
          trigger: "both",
        },
      },
    ];

    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const quadrant of QUADRANTS) {
      results.push(
        decideLargeDocumentGuard({ viewMode: "wysiwyg", content: quadrant.content }),
      );
      labels.push(quadrant.label);
    }

    expect(results).toHaveLength(QUADRANTS.length);
    results.forEach((result, i) => {
      expect(result, labels[i]).toEqual(QUADRANTS[i].expected);
    });

    // Quadrant 1 allows, so its arm must also be bare.
    expect(Object.keys(results[0]), labels[0]).toEqual(["action"]);
  });
});

// ===========================================================================
// WI-2: the exported constants. No law — an exported string and an exported
// integer have no conserved quantity, no round trip, and no ordering. The copy
// contract (M3) is a shape constraint, not a law.
// ===========================================================================

describe("largeDocumentGuard exported constants (WI-2)", () => {
  // --- M1 ------------------------------------------------------------------
  it("M1: the exported message constant is exactly the chosen literal", () => {
    // Written out in full. `toBe(LARGE_DOCUMENT_DOWNGRADE_MESSAGE)` would be a
    // tautology. Recorded honestly: M1 in isolation is the weakest case in the
    // matrix — a constant is satisfiable by a hardcoded string, which is what a
    // constant is. It is kept because a user-visible copy change should require
    // a deliberate red test and a CHANGELOG entry.
    expect(LARGE_DOCUMENT_DOWNGRADE_MESSAGE).toBe(
      "This document is too complex for WYSIWYG. Switched to Source mode for performance.",
    );
  });

  // --- M2 ------------------------------------------------------------------
  it("M2: a degrade decision carries that same literal", () => {
    // M2 is what makes the pair non-trivial: exporting one literal and building
    // the decision's message from another is a real divergence M1 cannot see.
    const decision = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "\n".repeat(25_001),
    });
    expect(decision.action).toBe("degrade-to-source");
    if (decision.action !== "degrade-to-source") throw new Error("unreachable");
    expect(decision.message).toBe(
      "This document is too complex for WYSIWYG. Switched to Source mode for performance.",
    );
  });

  // --- M3 ------------------------------------------------------------------
  it("M3: the copy contract holds independently of the exact copy", () => {
    // Deliberately designed to SURVIVE a legitimate copy edit while still
    // failing a bad one — that is what distinguishes it from M1 rather than
    // duplicating it.
    //
    // Rule 30 §5 ("one signal per surface") is enforced by the call site's
    // single `showToast` and by C9's empty allow arm, not by a copy assertion.
    // Recorded here so the criterion is not double-counted.
    expect(LARGE_DOCUMENT_DOWNGRADE_MESSAGE).not.toMatch(/\d/); // names no size and no count
    expect(LARGE_DOCUMENT_DOWNGRADE_MESSAGE).toMatch(/Source mode/); // says what happened
    expect(LARGE_DOCUMENT_DOWNGRADE_MESSAGE).toMatch(/performance/i); // says why
    expect(LARGE_DOCUMENT_DOWNGRADE_MESSAGE).not.toMatch(/500|KB|byte/i); // revert anchor
  });

  // --- M4 / LL-1b ----------------------------------------------------------
  it("M4: the exported line-length constant is live, not a dead symbol", () => {
    // S2. An exact mirror of G21' for the new threshold, and the BEHAVIOURAL
    // half of the C8b' source-text pin
    // `/\blongestLine\s*<=\s*LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD\b/`. The
    // source-text half alone cannot see a constant that moved AND a comparison
    // inlined to match; this case can.
    //
    // WHAT IT DOES NOT CATCH, recorded so the pair is not over-credited: an
    // inlined `1_000_000`, or the max-fold `max(score, longestLine / 40) >
    // 25_000`. Both are output-identical here, so M4 passes against them. Only
    // C8b's positive regex catches those. M4's claim is that the exported
    // constant is the one the function actually uses — not that the comparison
    // is spelled the way the ADR says.
    expect(LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD).toBe(1_000_000);

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD),
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD - 1),
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        content: "x".repeat(LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD + 1),
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 0,
      longestLine: LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD + 1,
      trigger: "line-length",
    });
  });
});
