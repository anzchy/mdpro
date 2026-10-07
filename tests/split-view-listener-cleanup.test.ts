// @vitest-environment node
/**
 * Tests for SplitView — two-mode-editor refactor (WI-1).
 *
 * After cutting from 4 modes to 2 (wysiwyg | source), SplitView is now a
 * simple full-width source editor wrapper. Split-pane drag and preview pane
 * are removed; there is no longer any window event listener to clean up.
 *
 * These tests verify the simplified structure replaces the old drag machinery.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

describe("SplitView — simplified source-only rendering (two-mode-editor WI-1)", () => {
  const src = readComponent("components/Editor/SplitView.tsx");

  it("renders the Editor component (source mode)", () => {
    expect(src).toMatch(/\bEditor\b/);
  });

  it("exposes a source-container div for TOC scrollspy", () => {
    expect(src).toMatch(/id=["']source-container["']/);
  });

  it("does not contain split-pane drag logic (split mode removed)", () => {
    expect(src).not.toMatch(/startDrag/);
    expect(src).not.toMatch(/splitRatio/);
    expect(src).not.toMatch(/cleanupRef/);
  });

  it("does not import or render Preview (preview-only mode removed)", () => {
    expect(src).not.toMatch(/import.*Preview/);
    expect(src).not.toMatch(/<Preview/);
  });

  it("does not compare viewMode against removed mode strings", () => {
    expect(src).not.toMatch(/["']editor-only["']/);
    expect(src).not.toMatch(/["']preview-only["']/);
    expect(src).not.toMatch(/["']split["']/);
  });
});
