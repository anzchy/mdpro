// @vitest-environment node
/**
 * @module d250-toggle-input-apply-focus.test
 * Purpose: D250. Three keyboard stops the D244 device walk found outside
 * D244's buttons (report-20261016-d244-c7.md O1–O3):
 * - the MCP toggles' checkbox is 0×0 and transparent, and nothing drew its
 *   focus: the track now takes rule 33 pattern 2 when the checkbox has
 *   keyboard focus;
 * - the image menu's Custom… width input drew WebKit's default ring
 *   (2.15:1): it now takes rule 33 pattern 1, the text inputs' accent border
 *   and soft ring, as the Insert Link URL field does;
 * - the image menu's Apply was filled with the accent (`#60a5fa` in dark, the
 *   colour of its own ring): it now takes D222's primary fill and text, as
 *   Settings' primary buttons do.
 *
 * Strategy: source inspection (jsdom has no `:focus-visible`), with contrast
 * measured from the theme tokens, as tests/d244-button-focus-visible.test.ts
 * does. The device Tab walk covers what a selector cannot.
 */

import { readFileSync } from "node:fs";
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

const ROWS = "styles/sections/settings-rows.css";
const MENU = "components/Editor/ImageContextMenu.css";
const THEMES: Theme[] = ["light", "dark"];

describe("D250 (O1): the MCP toggles show keyboard focus", () => {
  const TRACK_RING = ".toggle-switch input:focus-visible + .toggle-slider";

  it("the track draws rule 33 pattern 2 when its checkbox has keyboard focus", () => {
    const r = rule(ROWS, TRACK_RING);
    expect(r.get("outline")).toBe("2px solid var(--color-focus-ring)");
    expect(r.get("outline-offset")).toBe("2px");
  });

  it("the checkbox is the track's previous sibling, so the `+` combinator reaches it", () => {
    const tsx = read("components/common/McpToggleRow.tsx");
    expect(tsx).toMatch(/<label className="toggle-switch">\s*<input\b[^>]*type="checkbox"[\s\S]*?\/>\s*<span className="toggle-slider" \/>/);
  });

  it.each(THEMES)("%s: the ring reads at least 3:1 on the dialog", (theme) => {
    const t = themeTokens(theme);
    const ring = resolveColor("var(--color-focus-ring)", t);
    expect(contrast(ring, resolveColor("var(--color-panel)", t))).toBeGreaterThanOrEqual(3);
  });
});

describe("D250 (O2): the Custom… width input takes the text-input focus pattern", () => {
  it("is rule 33 pattern 1, and replaces WebKit's ring only together with it", () => {
    const r = rule(MENU, ".image-context-menu-input:focus");
    expect(r.get("border-color")).toBe("var(--color-accent)");
    expect(r.get("box-shadow")).toBe("0 0 0 2px var(--color-accent-soft)");
    expect(r.get("outline")).toBe("none");
  });

  it("matches the Insert Link URL field's focus", () => {
    const link = rule("styles/sections/link-insert-modal.css", ".link-insert-input:focus");
    const input = rule(MENU, ".image-context-menu-input:focus");
    expect(input.get("border-color")).toBe(link.get("border-color"));
    expect(input.get("box-shadow")).toBe(link.get("box-shadow"));
  });

  it.each(THEMES)("%s: the focused border reads at least 3:1 on the input and on the menu", (theme) => {
    const t = themeTokens(theme);
    const border = resolveColor("var(--color-accent)", t);
    const panel = resolveColor("var(--color-panel)", t);
    expect(contrast(border, resolveColor(rule(MENU, ".image-context-menu-input").get("background")!, t))).toBeGreaterThanOrEqual(3);
    expect(contrast(border, over(resolveColor("var(--color-accent-soft)", t), panel))).toBeGreaterThanOrEqual(3);
  });
});

describe("D250 (O3): Apply takes D222's primary fill", () => {
  it("is filled and edged with --color-accent-fill, with --color-on-accent text", () => {
    const r = rule(MENU, ".image-context-menu-apply");
    expect(r.get("background")).toBe("var(--color-accent-fill)");
    expect(r.get("border")).toBe("1px solid var(--color-accent-fill)");
    expect(r.get("color")).toBe("var(--color-on-accent)");
  });

  it("darkens on hover as Settings' primary buttons do", () => {
    expect(rule(MENU, ".image-context-menu-apply:hover:not(:disabled)").get("background")).toBe(
      "var(--color-accent-fill-hover)",
    );
  });

  it.each(THEMES)("%s: Apply's text reads at least 4.5:1 on its fill, resting and hovered", (theme) => {
    const t = themeTokens(theme);
    const text = resolveColor("var(--color-on-accent)", t);
    for (const fill of ["var(--color-accent-fill)", "var(--color-accent-fill-hover)"]) {
      expect(contrast(text, resolveColor(fill, t))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("in dark, the fill is no longer the colour of its own focus ring", () => {
    const t = themeTokens("dark");
    expect(resolveColor("var(--color-accent-fill)", t)).not.toEqual(resolveColor("var(--color-focus-ring)", t));
  });
});
