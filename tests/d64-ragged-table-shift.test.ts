/**
 * D64 (ADR-0067 Decisions 1, 2, 5): ragged GFM tables are rectangular from the moment
 * they load into WYSIWYG, so a whole-document `replaceAll` (the MCP table path) or a
 * keystroke inside a ragged table never lets prosemirror-tables' `fixTables` pad at
 * the row START.
 *
 * Converted from the D64 diagnostic, which asserted the buggy `| <br /> | e | f | X1a |`.
 * Real Milkdown (commonmark + gfm + the exported `tableParityPlugins` that
 * MilkdownEditor.tsx registers + history), real stores, real `processTableActionEvent`.
 * Only the Tauri core boundary is mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { processTableActionEvent } from "../src/hooks/mcpTableAction";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { findAllTables } from "../src/utils/cursorSync/table";
import { widenTable } from "../src/utils/tableWiden";
import type { Editor } from "@milkdown/kit/core";
import {
  FIXTURE,
  FIXTURE_TAIL_WIDE,
  T1_CELLS,
  destroyParityEditors,
  docOf,
  fromT1,
  mountParityEditor,
  serialize,
  tWide,
  tableShapes,
  typeAfter,
  typeAtDocEnd,
} from "./support/raggedTableD64";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

/** A short body row between a full header and a full row. */
const SHORT = "| a | b | c |\n|---|---|---|\n| x |\n| y | z | w |\n\nend\n";
const SHORT_CELLS = [
  ["a", "b", "c"],
  ["x", "", ""],
  ["y", "z", "w"],
];

afterEach(destroyParityEditors);

function bindStores(e: Editor): void {
  useDocumentStore.setState({
    documents: [
      { id: "doc-a", path: null, content: FIXTURE, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null },
    ],
    activeDocumentId: "doc-a",
  } as never);
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null } as never);
  useMilkdownEditorStore.setState({ getEditor: () => e, flushers: {}, editorGenerations: {} } as never);
}

function mcpSetCell(payload: Record<string, unknown>): void {
  processTableActionEvent(
    { document_id: "doc-a", action: "set_cell", payload, window_label: null },
    {
      currentWindowLabel: "main",
      updateDocumentContent: (id, c) => useDocumentStore.getState().updateDocumentContent(id, c),
    },
  );
}

/** Replace one cell of a matrix copy. */
function withCell(cells: string[][], r: number, c: number, text: string): string[][] {
  return cells.map((row, i) => row.map((v, j) => (i === r && j === c ? text : v)));
}

describe("D64 load: ragged tables are rectangular before any transaction", () => {
  it("L-1 every fixture table has a problem-free TableMap, padded at the row end", async () => {
    const e = await mountParityEditor(FIXTURE);
    const shapes = tableShapes(docOf(e));
    expect(shapes).toHaveLength(4);
    for (const s of shapes) expect(s.problems).toBeNull();
    expect(shapes[0].cells).toEqual([["n1", "n2"], ["a", "b"], ["c", "d"]]);
    for (const n of [1, 2, 3]) {
      expect(shapes[n].width).toBe(4);
      expect(shapes[n].cells).toEqual(T1_CELLS.map((row) => row.map((v) => v.replace("X1", `X${n}`))));
    }
  });

  it("L-2 the load baseline already is the widened text (no <br />, no added :---)", async () => {
    const e = await mountParityEditor(FIXTURE);
    const md = serialize(e);
    expect(fromT1(md)).toBe(FIXTURE_TAIL_WIDE);
    expect(md).not.toContain("<br />");
    expect(md).not.toMatch(/:-/);
  });
});

