/**
 * Regression test for #78: settings-row label/control vertical misalignment.
 *
 * Root cause: `.settings-row-content` in globals.css had `align-items: flex-start`
 * (causing label and control to be top-aligned instead of vertically centred)
 * and was missing `flex: 1` (causing `justify-content: space-between` to not
 * spread label to left edge and control to right edge).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const globalsCss = fs.readFileSync(
  path.resolve(__dirname, "../src/styles/globals.css"),
  "utf-8",
);

/** Extract the declaration block for a given CSS selector. */
function extractBlock(css: string, selector: string): string {
  // Find the selector, then capture everything up to the matching closing brace.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : "";
}

describe("settings-row-content layout (fix #78)", () => {
  const block = extractBlock(globalsCss, ".settings-row-content");

  it("block is found in globals.css", () => {
    expect(block).not.toBe("");
  });

  it("uses align-items: center so label and control are vertically centred", () => {
    expect(block).toContain("align-items: center");
    expect(block).not.toContain("align-items: flex-start");
  });

  it("has flex: 1 so it fills the parent .settings-row and space-between works", () => {
    expect(block).toContain("flex: 1");
  });

  it("retains justify-content: space-between to push label left and control right", () => {
    expect(block).toContain("justify-content: space-between");
  });
});

describe("settings-row base layout", () => {
  const block = extractBlock(globalsCss, ".settings-row");

  it("is a flex row with align-items: center", () => {
    expect(block).toContain("display: flex");
    expect(block).toContain("align-items: center");
  });
});
