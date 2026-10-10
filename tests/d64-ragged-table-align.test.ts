/**
 * D64 (ADR-0067 Decision 2): columns that parse-time widening adds carry an EXPLICIT
 * `null` alignment, so they serialize as `---`, never the schema default `:---`.
 *
 * Converted from the 2026-10-10 alignment probe. Real Milkdown (commonmark + gfm +
 * the exported `tableParityPlugins`). No mocks: nothing here reaches Tauri.
 *
 * Expected text is the serializer's own load baseline measured before the transformer
 * existed (probe run "no transformer"), which the ADR records as the correct widening.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  typeAfter,
  viewOf,
} from "./support/raggedTableD64";

const MD = "Para\n\n| a | b |\n|---|:-:|\n| g | h | Z |\n| x |\n";
const WIDE = "| a |  b  |   |\n| - | :-: | - |\n| g |  h  | Z |\n| x |     |   |\n";

afterEach(destroyParityEditors);

describe("D64 alignment of added columns", () => {
  it("A-1 every cell of the added column has alignment null, the centered column keeps center", async () => {
    const e = await mountParityEditor(MD);
    const [shape] = tableShapes(docOf(e));
    expect(shape.problems).toBeNull();
    expect(shape.cells).toEqual([["a", "b", ""], ["g", "h", "Z"], ["x", "", ""]]);
    expect(shape.align).toEqual([
      [null, "center", null],
      [null, "center", null],
      [null, "center", null],
    ]);
  });

  it("A-2 baseline and an edit outside the table both serialize the added column as ---", async () => {
    const e = await mountParityEditor(MD);
    expect(serialize(e)).toBe(`Para\n\n${WIDE}`);
    const view = viewOf(e);
    view.dispatch(view.state.tr.insertText("X", 1));
    expect(serialize(e)).toBe(`XPara\n\n${WIDE}`);
  });

  it("A-3 an edit INSIDE the table keeps the added column's delimiter colon-free", async () => {
    const e = await mountParityEditor(MD);
    typeAfter(e, "Z", "!");
    const md = serialize(e);
    const delimiter = md.split("\n")[3];
    expect(delimiter).toMatch(/^\| -+ \| :-+: \| -+ \|$/);
    expect(md).not.toContain("<br />");
    const [shape] = tableShapes(docOf(e));
    expect(shape.cells).toEqual([["a", "b", ""], ["g", "h", "Z!"], ["x", "", ""]]);
  });
});
