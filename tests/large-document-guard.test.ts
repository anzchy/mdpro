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
    });
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
    const rows: Array<{ n: number; fragment: string; s: number; transition: string }> = [
      { n: 1, fragment: "", s: 0, transition: 'EOF immediately after "\\n"' },
      { n: 2, fragment: "\n", s: 1, transition: "empty line" },
      { n: 3, fragment: "x", s: 0, transition: "line-start state left by a non-ws non-pipe char; EOF mid-line" },
      { n: 4, fragment: "|", s: 0, transition: "pipe at line start => +1 pipe, -1 row start" },
      { n: 5, fragment: "||", s: 1, transition: "one row start per LINE, not per pipe" },
      { n: 6, fragment: "x|", s: 1, transition: "pipe after the line-start state was left => no subtraction" },
      { n: 7, fragment: " |", s: 0, transition: "single leading space skipped" },
      { n: 8, fragment: "\t|", s: 0, transition: "leading tab skipped (tab IS whitespace)" },
      { n: 9, fragment: "       |", s: 0, transition: "UNBOUNDED skip (7 spaces) - kills a GFM 3-space implementation" },
      { n: 10, fragment: "\u00A0|", s: 1, transition: "NBSP is NOT whitespace - kills trimStart() / /\\s/" },
      { n: 11, fragment: "\r|", s: 1, transition: "lone CR is not whitespace and not a newline" },
      { n: 12, fragment: "\u{1F600}|", s: 1, transition: "astral char does not perturb the scan" },
      { n: 13, fragment: "| a | b |", s: 2, transition: "3 pipes - 1 row start" },
      { n: 14, fragment: "a | b", s: 1, transition: "omitted outer pipes - ADR-accepted UNDER-count" },
      { n: 15, fragment: "|---|---|", s: 2, transition: "delimiter row - ADR-accepted OVER-count (3 pipes - 1 row start)" },
      { n: 16, fragment: "| a | b |\n", s: 3, transition: "one full LF table row" },
      { n: 17, fragment: "   | a | b |\n", s: 3, transition: "indented table row" },
      { n: 18, fragment: "\t| a | b |\n", s: 3, transition: "tab-indented table row" },
      { n: 19, fragment: "| a | b |\r\n", s: 3, transition: "CRLF table row scores as LF" },
      { n: 20, fragment: "```\na|b\n```\n", s: 4, transition: "fenced code - ADR-accepted OVER-count" },
      { n: 21, fragment: "\n|", s: 1, transition: 'line start re-armed after "\\n"' },
      { n: 22, fragment: " \n |", s: 1, transition: "all-whitespace line, then indented pipe" },
      { n: 23, fragment: "| a | b\n", s: 2, transition: "ROW START WITHOUT A CLOSING PIPE: 1 newline + 2 pipes - 1 row start" },
      { n: 24, fragment: "| a | b", s: 1, transition: "same, unterminated at EOF: 2 pipes - 1 row start" },
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
    const labels: string[] = [];
    for (const row of rows) {
      results.push(atMargin(row.fragment));
      labels.push(`row ${row.n} (s=${row.s}): ${row.transition}`);
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
        });
      }
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
    });

    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\n".repeat(57_190) }),
    ).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
    });

    // "a\nb\nc" is 2 newline characters across 3 lines.
    expect(atMargin("a\nb\nc")).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_002,
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
    });
  });

  // --- N5 ------------------------------------------------------------------
  it("N5: L4 — CRLF metamorphic invariance", () => {
    // `.split("\n").join("\r\n")`, NOT `replaceAll`: the latter is ES2021 and
    // fails TS2550 under tsconfig.json's `lib: ES2020` — the same diagnostic
    // G20' records for `Object.hasOwn`.
    //
    // Both sides are real calls and nothing is hard-coded, so this case cannot
    // be satisfied by a constant. Grounded in reality: the D6.1 perf corpus
    // ships `normal-prose.wysiwyg.crlf.md`.
    //
    // Deliberate counterpart to N13: CRLF must be INVARIANT (because `\r` sits
    // at end-of-line there), and classic-Mac lone `\r` must NOT be normalised.
    // Either case alone leaves the `\r` rule ambiguous.
    const crlf = (d: string): string => d.split("\n").join("\r\n");
    const DOCS: Array<{ text: string; label: string }> = [
      { text: "", label: "empty" },
      { text: "\n", label: "one newline" },
      { text: AT_THRESHOLD, label: "at threshold" },
      { text: AT_THRESHOLD + "\n", label: "one over threshold" },
      { text: "| a | b |\n".repeat(10_000), label: "2-col table" },
      { text: "   | a | b |\n".repeat(9_000), label: "indented table" },
      { text: "a | b\n".repeat(20_000), label: "outer pipes omitted" },
      { text: "- item\n".repeat(32_657), label: "many short nodes" },
    ];

    const pairs: Array<{ lf: LargeDocumentGuardDecision; crlf: LargeDocumentGuardDecision }> =
      [];
    const labels: string[] = [];
    for (const doc of DOCS) {
      pairs.push({
        lf: decideLargeDocumentGuard({ viewMode: "wysiwyg", content: doc.text }),
        crlf: decideLargeDocumentGuard({ viewMode: "wysiwyg", content: crlf(doc.text) }),
      });
      labels.push(doc.label);
    }

    expect(pairs).toHaveLength(DOCS.length);
    pairs.forEach((pair, i) => {
      expect(pair.crlf, labels[i]).toEqual(pair.lf);
    });
  });

  // --- N3 ------------------------------------------------------------------
  it("N3: byte-length invariance — volume is irrelevant, structure is not", () => {
    // Successor to the retired G16, inverted. Any residual byte term
    // (`TextEncoder`, `content.length`, a `Math.max(score, bytes/K)` hybrid)
    // fails here; family 1's ~600 KB member is the one the OLD predicate
    // degraded, so a partial revert fails here first.
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

    const familyTwo: LargeDocumentGuardDecision[] = [];
    const familyTwoLabels: string[] = [];
    for (const fillerLen of [0, 1, 100]) {
      familyTwo.push(
        decideLargeDocumentGuard({
          viewMode: "wysiwyg",
          content: ("x".repeat(fillerLen) + "\n").repeat(30_000),
        }),
      );
      familyTwoLabels.push(`fillerLen=${fillerLen}, score 30,000`);
    }
    familyTwo.forEach((result, i) => {
      expect(result, familyTwoLabels[i]).toEqual({
        action: "degrade-to-source",
        message: EXPECTED_MESSAGE,
        elements: 30_000,
      });
    });
    expect(new Set(familyTwo.map((r) => JSON.stringify(r))).size).toBe(1);
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
    });
    expect(second).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
    });
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
    // the property exactly once. The one-pass / constant-space invariants are
    // enforced only by C12, a source-text case in the call-site file, and C12
    // is itself blind to allocation-free parsing rules (for which N17 and N1
    // rows 23/24 are the behavioural tripwires).
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
    });
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
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "\r".repeat(30_000) }),
    ).toEqual({ action: "allow" });

    // 3 pipes, NO row start: the line's first character is `\r`, which is
    // neither whitespace nor a newline under contract answer (2).
    expect(atMargin("\r| a | b |")).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 25_003,
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
    const rows: Array<{ n: number; fragment: string; s: number; transition: string }> = [
      {
        n: 1,
        fragment: "\\| a\n",
        s: 2,
        transition:
          "escaped pipe STILL COUNTS as a cell (1 newline + 1 pipe); the line is NOT a row start, because the first non-whitespace character is a backslash",
      },
      {
        n: 2,
        fragment: "`a|b`\n",
        s: 2,
        transition:
          "inline-code pipe STILL COUNTS - there is no span tracking (1 newline + 1 pipe - 0 row starts)",
      },
    ];

    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const row of rows) {
      results.push(atMargin(row.fragment));
      labels.push(`N17 row ${row.n} (s=${row.s}): ${row.transition}`);
    }

    expect(results).toHaveLength(rows.length);
    results.forEach((result, i) => {
      expect(result, labels[i]).toEqual({
        action: "degrade-to-source",
        message: EXPECTED_MESSAGE,
        elements: 25_000 + rows[i].s,
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
    // THE DEDICATED PIN FOR CONTRACT ANSWER (4): renaming `elements`, adding an
    // undeclared field, or leaking `bytes` back in all fail here.
    expect(Object.keys(degradeResult).sort()).toEqual(["action", "elements", "message"]);
  });

  // === G. Evidence anchors — the ADR's empirical claims =====================

  // --- N15 -----------------------------------------------------------------
  it("N15: the headline inversion — a 600 KB single line is ALLOWED", () => {
    // THE RED-RECEIPT CASE FOR THE WHOLE CHANGE. Against the old byte predicate
    // this returned `{action:"degrade-to-source", message:"Document exceeds
    // 500KB…", bytes:614_400}`. It must NOT be softened if someone later panics
    // about large files: softening it re-adopts the predicate ADR-0016 refutes.
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

    expect(decisions[0], labels[0]).toEqual({ action: "allow" });
    expect(decisions[1], labels[1]).toEqual({ action: "allow" });
    expect(decisions[2], labels[2]).toEqual({ action: "allow" });
    expect(decisions[3], labels[3]).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 32_657,
    });
    expect(decisions[4], labels[4]).toEqual({
      action: "degrade-to-source",
      message: EXPECTED_MESSAGE,
      elements: 57_190,
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
    });
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
});
