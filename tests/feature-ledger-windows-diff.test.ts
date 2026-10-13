// @vitest-environment node
/**
 * Purpose: Pin the parse of the per-area `#### Windows 差异` tables and their
 * three gates (ADR-0089, D191-WI-1): every 能力 matches exactly one row of the
 * same area's inventory table, every Windows cell is a ledger state or `N/A`,
 * and a `Partial` Windows cell carries a 说明. Structure and the end-to-end gate
 * live in `feature-ledger-windows-diff-gate.test.ts`.
 *
 * @module tests/feature-ledger-windows-diff.test
 * @coordinates-with scripts/ledger/windowsDiff.mjs, tests/support/ledgerWindowsDiff.ts
 */
import { describe, expect, it } from "vitest";

import {
  WINDOWS_STATES,
  checkWindowsDiffs,
  parseWindowsDiffs,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/ledger/windowsDiff.mjs";
import { VALID_TWO_AREAS, diff, inventory, ledger, lineOf } from "./support/ledgerWindowsDiff";

interface Finding {
  severity: string;
  rule: string;
  message: string;
  lineNumber?: number;
}
interface DiffRow {
  capability: string;
  windows: string;
  note: string;
  area: string;
  lineNumber: number;
}
interface DiffTable {
  area: string;
  lineNumber: number;
  rows: DiffRow[];
}

const findings = (md: string): Finding[] => checkWindowsDiffs(md);
const byRule = (md: string, rule: string) => findings(md).filter((f) => f.rule === rule);

/** One area 「文件」 whose inventory is 打开文件 / 保存, plus the given diff rows. */
const oneArea = (...rows: [string, string, string][]) =>
  ledger([{ area: "文件", body: [...inventory("打开文件", "保存"), "", ...diff(...rows)] }]);

describe("parseWindowsDiffs exposes the difference rows per area", () => {
  it("returns one table per area, in document order, with capability / windows / note", () => {
    const { tables } = parseWindowsDiffs(VALID_TWO_AREAS) as { tables: DiffTable[] };
    expect(tables.map((t) => t.area)).toEqual(["文件与文档管理", "平台集成"]);
    expect(tables[0].rows.map((r) => [r.capability, r.windows, r.note])).toEqual([
      ["打开文件", "Partial", "限制：UNC 路径打不开"],
      ["新建文档", "Unknown", ""],
    ]);
    expect(tables[1].rows.map((r) => [r.capability, r.windows, r.note])).toEqual([
      ["Finder 关联", "N/A", "Windows 没有 Finder"],
    ]);
  });

  it("records each row's area and 1-based source line, and the heading line per table", () => {
    const { tables } = parseWindowsDiffs(VALID_TWO_AREAS) as { tables: DiffTable[] };
    expect(tables).toHaveLength(2);
    const row = tables[1].rows[0];
    expect(row.area).toBe("平台集成");
    expect(row.lineNumber).toBe(lineOf(VALID_TWO_AREAS, "| Finder 关联 | N/A | Windows 没有 Finder |"));
    expect(tables[0].lineNumber).toBe(lineOf(VALID_TWO_AREAS, "#### Windows 差异"));
  });

  it("does not count difference rows as inventory rows of any kind", () => {
    const { tables } = parseWindowsDiffs(VALID_TWO_AREAS) as { tables: DiffTable[] };
    const all = tables.flatMap((t) => t.rows.map((r) => r.capability));
    expect(all).not.toContain("能力");
    expect(all).toHaveLength(3);
  });

  it("a heading with a header row and no data rows is an empty, valid table", () => {
    const md = ledger([{ area: "文件", body: [...inventory("打开文件"), "", ...diff()] }]);
    const { tables } = parseWindowsDiffs(md) as { tables: DiffTable[] };
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toEqual([]);
    expect(findings(md)).toEqual([]);
  });

  it("ignores a difference-shaped table inside a code fence", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("打开文件"), "", "```", ...diff(["不存在", "bogus", ""]), "```"] },
    ]);
    expect((parseWindowsDiffs(md) as { tables: DiffTable[] }).tables).toEqual([]);
    expect(findings(md)).toEqual([]);
  });
});

describe("valid ledgers pass", () => {
  it("two areas, each with a difference table → 0 findings", () => {
    expect(findings(VALID_TWO_AREAS)).toEqual([]);
  });

  it("a ledger with no difference tables at all → 0 findings", () => {
    const md = ledger([{ area: "文件", body: inventory("打开文件") }, { area: "平台", body: inventory("单实例") }]);
    expect(findings(md)).toEqual([]);
  });
});