describe("D64 MCP repro: a set_cell in WYSIWYG leaves other ragged tables byte-identical", () => {
  it("D64-1 set_cell on T0 changes T0 only; T1-T3 serialize exactly as before", async () => {
    const e = await mountParityEditor(FIXTURE);
    bindStores(e);
    const before = serialize(e);
    mcpSetCell({ tableIndex: 0, row: 1, col: 1, content: "R1" });
    const after = serialize(e);
    expect(fromT1(after)).toBe(fromT1(before));
    expect(fromT1(after)).toBe(FIXTURE_TAIL_WIDE);
    expect(after).toContain("| a  | R1 |");
    expect(after).not.toContain("<br />");
    expect(after).not.toMatch(/:-/);
    for (const s of tableShapes(docOf(e))) expect(s.problems).toBeNull();
  });

  // D64-2 (policy: changed assertion with a stated reason, approved by the user
  // 2026-10-10 「改成断言拒绝 (Recommended)」). At red it expected set_cell at col 2
  // to edit T1. ADR-0064 A1 bounds MCP `col` by the header width of the STORED
  // Markdown, and loading writes nothing to the store (ADR-0067), so the store's
  // T1 header is still 2 wide and col 2 is refused as an invalid payload. The
  // claim is now the refusal: nothing changes, in the editor or the store.
  // D64-2b makes the original in-place claim at an addressable column.
  it("D64-2 set_cell past T1's stored header width is refused and changes nothing", async () => {
    const e = await mountParityEditor(FIXTURE);
    bindStores(e);
    const before = serialize(e);
    const storedBefore = useDocumentStore.getState().documents[0].content;
    mcpSetCell({ tableIndex: 1, row: 1, col: 2, content: "Y1" });
    const shapes = tableShapes(docOf(e));
    for (const s of shapes) expect(s.problems).toBeNull();
    expect(shapes[1].cells).toEqual(T1_CELLS);
    expect(serialize(e)).toBe(before);
    expect(useDocumentStore.getState().documents[0].content).toBe(storedBefore);
  });
  it("D64-2b set_cell on ragged T1 col 1 edits that cell in place and leaves T2/T3 alone", async () => {
    const e = await mountParityEditor(FIXTURE);
    bindStores(e);
    const before = serialize(e);
    mcpSetCell({ tableIndex: 1, row: 1, col: 1, content: "Y1" });
    const shapes = tableShapes(docOf(e));
    for (const s of shapes) expect(s.problems).toBeNull();
    expect(shapes[1].cells).toEqual(withCell(T1_CELLS, 1, 1, "Y1"));
    const after = serialize(e);
    const tail = (md: string) => md.slice(md.indexOf("## T2 wide"));
    expect(tail(after)).toBe(tail(before));
    expect(after).not.toContain("<br />");
    expect(after).not.toMatch(/:-/);
    const stored = findAllTables(useDocumentStore.getState().documents[0].content)[1];
    expect(widenTable(stored).rows).toEqual(withCell(T1_CELLS, 1, 1, "Y1"));
  });
});

describe("D64 typing inside and outside each ragged shape does not move cells", () => {
  const overflowCases: Array<[string, string, number, number]> = [
    ["the overflow cell", "X1a", 1, 2],
    ["the short header", "h1", 0, 0],
    ["the full row", "X1c", 2, 3],
  ];
  for (const [label, needle, r, c] of overflowCases) {
    it(`TY-O typing in ${label} of T1 keeps every cell in its column`, async () => {
      const e = await mountParityEditor(FIXTURE);
      typeAfter(e, needle, "!");
      const shapes = tableShapes(docOf(e));
      expect(shapes[1].problems).toBeNull();
      expect(shapes[1].cells).toEqual(withCell(T1_CELLS, r, c, `${needle}!`));
      const md = serialize(e);
      expect(md).toContain(`## T2 wide\n\n${tWide(2)}\n`);
      expect(md).toContain(`## T3 wide\n\n${tWide(3)}\n`);
      expect(md).not.toContain("<br />");
      expect(md).not.toMatch(/:-/);
    });
  }

  it("TY-O typing outside every table leaves T1-T3 as the widened text", async () => {
    const e = await mountParityEditor(FIXTURE);
    typeAtDocEnd(e, "kq1");
    expect(fromT1(serialize(e))).toBe(FIXTURE_TAIL_WIDE.replace("Last line.", "Last line.kq1"));
  });

  const shortCases: Array<[string, string, number, number]> = [
    ["the short row", "x", 1, 0],
    ["the header", "a", 0, 0],
    ["the full row", "w", 2, 2],
  ];
  for (const [label, needle, r, c] of shortCases) {
    it(`TY-S typing in ${label} of a short-row table keeps every cell in its column`, async () => {
      const e = await mountParityEditor(SHORT);
      typeAfter(e, needle, "!");
      const [shape] = tableShapes(docOf(e));
      expect(shape.problems).toBeNull();
      expect(shape.cells).toEqual(withCell(SHORT_CELLS, r, c, `${needle}!`));
      const md = serialize(e);
      expect(md).not.toContain("<br />");
      expect(md).not.toMatch(/:-/);
    });
  }

  it("TY-S typing outside a short-row table keeps it widened at the row end", async () => {
    const e = await mountParityEditor(SHORT);
    typeAtDocEnd(e, "Z");
    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.cells).toEqual(SHORT_CELLS);
    expect(serialize(e)).toBe("| a | b | c |\n| - | - | - |\n| x |   |   |\n| y | z | w |\n\nendZ\n");
  });
});
