// @vitest-environment node
/**
 * @module milkdown-table-resize-handle.test
 * Purpose: Verify the WYSIWYG column-resize handle CSS (Phase 2 WI-2.1).
 * `prosemirror-tables` is already wired via the gfm preset's
 * `columnResizingPlugin`; this WI is CSS-only.
 *
 * Strategy: source inspection (mirrors the WI-1.6 selectedCell test).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/MilkdownEditor.css"),
  "utf-8",
);

describe("column resize handle CSS (WI-2.1)", () => {
  it("targets .ProseMirror .column-resize-handle from inside .milkdown-editor", () => {
    expect(css).toMatch(
      /\.milkdown-editor\s+\.ProseMirror\s+\.column-resize-handle/,
    );
  });

  it("is always-visible as a hairline using var(--color-border)", () => {
    expect(css).toMatch(
      /\.column-resize-handle[\s\S]{0,300}background:[\s\S]{0,80}var\(--color-border\)/,
    );
  });

  it("expands and changes color to var(--color-accent) on hover/drag", () => {
    expect(css).toMatch(
      /column-resize-handle[\s\S]{0,400}var\(--color-accent\)/,
    );
  });

  it("sets cursor: col-resize for the drag affordance", () => {
    expect(css).toMatch(/cursor:\s*col-resize/);
  });

  // Bug #2 follow-up (2026-05-04): the 1px hairline by itself is too
  // narrow a hit target. The handle must be visibly wide for hit
  // detection (≥6px) while keeping the visible mark thin via ::after.
  it("uses a wider hit area than the visible hairline (≥6px)", () => {
    const block = css.match(
      /\.column-resize-handle\s*\{[^}]*\}/m,
    );
    expect(block).not.toBeNull();
    const widthMatch = block![0].match(/width:\s*(\d+)px/);
    expect(widthMatch).not.toBeNull();
    expect(Number(widthMatch![1])).toBeGreaterThanOrEqual(6);
  });

  it("draws the visible hairline via a ::after pseudo so the wider hit area is invisible", () => {
    expect(css).toMatch(/\.column-resize-handle::after\b/);
  });
});
