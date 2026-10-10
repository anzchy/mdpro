/**
 * D64 WI-2 (ADR-0067 Decision 1, 2): `widenMdastTables` widens every GFM mdast table
 * to its widest row, pads at the row END with empty `tableCell`s (header included),
 * and extends `table.align` with explicit `null`. `widenRows` is the shared core it
 * and `widenTable` both use.
 *
 * The ragged mdast comes from a REAL remark parse: the `remarkCtx` processor of a
 * Milkdown editor built with commonmark + gfm only (no transformer registered), and
 * `parse` alone, which runs no transformers. Nothing here reaches Tauri.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultValueCtx, Editor, remarkCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { widenMdastTables } from "../src/plugins/milkdown/table/raggedTableWiden";
import { widenRows } from "../src/utils/tableWiden";
import type { ColumnAlignment } from "../src/utils/tableParser";
import { mulberry32 } from "./support/tableCorpus";

interface MNode {
  type: string;
  value?: string;
  align?: ColumnAlignment[];
  children?: MNode[];
}

let editor: Editor;
let parse: (md: string) => MNode;

beforeAll(async () => {
  const root = document.body.appendChild(document.createElement("div"));
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, "");
    })
    .use(commonmark)
    .use(gfm)
    .create();
  parse = (md) => editor.action((ctx) => ctx.get(remarkCtx).parse(md)) as unknown as MNode;
});
afterAll(async () => {
  await editor.destroy();
  document.body.innerHTML = "";
});

const textOf = (n: MNode): string =>
  n.value ?? (n.children ?? []).map(textOf).join("");

function tablesIn(n: MNode): MNode[] {
  if (n.type === "table") return [n];
  return (n.children ?? []).flatMap(tablesIn);
}

const cellsOf = (table: MNode): string[][] =>
  (table.children ?? []).map((row) => (row.children ?? []).map(textOf));

/** Parse, widen in place, and return the single table. */
function widened(md: string): MNode {
  const tree = parse(md);
  widenMdastTables(tree);
  const tables = tablesIn(tree);
  expect(tables).toHaveLength(1);
  return tables[0];
}

describe("widenMdastTables on real remark-gfm trees", () => {
  it("M-1 overflow: the header widens and the overflow cell keeps its column", () => {
    const t = widened("| a | b |\n|---|---|\n| c | d | e |\n");
    expect(cellsOf(t)).toEqual([["a", "b", ""], ["c", "d", "e"]]);
    expect(t.align).toStrictEqual([null, null, null]);
  });

  it("M-2 short rows are padded at the END; existing alignments are kept", () => {
    const t = widened("| a | b | c |\n|---|:-:|--:|\n| x |\n| y | z |\n");
    expect(cellsOf(t)).toEqual([["a", "b", "c"], ["x", "", ""], ["y", "z", ""]]);
    expect(t.align).toStrictEqual([null, "center", "right"]);
  });

  it("M-3 padding cells are empty tableCells appended after the original cells", () => {
    const t = widened("| a | b |\n|---|---|\n| c | d | e | f |\n");
    const header = t.children![0].children!;
    expect(header.map((c) => c.type)).toEqual(["tableCell", "tableCell", "tableCell", "tableCell"]);
    expect(header.slice(2)).toEqual([
      { type: "tableCell", children: [] },
      { type: "tableCell", children: [] },
    ]);
    expect(cellsOf(t)[1]).toEqual(["c", "d", "e", "f"]);
  });

  it("M-4 a blank overflow cell still counts as a column", () => {
    const t = widened("| a | b |\n|---|---|\n| c | d |  |\n");
    expect(cellsOf(t)).toEqual([["a", "b", ""], ["c", "d", ""]]);
    expect(t.align).toStrictEqual([null, null, null]);
  });

  it("M-5 a ragged table inside a blockquote is widened", () => {
    const t = widened("> | a | b |\n> |---|---|\n> | c | d | e |\n");
    expect(cellsOf(t)).toEqual([["a", "b", ""], ["c", "d", "e"]]);
    expect(t.align).toStrictEqual([null, null, null]);
  });

  it("M-6 a ragged table inside a list item is widened", () => {
    const t = widened("- item\n\n  | a | b |\n  |---|---|\n  | c | d | e |\n");
    expect(cellsOf(t)).toEqual([["a", "b", ""], ["c", "d", "e"]]);
  });

  it("M-6b every table in a document is widened, top-level and nested", () => {
    const tree = parse(
      "| a |\n|---|\n| b | c |\n\n> | d |\n> |---|\n> | e | f |\n\n- x\n\n  > | g |\n  > |---|\n  > | h | i |\n",
    );
    widenMdastTables(tree);
    const tables = tablesIn(tree);
    expect(tables.map(cellsOf)).toEqual([
      [["a", ""], ["b", "c"]],
      [["d", ""], ["e", "f"]],
      [["g", ""], ["h", "i"]],
    ]);
  });

  it("M-7 an escaped pipe stays inside its cell and does not count as a column", () => {
    const t = widened("| a \\| b | c |\n|---|---|\n| x | y \\| z | w |\n");
    expect(cellsOf(t)).toEqual([["a | b", "c", ""], ["x", "y | z", "w"]]);
  });

  it("M-8 CJK content keeps its cells and order", () => {
    const t = widened("| 名称 | 值 |\n|---|---|\n| 甲 | 乙 | 丙 |\n| 丁 |\n");
    expect(cellsOf(t)).toEqual([["名称", "值", ""], ["甲", "乙", "丙"], ["丁", "", ""]]);
  });

  it("M-9 added alignments are explicit null entries, never holes or undefined", () => {
    const t = widened("| a |\n|:-:|\n| b | c | d |\n");
    expect(t.align).toHaveLength(3);
    expect(Object.keys(t.align!)).toEqual(["0", "1", "2"]);
    expect(t.align).toStrictEqual(["center", null, null]);
  });

  it("M-10 a rectangular table and non-table content are left exactly as parsed", () => {
    const md = "# T\n\n| a | b |\n|:--|--:|\n| c | d |\n\n> quote\n";
    const tree = parse(md);
    const before = JSON.parse(JSON.stringify(tree));
    widenMdastTables(tree);
    expect(tree).toEqual(before);
  });
});

