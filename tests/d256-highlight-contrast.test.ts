// @vitest-environment node
/**
 * @module d256-highlight-contrast.test
 * Purpose: D256. A `==highlight==` in the WYSIWYG editor was the UA's black
 * text on one pink, rgba(255, 85, 130, 0.65), in both themes: 3.56:1 in dark.
 * The fill is now the theme-split token `--color-highlight` (light keeps the
 * pink at 0.65, dark drops it to 0.40) and the marked text takes
 * `--color-text`. User verdict on prototype/d256-d257-contrast:
 * 「B · fainter dark pink (Recommended)」.
 *
 * Strategy: source inspection of the token files and MilkdownEditor.css, with
 * contrast measured from the theme tokens (tests/support/contrast).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations, tokenBlock } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Theme } from "./support/contrast";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const MARK = ".milkdown-editor .ProseMirror mark";
const THEMES: Theme[] = ["light", "dark"];
const FILL: Record<Theme, string> = { light: "rgba(255, 85, 130, 0.65)", dark: "rgba(255, 85, 130, 0.40)" };

const markRule = new Map(
  parseDeclarations(read("components/Editor/MilkdownEditor.css"))
    .filter((d) => d.selector.split(",").some((s) => s.trim() === MARK))
    .map((d) => [d.property, d.value]),
);

describe("D256: the highlight reads in both themes", () => {
  it.each(THEMES)("%s declares --color-highlight as the chosen fill", (theme) => {
    expect(tokenBlock(read(`styles/themes/${theme}.css`), `.theme-${theme}`).get("--color-highlight")).toBe(FILL[theme]);
  });

  it("the :root fallback in globals.css is the light fill", () => {
    expect(tokenBlock(read("styles/globals.css"), ":root").get("--color-highlight")).toBe(FILL.light);
  });

  it("the mark takes the token fill and the theme's text colour", () => {
    expect(markRule.get("background")).toBe("var(--color-highlight)");
    expect(markRule.get("color")).toBe("var(--color-text)");
  });

  it("no other stylesheet paints a mark with a fill of its own", () => {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((p) => p.split("\\").join("/"))
      .filter((p) => p.endsWith(".css"));
    const others = files.flatMap((f) =>
      parseDeclarations(read(f))
        .filter((d) => /(^|[\s>+~])mark(?![\w-])/.test(d.selector) && /^background(-color)?$/.test(d.property))
        .filter((d) => d.value !== "var(--color-highlight)")
        .map((d) => `${f} ${d.selector} { ${d.property}: ${d.value} }`),
    );
    expect(others).toEqual([]);
  });

  it.each(THEMES)("%s: marked text is at least 4.5:1 and the mark still stands out from the page", (theme) => {
    const t = themeTokens(theme);
    const editor = resolveColor("var(--color-editor-bg)", t);
    const fill = over(resolveColor(markRule.get("background") ?? "transparent", t), editor);
    const text = resolveColor(markRule.get("color") ?? "black", t);
    expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5);
    // 1.59:1 at the light 0.40 the prototype rejected; 1.90 dark, 2.13 light as chosen.
    expect(contrast(fill, editor)).toBeGreaterThanOrEqual(1.8);
  });
});
