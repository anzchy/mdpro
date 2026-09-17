/**
 * Purpose: Pin the behaviour of the feature-ledger parser and its mechanical
 * rules (`scripts/ledger/parse.mjs`). These are the pure functions behind
 * `pnpm ledger:check`; the filesystem-touching halves (`declared.mjs`,
 * `check.mjs`, `render.mjs`) are deliberately NOT tested here — asserting on
 * live-repo counts would be a brittle test that fails on every real edit.
 *
 * @module tests/feature-ledger.test
 * @coordinates-with scripts/ledger/parse.mjs
 */
import { describe, expect, it } from "vitest";

import {
  LEDGER_STATES,
  checkAbsentWhere,
  checkCoverage,
  checkNoBuildOutputs,
  checkNoLineNumbers,
  checkPartialHasLimit,
  checkStates,
  extractPathClaims,
  parseLedger,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/ledger/parse.mjs";

const FIXTURE = [
  "# 功能账簿",
  "",
  "## 状态图例",
  "",
  "| 状态 | 含义 |",
  "| --- | --- |",
  "| Shipped | 已交付并可验证 |",
  "| Absent | 不存在 |",
  "",
  "## 1. 文件与文档",
  "",
  "| 能力 | 状态 | 在哪 | 怎么确认 |",
  "| --- | --- | --- | --- |",
  "| 打开文件 | Shipped | `src-tauri/src/commands/file.rs` | 调用 open_file |",
  "| 草稿恢复 | Partial | `src/hooks/useAutoSave.ts` | 限制：仅当前窗口 |",
  "| 云同步 | Absent | — | 未实现 |",
  "",
  "### 1.1 子章节",
  "",
  "正文段落。",
  "",
].join("\n");

describe("parseLedger", () => {
  it("parses only the 4-column inventory table and ignores other pipe tables", () => {
    const { rows } = parseLedger(FIXTURE);
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { capability: string }) => r.capability)).toEqual([
      "打开文件",
      "草稿恢复",
      "云同步",
    ]);
    // The 2-column legend table must not contribute rows.
    expect(rows.some((r: { capability: string }) => r.capability === "Shipped")).toBe(false);
  });

  it("records the section and 1-based source line for each row", () => {
    const { rows } = parseLedger(FIXTURE);
    expect(rows[0].section).toBe("1. 文件与文档");
    expect(rows[0].lineNumber).toBe(14);
    expect(rows[2].lineNumber).toBe(16);
  });

  it("collects sections with their level and attaches rows", () => {
    const { sections } = parseLedger(FIXTURE);
    expect(sections.map((s: { heading: string }) => s.heading)).toEqual([
      "状态图例",
      "1. 文件与文档",
      "1.1 子章节",
    ]);
    expect(sections[1].level).toBe(2);
    expect(sections[2].level).toBe(3);
    expect(sections[1].rows).toHaveLength(3);
    expect(sections[0].rows).toHaveLength(0);
  });

  it("collapses whitespace runs into a single hyphen in anchors", () => {
    const { sections } = parseLedger(FIXTURE);
    const anchor = sections[1].anchor;
    expect(anchor).toBe("1-文件与文档");
    expect(anchor).not.toContain("--");
  });
});

describe("checkStates", () => {
  it("accepts the five canonical states", () => {
    const rows = LEDGER_STATES.map((state: string, i: number) => ({
      capability: `c${i}`,
      state,
      where: state === "Absent" ? "—" : "`src/a.ts`",
      confirm: "x",
      section: "s",
      lineNumber: i + 1,
    }));
    expect(checkStates(rows)).toEqual([]);
  });

  it("rejects a decorated state — the enum is closed", () => {
    const rows = [
      { capability: "c", state: "Shipped (WYSIWYG)", where: "`src/a.ts`", confirm: "x", section: "s", lineNumber: 9 },
    ];
    const findings = checkStates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("state-enum");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].lineNumber).toBe(9);
    expect(findings[0].message).toContain("Shipped (WYSIWYG)");
  });
});

describe("checkPartialHasLimit", () => {
  const partial = (confirm: string) => [
    { capability: "c", state: "Partial", where: "`src/a.ts`", confirm, section: "s", lineNumber: 3 },
  ];

  it("flags a Partial row whose 怎么确认 names no limit", () => {
    const findings = checkPartialHasLimit(partial("运行 pnpm test"));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("partial-limit");
  });

  it("passes a Partial row that names a limit", () => {
    expect(checkPartialHasLimit(partial("运行 pnpm test；限制：仅源码模式"))).toEqual([]);
  });

  it("ignores non-Partial rows", () => {
    expect(
      checkPartialHasLimit([
        { capability: "c", state: "Shipped", where: "`src/a.ts`", confirm: "无限制说明", section: "s", lineNumber: 3 },
      ]),
    ).toEqual([]);
  });
});

describe("checkAbsentWhere", () => {
  it("flags an Absent row that claims a real path", () => {
    const findings = checkAbsentWhere([
      { capability: "c", state: "Absent", where: "`src/a.ts`", confirm: "x", section: "s", lineNumber: 5 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("absent-where");
  });

  it("passes an Absent row whose 在哪 is an em dash", () => {
    expect(
      checkAbsentWhere([
        { capability: "c", state: "Absent", where: "—", confirm: "x", section: "s", lineNumber: 5 },
      ]),
    ).toEqual([]);
  });

  it("flags a non-Absent row whose 在哪 is an em dash", () => {
    const findings = checkAbsentWhere([
      { capability: "c", state: "Shipped", where: "—", confirm: "x", section: "s", lineNumber: 7 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("absent-where");
    expect(findings[0].lineNumber).toBe(7);
  });
});

describe("extractPathClaims", () => {
  it("extracts backticked repo paths and skips prose and bare identifiers", () => {
    const claims = extractPathClaims([
      {
        capability: "c",
        state: "Shipped",
        where: "`src/App.tsx` 与 `src/stores/` ，命令 `open_file`",
        confirm: "x",
        section: "s",
        lineNumber: 2,
      },
    ]);
    expect(claims.map((c: { path: string }) => c.path)).toEqual(["src/App.tsx", "src/stores/"]);
    expect(claims[0].lineNumber).toBe(2);
  });
});

describe("checkNoLineNumbers", () => {
  it("flags a path claim pinned to a line number", () => {
    const findings = checkNoLineNumbers([{ path: "src/foo.ts:42", row: null, lineNumber: 4 }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("no-line-numbers");
    expect(findings[0].lineNumber).toBe(4);
  });

  it("passes a plain path", () => {
    expect(checkNoLineNumbers([{ path: "src/foo.ts", row: null, lineNumber: 4 }])).toEqual([]);
  });
});

describe("checkNoBuildOutputs", () => {
  it("flags a claim on a build output", () => {
    const findings = checkNoBuildOutputs([{ path: "dist/bundle.js", row: null, lineNumber: 6 }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("no-build-outputs");
  });

  it("passes a first-party source path", () => {
    expect(checkNoBuildOutputs([{ path: "src/main.tsx", row: null, lineNumber: 6 }])).toEqual([]);
  });
});

describe("checkCoverage", () => {
  it("reports a declared name that appears nowhere in the ledger", () => {
    const findings = checkCoverage(
      [
        { name: "open_file", kind: "tauri-command", source: "src-tauri/src/commands/file.rs" },
        { name: "delete_draft", kind: "tauri-command", source: "src-tauri/src/commands/draft.rs" },
      ],
      FIXTURE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("coverage");
    expect(findings[0].message).toContain("delete_draft");
  });
});
