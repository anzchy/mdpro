/**
 * D94: a table-carrying drop at a table's INTERIOR BOUNDARY — between cells,
 * at a row edge, between rows, at the table's own content edges. D90 refused a
 * drop only when the insert position was strictly inside a cell; at these
 * positions `dropPoint` finds no place for the open slice (returns null), the
 * fallback pointer position is not in a cell, so the drop passed through and
 * prosemirror-view's `replaceRange` split the host table (3 tables) and
 * `serialize()` threw. Same inside a list item and a blockquote.
 *
 * Positions are derived from the document (every in-table, not-in-cell
 * position), never trusted from hard-coded numbers alone. Driver:
 * `tests/support/tableDropDriver.ts` (real prosemirror-view drop handler, only
 * `posAtCoords` stubbed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { loggingService } from "../src/services/loggingService";
import { useToastStore } from "../src/stores/toastStore";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  viewOf,
} from "./support/raggedTableD64";
import {
  DROP_TOAST,
  drop,
  HOST,
  inTableNonCellPositions,
  MIXED,
  TABLE,
} from "./support/tableDropDriver";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useToastStore.getState().clearToast();
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  useToastStore.getState().clearToast();
  await destroyParityEditors();
});

const dropLogs = () =>
  logSpy.mock.calls
    .map((c) => c[0] as { event: string; status: string })
    .filter((p) => p.event === "editor.table.drop");

const indent = (md: string, prefix: string) =>
  md
    .trimEnd()
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");

const IN_LIST = `- item\n\n${indent(HOST, "  ")}\n`;
const IN_QUOTE = `${indent(HOST, "> ")}\n`;

/** Names of `pos`'s ancestors, outermost first. */
function ancestors(e: Editor, pos: number): string[] {
  const $p = docOf(e).resolve(pos);
  return Array.from({ length: $p.depth + 1 }, (_, d) => $p.node(d).type.name);
}

/** Mount, drop MIXED at `pos`, and assert the drop was refused with no change. */
async function expectRefusedAt(md: string, pos: number): Promise<void> {
  const e = await mountParityEditor(md);
  const names = ancestors(e, pos);
  // Non-vacuous: the position is inside a table and not inside any cell.
  expect(names).toContain("table");
  expect(names).not.toContain("table_cell");
  expect(names).not.toContain("table_header");
  const before = docOf(e);
  const mdBefore = serialize(e);
  expect(drop(viewOf(e), pos, { html: MIXED })).toBe(true);
  expect(docOf(e).eq(before), `doc changed at ${pos}`).toBe(true);
  expect(tableShapes(docOf(e))).toHaveLength(1);
  expect(() => serialize(e)).not.toThrow();
  expect(serialize(e)).toBe(mdBefore);
  const logs = dropLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0].status).toBe("fail");
  expect(useToastStore.getState().message).toBe(DROP_TOAST);
  await destroyParityEditors();
  logSpy.mockClear();
  useToastStore.getState().clearToast();
}

describe("D94 — a mixed slice dropped at an in-table boundary is refused", () => {
  it("the five named boundary positions are in the table and not in a cell (guard)", async () => {
    const e = await mountParityEditor(HOST);
    const boundaries = inTableNonCellPositions(docOf(e));
    expect(boundaries).toEqual(expect.arrayContaining([8, 14, 15, 16, 22]));
  });

  it.each([
    ["D94-1", 8, "between header cells"],
    ["D94-2", 14, "end of the header row"],
    ["D94-3", 15, "between the rows"],
    ["D94-4", 16, "start of the body row"],
    ["D94-5", 22, "between body cells"],
  ])("%s: dropped at %i (%s) — unchanged, one table, serializes, logged, toasted", async (_id, pos) => {
    await expectRefusedAt(HOST, pos as number);
  });

  it("D94-1..5 sweep: every in-table non-cell position of the host is refused", async () => {
    const e = await mountParityEditor(HOST);
    const positions = inTableNonCellPositions(docOf(e));
    await destroyParityEditors();
    expect(positions.length).toBeGreaterThanOrEqual(9);
    for (const pos of positions) await expectRefusedAt(HOST, pos);
  });

  it("D94-6: a table inside a list item — every in-table non-cell position is refused", async () => {
    const e = await mountParityEditor(IN_LIST);
    const positions = inTableNonCellPositions(docOf(e));
    // The table really is nested in the list item.
    expect(ancestors(e, positions[0]).slice(0, 3)).toEqual(["doc", "bullet_list", "list_item"]);
    await destroyParityEditors();
    expect(positions.length).toBeGreaterThanOrEqual(9);
    for (const pos of positions) await expectRefusedAt(IN_LIST, pos);
  });

  it("D94-7: a table inside a blockquote — every in-table non-cell position is refused", async () => {
    const e = await mountParityEditor(IN_QUOTE);
    const positions = inTableNonCellPositions(docOf(e));
    expect(ancestors(e, positions[0]).slice(0, 2)).toEqual(["doc", "blockquote"]);
    await destroyParityEditors();
    expect(positions.length).toBeGreaterThanOrEqual(9);
    for (const pos of positions) await expectRefusedAt(IN_QUOTE, pos);
  });
});

describe("D94 — drops outside the host table, or relocated out of it, still land", () => {
  const AROUND = `Before\n\n${HOST}\nAfter\n`;

  it("D94-8: the doc-level positions just before and just after the host table are not refused", async () => {
    for (const edge of ["before", "after"] as const) {
      const e = await mountParityEditor(AROUND);
      const doc = docOf(e);
      const tablePos = doc.child(0).nodeSize;
      expect(doc.child(1).type.name).toBe("table");
      const pos = edge === "before" ? tablePos : tablePos + doc.child(1).nodeSize;
      expect(ancestors(e, pos)).toEqual(["doc"]);
      drop(viewOf(e), pos, { html: MIXED });
      expect(dropLogs()).toHaveLength(0);
      expect(useToastStore.getState().message).toBeNull();
      const cells = tableShapes(docOf(e)).map((s) => s.cells);
      expect(cells).toContainEqual([
        ["h1", "h2"],
        ["a", "b"],
      ]);
      expect(cells).toContainEqual([
        ["X1", "X2"],
        ["y1", "y2"],
      ]);
      expect(() => serialize(e)).not.toThrow();
      await destroyParityEditors();
    }
  });

  it("D94-9: a closed pure-table slice at a boundary is relocated beside the host and lands", async () => {
    const e = await mountParityEditor(HOST);
    drop(viewOf(e), 15, { html: TABLE });
    expect(dropLogs()).toHaveLength(0);
    const cells = tableShapes(docOf(e)).map((s) => s.cells);
    expect(cells).toHaveLength(2);
    expect(cells).toContainEqual([
      ["X1", "X2"],
      ["y1", "y2"],
    ]);
    expect(() => serialize(e)).not.toThrow();
  });
});
