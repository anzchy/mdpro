/**
 * @module tests/support/stitchSidecar
 * Purpose: generate the YAML front matter of `design/DESIGN.stitch.md`, the
 * Stitch-format sidecar of `design/DESIGN.md` (D278-WI-3; user rulings
 * 「Generated sidecar (Recommended)」, 「light and dark both」), from the
 * declared CSS tokens. `tests/design-token-parity.test.ts` S1–S5 compare it
 * with the committed file, or write it under `MDPRO_WRITE_SIDECAR=1`.
 *
 * Key decisions:
 * - `colors:` is `:root` + light and `colors-dark:` is `:root` + dark, with
 *   the same keys. Each value is the token resolved by `resolveColor` (the
 *   resolver the contrast tests use), not composited over any backdrop, and
 *   serialised by `toHex`: alpha is kept. A mapped colour that does not
 *   resolve (a gradient, a shadow) throws.
 * - Non-colour keys mapped to a token are written as the token's literal
 *   text; `fontFamily` is the first family of `--font-sans` / `--font-mono`,
 *   because Stitch takes one family. Keys with no token (line heights,
 *   weights, the spacing steps) are constants here.
 * - Hosted in the test helpers, not `scripts/`: `contrast.ts` builds its
 *   paths from `__dirname`, which only vitest provides in this ESM package.
 * - Only the front matter is generated. The prose body is hand-written and
 *   kept byte for byte.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveColor, themeTokens, toHex } from "./contrast";

export type TokenSet = ReadonlyMap<string, string>;
export interface TokenSets {
  light: TokenSet;
  dark: TokenSet;
}

const SIDECAR = join(__dirname, "..", "..", "design", "DESIGN.stitch.md");
const NAME = "mdpro — Quiet paper, command surface";

/** Stitch colour key → CSS token. The same keys go into `colors:` and `colors-dark:`. */
export const COLOURS: ReadonlyArray<readonly [key: string, token: string]> = [
  ["background", "--color-bg"],
  ["surface", "--color-surface"],
  ["surface-panel", "--color-panel"],
  ["editor-background", "--color-editor-bg"],
  ["on-surface", "--color-text"],
  ["on-surface-muted", "--color-muted"],
  ["primary", "--color-accent"],
  ["on-primary", "--color-on-accent"],
  ["primary-soft", "--color-accent-soft"],
  ["primary-text", "--color-accent-text"],
  ["primary-fill", "--color-accent-fill"],
  ["primary-fill-hover", "--color-accent-fill-hover"],
  ["hover", "--color-hover"],
  ["outline", "--color-border"],
  ["outline-subtle", "--color-border-subtle"],
  ["control-outline", "--color-control-border"],
  ["error", "--color-danger"],
  ["error-soft", "--color-danger-soft"],
  ["error-text", "--color-error-text"],
  ["code-surface", "--color-code-bg"],
  ["highlight", "--color-highlight"],
  ["scrim", "--color-scrim"],
];

interface TypeStyle {
  family: "--font-sans" | "--font-mono";
  size: string;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
}

/** Stitch type style → its tokens (`family`, `size`) and constants. */
const TYPOGRAPHY: ReadonlyArray<readonly [key: string, style: TypeStyle]> = [
  ["ui-sm", { family: "--font-sans", size: "--font-size-ui-sm", weight: "400", lineHeight: "16px", letterSpacing: "0" }],
  ["ui", { family: "--font-sans", size: "--font-size-ui", weight: "400", lineHeight: "18px", letterSpacing: "0" }],
  ["ui-lg", { family: "--font-sans", size: "--font-size-ui-lg", weight: "600", lineHeight: "20px", letterSpacing: "0" }],
  ["title", { family: "--font-sans", size: "--font-size-title", weight: "600", lineHeight: "22px", letterSpacing: "0" }],
  ["section-label", { family: "--font-sans", size: "--font-size-ui-sm", weight: "600", lineHeight: "16px", letterSpacing: "0.04em" }],
  ["value-mono", { family: "--font-mono", size: "--font-size-ui-sm", weight: "400", lineHeight: "16px", letterSpacing: "0" }],
  ["editor-body", { family: "--font-sans", size: "--editor-font-size", weight: "400", lineHeight: "26px", letterSpacing: "0" }],
];

/** Stitch radius key → token, or a constant (`999px` pills, DR23). */
const ROUNDED: ReadonlyArray<readonly [key: string, tokenOrValue: string]> = [
  ["inner", "--radius-inner"],
  ["DEFAULT", "--radius-control"],
  ["popover", "--radius-popover"],
  ["full", "999px"],
];

/** Stitch spacing key → token, or a constant (the ad-hoc 4–24px steps, rule 31). */
const SPACING: ReadonlyArray<readonly [key: string, tokenOrValue: string]> = [
  ["unit", "4px"],
  ["xs", "4px"],
  ["sm", "8px"],
  ["md", "12px"],
  ["lg", "16px"],
  ["xl", "24px"],
  ["title-bar-height", "--title-bar-height"],
  ["sidebar-width", "--sidebar-width"],
];

const isToken = (s: string) => s.startsWith("--");