describe("gate 1: each 能力 matches exactly one row of its own area's inventory", () => {
  it("a 能力 absent from the inventory is a finding naming the area and the capability", () => {
    const md = oneArea(["导出 PDF", "Absent", ""]);
    const f = findings(md);
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("windows-diff-match");
    expect(f[0].severity).toBe("error");
    expect(f[0].message).toContain("文件");
    expect(f[0].message).toContain("导出 PDF");
    expect(f[0].lineNumber).toBe(lineOf(md, "| 导出 PDF | Absent |  |"));
  });

  it("a 能力 that exists only in a DIFFERENT area's inventory is a finding", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("打开文件"), "", ...diff(["单实例", "Unknown", ""])] },
      { area: "平台", body: inventory("单实例") },
    ]);
    const f = byRule(md, "windows-diff-match");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("文件");
    expect(f[0].message).toContain("单实例");
  });

  it("a 能力 listed twice in one difference table is a finding on the second row", () => {
    const md = oneArea(["保存", "Partial", "限制：x"], ["保存", "Unknown", ""]);
    const f = byRule(md, "windows-diff-match");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("保存");
    expect(f[0].lineNumber).toBe(lineOf(md, "| 保存 | Unknown |  |"));
  });

  it("a 能力 whose inventory row appears twice in the area is ambiguous, so a finding", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("保存", "保存"), "", ...diff(["保存", "Unknown", ""])] },
    ]);
    expect(byRule(md, "windows-diff-match")).toHaveLength(1);
  });

  it("matching is exact after cell trimming: extra spaces around the cell still match", () => {
    const md = ledger([
      {
        area: "文件",
        body: [...inventory("打开文件"), "", ...diff(), "|   打开文件   | Unknown | |"],
      },
    ]);
    expect(findings(md)).toEqual([]);
  });

  it.each([
    ["markdown is compared raw: backticks on one side only", "`打开文件`"],
    ["no case folding", "Open File"],
    ["no inner-whitespace folding", "打开 文件"],
    ["no prefix matching", "打开"],
  ])("%s → a finding", (_why, capability) => {
    const md = ledger([
      { area: "文件", body: [...inventory("打开文件", "Open file"), "", ...diff([capability, "Unknown", ""])] },
    ]);
    expect(byRule(md, "windows-diff-match")).toHaveLength(1);
  });

  it("a 能力 containing markdown matches when the text is identical, backticks included", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("`open_file` 命令"), "", ...diff(["`open_file` 命令", "Unknown", ""])] },
    ]);
    expect(findings(md)).toEqual([]);
  });
});

describe("gate 2: the Windows cell is one of the five states or N/A", () => {
  it("the enum is the five ledger states plus N/A", () => {
    expect([...WINDOWS_STATES]).toEqual(["Shipped", "Partial", "Stub", "Absent", "Unknown", "N/A"]);
  });

  it.each(["Shipped", "Partial", "Stub", "Absent", "Unknown", "N/A"])("%s → no finding", (state) => {
    expect(findings(oneArea(["保存", state, "说明文字"]))).toEqual([]);
  });

  it.each([
    ["wrong case", "shipped"],
    ["decorated", "Partial (export only)"],
    ["not a state", "Yes"],
    ["empty", ""],
    ["N/A spelled differently", "n/a"],
    ["NA without slash", "NA"],
  ])("%s (%j) → one windows-diff-enum finding naming the value", (_why, value) => {
    const md = oneArea(["保存", value, "说明文字"]);
    const f = findings(md);
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("windows-diff-enum");
    expect(f[0].message).toContain("保存");
    expect(f[0].message).toContain(`"${value}"`);
  });
});

// Deliberately NOT Part 1's `限制：` rule: ADR-0089 (Decision, "a `Partial`
// Windows cell has a non-empty 说明") asks only for a non-empty 说明, and a
// difference row exists only because Windows differs, so the 说明 is already
// the limit. Delegator ruling 2026-10-13; do not tighten this to `限制：`.
describe("gate 3: a Partial Windows cell carries a 说明", () => {
  it("Partial with an empty 说明 → a finding", () => {
    const md = oneArea(["保存", "Partial", ""]);
    const f = findings(md);
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("windows-diff-partial-note");
    expect(f[0].message).toContain("保存");
    expect(f[0].lineNumber).toBe(lineOf(md, "| 保存 | Partial |  |"));
  });

  it("Partial whose row has no 说明 cell at all → a finding", () => {
    const md = ledger([{ area: "文件", body: [...inventory("保存"), "", ...diff(), "| 保存 | Partial |"] }]);
    expect(byRule(md, "windows-diff-partial-note")).toHaveLength(1);
  });

  it("Partial with a 说明 → no finding (限制： is not required here)", () => {
    expect(findings(oneArea(["保存", "Partial", "另存为对话框不弹出"]))).toEqual([]);
  });

  it.each(["Shipped", "Stub", "Absent", "Unknown", "N/A"])("%s with an empty 说明 → no finding", (state) => {
    expect(findings(oneArea(["保存", state, ""]))).toEqual([]);
  });
});
