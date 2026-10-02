/**
 * @module table-write-guard.test
 * Purpose: WI-C0 — the write-boundary backstop in
 * `src/utils/tableWriteGuard.ts` and its four call sites (plan
 * `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` §3.1 W1-W4).
 *
 * WHY THIS FILE DOES NOT STAGE THE §3.2 REPRODUCTION
 * --------------------------------------------------
 * §3.2 measured a real data-loss path: `delete_row(tableIndex: 0)` on
 * `"Intro\n\n| a |\n---\n\n| x | y |\n| - | - |\n| 1 | 2 |\n"` deleted a
 * setext H2, because the scanner enumerated a phantom table ahead of the
 * real one. WI-C1 / WI-C2 killed that at the source. Re-measured on
 * 2026-09-18 against `micromark-extension-gfm-table@2.1.2` (through
 * `remark-gfm@4.0.1`) over `makeCorpus(SEED, 200)` and
 * `makeOverlapCorpus(OVERLAP_SEED, 200)` — 400 documents, 208 models —
 * mdpro over-detects **zero** tables: not one model covers a byte GFM
 * considers non-table content, and the guard refuses **none** of the 208.
 * The residual disagreement is entirely under-detection, which cannot
 * cause a bad write.
 *
 * So the guard has no reachable defect to fix today, and a test that
 * fed the shipped scanner `docA` and expected a refusal would be
 * theatre — the scanner now returns one table there, correctly.
 * Instead:
 *
 *   1. The contract cases below call `refuseTableWrite` on models built
 *      by hand, which is what the function's input domain actually is.
 *   2. The four write-path cases make the SCANNER drift, by mocking the
 *      enumeration collaborator to hand a write path a phantom model.
 *      That is precisely the failure mode the guard is insurance
 *      against, and it is the only honest way to reach these branches
 *      now that the parser is narrowed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import {
  guardTableWrite,
  refuseTableWrite,
  type TableWriteRefusalReason,
} from "../src/utils/tableWriteGuard";
import { parseTableAt, type TableModel } from "../src/utils/tableParser";
import { loggingService } from "../src/services/loggingService";
import { tableDetectionExtension } from "../src/plugins/codemirror/sourceTableDetection";

// Passthrough mocks: the real implementation runs unless a case
// explicitly makes it drift.
vi.mock("../src/utils/cursorSync/table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/cursorSync/table")>();
  return { ...actual, findAllTables: vi.fn(actual.findAllTables) };
});
vi.mock("../src/utils/tableParser/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/parse")>();
  return {
    ...actual,
    parseTableAtOffset: vi.fn(actual.parseTableAtOffset),
    parseTableAtLine: vi.fn(actual.parseTableAtLine),
  };
});

const { findAllTables } = await import("../src/utils/cursorSync/table");
const { parseTableAtLine, parseTableAtOffset } = await import("../src/utils/tableParser/parse");
const { applyMcpTableAction, setCell } = await import("../src/utils/tableMcp");
const { formatAllTables } = await import("../src/utils/tableFormatter");
const { computeSourceTableContext, dispatchSourceTableAction } = await import(
  "../src/plugins/codemirror/sourceTableContextMenu"
);
const { tableShiftTabCommand, tableTabCommand } = await import(
  "../src/plugins/codemirror/sourceTableTabNav"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A hand-built model over `raw`. `rowCount` defaults to "lines minus the
 * delimiter row", matching what `parseTableAtLine` would produce. The
 * guard reads `raw`, `start`, `rowCount` and `colCount` only — `cells` /
 * `rows` stay empty unless a case needs them for the downstream edit.
 */
function modelOf(raw: string, over: Partial<TableModel> = {}): TableModel {
  return {
    start: 0,
    end: raw.length,
    rowCount: Math.max(raw.split("\n").length - 1, 1),
    colCount: 1,
    alignments: [null],
    cells: [],
    rows: [],
    raw,
    ...over,
  };
}