/** Every CSS token the sidecar reads, once each. */
export function mappedTokens(): string[] {
  const names = [
    ...COLOURS.map(([, t]) => t),
    ...TYPOGRAPHY.flatMap(([, s]) => [s.family, s.size]),
    ...ROUNDED.map(([, t]) => t),
    ...SPACING.map(([, t]) => t),
  ].filter(isToken);
  return [...new Set(names)];
}

/** A mapped token that is undeclared in `declared`, or interim (it is about to be deleted). */
export function mappingDefects(tokens: Iterable<string>, declared: ReadonlySet<string>, interim: Record<string, string>): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (!declared.has(t)) out.push(`${t}: not declared`);
    else if (t in interim) out.push(`${t}: Interim (${interim[t]})`);
  }
  return out;
}

/** `token` in `tokens` as sRGB hex with alpha. Throws when undeclared or not a colour. */
export function colourHex(token: string, tokens: TokenSet): string {
  const value = tokens.get(token);
  if (value === undefined) throw new Error(`${token} is not declared`);
  return toHex(resolveColor(value, tokens));
}

function literal(tokenOrValue: string, tokens: TokenSet): string {
  if (!isToken(tokenOrValue)) return tokenOrValue;
  const value = tokens.get(tokenOrValue);
  if (value === undefined) throw new Error(`${tokenOrValue} is not declared`);
  return value.trim();
}

function firstFamily(stack: string): string {
  return stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

/** A YAML scalar: quoted when plain YAML would read it as a comment, a number, or not a string. */
function scalar(v: string): string {
  return /^[#\d.'"]|^$|: | #/.test(v) && !/^\d+(\.\d+)?(px|em)$/.test(v) ? `'${v.replace(/'/g, "''")}'` : v;
}

/** The light and dark token sets the app's stylesheets declare. */
export function stylesheetTokens(): TokenSets {
  return { light: themeTokens("light"), dark: themeTokens("dark") };
}

/** The front matter, `---` lines included, for the given token sets (default: the stylesheets). */
export function frontMatter(sets: TokenSets = stylesheetTokens()): string {
  const lines = ["---", `name: ${NAME}`];
  for (const [section, tokens] of [["colors", sets.light], ["colors-dark", sets.dark]] as const) {
    lines.push(`${section}:`);
    for (const [key, token] of COLOURS) lines.push(`  ${key}: ${scalar(colourHex(token, tokens))}`);
  }
  lines.push("typography:");
  for (const [key, s] of TYPOGRAPHY) {
    lines.push(
      `  ${key}:`,
      `    fontFamily: ${scalar(firstFamily(literal(s.family, sets.light)))}`,
      `    fontSize: ${scalar(literal(s.size, sets.light))}`,
      `    fontWeight: ${scalar(s.weight)}`,
      `    lineHeight: ${scalar(s.lineHeight)}`,
      `    letterSpacing: ${scalar(s.letterSpacing)}`,
    );
  }
  lines.push("rounded:");
  for (const [key, t] of ROUNDED) lines.push(`  ${key}: ${scalar(literal(t, sets.light))}`);
  lines.push("spacing:");
  for (const [key, t] of SPACING) lines.push(`  ${key}: ${scalar(literal(t, sets.light))}`);
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

/** The committed sidecar split into its front matter (`---` lines included) and its body. */
export function splitSidecar(text: string): { front: string; body: string } {
  const end = text.indexOf("\n---\n", 3);
  if (!text.startsWith("---\n") || end < 0) throw new Error("the sidecar has no `---` front matter");
  return { front: text.slice(0, end + 5), body: text.slice(end + 5) };
}

/** The keys directly under a top-level `section:` of the front matter. */
export function sectionKeys(front: string, section: string): string[] {
  const keys: string[] = [];
  let inside = false;
  for (const line of front.split("\n")) {
    if (/^\S/.test(line)) inside = line === `${section}:`;
    else if (inside) {
      const m = /^ {2}([\w-]+):/.exec(line);
      if (m) keys.push(m[1]);
    }
  }
  return keys;
}

/** The dotted key path of the first line where two front matters differ, e.g. `colors-dark.primary`. */
export function firstDifference(a: string, b: string): string | undefined {
  const la = a.split("\n");
  const lb = b.split("\n");
  const path: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    const line = la[i] ?? lb[i];
    const m = /^( *)([\w-]+):/.exec(line);
    if (m) path.splice(m[1].length / 2, Infinity, m[2]);
    if (la[i] !== lb[i]) return path.join(".") || `line ${i + 1}`;
  }
  return undefined;
}

/** The committed `design/DESIGN.stitch.md`, or `undefined` when it does not exist. */
export function readSidecar(): string | undefined {
  return existsSync(SIDECAR) ? readFileSync(SIDECAR, "utf8") : undefined;
}

/** Replace the committed sidecar's front matter with `front`, keeping its body byte for byte. */
export function writeFrontMatter(front: string): void {
  const text = readSidecar();
  if (text === undefined) throw new Error("design/DESIGN.stitch.md does not exist; write its body first");
  writeFileSync(SIDECAR, front + splitSidecar(text).body);
}
