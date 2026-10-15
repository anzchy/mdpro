// @vitest-environment node
/**
 * Purpose: Pin how `pnpm ledger:build` renders a `#### Windows 差异` table
 * (ADR-0089: "renders the Windows cell as a chip with the same colours as the
 * macOS badges", D191-WI-2). The Windows cell reuses the macOS badge class for
 * each of the five states, `N/A` gets its own neutral `badge-na`, the table is
 * tagged `windows-diff`, and its rows stay out of the state-chip counts
 * (`tr.inv-row`). A ledger without difference tables renders as before.
 *
 * String-level assertions on purpose: the renderer emits a fixed, small HTML
 * shape, and a node-environment file keeps jsdom out of a DOM-free script.
 *
 * @module tests/feature-ledger-render-windows.test
 * @coordinates-with scripts/ledger/md.mjs, scripts/ledger/render.mjs,
 *   scripts/ledger/template.mjs, tests/support/ledgerWindowsDiff.ts
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { renderInline, renderMarkdown } from "../../scripts/ledger/md.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildHtml } from "../../scripts/ledger/render.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { LEDGER_CSS } from "../../scripts/ledger/template.mjs";
import { INVENTORY_HEAD, diff, inventory, ledger } from "../support/ledgerWindowsDiff";

const FIXED_NOW = new Date(2026, 9, 13, 12, 0);
const html = (md: string): string => renderMarkdown(md).html;

/** One capability per Windows value; the macOS state of each is Shipped. */
const CASES: [string, string][] = [
  ["新建文档", "Shipped"],
  ["打开文件", "Partial"],
  ["保存", "Stub"],
  ["另存为", "Absent"],
  ["导出", "Unknown"],
  ["Finder 关联", "N/A"],
];
const ALL_VALUES = ledger([
  {
    area: "文件",
    body: [...inventory(...CASES.map(([cap]) => cap)), "", ...diff(...CASES.map(([cap, w]) => [cap, w, `说明 ${w}`] as [string, string, string]))],
  },
  { area: "平台", body: inventory("单实例") },
]);

/** The rendered windows-diff table, or "" when there is none. */
function diffTableHtml(rendered: string): string {
  const start = rendered.indexOf('<table class="windows-diff">');
  if (start < 0) return "";
  return rendered.slice(start, rendered.indexOf("</table>", start) + "</table>".length);
}

/** [能力, Windows, 说明] inner HTML of every body row of a rendered table. */
function bodyRows(tableHtml: string): string[][] {
  const tbody = /<tbody>([\s\S]*)<\/tbody>/.exec(tableHtml)?.[1] ?? "";
  return [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]),
  );
}

const badgeClass = (cellHtml: string | undefined): string | undefined =>
  /<span class="([^"]+)">/.exec(cellHtml ?? "")?.[1];

/** The class the macOS 状态 badge gets for `state`, read off a rendered inventory row. */
function macBadgeClass(state: string): string | undefined {
  const md = [...INVENTORY_HEAD, `| 能力 | ${state} | \`a/b.ts\` | x |`].join("\n");
  return badgeClass(html(md));
}

describe("the Windows cell renders as the macOS badge for the same state", () => {
  it("the difference table is rendered as a table tagged windows-diff", () => {
    expect(diffTableHtml(html(ALL_VALUES))).not.toBe("");
  });

  it.each(CASES.filter(([, w]) => w !== "N/A"))("%s → Windows %s uses the macOS badge class", (cap, state) => {
    const expected = macBadgeClass(state);
    expect(expected).toBe(`badge badge-${state.toLowerCase()}`);
    const row = bodyRows(diffTableHtml(html(ALL_VALUES))).find((r) => r[0] === cap);
    expect(row, `no difference row for ${cap}`).toBeDefined();
    expect(badgeClass(row?.[1])).toBe(expected);
    expect(row?.[1]).toContain(`>${state}</span>`);
  });

  it("N/A renders as its own neutral badge-na chip", () => {
    const row = bodyRows(diffTableHtml(html(ALL_VALUES))).find((r) => r[0] === "Finder 关联");
    expect(badgeClass(row?.[1])).toBe("badge badge-na");
    expect(row?.[1]).toContain(">N/A</span>");
  });

  it("badge-na is defined in the template CSS with neutral colours only", () => {
    const rule = /\.badge-na\s*\{([^}]*)\}/.exec(LEDGER_CSS)?.[1];
    expect(rule, ".badge-na has no CSS rule").toBeDefined();
    expect(rule).toContain("var(--color-muted)");
    for (const hue of ["--color-danger", "--ledger-ok", "--ledger-warn", "--color-accent"]) {
      expect(rule).not.toContain(hue);
    }
  });

  it("a value outside the enum renders as badge-invalid, like an invalid macOS state", () => {
    const md = ledger([{ area: "文件", body: [...inventory("保存"), "", ...diff(["保存", "Yes", ""])] }]);
    const row = bodyRows(diffTableHtml(html(md)))[0];
    expect(badgeClass(row?.[1])).toBe(macBadgeClass("Yes"));
    expect(badgeClass(row?.[1])).toBe("badge badge-invalid");
  });

  it("difference rows are not inventory rows, so the state chips do not count them", () => {
    const rendered = html(ALL_VALUES);
    const table = diffTableHtml(rendered);
    expect(table).not.toBe("");
    expect(table).not.toContain("inv-row");
    expect(rendered.match(/class="inv-row"/g)).toHaveLength(CASES.length + 1);
  });
});

