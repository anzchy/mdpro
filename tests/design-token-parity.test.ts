// @vitest-environment node
/**
 * @module design-token-parity.test
 * Purpose: D278-WI-1. The token docs and the declared tokens check each
 * other (user: 「Rule 31 文档和实际 token 互相核对」):
 * - P1 every declared token is documented: the backticked token opening the
 *   first cell of a DESIGN.md § Tokens table row, or a rule 31 bullet head.
 *   A mention anywhere else (another row's cell, prose) does not count.
 * - P2 every § Tokens row names a declared token, unless it is `Planned`.
 * - P3 every rule 31 bullet-head token is declared.
 * - P4 every declared token is consumed: `var(--x` anywhere in app source,
 *   including inside another token's value, or a quoted `"--x"` in TS.
 * - P5 markers: `Planned (WI-…)` on an undeclared token, `Interim (WI-…)` on
 *   a declared one that the named WI deletes; the INTERIM list is required.
 * - P6 theme structure: light and dark declare the same keys, each has a
 *   `:root` default that resolves equal to light, a token zeroed under
 *   reduced motion is in no theme block, and the root-only set is pinned.
 *
 * Strategy: source inspection. The checks are pure functions over text, so
 * the fixtures below exercise each one against a planted defect.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, tokenBlock } from "./support/cssTokenScan";
import { resolveColor, type Rgba } from "./support/contrast";
import { MARKER, markerDefects, tableRows, tokensSlice, undeclaredRows, unconsumed } from "./support/tokenDocs";
import { colourHex, COLOURS, firstDifference, frontMatter, mappedTokens, mappingDefects, readSidecar, sectionKeys, splitSidecar, stylesheetTokens, writeFrontMatter } from "./support/stitchSidecar";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const GLOBALS = read("src/styles/globals.css");
const LIGHT = read("src/styles/themes/light.css");
const DARK = read("src/styles/themes/dark.css");
const DESIGN = read("design/DESIGN.md");
const RULE31 = read(".claude/rules/31-design-tokens.md");

/** Tokens at the head of a rule 31 bullet: `- \`--a\`…` and comma lists `- \`--a\`, \`--b\`…`. */
function bulletHeads(rule31: string): Set<string> {
  const heads = new Set<string>();
  for (const line of rule31.split("\n")) {
    const m = /^\s*[-*]\s+(`--[\w-]+`(?:\s*,\s*`--[\w-]+`)*)/.exec(line);
    if (m) for (const t of m[1].matchAll(/`(--[\w-]+)`/g)) heads.add(t[1]);
  }
  return heads;
}

const BLOCKS = { root: tokenBlock(GLOBALS, ":root"), light: tokenBlock(LIGHT, ".theme-light"), dark: tokenBlock(DARK, ".theme-dark") };
const declared = new Set([...BLOCKS.root.keys(), ...BLOCKS.light.keys(), ...BLOCKS.dark.keys()]);

/** P1: declared tokens with no first-cell row and no bullet head. */
function undocumented(tokens: Iterable<string>, design: string, rule31: string): string[] {
  const rows = tableRows(design);
  const heads = bulletHeads(rule31);
  return [...tokens].filter((t) => !rows.has(t) && !heads.has(t)).sort();
}

/** Tokens D278 introduced as interim, with the WI that deletes each (plan WI-2). */
const INTERIM: Record<string, string> = {
  "--color-running-fill": "WI-4.4 item 6",
  "--color-running-text": "WI-4.4 item 6",
  "--color-banner-unsaved": "WI-4.3",
};

/** The `:root`-only tokens on 18b63216 (P6e); a new one is a deliberate edit here. */
const ROOT_ONLY = [
  "--bottom-tabs-height",
  "--color-focus-ring",
  "--color-on-accent",
  "--color-scrim",
  "--content-padding",
  "--editor-content-width",
  "--editor-font-family",
  "--editor-font-size",
  "--editor-line-height",
  "--font-mono",
  "--font-sans",
  "--font-size-title",
  "--font-size-ui",
  "--font-size-ui-lg",
  "--font-size-ui-sm",
  "--main-min-width",
  "--motion-duration-fast",
  "--radius-control",
  "--radius-inner",
  "--radius-popover",
  "--sidebar-width",
  "--sidebar-width-min",
  "--title-bar-height",
  "--traffic-lights-clearance",
  "--traffic-lights-clearance-main",
  "--traffic-lights-end",
];

/** The tokens globals.css's `@media (prefers-reduced-motion: reduce) { :root { … } }` sets. */
function reducedMotionTokens(globals: string): string[] {
  const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(blankComments(globals));
  return m ? [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]) : [];
}

