/**
 * @module milkdown-table-cell-highlight.test
 * Purpose: Verify the WYSIWYG selected-cell decoration uses the new
 * --color-accent / --color-accent-soft tokens (WI-1.6 + WI-1.9).
 * prosemirror-tables emits the .selectedCell class on cells that are
 * part of the current cell selection; the CSS rule paints the highlight.
 *
 * Strategy: source inspection (CSS-presence check, mirrors
 * tests/milkdown-image-resize.test.ts pattern).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/MilkdownEditor.css"),
  "utf-8",
);

describe("WYSIWYG selected-cell highlight (WI-1.6)", () => {
  it("targets td.selectedCell and th.selectedCell inside .ProseMirror", () => {
    expect(css).toMatch(
      /\.milkdown-editor\s+\.ProseMirror\s+td\.selectedCell/,
    );
    expect(css).toMatch(
      /\.milkdown-editor\s+\.ProseMirror\s+th\.selectedCell/,
    );
  });

  it("paints with var(--color-accent-soft) background", () => {
    // Per WI-1.9, the soft variant token now exists in both theme files.
    expect(css).toMatch(
      /\.selectedCell[\s\S]*background:[\s\S]*var\(--color-accent-soft\)/,
    );
  });

  it("uses var(--color-accent) for the outline (not a hardcoded color)", () => {
    expect(css).toMatch(
      /\.selectedCell[\s\S]*outline:[\s\S]*var\(--color-accent\)/,
    );
  });
});
