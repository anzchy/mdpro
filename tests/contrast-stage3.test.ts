// @vitest-environment node
/**
 * @module contrast-stage3.test
 * Purpose: the Stage 3 contrast table (plan P WI-3.5, STOP 3 acceptance).
 * Every pair the plan lists is measured in both themes from the real theme
 * tokens and the rules that paint it, against A9 (WCAG 2.1 AA): 4.5:1 for
 * text, 3:1 for focus indicators and control boundaries.
 *
 * Three pairs fail and were already failing before Stage 3: input borders,
 * the toggle's off-track and knob, and the light danger button's hover
 * label. They are D227, and the user chooses the fix on
 * prototype/p-wi35-a9-controls. Until then `D227` pins each one at its
 * measured ratio and asserts it is still below the line, so the fix makes
 * this test fail until its row is deleted, and the pair then has to pass.
 *
 * Strategy: colours are read from the declaration that paints them
 * (`fromRule`), not copied, so a changed rule changes the measurement. A
 * translucent fill is composited over the surface it sits on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Rgba, type Theme } from "./support/contrast";

const TEXT = 4.5;
const UI = 3;
const root = join(__dirname, "..");

/** The value of `property` in the rule whose selector, or one entry of its selector list, is `selector`. */
function fromRule(file: string, selector: string, property: string): string {
  const decl = parseDeclarations(readFileSync(join(root, file), "utf8")).find(
    (d) => d.property === property && d.selector.split(",").some((s) => s.trim() === selector),
  );
  if (!decl) throw new Error(`${file}: no ${property} in ${selector}`);
  return decl.value;
}

