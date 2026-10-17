// @vitest-environment node
/**
 * @module d257-settings-error-contrast.test
 * Purpose: D257. The Settings error panel's text was `--color-danger` on
 * `--color-danger-soft`: 4.01:1 in light, under rule 31's 4.5. Its text now
 * takes a new `--color-error-text` (light #b91c1c, 5.37:1; dark #f87171,
 * today's dark look, 4.92:1); the border and fill keep the danger tokens.
 * Not `--color-error-text`: ADR-0106 reverted a token of that name for the
 * danger button, and tests/contrast-d227.test.ts keeps it undefined.
 * User verdict on prototype/d256-d257-contrast:
 * 「B1 · darker red, dark unchanged (Recommended)」.
 *
 * Strategy: source inspection of the token files and settings-rows.css, with
 * contrast measured from the theme tokens (tests/support/contrast).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations, tokenBlock } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Theme } from "./support/contrast";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const THEMES: Theme[] = ["light", "dark"];
const TEXT: Record<Theme, string> = { light: "#b91c1c", dark: "#f87171" };

const errorRule = new Map(
  parseDeclarations(read("styles/sections/settings-rows.css"))
    .filter((d) => d.selector.split(",").some((s) => s.trim() === ".settings-error"))
    .map((d) => [d.property, d.value]),
);

describe("D257: the Settings error panel's text reads at 4.5:1", () => {
  it.each(THEMES)("%s declares --color-error-text as the chosen red", (theme) => {
    expect(tokenBlock(read(`styles/themes/${theme}.css`), `.theme-${theme}`).get("--color-error-text")).toBe(TEXT[theme]);
  });

  it("the :root fallback in globals.css is the light red", () => {
    expect(tokenBlock(read("styles/globals.css"), ":root").get("--color-error-text")).toBe(TEXT.light);
  });

  it("the panel's text takes the token; its fill and border keep the danger pair", () => {
    expect(errorRule.get("color")).toBe("var(--color-error-text)");
    expect(errorRule.get("background")).toBe("var(--color-danger-soft)");
    expect(errorRule.get("border")).toBe("1px solid var(--color-danger)");
  });

  it.each(THEMES)("%s: the text is at least 4.5:1 on the panel's fill over the dialog", (theme) => {
    const t = themeTokens(theme);
    const fill = over(resolveColor(errorRule.get("background") ?? "transparent", t), resolveColor("var(--color-panel)", t));
    expect(contrast(resolveColor(errorRule.get("color") ?? "black", t), fill)).toBeGreaterThanOrEqual(4.5);
  });
});
