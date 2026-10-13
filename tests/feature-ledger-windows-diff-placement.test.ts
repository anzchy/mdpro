// @vitest-environment node
/**
 * Purpose: Pin what may stand between an area's inventory table and its
 * `#### Windows 差异` table (ADR-0089 "the inventory table immediately above",
 * audit b104 Medium, receipt D191-F-1). Only prose: another heading of level
 * ≤ 4 or another table in between makes the difference table misplaced, one
 * `windows-diff-structure` finding at its heading, and its rows are not gated.
 *
 * Every misplaced fixture carries a row that would fail gates 1 and 2
 * (`不存在` / `Yes`), so "exactly one finding" also proves the rows were not
 * gated against a stale inventory.
 *
 * @module tests/feature-ledger-windows-diff-placement.test
 * @coordinates-with scripts/ledger/windowsDiff.mjs, tests/support/ledgerWindowsDiff.ts
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkWindowsDiffs, parseWindowsDiffs } from "../scripts/ledger/windowsDiff.mjs";
import { diff, inventory, ledger, lineOf } from "./support/ledgerWindowsDiff";

interface Finding {
  rule: string;
  message: string;
  lineNumber?: number;
}

const findings = (md: string): Finding[] => checkWindowsDiffs(md);
const tables = (md: string): unknown[] => (parseWindowsDiffs(md) as { tables: unknown[] }).tables;

/** A row that names an existing capability with a valid state. */
const GOOD_ROW: [string, string, string] = ["保存", "Unknown", ""];
/** A row that would fail both the match and the enum gate if it were gated. */
const BAD_ROW: [string, string, string] = ["不存在", "Yes", ""];

const TWO_COL_TABLE = ["| 键 | 值 |", "| --- | --- |", "| a | 1 |"];

function expectMisplaced(md: string) {
  const f = findings(md);
  expect(f, JSON.stringify(f)).toHaveLength(1);
  expect(f[0].rule).toBe("windows-diff-structure");
  expect(f[0].lineNumber).toBe(lineOf(md, "#### Windows 差异"));
  expect(tables(md)).toEqual([]);
}

describe("regressions: something other than prose between inventory and difference table (b104)", () => {
  it("(a) an intervening `#### Other` heading makes the difference table misplaced", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("保存"), "", "#### Other", "", "正文。", "", ...diff(GOOD_ROW, BAD_ROW)] },
    ]);
    expectMisplaced(md);
  });

  it("(a′) an intervening `####` heading with nothing under it is still a heading in between", () => {
    const md = ledger([{ area: "文件", body: [...inventory("保存"), "", "#### Other", "", ...diff(GOOD_ROW)] }]);
    expectMisplaced(md);
  });

  it("(b) an intervening unrelated 2-column table makes the difference table misplaced", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("保存"), "", ...TWO_COL_TABLE, "", ...diff(GOOD_ROW, BAD_ROW)] },
    ]);
    expectMisplaced(md);
  });

  it("(b′) an intervening table separated from it by prose is still a table in between", () => {
    const md = ledger([
      {
        area: "文件",
        body: [...inventory("保存"), "", "说明一段。", "", ...TWO_COL_TABLE, "", "再一段。", "", ...diff(GOOD_ROW)],
      },
    ]);
    expectMisplaced(md);
  });

  it("(c) an intervening `###` area with no inventory does not borrow the previous area's", () => {
    const md = ledger([
      { area: "文件", body: inventory("保存") },
      { area: "平台", body: ["正文。", "", ...diff(GOOD_ROW, BAD_ROW)] },
    ]);
    expectMisplaced(md);
  });
});

describe("guards: what may still stand in between", () => {
  it("prose paragraphs between the inventory and the difference table are fine", () => {
    const md = ledger([
      {
        area: "文件",
        body: [...inventory("保存"), "", "这一区在 Windows 上的差异：", "", "第二段说明。", "", ...diff(GOOD_ROW)],
      },
    ]);
    expect(findings(md)).toEqual([]);
    expect(tables(md)).toHaveLength(1);
  });

  it("an unrelated table BEFORE the inventory table does not matter", () => {
    const md = ledger([
      { area: "文件", body: [...TWO_COL_TABLE, "", ...inventory("保存"), "", ...diff(GOOD_ROW)] },
    ]);
    expect(findings(md)).toEqual([]);
  });

  it("a `####` heading BEFORE the inventory table does not matter", () => {
    const md = ledger([
      { area: "文件", body: ["#### 小节", "", ...inventory("保存"), "", ...diff(GOOD_ROW)] },
    ]);
    expect(findings(md)).toEqual([]);
  });

  it("the table directly after the inventory, blank line only, is fine and gated", () => {
    const md = ledger([{ area: "文件", body: [...inventory("保存"), "", ...diff(GOOD_ROW, BAD_ROW)] }]);
    const rules = findings(md).map((f) => f.rule).sort();
    expect(rules).toEqual(["windows-diff-enum", "windows-diff-match"]);
  });
});
