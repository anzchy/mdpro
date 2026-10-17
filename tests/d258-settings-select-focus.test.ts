// @vitest-environment node
/**
 * @module d258-settings-select-focus.test
 * Purpose: D258. The Settings selects (Editor page: font, line height, …) took
 * keyboard focus with `outline: none` and only an accent border, which rule 33
 * forbids (hard rules 1 and 5): an outline removed without a replacement ring.
 * They now take rule 33 pattern 1, the text inputs' accent border plus soft
 * ring, as the Insert Link URL field and D250's Custom… input do.
 * Follow-up (both audits on PR #494, one shared Medium): the ring is drawn on
 * `:focus-visible`, not `:focus`, so a mouse click on a select paints none
 * (rule 33 hard rule 6); cases 1 and 2 moved to that selector for that reason.
 *
 * Strategy: source inspection (jsdom has no focus rendering), with contrast
 * measured from the theme tokens, as tests/d250-toggle-input-apply-focus.test.ts
 * does. The device Tab walk covers the look.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Theme } from "./support/contrast";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** The declarations of exactly `selector` in one stylesheet, property → value. */
const rule = (file: string, selector: string) =>
  new Map(
    parseDeclarations(read(file))
      .filter((d) => d.selector.split(",").some((s) => s.trim() === selector))
      .map((d) => [d.property, d.value]),
  );

const PAGES = "styles/sections/settings-pages.css";
const THEMES: Theme[] = ["light", "dark"];

describe("D258: the Settings select takes the text-input focus pattern", () => {
  it("is rule 33 pattern 1: accent border plus the soft ring, which replaces the outline", () => {
    const r = rule(PAGES, ".settings-select:focus-visible");
    expect(r.get("border-color")).toBe("var(--color-accent)");
    expect(r.get("box-shadow")).toBe("0 0 0 2px var(--color-accent-soft)");
    expect(r.get("outline")).toBe("none");
  });

  it("matches the Insert Link URL field's focus", () => {
    const link = rule("styles/sections/link-insert-modal.css", ".link-insert-input:focus");
    const select = rule(PAGES, ".settings-select:focus-visible");
    expect(select.get("border-color")).toBe(link.get("border-color"));
    expect(select.get("box-shadow")).toBe(link.get("box-shadow"));
  });

  it("no rule anywhere removes the select's outline without the ring", () => {
    const all = cssFiles().flatMap((f) => parseDeclarations(read(f)).map((d) => ({ ...d, file: f })));
    const outlineOff = all.filter(
      (d) => /\.settings-select(?![\w-])/.test(d.selector) && d.property === "outline" && d.value === "none",
    );
    for (const d of outlineOff) {
      const sameRule = all.filter((x) => x.file === d.file && x.selector === d.selector);
      expect(sameRule.some((x) => x.property === "box-shadow" && x.value.includes("var(--color-accent-soft)"))).toBe(true);
    }
    expect(outlineOff.length).toBeGreaterThan(0);
  });

  it("no rule on plain :focus draws the ring or zeroes the outline, so a click paints nothing", () => {
    const onFocus = cssFiles().flatMap((f) =>
      parseDeclarations(read(f))
        .filter((d) => /\.settings-select:focus(?![\w-])/.test(d.selector))
        .map((d) => `${f} ${d.selector} { ${d.property}: ${d.value} }`),
    );
    expect(onFocus).toEqual([]);
  });

  it.each(THEMES)("%s: the focused border reads at least 3:1 on the select and on the soft ring", (theme) => {
    const t = themeTokens(theme);
    const border = resolveColor("var(--color-accent)", t);
    const panel = resolveColor("var(--color-panel)", t);
    const field = over(resolveColor(rule(PAGES, ".settings-select").get("background")!, t), panel);
    expect(contrast(border, field)).toBeGreaterThanOrEqual(3);
    expect(contrast(border, over(resolveColor("var(--color-accent-soft)", t), panel))).toBeGreaterThanOrEqual(3);
  });
});

/** Every stylesheet under src/, as paths relative to it. */
function cssFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".css"));
}