/** The §3.2 document, kept as the shape a drifting scanner would mis-read. */
const DOC_A = "Intro\n\n| a |\n---\n\n| x | y |\n| - | - |\n| 1 | 2 |\n";

/**
 * The exact phantom `findAllTables` used to emit for `DOC_A` before
 * WI-C1: `[7, 16)`, raw `"| a |\n---"`, one row, one column. Reproduced
 * here as a literal so these cases keep testing the guard even after the
 * scanner has been narrowed past ever producing it again.
 */
function docAPhantom(): TableModel {
  const cell = { start: 8, end: 11, text: "a", row: 0, col: 0 };
  return {
    start: 7,
    end: 16,
    rowCount: 1,
    colCount: 1,
    alignments: [null],
    cells: [cell],
    rows: [[cell]],
    raw: "| a |\n---",
  };
}

function refusalLogs(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map((c) => c[0] as { event: string; context?: Record<string, unknown> })
    .filter((p) => p.event === "ui.table.write_refused");
}

function spyOnLog() {
  return vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
}

function makeView(doc: string, cursor: number, detection = false): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: detection ? [markdown(), tableDetectionExtension()] : [markdown()],
    }),
  });
}

// ---------------------------------------------------------------------------
// 1. refuseTableWrite — the contract
// ---------------------------------------------------------------------------

describe("refuseTableWrite — models the scanner legitimately produces", () => {
  it("passes a plain multi-column table parsed from real source", () => {
    const model = parseTableAt("| a | b |\n| - | - |\n| 1 | 2 |\n", 0);
    expect(model).not.toBeNull();
    expect(refuseTableWrite(model!)).toBeNull();
  });

  it("passes a 3-space-indented table (the CommonMark boundary: 3 passes, 4 does not)", () => {
    const model = parseTableAt("   | a | b |\n   | - | - |\n   | 1 | 2 |\n", 0);
    expect(model).not.toBeNull();
    expect(refuseTableWrite(model!)).toBeNull();
  });

  it("passes a CRLF table — the CR must not be mistaken for content", () => {
    const model = parseTableAt("| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n", 0);
    expect(model).not.toBeNull();
    expect(refuseTableWrite(model!)).toBeNull();
  });

  /**
   * The over-correction guard. The plan's proposed condition was "the
   * model's delimiter row must itself be a candidate line" — but
   * `isTableCandidateLine` demands an unescaped `|`, and a single-column
   * delimiter may be spelled `:-:` with none. GFM calls this a table
   * (plan §5.2 shape A1) and the shipped scanner still parses it, so the
   * proposed condition would have refused edits to a real table.
   */
  it("passes a single-column `:-:` table whose delimiter carries no pipe", () => {
    const model = parseTableAt("| a |\n:-:\n| b |\n", 0);
    expect(model).not.toBeNull();
    expect(model!.raw).toContain(":-:");
    expect(refuseTableWrite(model!)).toBeNull();
  });
});

describe("refuseTableWrite — models a drifting scanner could produce", () => {
  const cases: [string, TableModel, TableWriteRefusalReason][] = [
    ["S1 setext: `---` under a single-column header", modelOf("| a |\n---"), "setext-underline"],
    ["S1′ longer underline", modelOf("| a |\n-----"), "setext-underline"],
    ["S1″ underline with trailing space", modelOf("| a |\n--- "), "setext-underline"],
    [
      "S2 delimiter indented 4 spaces",
      modelOf("| a | b |\n    | - | - |", { colCount: 2 }),
      "delimiter-indented",
    ],
    [
      "S2‴ delimiter indented 5 spaces",
      modelOf("| a | b |\n     | - | - |", { colCount: 2 }),
      "delimiter-indented",
    ],
    [
      "S3 tab-indented delimiter (a tab advances to column 4)",
      modelOf("| a | b |\n\t| - | - |", { colCount: 2 }),
      "delimiter-indented",
    ],
    [
      "S3′ tab-indented HEADER — the shape a delimiter-only check misses",
      modelOf("\t| a | b |\n| - | - |", { colCount: 2 }),
      "header-indented",
    ],
    [
      "header indented 4 spaces",
      modelOf("    | a | b |\n| - | - |", { colCount: 2 }),
      "header-indented",
    ],
    ["blank header", modelOf("\n| - |"), "header-not-candidate"],
    ["pipe-less header", modelOf("just prose\n| - |"), "header-not-candidate"],
    ["second line is prose, not a delimiter", modelOf("| a |\n| prose |"), "not-a-delimiter-row"],
    ["no delimiter row at all", modelOf("| a |"), "missing-delimiter-row"],
    [
      "body row that is not a table line",
      modelOf("| a |\n| - |\nplain prose", { rowCount: 2 }),
      "body-row-not-candidate",
    ],
    [
      "degenerate dimensions",
      modelOf("| a |\n| - |", { colCount: 0 }),
      "degenerate-dimensions",
    ],
  ];

  it.each(cases)("refuses %s", (_label, model, reason) => {
    expect(refuseTableWrite(model)).toBe(reason);
  });

  it("refuses the exact §3.2 phantom", () => {
    expect(refuseTableWrite(docAPhantom())).toBe("setext-underline");
  });
});

