// @vitest-environment node
/**
 * @module design-tokens-retune.test
 * Purpose: the theme token retune of plan P WI-3.1 (items 1, 7, 8). Both
 * theme files take the derived mixes of `proposal-ab.html:40-57` together
 * (rule 31 authoring rule 1), set `color-scheme`, and leave the D4 neutrals
 * alone; `:root` keeps a light copy of every shared token (Q2). The About
 * progress track moves off `--color-border` (WI-3.0, Option B). Rule 34 and
 * rule 31 name what changed, in the same commit.
 *
 * Strategy: source inspection over the theme files, `globals.css`, the
 * settings partial and the two rules.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, parseDeclarations, tokenBlock } from "./support/cssTokenScan";
import { readAppCssFile } from "../src/test/appCss";

const ROOT = join(__dirname, "..");
const lightCss = readAppCssFile("themes/light.css");
const darkCss = readAppCssFile("themes/dark.css");
const light = tokenBlock(lightCss, ".theme-light");
const dark = tokenBlock(darkCss, ".theme-dark");
const root = tokenBlock(readAppCssFile("globals.css"), ":root");
const rule31 = readFileSync(join(ROOT, ".claude/rules/31-design-tokens.md"), "utf8");
const rule34 = readFileSync(join(ROOT, ".claude/rules/34-dark-theme.md"), "utf8");

const mix = (base: string, pct: number) => `color-mix(in srgb, var(${base}) ${pct}%, transparent)`;

/** proposal-ab.html:40-57, per theme. */
const RETUNED: Record<"light" | "dark", Record<string, string>> = {
  light: {
    "--color-accent-soft": mix("--color-accent", 14),
    "--color-border": mix("--color-text", 10),
    "--color-border-subtle": mix("--color-text", 6),
    "--color-hover": mix("--color-text", 5),
    "--shadow-soft": `0 0 0 0.5px ${mix("--color-text", 12)}, 0 8px 24px ${mix("--color-text", 8)}`,
  },
  dark: {
    "--color-accent-soft": mix("--color-accent", 22),
    "--color-border": mix("--color-text", 12),
    "--color-border-subtle": mix("--color-text", 7),
    "--color-hover": mix("--color-text", 8),
    "--shadow-soft": `0 0 0 0.5px ${mix("--color-text", 16)}, 0 8px 24px color-mix(in srgb, black 45%, transparent)`,
  },
};

/** D4: the neutrals and the base colours keep today's values. */
const D4: Record<"light" | "dark", Record<string, string>> = {
  light: {
    "--color-bg": "#ffffff",
    "--color-surface": "#f6f7fb",
    "--color-panel": "#ffffff",
    "--color-text": "#1a1a1a",
    "--color-muted": "#6b7280",
    "--color-accent": "#2563eb",
    "--color-danger": "#dc2626",
    "--color-editor-bg": "#ffffff",
  },
  dark: {
    "--color-bg": "#0f1115",
    "--color-surface": "#161a22",
    "--color-panel": "#141821",
    "--color-text": "#e5e7eb",
    "--color-muted": "#9aa4b2",
    "--color-accent": "#60a5fa",
    "--color-danger": "#f87171",
    "--color-editor-bg": "#0f1115",
  },
};

/** The first `selector { … }` block's `color-scheme`, or undefined. */
function colorScheme(css: string, selector: string): string | undefined {
  return parseDeclarations(blankComments(css)).find((d) => d.selector === selector && d.property === "color-scheme")?.value;
}

describe("theme retune (WI-3.1)", () => {
  it("each theme class sets color-scheme", () => {
    expect(colorScheme(lightCss, ".theme-light")).toBe("light");
    expect(colorScheme(darkCss, ".theme-dark")).toBe("dark");
  });

  for (const theme of ["light", "dark"] as const) {
    const block = theme === "light" ? light : dark;
    for (const [name, value] of Object.entries(RETUNED[theme])) {
      it(`${theme}: ${name} is the proposal value`, () => {
        expect(block.get(name)).toBe(value);
      });
    }
    it(`${theme}: the D4 neutrals keep their values`, () => {
      expect(Object.fromEntries(Object.keys(D4[theme]).map((n) => [n, block.get(n)]))).toEqual(D4[theme]);
    });
  }

  it(":root keeps a light copy of every retuned token (Q2: :root paints first)", () => {
    for (const [name, value] of Object.entries(RETUNED.light)) expect(root.get(name), name).toBe(value);
  });

  it("--color-code-bg is unchanged in WI-3.1; item 15 is deferred to WI-3.2", () => {
    expect([root.get("--color-code-bg"), light.get("--color-code-bg"), dark.get("--color-code-bg")]).toEqual([
      "#f4f4f4",
      "#f4f4f4",
      "#1b2230",
    ]);
  });
});

describe("About progress track (WI-3.0 Option B)", () => {
  it("the track uses --color-border-subtle", () => {
    const decls = parseDeclarations(readAppCssFile("sections/settings-about.css"));
    const track = decls.filter((d) => d.selector === ".about-progress-bar::-webkit-progress-bar" && d.property === "background");
    expect(track.map((d) => d.value)).toEqual(["var(--color-border-subtle)"]);
  });
});

describe("rules in the same commit", () => {
  it("rule 34 § Theme detection says each theme class sets color-scheme", () => {
    const section = rule34.slice(rule34.indexOf("## Theme detection"), rule34.indexOf("## When overrides"));
    expect(section).toMatch(/`color-scheme`/);
  });

  it("rule 31 names --color-border-subtle and --color-hover", () => {
    expect(rule31).toContain("`--color-border-subtle`");
    expect(rule31).toContain("`--color-hover`");
  });
});
