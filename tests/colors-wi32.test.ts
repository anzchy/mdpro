// @vitest-environment node
/**
 * @module colors-wi32.test
 * Purpose: the colour rows of plan P WI-3.2. Item 1 (accent-soft for the
 * active TOC row and the shortcut being recorded), the 2026-10-03 rulings R1,
 * R3 and R10, the hover fill (`--color-hover`, review item 7), the active
 * tab's single `--shadow-soft`, and DESIGN.md:123: an elevated surface
 * (`box-shadow: var(--shadow-soft)`) adds no separate border, because the
 * ring is part of the shadow (audit b134 M1); an elevated CodeMirror surface
 * also resets the border CodeMirror's own theme draws (audit b136 M1). Item 15 (`--color-code-bg`)
 * stays deferred: tests/design-tokens-retune.test.ts pins it unchanged.
 *
 * Strategy: source inspection, one row per declaration; the elevation rule
 * is checked over every in-scope stylesheet.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const S = "styles/sections/";
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** The values of `property` on `selector` in `file`. */
const valuesOf = (file: string, selector: string, property: string) =>
  parseDeclarations(read(file))
    .filter((d) => d.selector === selector && d.property === property)
    .map((d) => d.value);

const PRIMARY_HOVER = "color-mix(in srgb, var(--color-accent) 88%, var(--color-text))";

const ROWS: Array<[file: string, selector: string, property: string, values: string[]]> = [
  // item 1
  [S + "toc-sidebar.css", ".toc-entry__content--active", "background", ["var(--color-accent-soft)"]],
  [S + "settings-shell.css", ".shortcut-value.is-editing", "background", ["var(--color-accent-soft)"]],
  // R1
  [S + "settings-mcp.css", ".mcp-client-status.installed", "color", ["var(--color-text)"]],
  // R3 (proposal-ab.html:185)
  [S + "link-insert-modal.css", ".toolbar-button--primary:hover:not(:disabled)", "background", [PRIMARY_HOVER]],
  [S + "settings-pages.css", ".toolbar-button.primary:hover", "background", [PRIMARY_HOVER]],
  // R10
  [S + "settings-about.css", ".about-status-ok", "color", ["var(--color-text)"]],
  [S + "settings-about.css", ".about-status-error", "color", ["var(--color-danger)"]],
  [S + "settings-about.css", ".about-status-disabled", "color", []],
  // hover (review item 7)
  ["components/BottomTabs/BottomTabs.css", ".bottom-tabs__add:hover", "background", ["var(--color-hover)"]],
  ["components/BottomTabs/BottomTabs.css", ".bottom-tab:hover", "background", ["var(--color-hover)"]],
  ["components/BottomTabs/BottomTabs.css", ".bottom-tab__close:hover", "background", ["var(--color-hover)"]],
  [S + "toc-sidebar.css", ".toc-entry__content:hover", "background", ["var(--color-hover)"]],
  // flat tabs: the active tab is the one tab with a shadow (proposal :45)
  ["components/BottomTabs/BottomTabs.css", ".bottom-tab--active", "box-shadow", ["var(--shadow-soft)"]],
];

describe("WI-3.2 colour rows", () => {
  for (const [file, selector, property, values] of ROWS) {
    it(`${selector} { ${property} } = ${values.join(", ") || "(none)"}`, () => {
      expect(valuesOf(file, selector, property)).toEqual(values);
    });
  }
});

describe("elevated surfaces add no separate border (DESIGN.md:123)", () => {
  const EXCLUDED = new Set(["App.css", "styles/themes/light.css", "styles/themes/dark.css"]);
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".css") && !EXCLUDED.has(p));
  const EDGE = /^border(-(top|right|bottom|left))?(-(width|style|color))?$/;
  const NO_EDGE = new Set(["none", "0", "0px"]);

  it("finds the elevated surfaces it checks", () => {
    const elevated = files.flatMap((f) =>
      parseDeclarations(read(f))
        .filter((d) => d.property === "box-shadow" && d.value === "var(--shadow-soft)")
        .map((d) => d.selector),
    );
    expect(elevated.length).toBeGreaterThanOrEqual(6);
  });

  it("an elevated CodeMirror surface resets the border CodeMirror's base theme draws (audit b136 M1)", () => {
    // @codemirror/view's light theme gives `.cm-tooltip` `border: 1px solid #bbb`;
    // declaring no border of our own is not enough, the app rule must remove it.
    const unreset = files.flatMap((f) => {
      const decls = parseDeclarations(read(f));
      const elevated = new Set(
        decls
          .filter((d) => d.property === "box-shadow" && d.value === "var(--shadow-soft)" && /\.cm-/.test(d.selector))
          .map((d) => d.selector),
      );
      return [...elevated]
        .filter((sel) => !decls.some((d) => d.selector === sel && d.property === "border" && NO_EDGE.has(d.value)))
        .map((sel) => `${f}: ${sel}`);
    });
    expect(unreset).toEqual([]);
  });

  for (const file of files) {
    it(file, () => {
      const decls = parseDeclarations(read(file));
      const elevated = new Set(
        decls.filter((d) => d.property === "box-shadow" && d.value === "var(--shadow-soft)").map((d) => d.selector),
      );
      const bordered = decls
        .filter((d) => elevated.has(d.selector) && EDGE.test(d.property) && !NO_EDGE.has(d.value))
        .map((d) => `${d.line} ${d.selector} { ${d.property}: ${d.value} }`);
      expect(bordered).toEqual([]);
    });
  }
});