describe("guardTableWrite — logging contract", () => {
  it("returns true and logs nothing for a writable model", () => {
    const spy = spyOnLog();
    const model = parseTableAt("| a | b |\n| - | - |\n| 1 | 2 |\n", 0)!;
    expect(guardTableWrite(model, "mcp.set_cell")).toBe(true);
    expect(refusalLogs(spy)).toHaveLength(0);
  });

  it("returns false and logs offsets + reason, never cell text", () => {
    const spy = spyOnLog();
    expect(guardTableWrite(docAPhantom(), "format.all_tables")).toBe(false);
    const logs = refusalLogs(spy);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({
      controlId: "format.all_tables",
      reason: "setext-underline",
      start: 7,
      end: 16,
      rowCount: 1,
      colCount: 1,
    });
    // Rule 60: events carry no document content.
    expect(JSON.stringify(logs[0])).not.toContain("| a |");
  });
});

// ---------------------------------------------------------------------------
// 2. The four write paths (plan §3.1 W1-W4)
// ---------------------------------------------------------------------------

describe("W1 — MCP table actions refuse a phantom model", () => {
  const realTable = () => parseTableAt(DOC_A, DOC_A.indexOf("| x | y |") + 2)!;

  beforeEach(() => {
    vi.mocked(findAllTables).mockReturnValue([docAPhantom(), realTable()]);
  });

  it("set_cell(tableIndex 0) returns null instead of rewriting the setext heading", () => {
    const spy = spyOnLog();
    expect(
      setCell(DOC_A, { tableIndex: 0, row: 0, col: 0, content: "HACKED" }),
    ).toBeNull();
    expect(refusalLogs(spy)[0]?.context).toMatchObject({
      controlId: "mcp.set_cell",
      reason: "setext-underline",
    });
  });

  it("delete_row(tableIndex 0) returns null — §3.2's data-loss call", () => {
    const spy = spyOnLog();
    expect(
      applyMcpTableAction(DOC_A, "delete_row", { tableIndex: 0, index: 0 }),
    ).toBeNull();
    expect(refusalLogs(spy)[0]?.context).toMatchObject({
      controlId: "mcp.table_edit",
      reason: "setext-underline",
    });
  });

  it("still edits the REAL table at tableIndex 1 — the guard is not a blanket refusal", () => {
    const out = setCell(DOC_A, { tableIndex: 1, row: 0, col: 0, content: "EDITED" });
    expect(out).not.toBeNull();
    expect(out).toContain("EDITED");
    // The setext heading above it is untouched.
    expect(out!.slice(0, 16)).toBe(DOC_A.slice(0, 16));
  });
});

