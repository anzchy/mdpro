// @vitest-environment node
/**
 * @module design-tokens-redesign.test
 * Purpose: the value-preserving tokens of plan P WI-2.2. Each is declared once,
 * in `globals.css :root` (theme-independent, rule 31 authoring rule 1), with
 * exactly the value the literals it replaces render today, so Stage 2 changes
 * no computed style. Each is also named in rule 31 and in the new design doc's
 * § Tokens in the same commit (R2, R6; DR14).
 *
 * Strategy: source inspection over the CSS and the two docs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenBlock } from "./support/cssTokenScan";
import { readAppCssFile } from "../src/test/appCss";

const ROOT = join(__dirname, "..");
const root = tokenBlock(readAppCssFile("globals.css"), ":root");
const light = readAppCssFile("themes/light.css");
const dark = readAppCssFile("themes/dark.css");
const rule31 = readFileSync(join(ROOT, ".claude/rules/31-design-tokens.md"), "utf8");
const design = readFileSync(join(ROOT, "design/DESIGN.md"), "utf8");
const designTokens = design.slice(design.indexOf("## Tokens"), design.indexOf("## Layout"));

/** Each token and the value its Stage 2 sites render today (Appendix A). */
const VALUE_PRESERVING: Array<[string, string]> = [
  ["--color-on-accent", "#fff"],
  ["--color-scrim", "rgba(15, 23, 42, 0.35)"],
  ["--font-size-ui-sm", "12px"],
  ["--font-size-ui", "13px"],
  ["--font-size-ui-lg", "14px"],
  ["--radius-inner", "4px"],
  ["--radius-control", "6px"],
  ["--radius-popover", "10px"],
  ["--motion-duration-fast", "150ms"],
];

describe("WI-2.2 tokens are declared in :root with today's values", () => {
  for (const [name, value] of VALUE_PRESERVING) {
    it(`${name} is ${value} in :root and in neither theme file`, () => {
      expect(root.get(name)).toBe(value);
      expect(light).not.toContain(`${name}:`);
      expect(dark).not.toContain(`${name}:`);
    });
  }
});

describe("WI-2.2 tokens are documented in the same commit", () => {
  for (const [name] of VALUE_PRESERVING) {
    it(`${name} has a rule 31 entry and a DESIGN.md § Tokens row`, () => {
      expect(rule31).toContain(`\`${name}\``);
      expect(designTokens).toMatch(new RegExp(`^\\| \`${name}\` \\|`, "m"));
    });
  }

  it("rule 31 logs redesign tokens in the new design doc while the redesign runs (DR14)", () => {
    expect(rule31).toContain("design/DESIGN.md");
    expect(rule31).toMatch(/While the UI redesign is in progress/);
  });
});

describe("R2 and R6 sites use their tokens", () => {
  const sites: Array<[string, RegExp]> = [
    ["sections/buttons-dialog.css", /\.dialog-backdrop\s*\{[^}]*background:\s*var\(--color-scrim\)/],
    ["sections/link-insert-modal.css", /\.toolbar-button--primary\s*\{[^}]*color:\s*var\(--color-on-accent\)/],
    ["sections/settings-pages.css", /\.toolbar-button\.primary\s*\{[^}]*color:\s*var\(--color-on-accent\)/],
    ["sections/settings-rows.css", /\.toggle-slider:before\s*\{[^}]*background-color:\s*var\(--color-on-accent\)/],
  ];
  for (const [file, pattern] of sites) {
    it(`${file} ${pattern.source.split("\\s")[0].replace(/\\/g, "")}`, () => {
      expect(readAppCssFile(file)).toMatch(pattern);
    });
  }
});