/** A random ragged mdast table: 1-6 rows of 1-6 cells, align as long as the header. */
function randomTable(next: () => number): MNode {
  const pick = (n: number) => Math.floor(next() * n);
  const aligns: ColumnAlignment[] = [null, "left", "center", "right"];
  const rows: MNode[] = Array.from({ length: 1 + pick(6) }, (_, r) => ({
    type: "tableRow",
    children: Array.from({ length: 1 + pick(6) }, (_, c) => ({
      type: "tableCell",
      children: pick(4) === 0 ? [] : [{ type: "text", value: `r${r}c${c}` }],
    })),
  }));
  const align = rows[0].children!.map(() => aligns[pick(4)]);
  return { type: "table", align, children: rows };
}

describe("widenMdastTables on very large trees", () => {
  it("M-11 a root with 300 000 children does not overflow the stack (no argument spread)", () => {
    const children = Array.from({ length: 300_000 }, () => ({ type: "paragraph", children: [] }));
    const table = {
      type: "table",
      align: [null],
      children: [
        { type: "tableRow", children: [{ type: "tableCell", children: [] }] },
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [] },
            { type: "tableCell", children: [] },
          ],
        },
      ],
    };
    const tree = { type: "root", children: [...children, table] };
    expect(() => widenMdastTables(tree)).not.toThrow();
    expect(table.children[0].children).toHaveLength(2);
    expect(table.align).toEqual([null, null]);
  });
});

describe("laws over generated tables", () => {
  const SEED = 0x0d64_0002;
  const CASES = 400;

  it("M-P1 rectangular at the widest width, original cells a prefix, align extended with null", () => {
    const next = mulberry32(SEED);
    for (let i = 0; i < CASES; i += 1) {
      const input = randomTable(next);
      const original = JSON.parse(JSON.stringify(input)) as MNode;
      const tree: MNode = { type: "root", children: [{ type: "blockquote", children: [input] }] };
      widenMdastTables(tree);
      const width = Math.max(original.align!.length, ...original.children!.map((r) => r.children!.length));
      expect(input.align).toStrictEqual([
        ...original.align!,
        ...Array(width - original.align!.length).fill(null),
      ]);
      input.children!.forEach((row, r) => {
        const before = original.children![r].children!;
        expect(row.children).toHaveLength(width);
        expect(row.children!.slice(0, before.length)).toEqual(before);
        for (const pad of row.children!.slice(before.length)) {
          expect(pad).toEqual({ type: "tableCell", children: [] });
        }
      });
    }
  });

  it("M-P2 idempotent: widening a widened tree changes nothing", () => {
    const next = mulberry32(SEED + 1);
    for (let i = 0; i < CASES; i += 1) {
      const tree: MNode = { type: "root", children: [randomTable(next), randomTable(next)] };
      widenMdastTables(tree);
      const once = JSON.parse(JSON.stringify(tree));
      widenMdastTables(tree);
      expect(tree).toEqual(once);
    }
  });

  it("C-P1 widenRows: rectangular, prefix-preserving, null-extended, on any cell type", () => {
    const next = mulberry32(SEED + 2);
    for (let i = 0; i < CASES; i += 1) {
      const rows = Array.from({ length: Math.floor(next() * 5) }, () =>
        Array.from({ length: Math.floor(next() * 6) }, () => Math.floor(next() * 100)),
      );
      const align: ColumnAlignment[] = Array.from({ length: Math.floor(next() * 4) }, () => "left");
      const copy = rows.map((r) => [...r]);
      const alignCopy = [...align];
      const width = rows.reduce((m, r) => Math.max(m, r.length), align.length);
      const out = widenRows(rows, align, () => -1);
      expect(out.alignments).toStrictEqual([...align, ...Array(width - align.length).fill(null)]);
      expect(out.rows).toHaveLength(copy.length);
      out.rows.forEach((row, r) => {
        expect(row).toEqual([...copy[r], ...Array(width - copy[r].length).fill(-1)]);
      });
      expect(align).toEqual(alignCopy); // input alignments not mutated
    }
  });

  it("C-1 widenRows on an empty row list keeps the alignment width", () => {
    expect(widenRows<string>([], ["left", null], () => "")).toEqual({ rows: [], alignments: ["left", null] });
  });

  it("C-2 widenRows does not mutate the caller's alignment array", () => {
    const align: ColumnAlignment[] = ["center"];
    widenRows([["a", "b"]], align, () => "");
    expect(align).toEqual(["center"]);
  });
});
