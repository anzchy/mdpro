/**
 * WI-3.2 — structural integrity of the shared heading-identity corpus.
 *
 * The fixture (tests/render-fixtures/heading-identity.json) is DATA, not behaviour:
 * it carries no behavioural law, only the structural invariant that *the set of cases
 * and the set of (case, face) pins are exactly a stated list*. Until this file, that
 * invariant was unenforced — both runners assert only `cases.length > 0`, so DELETING
 * A WHOLE CASE was invisible: every remaining assertion still passed and the suite
 * reported green with less coverage than it claimed. During a work item whose central
 * activity is editing this fixture, that is the cheapest possible way to make a red go
 * away without noticing.
 *
 * PARITY SURFACE — THREE LIVE FACES (`rust`, `toc`, `exportFallback`) plus the
 * derived `tocOffsets` and the preservation-only `exportCanonical`. The ONE OTHER
 * slug generator in the tree is DEAD CODE and out of scope for every claim made
 * here: `src-tauri/src/commands/toc.rs:36` (zero callers, wrong argument name). A
 * second dead one lived in `src/stores/` until WI-3.5.8 deleted it; its absence is
 * guarded by `tests/dead-slug-removal.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

interface Case {
  name: string;
  currentlyFailsOn?: string[];
  currentlyProduces?: Record<string, unknown>;
}

const fixtures = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "render-fixtures/heading-identity.json"),
    "utf-8",
  ),
) as { faces: string[]; cases: Case[] };

/** H1: the full enumerated inventory, in order. */
const EXPECTED_CASE_NAMES = [
  "all-levels",
  "atx-control-alpha",
  "non-heading-ids",
  "cjk-basic",
  "punctuation-cjk",
  "dup-cjk",
  "suffix-collision",
  "emoji-then-literal",
  "two-emoji-only",
  "literal-then-emoji", // added by WI-3.2 (test-matrix ADDENDUM A)
  "literal-suffix-then-two-emoji", // added by WI-3.2 (test-matrix ADDENDUM A)
  "fenced-hash",
  "setext-noncolliding",
  "setext-title",
  "formatted-bold",
  "inline-code",
  "link-in-heading",
  "trailing-hashes",
  "leading-trailing-punct",
  "clobber-title",
  "clobber-name",
  "clobber-body",
  "clobber-location",
  "clobber-forms",
  "tab-heading", // added by the B19 regression fix (ADR-0012 follow-up)
  "crlf-doc",
  "crlf-two-lines",
  "lf-two-lines",
];

/**
 * H2: every (case, face) pin that must SURVIVE WI-3.2, each tagged with the work
 * item that owns it.
 *
 * WI-3.2's slug half (batches B1 + B2) removed exactly these and nothing else:
 *   (suffix-collision, rust|toc|exportFallback), (emoji-then-literal, toc|exportFallback),
 *   (two-emoji-only, toc|exportFallback).
 *
 * The ADR-0003 B′ sanitizer batch (B3) has now LANDED — ADR-0011 was accepted on
 * 2026-09-18, which was its only blocker — and removed sixteen further pins:
 * `trailing-hashes`, `leading-trailing-punct` and the five `clobber-*` cases on
 * `exportCanonical` AND `exportFallback`, plus `setext-title`'s two export pins.
 * `setext-title` keeps its `toc` pin: two independent defects were stacked on one
 * input and only one of them was B3's, so that case was partially unpinned.
 *
 * The Lezer parser-swap batch has now LANDED too — ADR-0012 was accepted on
 * 2026-09-18, superseding sequencing rows 3.3 ("replace with remark") and 3.4
 * ("bespoke line/terminator mapper") with one change — and removed five further
 * pins: `fenced-hash|toc`, `setext-noncolliding|toc` and `setext-title|toc` (the
 * old regex saw neither fences nor setext underlines), plus
 * `crlf-doc|tocOffsets` and `crlf-two-lines|tocOffsets` (a Lezer node's `from` is
 * a UTF-16 index, so the `offset += line.length + 1` undercount has no successor).
 * `link-in-heading|toc` survived that batch by measurement, not by omission — see
 * its tag below.
 *
 * Every pin below therefore belongs to a work item that has NOT run yet. Removing
 * one is removing another work item's specification, which is what H2's failure
 * message is worded to catch.
 */
const EXPECTED_SURVIVING_PINS = [
  "formatted-bold|exportFallback", // accepted degradation A1 (marked markup leak)
  "inline-code|exportFallback", // accepted degradation A1
  "link-in-heading|exportFallback", // accepted degradation A1
  // ADR-0012 Consequences: `HeaderMark` subtraction leaves LinkMark/URL in the
  // node range, measured 2026-09-18. Owned by the deferred inline-markup
  // stripping work, NOT by the superseded "WI-3.3 (remark replacement)".
  "link-in-heading|toc",
];

describe("heading-identity corpus — specification integrity (three live faces)", () => {
  it("H1: the case inventory is exactly the pinned list, in order", () => {
    expect(
      fixtures.cases.map((c) => c.name),
      "a case was added, renamed, reordered or DELETED. Deleting a case is invisible " +
        "to both corpus runners — they assert only that the file is non-empty — so this " +
        "list is the only thing standing between an inconvenient red and a silent " +
        "coverage loss.",
    ).toEqual(EXPECTED_CASE_NAMES);
  });

  it("H2: the surviving pin set is exactly the WI-3.3 / A1 / WI-3.4 set", () => {
    const actual = fixtures.cases
      .flatMap((c) => (c.currentlyFailsOn ?? []).map((f) => `${c.name}|${f}`))
      .sort();
    const expected = [...EXPECTED_SURVIVING_PINS].sort();

    const removed = expected.filter((p) => !actual.includes(p));
    const left = actual.filter((p) => !expected.includes(p));

    expect(
      actual,
      `you removed a pin that belongs to another work item: ${JSON.stringify(removed)}; ` +
        `you left a pin WI-3.2 was supposed to remove, or added an unexpected one: ` +
        `${JSON.stringify(left)}`,
    ).toEqual(expected);
  });

  it("H3: currentlyProduces and currentlyFailsOn agree, for every face of every case", () => {
    for (const c of fixtures.cases) {
      const pins = c.currentlyFailsOn ?? [];
      const recorded = Object.keys(c.currentlyProduces ?? {});

      for (const face of [...pins, ...recorded]) {
        expect(
          fixtures.faces,
          `[${c.name}] references face "${face}", which is not in the fixture's ` +
            `declared faces array. A recording under a misspelled key is read by ` +
            `nobody and fails nothing.`,
        ).toContain(face);
      }

      expect(
        [...recorded].sort(),
        `[${c.name}] currentlyProduces keys and currentlyFailsOn disagree. A ` +
          `recording left behind after its currentlyFailsOn face was deleted is the ` +
          `exact half-unpin the acceptance criterion forbids.`,
      ).toEqual([...pins].sort());

      if (pins.length === 0) {
        expect(
          c.currentlyProduces,
          `[${c.name}] has an empty currentlyFailsOn but still carries a ` +
            `currentlyProduces object. A case with no pinned defect must lose it ` +
            `entirely.`,
        ).toBeUndefined();
      }
    }
  });
});