/** A value resolved for comparison: colours as rounded channels, anything else as alias-resolved text. */
function comparable(value: string, tokens: ReadonlyMap<string, string>): string {
  try {
    const c: Rgba = resolveColor(value, tokens);
    return c.map((n) => n.toFixed(6)).join(",");
  } catch {
    let v = value;
    for (let i = 0; i < 8; i += 1) {
      const alias = /^var\((--[\w-]+)\)$/.exec(v);
      const next = alias ? tokens.get(alias[1]) : undefined;
      if (next === undefined) break;
      v = next;
    }
    return v;
  }
}

interface Blocks {
  root: ReadonlyMap<string, string>;
  light: ReadonlyMap<string, string>;
  dark: ReadonlyMap<string, string>;
}

/** P6a–e defects for `blocks`, given the reduced-motion tokens and the pinned root-only list. */
function themeDefects(blocks: Blocks, reduced: string[], rootOnly: string[]): string[] {
  const out: string[] = [];
  const light = new Set(blocks.light.keys());
  const dark = new Set(blocks.dark.keys());
  for (const k of light) if (!dark.has(k)) out.push(`P6a ${k}: light only`);
  for (const k of dark) if (!light.has(k)) out.push(`P6a ${k}: dark only`);
  const rootSet = new Map(blocks.root);
  const lightSet = new Map([...blocks.root, ...blocks.light]);
  for (const k of new Set([...light, ...dark])) {
    if (!blocks.root.has(k)) {
      out.push(`P6b ${k}: no :root default`);
      continue;
    }
    if (light.has(k) && comparable(blocks.root.get(k) ?? "", rootSet) !== comparable(blocks.light.get(k) ?? "", lightSet)) {
      out.push(`P6c ${k}: :root resolves differently from light`);
    }
  }
  for (const k of reduced) if (light.has(k) || dark.has(k)) out.push(`P6d ${k}: in a theme block overrides reduced motion`);
  const actual = [...blocks.root.keys()].filter((k) => !light.has(k) && !dark.has(k)).sort();
  const expected = [...rootOnly].sort();
  for (const k of actual) if (!expected.includes(k)) out.push(`P6e ${k}: root-only but not in ROOT_ONLY`);
  for (const k of expected) if (!actual.includes(k)) out.push(`P6e ${k}: in ROOT_ONLY but not root-only`);
  return out.sort();
}

const appSources = (readdirSync(SRC, { recursive: true }) as string[])
  .map((p) => p.split("\\").join("/"))
  .filter((p) => /\.(css|ts|tsx)$/.test(p))
  .map((p) => blankComments(readFileSync(join(SRC, p), "utf8")));

describe("D278-WI-1: docs and declared tokens agree", () => {
  it("P1 every declared token is documented", () => {
    expect(undocumented(declared, DESIGN, RULE31)).toEqual([]);
  });

  it("P2 every § Tokens row names a declared token, unless Planned", () => {
    expect(undeclaredRows(DESIGN, declared)).toEqual([]);
  });

  it("P3 every rule 31 bullet-head token is declared", () => {
    expect([...bulletHeads(RULE31)].filter((t) => !declared.has(t)).sort()).toEqual([]);
  });

  it("P4 every declared token is consumed", () => {
    expect(unconsumed(declared, appSources)).toEqual([]);
  });

  it("P5 markers are right, and the interim tokens carry theirs", () => {
    expect(markerDefects(DESIGN, declared, INTERIM)).toEqual([]);
  });

  it("P6 theme structure holds", () => {
    expect(themeDefects(BLOCKS, reducedMotionTokens(GLOBALS), ROOT_ONLY)).toEqual([]);
  });

  it("the planned rows are exactly the five D278 measured", () => {
    const planned = [...tableRows(DESIGN)].filter(([, row]) => MARKER.exec(row)?.[1] === "Planned").map(([t]) => t);
    expect(planned.sort()).toEqual([
      "--color-syntax-markup",
      "--color-syntax-meta",
      "--icon-size-md",
      "--icon-size-sm",
      "--source-font-family",
    ]);
  });

  it("--motion-ease-out is gone from § Tokens and from the motion prose (Q1)", () => {
    expect(tableRows(DESIGN).has("--motion-ease-out")).toBe(false);
    expect(DESIGN).not.toContain("--motion-ease-out");
  });
});

