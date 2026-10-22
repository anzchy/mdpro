// @vitest-environment node
/**
 * D162-WI-3, upstream bug (a): prosemirror-tables 1.8.5 `clipCells` shrinks a
 * cell that sticks out below the new height to `max(1, newHeight - rowspan)`
 * rows instead of the `newHeight - row` rows it has left
 * (dist/index.js `clipCells`, the `height != newHeight` branch). A span from row
 * 0 of 5 rows clipped to 2 rows becomes 1 row, so row 1 is missing a cell; a
 * repeated row near the bottom keeps a span that runs past the last row.
 *
 * Called directly, with no editor: this is the reproduction that fails on an
 * unpatched 1.8.5 and passes on `patches/prosemirror-tables@1.8.5.patch`
 * (ADR-0082). The selection bug (b) has its own file.
 *
 * Law: for every clip height, every clipped cell ends at or above the last row,
 * and the clipped rows form a sound `width` × `newHeight` table.
 */
import { describe, expect, it } from "vitest";
import { __clipCells, TableMap } from "@milkdown/kit/prose/tables";
import { cell, problemsOf, row, schema } from "./support/upstreamTableSchema";
import { collectionCases } from "./support/collectionCases";

type Cells = Parameters<typeof __clipCells>[0];

/** `pastedCells`' shape for an overlong span: A spans all `height` rows. */
function leftSpan(height: number): Cells {
  const rows = [row(cell("A", height), cell("B"))];
  for (let r = 1; r < height; r += 1) rows.push(row(cell(`c${r}`)));
  return { width: 2, height, rows };
}

/** The same with the span in the right column. */
function rightSpan(height: number): Cells {
  const rows = [row(cell("B"), cell("A", height))];
  for (let r = 1; r < height; r += 1) rows.push(row(cell(`c${r}`)));
  return { width: 2, height, rows };
}

/** A two-row source with a 2-row span, repeated when clipped taller. */
const shortSpan = (): Cells => ({ width: 2, height: 2, rows: [row(cell("A", 2), cell("B")), row(cell("C"))] });

/** Assert the law: every span ends by the last row, and the table is sound and full. */
function expectSound(out: Cells, width: number, height: number): void {
  expect(out.height).toBe(height);
  expect(out.rows).toHaveLength(height);
  out.rows.forEach((frag, r) => {
    frag.forEach((c) => expect(r + (c.attrs.rowspan as number)).toBeLessThanOrEqual(height));
  });
  expect(problemsOf(out.rows)).toBeNull();
  const table = schema.nodes.table.create(
    null,
    out.rows.map((r) => schema.nodes.table_row.create(null, r)),
  );
  const map = TableMap.get(table);
  expect({ width: map.width, height: map.height }).toEqual({ width, height });
}

describe("D162-WI-3 upstream (a) — clipCells keeps a clipped span's remaining rows", () => {
  it("a 5-row span from row 0 clipped to 2 rows spans 2 rows, and row 1 keeps its cell", () => {
    const out = __clipCells(leftSpan(5), 2, 2);
    expect(out.rows[0].child(0).textContent).toBe("A");
    expect(out.rows[0].child(0).attrs.rowspan).toBe(2);
    expect(out.rows[1].childCount).toBe(1);
    expectSound(out, 2, 2);
  });

  for (const [name, make] of [
    ["left", leftSpan],
    ["right", rightSpan],
  ] as const) {
  for (const height of [2, 3, 4, 5, 6]) {
      for (const newHeight of collectionCases("clip height", Array.from({ length: height - 1 }, (_, i) => i + 1))) {
        it(`${name} span of ${height} clipped to ${newHeight}: the span keeps ${newHeight} rows, the table is sound`, () => {
          const out = __clipCells(make(height), 2, newHeight);
          const a = out.rows[0].child(name === "left" ? 0 : 1);
          expect(a.textContent).toBe("A");
          expect(a.attrs.rowspan).toBe(newHeight);
          expectSound(out, 2, newHeight);
        });
      }
    }
  }

  for (const newHeight of [3, 4, 5, 6, 7]) {
    it(`a repeated 2-row span over ${newHeight} rows ends by the last row`, () => {
      const out = __clipCells(shortSpan(), 2, newHeight);
      expectSound(out, 2, newHeight);
      const spans = out.rows.map((r) => r.child(0).attrs.rowspan as number);
      // Row r starts an A on even rows: 2 rows, or what is left at the bottom.
      out.rows.forEach((_, r) => {
        if (r % 2 === 0) expect(spans[r]).toBe(Math.min(2, newHeight - r));
      });
    });
  }

  it("a span that fits is left as it is", () => {
    const src = leftSpan(3);
    const out = __clipCells(src, 2, 3);
    expect(out.rows).toBe(src.rows);
    expect(out.rows[0].child(0).attrs.rowspan).toBe(3);
  });
});
