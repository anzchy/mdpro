/**
 * Purpose: Fixture builders for the D191 Windows-difference ledger tests. Each
 * builds a small ledger markdown string shaped like `docs/feature-ledger.md`
 * (legend, `## Part 1 — …`, one `### <area>` per area, Part 2 after it), so
 * the tests never depend on the live ledger's content.
 *
 * Every 在哪 claim is `scripts/ledger/check.mjs` or the em dash, so the same
 * fixture also passes the existing gates when `check.mjs` runs on a temp copy
 * of `scripts/ledger/`.
 *
 * @module tests/support/ledgerWindowsDiff
 */

export const INVENTORY_HEAD = ["| 能力 | 状态 | 在哪 | 怎么确认 |", "| --- | --- | --- | --- |"];
export const DIFF_HEAD = ["#### Windows 差异", "", "| 能力 | Windows | 说明 |", "| --- | --- | --- |"];

/** An inventory table; each capability is Shipped unless `Absent` is given. */
export function inventory(...rows: (string | [string, "Shipped" | "Absent"])[]): string[] {
  return [
    ...INVENTORY_HEAD,
    ...rows.map((r) => {
      const [cap, state] = typeof r === "string" ? [r, "Shipped"] : r;
      const where = state === "Absent" ? "—" : "`scripts/ledger/check.mjs`";
      return `| ${cap} | ${state} | ${where} | 打开 app 做一次 |`;
    }),
  ];
}

/** A `#### Windows 差异` table; each row is [能力, Windows, 说明]. */
export function diff(...rows: [string, string, string][]): string[] {
  return [...DIFF_HEAD, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

export interface Area {
  area: string;
  body: string[];
}

/** A whole ledger: preamble, Part 1 with the given areas, then Part 2. */
export function ledger(areas: Area[], opts: { afterPart1?: string[] } = {}): string {
  return [
    "# 功能账簿",
    "",
    "## 状态图例",
    "",
    "| 状态 | 含义 |",
    "| --- | --- |",
    "| Shipped | 已交付 |",
    "",
    "## Part 1 — mdpro 现在有什么",
    "",
    ...areas.flatMap((a) => [`### ${a.area}`, "", ...a.body, ""]),
    "## Part 2 —— 对照组",
    "",
    "正文。",
    "",
    ...(opts.afterPart1 ?? []),
  ].join("\n");
}

/** 1-based line number of the first line equal to `line` (trailing space ignored). */
export function lineOf(markdown: string, line: string): number {
  const index = markdown.split("\n").findIndex((l) => l.trimEnd() === line);
  if (index < 0) throw new Error(`fixture has no line ${JSON.stringify(line)}`);
  return index + 1;
}

/** Two areas, each with a difference table; zero findings expected. */
export const VALID_TWO_AREAS = ledger([
  {
    area: "文件与文档管理",
    body: [
      ...inventory("新建文档", "打开文件", ["云同步", "Absent"]),
      "",
      ...diff(["打开文件", "Partial", "限制：UNC 路径打不开"], ["新建文档", "Unknown", ""]),
    ],
  },
  {
    area: "平台集成",
    body: [
      ...inventory("Finder 关联", "单实例"),
      "",
      ...diff(["Finder 关联", "N/A", "Windows 没有 Finder"]),
    ],
  },
]);