describe("D278-WI-1 fixtures: each check catches its defect", () => {
  const design = (rows: string) => `# x\n\n## Tokens\n\n| Token | Change |\n|---|---|\n${rows}\n\n## Layout\n`;

  it("P1 reads both docs and ignores mentions outside a first cell or bullet head", () => {
    const d = design("| `--a` | new |\n| `--b` | mentions `--c` |");
    expect(undocumented(["--a", "--b", "--c", "--d", "--e"], d, "- `--d`: x\n- `--x`, `--e`: y\nprose `--z`")).toEqual(["--c"]);
  });

  it("the slice guard fails loudly when `## Layout` is missing", () => {
    expect(() => tokensSlice("## Tokens\n| `--a` | x |")).toThrow();
  });

  it("P2 names an unmarked undeclared row and honours Planned", () => {
    const d = design("| `--a` | new |\n| `--b` | Planned (WI-4.1) |\n| `--c` | Interim (WI-4.3) |");
    expect(undeclaredRows(d, new Set())).toEqual(["--a", "--c"]);
  });

  it("P4 counts a token used only inside another token's value, and a quoted TS name", () => {
    expect(unconsumed(["--a", "--b", "--c"], [":root { --x: calc(var(--a) + 1px); }", 'el.style.setProperty("--b", v)'])).toEqual(["--c"]);
  });

  it("P5 catches a stale Planned, an undeclared Interim, and a missing or wrong required marker", () => {
    const d = design("| `--a` | Planned (WI-4.1) |\n| `--b` | Interim (WI-4.3) |\n| `--c` | new |\n| `--d` | Interim (WI-9) |");
    expect(markerDefects(d, new Set(["--a", "--c", "--d"]), { "--c": "WI-4.3", "--d": "WI-4.3" })).toEqual([
      "--a: Planned but declared",
      "--b: Interim but not declared",
      "--c: needs Interim (WI-4.3)",
      "--d: needs Interim (WI-4.3)",
    ]);
  });

  it("P5 fails when the Interim marker is deleted from --color-banner-unsaved's row", () => {
    const rows = [...tableRows(DESIGN).values()].join("\n");
    const stripped = design(rows.replace(/(`--color-banner-unsaved`[^\n]*?)Interim \(WI-4\.3\)/, "$1"));
    expect(markerDefects(stripped, declared, INTERIM)).toContain("--color-banner-unsaved: needs Interim (WI-4.3)");
  });

  const base = () => ({ root: new Map(BLOCKS.root), light: new Map(BLOCKS.light), dark: new Map(BLOCKS.dark) });

  it("P6a names a key in only one theme", () => {
    const b = base();
    b.light.set("--only-light", "#fff");
    b.root.set("--only-light", "#fff");
    expect(themeDefects(b, [], ROOT_ONLY)).toContain("P6a --only-light: light only");
  });

  it("P6c names a :root default that resolves differently from light", () => {
    const b = base();
    b.root.set("--color-accent", "#000000");
    expect(themeDefects(b, [], ROOT_ONLY)).toContain("P6c --color-accent: :root resolves differently from light");
  });

  it("P6d fails --motion-duration-fast copied into a theme block", () => {
    const b = base();
    b.light.set("--motion-duration-fast", "150ms");
    b.dark.set("--motion-duration-fast", "150ms");
    expect(themeDefects(b, reducedMotionTokens(GLOBALS), ROOT_ONLY)).toContain(
      "P6d --motion-duration-fast: in a theme block overrides reduced motion",
    );
  });

  it("P6e fails --font-sans copied unchanged into both theme blocks", () => {
    const b = base();
    b.light.set("--font-sans", BLOCKS.root.get("--font-sans") ?? "");
    b.dark.set("--font-sans", BLOCKS.root.get("--font-sans") ?? "");
    expect(themeDefects(b, [], ROOT_ONLY)).toContain("P6e --font-sans: in ROOT_ONLY but not root-only");
  });

  it("P6e fails a new root-only token missing from ROOT_ONLY", () => {
    const b = base();
    b.root.set("--new-root-only", "1px");
    expect(themeDefects(b, [], ROOT_ONLY)).toContain("P6e --new-root-only: root-only but not in ROOT_ONLY");
  });

  it("the reduced-motion block is found", () => {
    expect(reducedMotionTokens(GLOBALS)).toEqual(["--motion-duration-fast"]);
  });
});

