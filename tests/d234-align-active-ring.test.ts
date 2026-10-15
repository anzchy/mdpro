// @vitest-environment node
/**
 * D234: in the table menu, the current alignment ("Align left") has a solid
 * accent fill, and the keyboard ring is the accent too, inset 2px, so it
 * vanished into the fill (1:1, Stage 3 batch 5). The user chose option a on
 * prototype/d231-d234-focus (「D234:a」): on a focused active item the ring
 * is drawn in the panel colour, inset 4px, so a 2px band of fill frames it.
 *
 * Colours are read from the rules that paint them and the real theme tokens.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, resolveColor, themeTokens, type Theme } from "./support/contrast";

const CSS_FILE = join(__dirname, "..", "src", "styles", "sections", "table-context-menu.css");
const value = (selector: string, property: string): string => {
  const d = parseDeclarations(readFileSync(CSS_FILE, "utf8")).find(
    (x) => x.property === property && x.selector.split(",").some((s) => s.trim() === selector),
  );
  if (!d) throw new Error(`table-context-menu.css: no ${property} in ${selector}`);
  return d.value;
};

const ACTIVE_FOCUS = ".table-context-menu-item.is-active:focus-visible";

describe("D234 the focused current alignment shows its ring", () => {
  it("draws the ring in the panel colour, inset 4px", () => {
    expect(value(ACTIVE_FOCUS, "outline-color")).toBe("var(--color-panel)");
    expect(value(ACTIVE_FOCUS, "outline-offset")).toBe("-4px");
  });

  it.each<Theme>(["light", "dark"])("%s: the ring is ≥ 3:1 against the active fill", (theme) => {
    const t = themeTokens(theme);
    const fill = resolveColor(value(".table-context-menu-item.is-active", "background"), t);
    const ring = resolveColor(value(ACTIVE_FOCUS, "outline-color"), t);
    expect(contrast(ring, fill)).toBeGreaterThanOrEqual(3);
  });

  it("other items keep the standard inset accent ring", () => {
    expect(value(".table-context-menu-item:focus-visible", "outline")).toBe("2px solid var(--color-focus-ring)");
    expect(value(".table-context-menu-item:focus-visible", "outline-offset")).toBe("-2px");
  });
});
