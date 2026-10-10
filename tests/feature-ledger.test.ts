// @vitest-environment node
/**
 * Purpose: Pin the behaviour of the feature-ledger parser and its mechanical
 * rules (`scripts/ledger/parse.mjs`). These are the pure functions behind
 * `pnpm ledger:check`.
 *
 * Live-repo **counts** are still deliberately not asserted — a test pinning "166
 * rows" fails on every real edit and teaches people to update it without reading
 * it. What the last block does assert is the gate's *verdict* (zero findings) and
 * one named row's state cell, neither of which drifts under an honest edit. That
 * distinction, not "no filesystem", is the rule this file follows.
 *
 * @module tests/feature-ledger.test
 * @coordinates-with scripts/ledger/parse.mjs, scripts/ledger/check.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LEDGER_STATES,
  checkAbsentWhere,
  checkCoverage,
  checkNoBuildOutputs,
  checkNoLineNumbers,
  checkNoRawPipeInCode,
  checkPartialHasLimit,
  checkStates,
  checkTableSeparators,
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

describe("inventory table without a separator row (D71 / audit #45)", () => {
  const NO_SEPARATOR = [
    "## 1. 文件与文档",
    "",
    "| 能力 | 状态 | 在哪 | 怎么确认 |",
    "| 打开文件 | Shipped | `src/a.ts` | 调用 open_file |",
    "",
  ].join("\n");

  it("does not count its body as inventory rows — the renderer shows it as prose", () => {
    expect(parseLedger(NO_SEPARATOR).rows).toEqual([]);
  });

  it("is reported as a finding at the header line", () => {
    const findings = checkTableSeparators(parseLedger(NO_SEPARATOR).malformedTables);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("table-separator");
    expect(findings[0].lineNumber).toBe(3);
  });

  it("reports nothing for a well-formed ledger", () => {
    expect(checkTableSeparators(parseLedger(FIXTURE).malformedTables)).toEqual([]);
  });

  it("ignores a header-shaped line inside a code fence", () => {
    const fenced = ["```", "| 能力 | 状态 | 在哪 | 怎么确认 |", "```"].join("\n");
    expect(parseLedger(fenced).malformedTables).toEqual([]);
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

  it("flags the Tauri crate's build output under src-tauri/target/ (audit #46)", () => {
    const findings = checkNoBuildOutputs([
      { path: "src-tauri/target/release/mdpro", row: null, lineNumber: 7 },
    ]);
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

/**
 * WI-3.5.7 case D1 (test matrix `.claude/tdd-guardian/tests-20260918-214500.md:1061-1071`).
 *
 * D1's lane is `unit`, and the matrix's own reason is that `pnpm ledger:check` is
 * the same check as a script. It is invoked here as a subprocess rather than
 * recomposed from `parse.mjs` + `declared.mjs`: a recomposition would pass while
 * `check.mjs` grew a seventh rule the test never ran, which is precisely the drift
 * a gate test exists to stop.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the live feature ledger passes its own gate (WI-3.5.7 case D1)", () => {
  it("D1a `node scripts/ledger/check.mjs` reports zero findings", () => {
    const run = spawnSync("node", ["scripts/ledger/check.mjs", "--require"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    // A gate that silently skipped is a pass that proves nothing.
    expect(run.error, `could not run the ledger gate: ${run.error?.message}`).toBeUndefined();
    expect(run.stdout).toMatch(/^\d+ rows, \d+ path claims, /m);
    expect(run.stdout).not.toContain("不存在 — 功能账簿闸门被跳过");

    expect(
      run.status,
      `pnpm ledger:check failed:\n${run.stdout}${run.stderr}`,
    ).toBe(0);
    expect(run.stdout).toContain("0 findings");
  });

  it("D1b the 大纲侧栏 row stays Partial, names its limit, and records identity coordination", () => {
    const markdown = fs.readFileSync(path.join(REPO_ROOT, "docs/feature-ledger.md"), "utf8");
    const { rows } = parseLedger(markdown) as {
      rows: { capability: string; state: string; where: string; confirm: string }[];
    };

    const row = rows.find((r) => r.capability === "大纲侧栏");
    expect(row, "the 大纲侧栏 row disappeared from the ledger").toBeDefined();

    // The enum is closed and both existing 限制 clauses are still true, so WI-3.5 does
    // not promote this row. `Shipped (折叠态已保住)` is a gate failure, not a nuance.
    expect(row!.state).toBe("Partial");
    expect(row!.confirm).toContain("限制：");

    // Rule 60: the new surfaces get their description on the row that *is* that
    // surface, not a name parked elsewhere to turn the coverage count green.
    for (const claim of [
      "`src/stores/tocStore.ts`",
      "`src/stores/tocCoordination.ts`",
      "`src/stores/tocHierarchy.ts`",
      "`src/utils/headingCoordination.ts`",
    ]) {
      expect(row!.where, `大纲侧栏 row does not name ${claim}`).toContain(claim);
    }

    // The user-visible behaviour WI-3.5 changed must be confirmable from the row.
    for (const marker of ["折叠", "击键", "重新加载"]) {
      expect(
        row!.confirm,
        `大纲侧栏 怎么确认 does not let a reader confirm "${marker}"`,
      ).toContain(marker);
    }
  });
});

describe("checkNoRawPipeInCode", () => {
  // Found the hard way while landing D11: the 大文档性能保护 row contained a
  // bare pipe inside a code span. In a GFM table that pipe ENDS THE CELL, so
  // roughly 60% of the longest row in the ledger — every caveat about Source
  // mode included — was silently absent from the rendered HTML.
  //
  // Nothing caught it. The row still parsed, the state was still in the enum,
  // every path claim still resolved, and `pnpm ledger:check` said 0 findings.
  // The markdown read correctly and the artifact people actually open was
  // truncated mid-sentence. This is the check that would have caught it.

  /** A backtick, spelled so these fixtures stay readable inside template literals. */
  const BT = "\u0060";

  const tableWith = (cell: string) =>
    [
      "# t",
      "",
      "## s",
      "",
      "| 能力 | 状态 | 在哪 | 怎么确认 |",
      "|---|---|---|---|",
      `| a | Shipped | ${BT}x.ts${BT} | ${cell} |`,
    ].join("\n");

  it("flags an unescaped pipe inside a code span", () => {
    const findings = checkNoRawPipeInCode(tableWith(`围栏里的 ${BT}|${BT} 被当成单元格`));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("no-raw-pipe-in-code");
    expect(findings[0].lineNumber).toBe(7);
  });

  it("accepts the escaped spelling, which is what GFM wants", () => {
    // `\\|` inside a code span renders as a literal pipe and does not split the
    // cell. The 源码模式的表格识别范围 row already spells it that way.
    expect(checkNoRawPipeInCode(tableWith(`写 ${BT}\\| a \\|${BT} 再右键`))).toEqual([]);
  });

  it("ignores pipes outside code spans — those are the cell separators", () => {
    expect(checkNoRawPipeInCode(tableWith("普通文字，没有反引号"))).toEqual([]);
  });

  it("ignores code spans outside a table", () => {
    // Prose is not split by pipes, so demanding an escape there would be noise.
    expect(checkNoRawPipeInCode(`正文里的 ${BT}a | b${BT} 不该报`)).toEqual([]);
  });

  it("reports every offending row, not only the first", () => {
    const md = [tableWith(`${BT}|${BT}`), tableWith(`${BT}|${BT}`)].join("\n");

    expect(checkNoRawPipeInCode(md).length).toBeGreaterThanOrEqual(2);
  });

  it("the shipped ledger is clean", () => {
    // REGRESSION — the real file, not a fixture. Red before the escape landed.
    const markdown = fs.readFileSync(path.join(REPO_ROOT, "docs/feature-ledger.md"), "utf8");

    expect(checkNoRawPipeInCode(markdown)).toEqual([]);
  });

  it("an escaped backtick does not open a code span", () => {
    // REGRESSION — the check's own false positive. `docs/guide/keyboard-shortcuts.md`
    // spells a literal backtick as `\``. A span matcher that ignores the backslash
    // reads that as an opener, runs to the NEXT backtick, and reports the two real
    // column separators in between as truncating content. Acting on that report
    // merges three columns into one — which is exactly what happened before this
    // case existed. The row below is the shipped spelling, verbatim.
    const row = "| ⌘⇧\\` | Inline Code | `` `code` `` |";
    const md = ["# t", "", "## s", "", "| 能力 | 状态 | 在哪 | 怎么确认 |", "|---|---|---|---|", row].join(
      "\n",
    );

    expect(checkNoRawPipeInCode(md)).toEqual([]);
  });

  it("an escaped backtick still does not hide a real offender on the same row", () => {
    // The fix must not become "give up on any row containing \`". A genuine
    // truncating span later in the same row is still a finding.
    const row = `| ⌘⇧\\\` | 状态 | ${BT}a | b${BT} | 怎么确认 |`;
    const md = ["# t", "", "## s", "", "| 能力 | 状态 | 在哪 | 怎么确认 |", "|---|---|---|---|", row].join(
      "\n",
    );

    expect(checkNoRawPipeInCode(md)).toHaveLength(1);
    expect(checkNoRawPipeInCode(md)[0].rule).toBe("no-raw-pipe-in-code");
  });
});
