/**
 * D41 WI-4 — the Tab classifier's cost contract (ADR-0043 / E39): counted
 * parse and locate calls, and rope safety, on documents with a 2000-line
 * prefix so a whole-document copy would show up as a call or as a slice wider
 * than the table.
 *
 *  - COST-1: prose head, no table line → 0 parse, 0 locate, no rope reads that
 *    copy (`toString`, `toJSON`, `iter*`, `sliceString` all 0); falls through.
 *  - COST-2: head in a table → exactly one `parseTableAtLine(_, 2001)`, 0 locate.
 *  - COST-3: prose → prose across one table → 0 parse, exactly 1 locate, swallow.
 *  - COST-4: 2000 pipe-prose lines selected → ≤ 1 locate, 0 parse, falls through.
 *  - COST-5 (WI-0 finding, CHAR): 1000 pipe-prose lines then P2 — one candidate
 *    run, so no table — → exactly 1 locate, 0 parse, falls through.
 *
 * Passthrough spies only (the real parser runs). Intra-module calls inside
 * `locate.ts` are not intercepted, so the detection field's own
 * `locateTableAtOffset` is not counted. Matrix
 * `.claude/tdd-guardian/tests-20261002-D41.md`, C2-COST-1..5.
 */
import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { D12_FIXTURES, ropeSpy } from "./support/tableSpanOracle";

vi.mock("../src/utils/tableParser/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/parse")>();
  return { ...actual, parseTableAtLine: vi.fn(actual.parseTableAtLine) };
});
vi.mock("../src/utils/tableParser/locate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/locate")>();
  return { ...actual, locateTableAtLine: vi.fn(actual.locateTableAtLine) };
});

const { parseTableAtLine } = await import("../src/utils/tableParser/parse");
const { locateTableAtLine } = await import("../src/utils/tableParser/locate");
const { tableTabCommand } = await import("../src/plugins/codemirror/sourceTableTabNav");
const { tableDetectionExtension } = await import("../src/plugins/codemirror/sourceTableDetection");

const { T3, P2 } = D12_FIXTURES;
const D = "intro\n\n" + T3 + "\noutro\n";
const PFX = "para\n".repeat(2000) + "\n";

interface Measured {
  handled: boolean;
  docSame: boolean;
  ranges: Array<{ anchor: number; head: number }>;
  parse: number[];
  locate: number;
  toString: number;
  toJSON: number;
  iters: number;
  slices: number;
  maxSlice: number;
}

function measure(doc: string, anchor: number, head = anchor): Measured {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [markdown(), tableDetectionExtension()],
    }),
  });
  const before = view.state.doc;
  const spy = ropeSpy(before);
  vi.mocked(parseTableAtLine).mockClear();
  vi.mocked(locateTableAtLine).mockClear();
  spy.reset();
  const handled = tableTabCommand(view);
  const c = spy.counts();
  const json = spy.toJSONCalls();
  const sliceArgs = spy.sliceArgs();
  const parse = vi.mocked(parseTableAtLine).mock.calls.map(([, l]) => l);
  const locate = vi.mocked(locateTableAtLine).mock.calls.length;
  spy.restore();
  const out: Measured = {
    handled,
    docSame: view.state.doc === before,
    ranges: view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
    parse,
    locate,
    toString: c.toString,
    toJSON: json,
    iters: c.iter + c.iterLines + c.iterRange,
    slices: sliceArgs.length,
    maxSlice: Math.max(0, ...sliceArgs.map(([a, b]) => b - a)),
  };
  view.destroy();
  return out;
}

describe("D41 WI-4 — classifier cost (COST-1..5)", () => {
  it("C2-COST-1: a prose head with no table line reads nothing and falls through", () => {
    const m = measure("para\n".repeat(2000) + "Just prose.\n", 10005);
    expect(m).toEqual({
      handled: false,
      docSame: true,
      ranges: [{ anchor: 10005, head: 10005 }],
      parse: [],
      locate: 0,
      toString: 0,
      toJSON: 0,
      iters: 0,
      slices: 0,
      maxSlice: 0,
    });
  });

  it("C2-COST-2: a table head parses its own line once and locates nothing", () => {
    const m = measure(PFX + T3, 10003);
    expect({ handled: m.handled, head: m.ranges, parse: m.parse, locate: m.locate }).toEqual({
      handled: true,
      head: [{ anchor: 10006, head: 10006 }],
      parse: [2001],
      locate: 0,
    });
    expect({ toString: m.toString, toJSON: m.toJSON }).toEqual({ toString: 0, toJSON: 0 });
    expect(m.maxSlice).toBeLessThanOrEqual(55);
  });

  it("C2-COST-3: prose → prose across one table locates once, parses nothing, swallows", () => {
    const m = measure(PFX + D, 10003, 10067);
    expect({ handled: m.handled, docSame: m.docSame, ranges: m.ranges, parse: m.parse, locate: m.locate }).toEqual({
      handled: true,
      docSame: true,
      ranges: [{ anchor: 10003, head: 10067 }],
      parse: [],
      locate: 1,
    });
    expect({ toString: m.toString, toJSON: m.toJSON }).toEqual({ toString: 0, toJSON: 0 });
    expect(m.maxSlice).toBeLessThanOrEqual(55);
  });

  it("C2-COST-4: 2000 selected pipe-prose lines cost at most one locate and no slice", () => {
    const doc = "a | b\n".repeat(2000);
    const m = measure(doc, 0, 12000);
    expect(m.locate).toBeLessThanOrEqual(1);
    expect({ handled: m.handled, docSame: m.docSame, parse: m.parse }).toEqual({
      handled: false,
      docSame: true,
      parse: [],
    });
    expect({ toString: m.toString, toJSON: m.toJSON, slices: m.slices }).toEqual({
      toString: 0,
      toJSON: 0,
      slices: 0,
    });
  });

  it("C2-COST-5 (CHAR): a table at the end of a pipe-prose run is one run, one locate, no table", () => {
    const doc = "x | y\n".repeat(1000) + P2;
    expect(doc.length).toBe(6030);
    const m = measure(doc, 0, 6030);
    expect({ handled: m.handled, docSame: m.docSame, parse: m.parse, locate: m.locate }).toEqual({
      handled: false,
      docSame: true,
      parse: [],
      locate: 1,
    });
    expect({ toString: m.toString, toJSON: m.toJSON }).toEqual({ toString: 0, toJSON: 0 });
    expect(m.maxSlice).toBeLessThanOrEqual(29);
  });
});
