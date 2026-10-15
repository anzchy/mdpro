// @vitest-environment node
/**
 * D233: the Source find panel's "×" sits on the panel's top-right corner
 * (CodeMirror: `position: absolute; top: 0; right: 4px; padding: 0`), and
 * `.editor-shell` clips overflow, so its outer focus ring was cut on the top
 * and right edges (Stage 3 batch 5 device check). Go to Line's dialog "×"
 * (`.cm-dialog-close`) is built the same way.
 *
 * The fix draws rule 33 pattern 2 inside the button: a 2px focus-ring outline,
 * offset -2px, on a box padded 0 4px so the ring clears the glyph. The search
 * close moves to `right: 0` so the glyph stays where it was. The search rule
 * needs `.cm-panel.cm-search` to outrank CodeMirror's base theme, which
 * otherwise wins the tie by loading later.
 *
 * Strategy: source inspection (jsdom has no `:focus-visible` and no layout);
 * the device check covers the clip itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";

const CSS = readFileSync(join(__dirname, "..", "src", "styles", "sections", "editor-source.css"), "utf8");
const rule = (selector: string) =>
  new Map(
    parseDeclarations(CSS)
      .filter((d) => d.selector === selector)
      .map((d) => [d.property, d.value]),
  );

const SEARCH = '.editor-shell .cm-editor .cm-panel.cm-search [name="close"]';
const DIALOG = ".editor-shell .cm-editor .cm-panel .cm-dialog-close";

describe("D233 the panel close buttons draw their focus ring inside", () => {
  it.each([SEARCH, DIALOG])("%s:focus-visible has a 2px focus-ring outline, offset -2px", (sel) => {
    const decls = rule(`${sel}:focus-visible`);
    expect(decls.get("outline")).toBe("2px solid var(--color-focus-ring)");
    expect(decls.get("outline-offset")).toBe("-2px");
  });

  it.each([SEARCH, DIALOG])("%s is padded so the inset ring clears the glyph", (sel) => {
    const decls = rule(sel);
    expect(decls.get("padding")).toBe("0 4px");
    expect(decls.get("border-radius")).toBe("var(--radius-inner)");
  });

  it.each([SEARCH, DIALOG])("%s moves to right: 0, so the padded glyph stays in place", (sel) => {
    expect(rule(sel).get("right")).toBe("0");
  });
});