// D278-WI-3: design/DESIGN.stitch.md, the Stitch-format sidecar. Its front
// matter is generated from the tokens (tests/support/stitchSidecar.ts);
// `MDPRO_WRITE_SIDECAR=1` writes it instead of comparing.
describe("D278-WI-3: the Stitch sidecar matches the tokens", () => {
  it("S1 the generator reproduces the committed front matter byte for byte", () => {
    const generated = frontMatter();
    if (process.env.MDPRO_WRITE_SIDECAR === "1") writeFrontMatter(generated);
    const committed = readSidecar();
    expect(committed, "design/DESIGN.stitch.md exists").toBeDefined();
    const front = splitSidecar(committed ?? "").front;
    expect(firstDifference(front, generated), "stale key; regenerate with MDPRO_WRITE_SIDECAR=1").toBeUndefined();
    expect(front).toBe(generated);
  });

  it("S2 every mapped token is declared, and none is Interim", () => {
    expect(mappingDefects(mappedTokens(), declared, INTERIM)).toEqual([]);
  });

  it("S3 every token design/DESIGN.stitch.md maps is documented", () => {
    expect(undocumented(mappedTokens(), DESIGN, RULE31), "mapped by design/DESIGN.stitch.md but undocumented").toEqual([]);
  });

  it("S4 colors and colors-dark have the same keys, and no dark-* key", () => {
    const front = splitSidecar(readSidecar() ?? "").front;
    const keys = COLOURS.map(([k]) => k);
    expect(sectionKeys(front, "colors")).toEqual(keys);
    expect(sectionKeys(front, "colors-dark")).toEqual(keys);
    expect(keys.filter((k) => k.startsWith("dark-"))).toEqual([]);
  });

  it("S5 values match hand-computed hex: opaque, translucent, and a var() chain", () => {
    const { light, dark } = stylesheetTokens();
    expect(colourHex("--color-accent", light)).toBe("#2563eb");
    expect(colourHex("--color-accent", dark)).toBe("#60a5fa");
    // rgba(15, 23, 42, 0.35): alpha round(0.35 × 255) = 89 = 0x59.
    expect(colourHex("--color-scrim", light)).toBe("#0f172a59");
    expect(colourHex("--color-scrim", dark)).toBe("#0f172a59");
    expect(colourHex("--color-bg-secondary", light)).toBe("#f6f7fb");
    const chain = new Map([["--color-surface", "#f6f7fb"], ["--color-bg-secondary", "var(--color-surface)"]]);
    expect(colourHex("--color-bg-secondary", chain)).toBe("#f6f7fb");
  });
});

describe("D278-WI-3 fixtures: the sidecar gate catches its defects", () => {
  const sets = stylesheetTokens();
  const retuned = (set: ReadonlyMap<string, string>) => new Map([...set, ["--color-accent", "#2563ec"]]);

  it("S1 names the colors key when a light value changes", () => {
    expect(firstDifference(frontMatter(sets), frontMatter({ ...sets, light: retuned(sets.light) }))).toBe("colors.primary");
  });

  it("S1 names the colors-dark key when a dark value changes", () => {
    expect(firstDifference(frontMatter(sets), frontMatter({ ...sets, dark: retuned(sets.dark) }))).toBe("colors-dark.primary");
  });

  it("S2 names an undeclared and an Interim token", () => {
    expect(mappingDefects(["--color-undeclared", "--color-banner-unsaved"], declared, INTERIM)).toEqual([
      "--color-undeclared: not declared",
      "--color-banner-unsaved: Interim (WI-4.3)",
    ]);
  });

  it("the generator throws on a mapped token that is undeclared or not a colour", () => {
    expect(() => colourHex("--color-x", new Map())).toThrow(/not declared/);
    expect(() => colourHex("--color-x", new Map([["--color-x", "linear-gradient(#fff, #000)"]]))).toThrow();
  });

  it("splitSidecar refuses a file without front matter", () => {
    expect(() => splitSidecar("# no front matter\n")).toThrow(/front matter/);
  });
});

describe("D278-FIX-1 fixtures: P4 matches whole names, P5 rejects malformed markers", () => {
  const design = (rows: string) => `# x\n\n## Tokens\n\n| Token | Change |\n|---|---|\n${rows}\n\n## Layout\n`;

  it("P4 does not count var(--ab) or \"--ab\" as consuming --a", () => {
    expect(unconsumed(["--a", "--ab"], ["x { color: var(--ab); }", 'el.style.setProperty("--ab", v)'])).toEqual(["--a"]);
    expect(unconsumed(["--a"], ["x { color: var(--a, #fff); }"])).toEqual([]);
  });

  it("P5 names a marker keyword without a WI", () => {
    const d = design("| `--a` | Interim | x |\n| `--b` | Planned: soon | x |\n| `--c` | Interim (WI-4.3) | x |");
    expect(markerDefects(d, new Set(["--a", "--c"]), {})).toEqual(["--a: malformed marker", "--b: malformed marker"]);
  });
});