describe("W2 — formatAllTables skips a phantom instead of rewriting it", () => {
  it("leaves the phantom's bytes verbatim and still formats the real table", () => {
    const spy = spyOnLog();
    const realTable = parseTableAt(DOC_A, DOC_A.indexOf("| x | y |") + 2)!;
    vi.mocked(findAllTables).mockReturnValue([docAPhantom(), realTable]);

    const out = formatAllTables(DOC_A);

    // [7, 16) — `| a |\n---` — survives byte for byte.
    expect(out.slice(7, 16)).toBe("| a |\n---");
    expect(out.startsWith("Intro\n\n| a |\n---\n\n")).toBe(true);
    // The genuine table below it was still reformatted (padded columns).
    expect(out.slice(18)).toBe("| x   | y   |\n| --- | --- |\n| 1   | 2   |\n");
    expect(refusalLogs(spy)[0]?.context).toMatchObject({
      controlId: "format.all_tables",
      reason: "setext-underline",
    });
  });

  it("is a no-op on a document whose only table is a phantom", () => {
    const src = "| a |\n---\n| b |\n";
    vi.mocked(findAllTables).mockReturnValue([
      modelOf("| a |\n---\n| b |", { end: 15, rowCount: 2 }),
    ]);
    expect(formatAllTables(src)).toBe(src);
  });
});

describe("W3 — source-mode context menu refuses a phantom model", () => {
  it("does not open the menu over a phantom, and dispatch is a no-op", () => {
    const spy = spyOnLog();
    const view = makeView(DOC_A, 9);
    vi.mocked(parseTableAtOffset).mockReturnValue(docAPhantom());

    expect(computeSourceTableContext(view.state, 9)).toBeNull();
    expect(refusalLogs(spy)[0]?.context).toMatchObject({
      controlId: "source.context_menu",
      reason: "setext-underline",
    });

    vi.mocked(parseTableAtOffset).mockReturnValue(docAPhantom());
    expect(dispatchSourceTableAction(view, "delete_row", 9)).toBe(false);
    expect(view.state.doc.toString()).toBe(DOC_A);
  });

  it("still opens over a genuine table", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const view = makeView(md, 2);
    expect(computeSourceTableContext(view.state, 2)).not.toBeNull();
  });
});

describe("W4 — Tab navigation refuses a phantom model", () => {
  /*
   * D12 WI-4 (ADR-0043 Decision 5): Tab parses its own model per press.
   * D41 (plan-20261002-D41 WI-4): Tab gates on `hasTableDetection` and probes
   * the head's REAL line with `parseTableAtLine`, so the phantom is injected
   * there and the view needs the detection field (without it Tab falls
   * through and the guard is never reached). A refusal now SWALLOWS the key:
   * handled, nothing written, one `ui.table.tab_swallowed` per press.
   * Reason for editing this pinned test: the injection point and the
   * refusal policy moved (matrix "Commit 2 pin edits").
   */
  it("swallows the key and writes nothing", () => {
    const spy = spyOnLog();
    const view = makeView(DOC_A, 9, true);
    vi.mocked(parseTableAtLine).mockReturnValue(docAPhantom());

    expect(tableTabCommand(view)).toBe(true);
    expect(tableShiftTabCommand(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC_A);
    expect(view.state.selection.main.head).toBe(9);

    const logs = refusalLogs(spy);
    expect(logs).toHaveLength(2);
    expect(logs[0].context).toMatchObject({
      controlId: "source.tab_nav",
      reason: "setext-underline",
    });
    expect(logs[1].context).toMatchObject({
      controlId: "source.tab_nav",
      reason: "setext-underline",
    });
    const swallows = spy.mock.calls
      .map((c) => c[0] as { event: string; context?: Record<string, unknown> })
      .filter((p) => p.event === "ui.table.tab_swallowed");
    expect(swallows.map((p) => p.context?.reason)).toEqual(["guard-refused", "guard-refused"]);
    const atLine2 = vi.mocked(parseTableAtLine).mock.calls.filter(([, l]) => l === 2);
    expect(atLine2).toHaveLength(2);
  });

  it("still navigates inside a genuine table", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const view = makeView(md, 22, true);
    // The REAL parse (passthrough) feeds Tab.
    expect(tableTabCommand(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(25);
    expect(view.state.doc.toString()).toBe(md);
  });
});
