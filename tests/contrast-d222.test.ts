// @vitest-environment node
/**
 * @module contrast-d222.test
 * Purpose: D222 (audit b136), fixed in plan P WI-3.3 under the user's ruling
 * on prototype/d222-contrast: light 「A: derived accent text (Recommended)」,
 * dark 「B: deeper fill, white text」.
 *   - Light: selected-state text (active TOC row, the shortcut being
 *     recorded) is `--color-accent-text`, the accent mixed 80% with the text
 *     colour, so it reaches 4.5:1 on accent-soft. Dark keeps the accent.
 *   - Dark: primary buttons fill with `--color-accent-fill` (#1d4ed8) and
 *     hover toward black, under white `--color-on-accent`. Light keeps the
 *     accent fill and its hover.
 *
 * Strategy: the ratios are measured from the real theme tokens
 * (tests/support/contrast.ts), and the rules are checked to use the tokens,
 * so a retuned token or a rule that bypasses it both fail here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Theme } from "./support/contrast";

const AA_TEXT = 4.5;
const S = join(__dirname, "..", "src", "styles", "sections");
const valueOf = (file: string, selector: string, property: string) =>
  parseDeclarations(readFileSync(join(S, file), "utf8")).find(
    (d) => d.selector === selector && d.property === property,
  )?.value;

const color = (theme: Theme, value: string) => resolveColor(value, themeTokens(theme));

describe("the resolver reproduces the audit's measurements", () => {
  // b136 measured the light TOC row at 3.99:1 and dark white-on-accent at 2.54:1.
  const t = new Map([["--a", "#2563eb"], ["--soft", "color-mix(in srgb, var(--a) 14%, transparent)"]]);

  it("accent on 14% accent-soft over #f6f7fb is 3.99:1", () => {
    const fill = over(resolveColor("var(--soft)", t), resolveColor("#f6f7fb", t));
    expect(contrast(resolveColor("var(--a)", t), fill)).toBeCloseTo(3.99, 2);
  });

  it("white on #60a5fa is 2.54:1, and a mix toward black darkens", () => {
    expect(contrast(resolveColor("white", t), resolveColor("#60a5fa", t))).toBeCloseTo(2.54, 2);
    expect(resolveColor("color-mix(in srgb, #fff 50%, black)", t)).toEqual([127.5, 127.5, 127.5, 1]);
  });

  it("throws on a value form it does not understand", () => {
    expect(() => resolveColor("rgb(0 0 0)", t)).toThrow(/unsupported/);
  });
});

describe("selected-state text on accent-soft", () => {
  // Every opaque surface a selected row can sit on; the darkest is the worst case.
  const BACKDROPS = ["--color-bg", "--color-surface", "--color-panel"];

  for (const theme of ["light", "dark"] as const) {
    for (const backdrop of BACKDROPS) {
      it(`${theme}: --color-accent-text on accent-soft over ${backdrop} is at least 4.5:1`, () => {
        const fill = over(color(theme, "var(--color-accent-soft)"), color(theme, `var(${backdrop})`));
        expect(contrast(color(theme, "var(--color-accent-text)"), fill)).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }

  it("light derives it from the accent and the text colour (ruling A)", () => {
    expect(themeTokens("light").get("--color-accent-text")).toBe(
      "color-mix(in srgb, var(--color-accent) 80%, var(--color-text))",
    );
  });

  it("dark keeps the accent itself", () => {
    expect(color("dark", "var(--color-accent-text)")).toEqual(color("dark", "var(--color-accent)"));
  });

  it("the active TOC row and the recorder use it", () => {
    expect(valueOf("toc-sidebar.css", ".toc-entry__content--active .toc-entry__text", "color")).toBe(
      "var(--color-accent-text)",
    );
    expect(valueOf("settings-shell.css", ".shortcut-value.is-editing", "color")).toBe("var(--color-accent-text)");
  });
});

describe("audit b138 M6: the MCP Starting / Stopping badge is accent text on accent-soft", () => {
  // One rule with a selector list styles both states.
  const colorFor = (state: string) =>
    parseDeclarations(readFileSync(join(S, "settings-mcp.css"), "utf8")).find(
      (d) => d.property === "color" && d.selector.split(",").map((x) => x.trim()).includes(`.mcp-status-badge.${state}`),
    )?.value;

  it("uses --color-accent-text, so the 4.5:1 cases above cover it", () => {
    expect(colorFor("starting")).toBe("var(--color-accent-text)");
    expect(colorFor("stopping")).toBe("var(--color-accent-text)");
  });
});

describe("primary buttons: --color-on-accent on --color-accent-fill", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const state of ["--color-accent-fill", "--color-accent-fill-hover"]) {
      it(`${theme}: on-accent over ${state} is at least 4.5:1`, () => {
        expect(contrast(color(theme, "var(--color-on-accent)"), color(theme, `var(${state})`))).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      });
    }
  }

  it("dark fills with #1d4ed8 and hovers toward black, under white text (ruling B)", () => {
    const dark = themeTokens("dark");
    expect(dark.get("--color-accent-fill")).toBe("#1d4ed8");
    expect(dark.get("--color-accent-fill-hover")).toBe("color-mix(in srgb, var(--color-accent-fill) 88%, #000)");
    expect(color("dark", "var(--color-on-accent)")).toEqual([255, 255, 255, 1]);
  });

  it("light keeps the accent fill and its hover toward the text colour", () => {
    expect(color("light", "var(--color-accent-fill)")).toEqual(color("light", "var(--color-accent)"));
    expect(themeTokens("light").get("--color-accent-fill-hover")).toBe(
      "color-mix(in srgb, var(--color-accent) 88%, var(--color-text))",
    );
  });

  for (const [file, base, hover] of [
    ["settings-pages.css", ".toolbar-button.primary", ".toolbar-button.primary:hover"],
    ["link-insert-modal.css", ".toolbar-button--primary", ".toolbar-button--primary:hover:not(:disabled)"],
  ] as const) {
    it(`${base} paints its fill, edge and hover with the fill tokens`, () => {
      expect(valueOf(file, base, "background")).toBe("var(--color-accent-fill)");
      expect(valueOf(file, base, "border-color")).toBe("var(--color-accent-fill)");
      expect(valueOf(file, base, "color")).toBe("var(--color-on-accent)");
      expect(valueOf(file, hover, "background")).toBe("var(--color-accent-fill-hover)");
    });
  }
});

describe("the D222 and focus-ring tokens are documented", () => {
  const root = join(__dirname, "..");
  const rule31 = readFileSync(join(root, ".claude/rules/31-design-tokens.md"), "utf8");
  const design = readFileSync(join(root, "docs/design/mdpro-ui-new/DESIGN.md"), "utf8");
  const designTokens = design.slice(design.indexOf("## Tokens"), design.indexOf("## Layout"));

  for (const name of ["--color-accent-text", "--color-accent-fill", "--color-accent-fill-hover", "--color-focus-ring"]) {
    it(`${name} has a rule 31 entry and a DESIGN.md § Tokens row`, () => {
      expect(rule31).toContain(`\`${name}\``);
      expect(designTokens).toMatch(new RegExp(`^\\| \`${name}\` \\|`, "m"));
    });
  }
});
