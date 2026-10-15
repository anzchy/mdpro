// @vitest-environment node
/**
 * D231, styling half: option c with active-tab fill 6c, as the user approved
 * on prototype/d231-d234-focus (「1. 6c OK」).
 *
 * - The active tab is filled, not lifted: text 16% over the bar surface in
 *   light, 30% in dark (`--color-tab-active-fill`), with no shadow.
 * - The × shows on the active tab at rest, on any tab with keyboard focus
 *   inside it, and at full strength with a 2px ring when focused itself.
 * - Dark's 30% fill put the resting × at 0.5 and the accent ring and dot under
 *   3:1, so the active tab's resting × uses `--tab-active-close-opacity`
 *   (0.5 light, 0.6 dark) and its ring and dot `--color-tab-active-accent`
 *   (the accent in light, #93c5fd in dark).
 *
 * The readouts are pinned at the prototype's measurements, so a token change
 * fails here and has to be re-ruled. Colours are read from the rules that
 * paint them and the real theme tokens.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Rgba, type Theme } from "./support/contrast";

const CSS_FILE = join(__dirname, "..", "src", "components", "BottomTabs", "BottomTabs.css");
const decls = () => parseDeclarations(readFileSync(CSS_FILE, "utf8"));
const value = (selector: string, property: string): string | undefined =>
  decls().find((d) => d.property === property && d.selector.split(",").some((s) => s.trim() === selector))?.value;
const required = (selector: string, property: string): string => {
  const v = value(selector, property);
  if (v === undefined) throw new Error(`BottomTabs.css: no ${property} in ${selector}`);
  return v;
};
/** The colour in an `outline` shorthand such as `2px solid var(--x)`. */
const outlineColour = (v: string) => v.match(/var\(--[\w-]+\)/)?.[0] ?? v;

function readouts(theme: Theme) {
  const t = themeTokens(theme);
  const surface = resolveColor("var(--color-surface)", t);
  const fill = over(resolveColor(required(".bottom-tab--active", "background"), t), surface);
  const text = resolveColor("var(--color-text)", t);
  const opacity = Number(resolveVar(required(".bottom-tab--active .bottom-tab__close", "opacity"), t));
  const glyph: Rgba = [text[0], text[1], text[2], opacity];
  const ring = resolveColor(outlineColour(required(".bottom-tab--active .bottom-tab__close:focus-visible", "outline")), t);
  const dot = resolveColor(required(".bottom-tab--active .bottom-tab__modified", "background"), t);
  return {
    opacity,
    label: contrast(text, fill),
    close: contrast(over(glyph, fill), fill),
    ring: contrast(ring, fill),
    dot: contrast(dot, fill),
  };
}

function resolveVar(v: string, t: ReadonlyMap<string, string>): string {
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolveVar(t.get(m[1]) ?? "", t) : v.trim();
}

const PINNED: Record<Theme, { opacity: number; label: number; close: number; ring: number }> = {
  light: { opacity: 0.5, label: 11.71, close: 3.02, ring: 3.48 },
  dark: { opacity: 0.6, label: 5.81, close: 3.22, ring: 3.99 },
};

describe("D231 the active tab (6c) meets A9 in both themes", () => {
  it.each<Theme>(["light", "dark"])("%s: label ≥ 4.5, resting × ≥ 3, × ring ≥ 3, unsaved dot ≥ 3", (theme) => {
    const r = readouts(theme);
    expect(r.label).toBeGreaterThanOrEqual(4.5);
    expect(r.close).toBeGreaterThanOrEqual(3);
    expect(r.ring).toBeGreaterThanOrEqual(3);
    expect(r.dot).toBeGreaterThanOrEqual(3);
  });

  it.each<Theme>(["light", "dark"])("%s: the readouts stay at the approved prototype's", (theme) => {
    const r = readouts(theme);
    const p = PINNED[theme];
    expect(r.opacity).toBe(p.opacity);
    expect(r.label).toBeCloseTo(p.label, 1);
    expect(r.close).toBeCloseTo(p.close, 1);
    expect(r.ring).toBeCloseTo(p.ring, 1);
    expect(r.dot).toBeCloseTo(p.ring, 1);
  });

  it("dark's lighter accent is blue-300 and light's is the accent itself", () => {
    expect(resolveColor("var(--color-tab-active-accent)", themeTokens("dark")).slice(0, 3)).toEqual([0x93, 0xc5, 0xfd]);
    const light = themeTokens("light");
    expect(resolveColor("var(--color-tab-active-accent)", light)).toEqual(resolveColor("var(--color-accent)", light));
  });

  it("the active tab is filled with the token and no longer lifted by a shadow", () => {
    expect(required(".bottom-tab--active", "background")).toBe("var(--color-tab-active-fill)");
    expect(value(".bottom-tab--active", "box-shadow")).toBeUndefined();
  });
});

describe("D231 option c: when the × shows", () => {
  it("any tab with keyboard focus inside it shows its × at 0.5", () => {
    expect(required(".bottom-tab:focus-within .bottom-tab__close", "opacity")).toBe("0.5");
  });

  it("a focused × is at full strength with a 2px focus-ring outline", () => {
    expect(required(".bottom-tab__close:focus-visible", "opacity")).toBe("1");
    expect(required(".bottom-tab__close:focus-visible", "outline")).toBe("2px solid var(--color-focus-ring)");
  });

  it("a keyboard-focused tab draws a 2px inset ring around the whole tab", () => {
    expect(required(".bottom-tab:has(.bottom-tab__select:focus-visible)", "outline")).toBe(
      "2px solid var(--color-focus-ring)",
    );
    expect(required(".bottom-tab:has(.bottom-tab__select:focus-visible)", "outline-offset")).toBe("-2px");
    expect(
      outlineColour(required(".bottom-tab--active:has(.bottom-tab__select:focus-visible)", "outline-color")),
    ).toBe("var(--color-tab-active-accent)");
  });
});

describe("D231 the cascade keeps those states (found in the browser check)", () => {
  // `.bottom-tab:hover .bottom-tab__close` and `.bottom-tab:focus-within
  // .bottom-tab__close` are (0,3,0). Without the higher-ranked forms below, a
  // focused × stayed at 0.5, a hovered or focused active tab dropped dark's ×
  // to 0.5 (2.73:1), and dark's focused × took the plain accent ring (2.81:1).
  it("a focused × reaches full strength even while its tab has focus within", () => {
    expect(required(".bottom-tab:focus-within .bottom-tab__close:focus-visible", "opacity")).toBe("1");
  });

  it.each([".bottom-tab--active:hover .bottom-tab__close", ".bottom-tab--active:focus-within .bottom-tab__close"])(
    "%s keeps the active tab's resting opacity",
    (selector) => {
      expect(required(selector, "opacity")).toBe("var(--tab-active-close-opacity)");
    },
  );

  it("the active tab's focused × keeps the active-tab accent ring while its tab has focus within", () => {
    expect(outlineColour(required(".bottom-tab--active:focus-within .bottom-tab__close:focus-visible", "outline"))).toBe(
      "var(--color-tab-active-accent)",
    );
  });
});