/** The colour part of a `border` shorthand such as `1px solid var(--color-border)`. */
function borderColor(value: string): string {
  const m = value.match(/var\(--[\w-]+\)|#[0-9a-f]{3,8}\b/i);
  if (!m) throw new Error(`no colour in border: ${value}`);
  return m[0];
}

const SEC = "src/styles/sections";
const rule = {
  link: () => fromRule("src/components/Editor/MilkdownEditor.css", ".milkdown-editor .ProseMirror a", "color"),
  buttonFill: () => fromRule(`${SEC}/buttons-dialog.css`, ".toolbar-button", "background"),
  danger: () => fromRule(`${SEC}/settings-pages.css`, ".toolbar-button.danger", "color"),
  dangerHover: () => fromRule(`${SEC}/settings-pages.css`, ".toolbar-button.danger:hover", "background"),
  clientRow: () => fromRule(`${SEC}/settings-mcp.css`, ".mcp-client-row", "background"),
  menuActive: (p: string) => fromRule(`${SEC}/table-context-menu.css`, ".table-context-menu-item.is-active", p),
  menuDestructive: (p: string) =>
    fromRule(
      `${SEC}/table-context-menu.css`,
      ".table-context-menu-group--destructive .table-context-menu-item:hover:not(.is-disabled)",
      p,
    ),
  trackOff: () => fromRule(`${SEC}/settings-rows.css`, ".toggle-slider", "background-color"),
  trackOn: () =>
    fromRule(`${SEC}/settings-rows.css`, ".toggle-switch input:checked + .toggle-slider", "background-color"),
  knob: () => fromRule(`${SEC}/settings-rows.css`, ".toggle-slider:before", "background-color"),
  inputBorder: () => borderColor(fromRule(`${SEC}/settings-pages.css`, ".settings-select", "border")),
};

interface Pair {
  name: string;
  /** Foreground: text, ring, edge or knob. */
  fg: () => string;
  /** What it is drawn on. */
  bg: () => string;
  /** The opaque surface under a translucent `bg`. */
  under?: () => string;
  min: number;
}

const v = (token: string) => () => `var(${token})`;
const PAIRS: Pair[] = [
  // Text, 4.5:1
  ...["--color-text", "--color-muted"].flatMap((fg) =>
    ["--color-bg", "--color-surface", "--color-panel"].map((bg) => ({
      name: `${fg} on ${bg}`,
      fg: v(fg),
      bg: v(bg),
      min: TEXT,
    })),
  ),
  // Placeholder text is not in this table: the two rendered placeholders (Link
  // insert's URL, Export's folder) have no app ::placeholder rule, so their
  // colour is WebKit's default, measured on the device (WI-3.5b). The one
  // ::placeholder rule, `.settings-search`, styles a selector nothing renders.
  { name: "link on the editor background", fg: rule.link, bg: v("--color-editor-bg"), min: TEXT },
  {
    name: "typed text in a settings input",
    fg: () => fromRule(`${SEC}/toc-sidebar.css`, ".settings-input", "color"),
    bg: () => fromRule(`${SEC}/toc-sidebar.css`, ".settings-input", "background"),
    under: v("--color-panel"),
    min: TEXT,
  },
  // Labels on fills, 4.5:1
  { name: "primary label at rest", fg: v("--color-on-accent"), bg: v("--color-accent-fill"), min: TEXT },
  { name: "primary label hovered", fg: v("--color-on-accent"), bg: v("--color-accent-fill-hover"), min: TEXT },
  { name: "danger label at rest", fg: rule.danger, bg: rule.buttonFill, min: TEXT },
  { name: "danger label hovered", fg: rule.danger, bg: rule.dangerHover, under: rule.clientRow, min: TEXT },
  { name: "menu highlight", fg: () => rule.menuActive("color"), bg: () => rule.menuActive("background"), min: TEXT },
  {
    name: "destructive menu item hovered",
    fg: () => rule.menuDestructive("color"),
    bg: () => rule.menuDestructive("background"),
    min: TEXT,
  },
  ...["--color-surface", "--color-bg"].map((under) => ({
    name: `active row over ${under}`,
    fg: v("--color-accent-text"),
    bg: v("--color-accent-soft"),
    under: v(under),
    min: TEXT,
  })),
  // Focus ring, 3:1
  ...["--color-bg", "--color-surface", "--color-panel"].map((bg) => ({
    name: `focus ring on ${bg}`,
    fg: v("--color-focus-ring"),
    bg: v(bg),
    min: UI,
  })),
  { name: "focus ring on accent-soft", fg: v("--color-focus-ring"), bg: v("--color-accent-soft"), under: v("--color-surface"), min: UI },
  // Control boundaries, 3:1. The settings controls sit on the dialog's panel.
  { name: "input border", fg: rule.inputBorder, bg: v("--color-panel"), min: UI },
  { name: "toggle off-track", fg: rule.trackOff, bg: v("--color-panel"), min: UI },
  { name: "toggle on-track", fg: rule.trackOn, bg: v("--color-panel"), min: UI },
  { name: "toggle knob on the off-track", fg: rule.knob, bg: rule.trackOff, min: UI },
];

/**
 * D227: failing before Stage 3; a row pins a pair at its measured ratio until
 * it is fixed. Empty since the D227 fix (input borders 3.34 / 4.46, toggle
 * off-track 3.89 / 3.86, knob 3.89 / 4.61, light danger hover 5.04).
 */
const D227: Record<string, Partial<Record<Theme, number>>> = {};

function measure(pair: Pair, theme: Theme): number {
  const tokens = themeTokens(theme);
  const color = (value: string): Rgba => resolveColor(value, tokens);
  let bg = color(pair.bg());
  if (bg[3] < 1) bg = over(bg, color(pair.under ? pair.under() : "var(--color-bg)"));
  let fg = color(pair.fg());
  if (fg[3] < 1) fg = over(fg, bg);
  return contrast(fg, bg);
}

describe("Stage 3 contrast table (A9)", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      for (const pair of PAIRS) {
        const known = D227[pair.name]?.[theme];
        if (known === undefined) {
          it(`${pair.name} is at least ${pair.min}:1`, () => {
            expect(measure(pair, theme)).toBeGreaterThanOrEqual(pair.min);
          });
        } else {
          it(`${pair.name} still fails at ${known}:1 (D227; delete the row once fixed)`, () => {
            const ratio = measure(pair, theme);
            expect(ratio).toBeCloseTo(known, 2);
            expect(ratio).toBeLessThan(pair.min);
          });
        }
      }
    });
  }

  it("every D227 row names a pair in the table", () => {
    const names = new Set(PAIRS.map((p) => p.name));
    expect(Object.keys(D227).filter((n) => !names.has(n))).toEqual([]);
  });
});

describe("the resolver reads the rgba() fills the settings inputs use", () => {
  it("parses comma rgba() and rgb()", () => {
    expect(resolveColor("rgba(255, 255, 255, 0.9)", new Map())).toEqual([255, 255, 255, 0.9]);
    expect(resolveColor("rgb(15, 18, 28)", new Map())).toEqual([15, 18, 28, 1]);
  });

  it("still throws on a form it does not understand", () => {
    expect(() => resolveColor("rgb(15 18 28 / 50%)", new Map())).toThrow(/unsupported/);
  });
});

describe("DESIGN.md § Tokens names the D189 layout tokens (WI-3.5)", () => {
  const design = readFileSync(join(root, "docs/design/mdpro-ui-new/DESIGN.md"), "utf8");
  const tokens = design.slice(design.indexOf("## Tokens"), design.indexOf("## Layout"));

  for (const name of ["--sidebar-width-min", "--main-min-width"]) {
    it(`${name} has a row`, () => {
      expect(tokens).toMatch(new RegExp(`^\\| \`${name}\` \\|`, "m"));
    });
  }
});
