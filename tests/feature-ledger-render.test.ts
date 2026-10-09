// @vitest-environment node
/**
 * Purpose: Pin the link handling of the feature-ledger HTML renderer
 * (`scripts/ledger/md.mjs`). The ledger links to its siblings as scheme-less
 * relative paths (`plans/…`, `adr/…`), and `docs/feature-ledger.html` sits in
 * the same directory as the markdown, so those hrefs must survive verbatim —
 * D71 / audit #44 shipped an HTML where every one of them had become `#`.
 *
 * @module tests/feature-ledger-render.test
 * @coordinates-with scripts/ledger/md.mjs
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { renderInline, renderMarkdown } from "../scripts/ledger/md.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { parseLedger } from "../scripts/ledger/parse.mjs";

const hrefOf = (markdown: string): string | undefined =>
  /href="([^"]*)"/.exec(renderInline(markdown))?.[1];

describe("renderInline link targets (D71 / audit #44)", () => {
  it.each([
    ["plans/20260912-frontend-backend-sequencing-order.md#d71"],
    ["adr/0047-agent-tool.md"],
    ["feature-ledger.md"],
    ["./plans/x.md"],
    ["../CHANGELOG.md"],
    ["/abs/path.md"],
    ["#状态图例"],
    ["https://example.com/a"],
    ["http://example.com/a"],
    ["mailto:someone@example.com"],
  ])("keeps the safe target %s", (href) => {
    expect(hrefOf(`[x](${href})`)).toBe(href);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,hi"],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["//evil.example.com/x"],
  ])("neutralises the unsafe target %s", (href) => {
    expect(hrefOf(`[x](${href})`)).toBe("#");
  });

  it("still HTML-escapes the target", () => {
    expect(renderInline('[x](plans/a.md?q="b"&c)')).toContain(
      'href="plans/a.md?q=&quot;b&quot;&amp;c"',
    );
  });
});

describe("parser and renderer agree on what an inventory table is (audit #45)", () => {
  const HEADER = "| 能力 | 状态 | 在哪 | 怎么确认 |";
  const ROW = "| 打开文件 | Shipped | `src/a.ts` | 调用 open_file |";

  it.each([
    ["with a separator", [HEADER, "| --- | --- | --- | --- |", ROW]],
    ["without a separator", [HEADER, ROW]],
  ])("%s", (_name, lines) => {
    const markdown = lines.join("\n");
    const rendered = renderMarkdown(markdown).html.includes('class="inventory"');
    const parsed = parseLedger(markdown).rows.length > 0;
    expect(parsed).toBe(rendered);
  });
});
