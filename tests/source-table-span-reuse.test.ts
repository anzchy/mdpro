/**
 * @module source-table-span-reuse.test
 * D12 WI-6 (ADR-0043 Decision 4): span reuse on selection-only
 * transactions is invisible. Along any chain of selection transactions,
 * cursor or range, the field equals `legacyCursorOracle` (M3) at every
 * step, keyed on `selection.main.head`.
 *
 * The locate passthrough only CLASSIFIES steps (reused vs re-located) for
 * the non-vacuity counts; its count is snapshotted before the oracle runs.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` REUSE-1, REUSE-2.
 * REUSE-3..6 are in `source-table-span-reuse-guards.test.ts`.
 */

import { isDeepStrictEqual } from "node:util";

import { describe, expect, it, vi } from "vitest";
import { EditorState, type EditorSelection, type SelectionRange, type Text } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

import {
  getActiveTableCell,
  getTableContext,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import { locateTableAtOffset } from "../src/utils/tableParser/locate";
import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import { makeCorpus, mulberry32, SEED } from "./support/tableCorpus";
import { completeTreeState } from "./support/completeTreeState";
import { D12_FIXTURES, FENCE_IN_SPAN, legacyCursorOracle } from "./support/tableSpanOracle";

vi.mock("../src/utils/tableParser/locate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/locate")>();
  return { ...actual, locateTableAtOffset: vi.fn(actual.locateTableAtOffset) };
});

const locateSpy = vi.mocked(locateTableAtOffset);

const CORPUS_COUNT = 60;
const STEPS = 200;
const P_UNIFORM = 0.3;
const P_STEP = 0.4;
const P_EXTEND = 0.2;
const MIN_REUSED = 1_000;
const MIN_RELOCATED = 1_000;
const MIN_RANGE = 500;
const WALK_TIMEOUT_MS = 180_000;
const LANGUAGE = markdown();
const DETECTION = tableDetectionExtension();
const EXTENSIONS = [LANGUAGE, DETECTION];

const F = D12_FIXTURES;
const WALK_FIXTURES: [string, string][] = [
  ["NEP", F.NEP],
  ["NEP_EOF", F.NEP_EOF],
  ["NEP_TAIL", F.NEP_TAIL],
  ["M1_NEP", F.M1_NEP],
  ["M1_PIPED", F.M1_PIPED],
  ["M1_BLANK", F.M1_BLANK],
  ["PIPELESS", F.PIPELESS],
  ["PIPELESS_CHAIN", F.PIPELESS_CHAIN],
  ["PIPED_DELIM", F.PIPED_DELIM],
  ["SETEXT", F.SETEXT],
  ["AFTER_TAIL", F.AFTER_TAIL],
  ["INTRO_TABLE", F.INTRO_TABLE],
  ["FENCED_TABLE", F.FENCED_TABLE],
  ["FENCE_IN_SPAN", FENCE_IN_SPAN],
  ["T3", F.T3],
  ["CRLF", F.CRLF],
  ["ESC", F.ESC],
];

function field(s: EditorState) {
  return { span: getTableContext(s), cell: getActiveTableCell(s) };
}

/** One walk target: uniform, ±1, or the same column one line up/down. */
function drawTarget(s: EditorState, rnd: () => number): number {
  const len = s.doc.length;
  const head = s.selection.main.head;
  const r = rnd();
  if (r < P_UNIFORM) return Math.min(len, Math.floor(rnd() * (len + 1)));
  if (r < P_UNIFORM + P_STEP) {
    return Math.max(0, Math.min(len, head + (rnd() < 0.5 ? -1 : 1)));
  }
  const line = s.doc.lineAt(head);
  const n = Math.max(1, Math.min(s.doc.lines, line.number + (rnd() < 0.5 ? -1 : 1)));
  const target = s.doc.line(n);
  return Math.min(target.from + (head - line.from), target.to);
}

interface Disagreement {
  doc: string;
  step: number;
  anchor: number;
  head: number;
  prevHead: number;
  against: "legacy" | "fresh";
  got: unknown;
  want: unknown;
}

interface WalkRun {
  disagreements: Disagreement[];
  stats: { steps: number; reused: number; relocated: number; range: number; eligible: number };
}

let walkRun: WalkRun | null = null;

/** A state at `doc`/`selection` whose field was created over a complete tree. */
function completeState(doc: string | Text, selection: EditorSelection | { anchor: number }) {
  return completeTreeState(doc, selection, LANGUAGE, DETECTION);
}

