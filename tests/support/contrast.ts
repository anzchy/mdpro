/**
 * @module tests/support/contrast
 * Purpose: resolve a theme's colour tokens from the real stylesheets and
 * measure WCAG 2.x contrast between them (D222, plan P WI-3.3).
 *
 * Key decisions:
 * - A theme's tokens are `:root` in `globals.css` overlaid by `.theme-light`
 *   or `.theme-dark`: the theme classes sit on `<html>` with `:root` and are
 *   imported after `globals.css`, so a theme's definition wins.
 * - Only the value forms the theme tokens use are understood: `#rgb`,
 *   `#rgba`, `#rrggbb`, `#rrggbbaa`, `black`, `white`, `transparent`, comma
 *   `rgb()` / `rgba()` (the dark Settings fills), `var(--x)`,
 *   `var(--x, fallback)` (the fallback only when `--x` is undeclared, as CSS
 *   does; D278's C8 baseline) and `color-mix(in srgb, A p%, B)`. Anything
 *   else throws, so a new form fails the test loudly instead of being
 *   measured wrong.
 * - `toHex` is the one serialiser (D278): lowercase, alpha kept, 6 digits
 *   when opaque and 8 otherwise, with alpha `round(a × 255)`. The Stitch
 *   sidecar and the highlight pin both use it.
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

/** The custom properties of `:root` alone: first paint, before a theme class is set (D278). */
export function rootTokens(): Map<string, string> {
  return tokenBlock(read("globals.css"), ":root");
}

/** The custom properties in effect on `<html>` in `theme`. */
export function themeTokens(theme: Theme): Map<string, string> {
  const root = tokenBlock(read("globals.css"), ":root");
  const own = tokenBlock(read(`themes/${theme}.css`), `.theme-${theme}`);
  return new Map([...root, ...own]);
}

const NAMED: Record<string, Rgba> = { black: [0, 0, 0, 1], white: [255, 255, 255, 1], transparent: [0, 0, 0, 0] };

function hex(value: string): Rgba | undefined {
  const m = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return undefined;
  const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(alpha) as Rgba;
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
  const ref = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (ref) {
    const def = tokens.get(ref[1]);
    if (def !== undefined) return resolveColor(def, tokens, depth + 1);
    if (ref[2] !== undefined) return resolveColor(ref[2], tokens, depth + 1);
    throw new Error(`${ref[1]} is not defined`);
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

/** `c` as lowercase hex: `#rrggbb` when opaque, `#rrggbbaa` otherwise (D278). */
export function toHex(c: Rgba): string {
  const byte = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");
  const rgb = `#${byte(c[0])}${byte(c[1])}${byte(c[2])}`;
  return c[3] >= 1 ? rgb : rgb + byte(c[3] * 255);
}
