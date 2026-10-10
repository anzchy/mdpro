/**
 * D64 WI-2 (ADR-0063 rule, ADR-0067 Decision 5): a ragged table loaded into WYSIWYG,
 * edited, and serialized comes back as exactly what the source-side widener produces:
 * the same cell matrix and alignments as `widenTable`, the same bytes after
 * `formatTable`, no `<br />`, and no `:---` on an unaligned column. The round trip is
 * idempotent: loading that output and editing again writes the same table text.
 *
 * Real Milkdown (commonmark + gfm + the exported `tableParityPlugins` + history). No
 * mocks: nothing here reaches Tauri.
 */
import { afterEach, describe, expect, it } from "vitest";
import { findAllTables } from "../src/utils/cursorSync/table";
import { formatTable } from "../src/utils/tableFormatter";
import { widenTable } from "../src/utils/tableWiden";
import type { TableModel } from "../src/utils/tableParser";
import {
  destroyParityEditors,
  docOf,
  mountParityEditor,
  serialize,
  tableShapes,
  typeAfter,
  typeAtDocEnd,
} from "./support/raggedTableD64";

const TAIL = "\n\nend\n";

/** [label, table source, PM text of the first header cell] */
const CASES: Array<[string, string, string]> = [
  ["overflow", "| a | b |\n|---|---|\n| c | d | e |", "a"],
  ["short rows", "| a | b | c |\n|---|---|---|\n| x |\n| y | z |", "a"],
  ["blank overflow", "| a | b |\n|---|---|\n| c | d |  |", "a"],
  ["empty cell plus overflow", "| a | b |\n|---|---|\n|  | d | e |", "a"],
  ["escaped pipes", "| a \\| b | c |\n|---|---|\n| x | y \\| z | w |", "a | b"],
  ["CJK", "| 名称 | 值 |\n|---|---|\n| 甲 | 乙 | 丙 |\n| 丁 |", "名称"],
  ["aligned + mixed", "| a | b |\n|:--|--:|\n| c | d | e | f |\n| g |", "a"],
  ["fixture T1", "| h1 | h2 |\n| --- | --- |\n| e | f | X1a |\n| g | h | X1b | X1c |", "h1"],
];

afterEach(destroyParityEditors);

function onlyTable(md: string): TableModel {
  const tables = findAllTables(md);
  expect(tables).toHaveLength(1);
  return tables[0];
}

const tableText = (md: string): string => onlyTable(md).raw;

function assertNoArtifacts(md: string, model: TableModel): void {
  expect(md).not.toContain("<br />");
  const delimiter = model.raw.split("\n")[1].split("|").slice(1, -1).map((s) => s.trim());
  model.alignments.forEach((a, k) => {
    if (a === null) expect(delimiter[k], `column ${k} gained a colon`).not.toContain(":");
  });
}

describe("WYSIWYG load→edit→serialize equals the source-side widener", () => {
  for (const [label, table] of CASES) {
    it(`P-out ${label}: an edit outside the table`, async () => {
      const source = table + TAIL;
      const e = await mountParityEditor(source);
      typeAtDocEnd(e, "Z");
      const out = serialize(e);
      expect(out.endsWith("\n\nendZ\n")).toBe(true);
      const got = onlyTable(out);
      const want = onlyTable(source);
      expect(widenTable(got)).toEqual(widenTable(want));
      expect(formatTable(got)).toBe(formatTable(want));
      assertNoArtifacts(out, got);
    });
  }

  for (const [label, table, firstCell] of CASES) {
    it(`P-in ${label}: an edit inside the first header cell`, async () => {
      const source = table + TAIL;
      const e = await mountParityEditor(source);
      typeAfter(e, firstCell, "Q");
      const out = serialize(e);
      const got = widenTable(onlyTable(out));
      const want = widenTable(onlyTable(source));
      want.rows[0][0] = `${want.rows[0][0]}Q`;
      expect(got).toEqual(want);
      assertNoArtifacts(out, onlyTable(out));
      for (const s of tableShapes(docOf(e))) expect(s.problems).toBeNull();
    });
  }

  for (const [label, table] of CASES) {
    it(`P-idem ${label}: loading the output and editing again writes the same table`, async () => {
      const first = await mountParityEditor(table + TAIL);
      typeAtDocEnd(first, "Z");
      const once = serialize(first);
      const second = await mountParityEditor(once);
      expect(serialize(second)).toBe(once);
      typeAtDocEnd(second, "Z");
      const twice = serialize(second);
      expect(tableText(twice)).toBe(tableText(once));
      expect(widenTable(onlyTable(once)).rows.every((r) => r.length === onlyTable(once).colCount)).toBe(true);
    });
  }
});
