/**
 * @module tests/support/contrast
 * Purpose: resolve a theme's colour tokens from the real stylesheets and
 * measure WCAG 2.x contrast between them (D222, plan P WI-3.3).
 *
 * Key decisions:
 * - A theme's tokens are `:root` in `globals.css` overlaid by `.theme-light`
 *   or `.theme-dark`: the theme classes sit on `<html>` with `:root` and are
 *   imported after `globals.css`, so a theme's definition wins.
 * - Only the value forms the theme tokens use are understood: `#rgb` /
 *   `#rrggbb`, `black`, `white`, `transparent`, comma `rgb()` / `rgba()`
 *   (the settings input fills, WI-3.5), `var(--x)` and
 *   `color-mix(in srgb, A p%, B)`. Anything else throws, so a new form fails
 *   the test loudly instead of being measured wrong.
 * - `color-mix` is premultiplied interpolation in sRGB (CSS Color 5), so a
 *   mix with `transparent` keeps A's colour and scales its alpha.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tokenBlock } from "./cssTokenScan";

export type Rgba = [r: number, g: number, b: number, a: number];
export type Theme = "light" | "dark";

const STYLES = join(__dirname, "..", "..", "src", "styles");
const read = (rel: string) => readFileSync(join(STYLES, rel), "utf8");

/** The custom properties in effect on `<html>` in `theme`. */
export function themeTokens(theme: Theme): Map<string, string> {
  const root = tokenBlock(read("globals.css"), ":root");
  const own = tokenBlock(read(`themes/${theme}.css`), `.theme-${theme}`);
  return new Map([...root, ...own]);
}

const NAMED: Record<string, Rgba> = { black: [0, 0, 0, 1], white: [255, 255, 255, 1], transparent: [0, 0, 0, 0] };

function hex(value: string): Rgba | undefined {
  const m = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as Rgba;
}

function mix(a: Rgba, pa: number, b: Rgba): Rgba {
  const pb = 1 - pa;
  const alpha = a[3] * pa + b[3] * pb;
  if (alpha === 0) return [0, 0, 0, 0];
  const ch = (i: number) => (a[i] * a[3] * pa + b[i] * b[3] * pb) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}

/** `value` resolved against `tokens` to an sRGB colour with alpha. */
export function resolveColor(value: string, tokens: ReadonlyMap<string, string>, depth = 0): Rgba {
  if (depth > 20) throw new Error(`token cycle at ${value}`);
  const v = value.trim();
  const named = NAMED[v.toLowerCase()];
  if (named) return named;
  const h = hex(v);
  if (h) return h;
  const fn = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  const ref = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (ref) {
    const def = tokens.get(ref[1]);
    if (def === undefined) throw new Error(`${ref[1]} is not defined`);
    return resolveColor(def, tokens, depth + 1);
  }
  const cm = v.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/);
  if (cm) return mix(resolveColor(cm[1], tokens, depth + 1), Number(cm[2]) / 100, resolveColor(cm[3], tokens, depth + 1));
  throw new Error(`unsupported colour value: ${v}`);
}

/** `top` painted over the opaque `backdrop`. */
export function over(top: Rgba, backdrop: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + backdrop[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