/** Every document walked once; memoised so both REUSE-1 cases share it. */
function walk(): WalkRun {
  if (walkRun) return walkRun;
  const docs: [string, string][] = [
    ...makeCorpus(SEED, CORPUS_COUNT).map((d): [string, string] => [`corpus#${d.index}`, d.source]),
    ...WALK_FIXTURES,
  ];
  const disagreements: Disagreement[] = [];
  const stats = { steps: 0, reused: 0, relocated: 0, range: 0, eligible: 0 };

  docs.forEach(([id, doc], docIndex) => {
    const rnd = mulberry32(SEED ^ (0xd12 + docIndex));
    // Walk from a complete tree too. Selection-only transactions never
    // advance the parse, so a partial start tree would persist for the
    // whole walk and disagree with the complete-tree fresh state.
    let s = completeState(doc, { anchor: 0 });
    for (let step = 0; step < STEPS; step += 1) {
      const prev: SelectionRange = s.selection.main;
      const prevSpan = getTableContext(s);
      const target = drawTarget(s, rnd);
      const sel = rnd() < P_EXTEND ? { anchor: prev.anchor, head: target } : { anchor: target };

      locateSpy.mockClear();
      const next = s.update({ selection: sel }).state;
      const located = locateSpy.mock.calls.length;

      const got = field(next);
      const { anchor, head } = next.selection.main;
      stats.steps += 1;
      if (located === 0 && got.span !== null) stats.reused += 1;
      if (located > 0) stats.relocated += 1;
      if (anchor !== head) stats.range += 1;
      // Informational only: steps the ADR-0043 D4 rule would allow to reuse.
      if (prevSpan?.delimiterIsCandidate) {
        const i = linesFromText(next.doc).lineIndexAt(head);
        if (i >= prevSpan.headerLine && i <= prevSpan.lastLine) stats.eligible += 1;
      }

      const want = legacyCursorOracle(next);
      const base = { doc: id, step, anchor, head, prevHead: prev.head };
      if (!isDeepStrictEqual(got, want)) {
        disagreements.push({ ...base, against: "legacy", got, want });
      }
      const fresh = field(completeState(next.doc, next.selection));
      if (!isDeepStrictEqual(got, fresh)) {
        disagreements.push({ ...base, against: "fresh", got, want: fresh });
      }
      s = next;
    }
  });
  walkRun = { disagreements, stats };
  return walkRun;
}

describe("D12 WI-6 — REUSE-1 seeded random walk", () => {
  it(
    "REUSE-1: the field equals the legacy oracle (and a fresh state) at every step",
    () => {
      const { disagreements } = walk();
      expect({ count: disagreements.length, first: disagreements.slice(0, 3) }).toEqual({
        count: 0,
        first: [],
      });
    },
    WALK_TIMEOUT_MS,
  );

  it(
    "REUSE-1: non-vacuity — >=1,000 reused, >=1,000 re-located, >=500 range steps",
    () => {
      const { stats } = walk();
      const measured = `measured ${JSON.stringify(stats)}`;
      expect(stats.reused, measured).toBeGreaterThanOrEqual(MIN_REUSED);
      expect(stats.relocated, measured).toBeGreaterThanOrEqual(MIN_RELOCATED);
      expect(stats.range, measured).toBeGreaterThanOrEqual(MIN_RANGE);
    },
    WALK_TIMEOUT_MS,
  );
});

const SWEEP_FIXTURES: [string, string][] = [
  ["NEP", F.NEP],
  ["NEP_EOF", F.NEP_EOF],
  ["M1_NEP", F.M1_NEP],
  ["M1_PIPED", F.M1_PIPED],
  ["M1_BLANK", F.M1_BLANK],
  ["PIPELESS", F.PIPELESS],
  ["PIPELESS_CHAIN", F.PIPELESS_CHAIN],
  ["PIPED_DELIM", F.PIPED_DELIM],
];

describe("D12 WI-6 — REUSE-2 forward and reverse every-offset sweeps (S9)", () => {
  it.each(SWEEP_FIXTURES)("REUSE-2 %s: equal to the oracle at every offset, both ways", (_n, doc) => {
    let s = EditorState.create({ doc, selection: { anchor: 0 }, extensions: EXTENSIONS });
    const len = s.doc.length;
    const order = [
      ...Array.from({ length: len + 1 }, (_, o) => o),
      ...Array.from({ length: len + 1 }, (_, o) => len - o),
    ];
    const bad: { step: number; offset: number; got: unknown; want: unknown }[] = [];
    order.forEach((offset, step) => {
      s = s.update({ selection: { anchor: offset } }).state;
      const got = field(s);
      const want = legacyCursorOracle(s);
      if (!isDeepStrictEqual(got, want)) bad.push({ step, offset, got, want });
    });
    expect({ count: bad.length, first: bad.slice(0, 3) }).toEqual({ count: 0, first: [] });
  });
});
