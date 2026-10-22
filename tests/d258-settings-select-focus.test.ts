// @vitest-environment node
/**
 * @module d258-settings-select-focus.test
 * Purpose: D258. The Settings selects (Editor page: font, line height, …) took
 * keyboard focus with `outline: none` and only an accent border, which rule 33
 * forbids (hard rules 1 and 5): an outline removed without a replacement ring.
 * The text-input box-shadow ring did not paint on the native select in
 * WebKit, so the select uses rule 33 pattern 2's solid 2px focus outline.
 * The ring remains on `:focus-visible`, not `:focus` (rule 33 hard rule 6).
 * WebKit intentionally matches `:focus-visible` on macOS selects after a
 * pointer click, so CSS alone cannot guarantee pointer suppression here.
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

describe("D258: the Settings select paints a focus ring in WebKit", () => {
  it("uses an accent border plus rule 33 pattern 2 instead of the unpainted shadow", () => {
    const r = rule(PAGES, ".settings-select:focus-visible");
    expect(r.get("border-color")).toBe("var(--color-accent)");
    expect(r.get("outline")).toBe("2px solid var(--color-focus-ring)");
    expect(r.get("outline-offset")).toBe("2px");
    expect(r.get("box-shadow")).toBeUndefined();
  });

  it("keeps the native select appearance and arrow", () => {
    const selectDeclarations = parseDeclarations(read(PAGES)).filter((d) =>
      d.selector.split(",").some((s) => /\.settings-select(?![\w-])/.test(s.trim())),
    );
    expect(
      selectDeclarations.filter((d) => d.property === "appearance" || d.property === "-webkit-appearance"),
    ).toEqual([]);
  });

  it("no rule anywhere removes the select's outline", () => {
    const all = cssFiles().flatMap((f) => parseDeclarations(read(f)).map((d) => ({ ...d, file: f })));
    const outlineOff = all.filter(
      (d) => /\.settings-select(?![\w-])/.test(d.selector) && d.property === "outline" && d.value === "none",
    );
    expect(outlineOff).toEqual([]);
  });

  it("no rule on plain :focus explicitly opts pointer focus into the custom style", () => {
    const onFocus = cssFiles().flatMap((f) =>
      parseDeclarations(read(f))
        .filter((d) => /\.settings-select:focus(?![\w-])/.test(d.selector))
        .map((d) => `${f} ${d.selector} { ${d.property}: ${d.value} }`),
    );
    expect(onFocus).toEqual([]);
  });

  it.each(THEMES)("%s: the focused border and ring each read at least 3:1", (theme) => {
    const t = themeTokens(theme);
    const border = resolveColor("var(--color-accent)", t);
    const ring = resolveColor("var(--color-focus-ring)", t);
    const panel = resolveColor("var(--color-panel)", t);
    const field = over(resolveColor(rule(PAGES, ".settings-select").get("background")!, t), panel);
    expect(contrast(border, field)).toBeGreaterThanOrEqual(3);
    expect(contrast(ring, field)).toBeGreaterThanOrEqual(3);
    expect(contrast(ring, panel)).toBeGreaterThanOrEqual(3);
  });
});

/** Every stylesheet under src/, as paths relative to it. */
function cssFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".css"));
}