describe("text cells and placement", () => {
  const RAW_CAP = '<script>alert(1)</script> & "co"';
  const RAW_NOTE = "a < b & `x<y>` 'q'";
  const ESCAPING = ledger([
    { area: "文件", body: [...inventory(RAW_CAP), "", ...diff([RAW_CAP, "Partial", RAW_NOTE])] },
  ]);

  it("能力 and 说明 render as text, escaped exactly like inventory cells", () => {
    const rendered = html(ESCAPING);
    const row = bodyRows(diffTableHtml(rendered))[0];
    expect(row?.[0]).toBe(renderInline(RAW_CAP));
    expect(row?.[2]).toBe(renderInline(RAW_NOTE));
    expect(row?.[0]).toContain("&lt;script&gt;");
    expect(row?.[0]).toContain("&amp;");
    expect(rendered).not.toContain("<script>alert");
  });

  it("the difference table follows its area's inventory, under the Windows 差异 heading", () => {
    const rendered = html(ALL_VALUES);
    const inventoryAt = rendered.indexOf('<table class="inventory">');
    const headingAt = rendered.search(/<h4 id="[^"]*">Windows 差异<\/h4>/);
    const tableAt = rendered.indexOf('<table class="windows-diff">');
    const nextAreaAt = rendered.indexOf(">平台</h3>");
    expect(inventoryAt).toBeGreaterThanOrEqual(0);
    expect(headingAt).toBeGreaterThan(inventoryAt);
    expect(tableAt).toBeGreaterThan(headingAt);
    expect(nextAreaAt).toBeGreaterThan(tableAt);
  });
});

describe("ledgers without difference tables are unaffected", () => {
  const BASE = ledger([{ area: "文件", body: inventory("保存", "打开文件") }, { area: "平台", body: inventory("单实例") }]);
  const WITH_DIFF = ledger([
    { area: "文件", body: [...inventory("保存", "打开文件"), "", ...diff(["保存", "Unknown", "未验"])] },
    { area: "平台", body: inventory("单实例") },
  ]);

  it("no difference table → no windows-diff markup and no badge-na in the body", () => {
    expect(html(BASE)).not.toContain("windows-diff");
    expect(html(BASE)).not.toContain("badge-na");
  });

  it("removing the rendered difference block gives back exactly the render without it", () => {
    const block = /\n<h4 id="[^"]*">Windows 差异<\/h4>\n<div class="table-wrap"><table class="windows-diff">[\s\S]*?<\/table><\/div>/;
    const withDiff = html(WITH_DIFF);
    expect(withDiff).toMatch(block);
    expect(withDiff.replace(block, "")).toBe(html(BASE));
  });

  it("the TOC headings are unchanged by a difference table (h4 stays out of the TOC)", () => {
    expect(renderMarkdown(WITH_DIFF).headings).toEqual(renderMarkdown(BASE).headings);
  });
});

describe("the rendered page stays self-contained", () => {
  it("buildHtml with difference tables makes 0 external requests", () => {
    const page = buildHtml(ALL_VALUES, FIXED_NOW);
    expect(page).toContain('<table class="windows-diff">');
    expect(page).not.toMatch(/<link\b/i);
    expect(page).not.toMatch(/\bsrc\s*=/i);
    expect(page).not.toMatch(/url\(/i);
    expect(page).not.toMatch(/@import/i);
    expect(page).not.toMatch(/https?:\/\//i);
  });
});
