// @vitest-environment node
/**
 * Tests for view-mode event handler in useMenuEvents.
 *
 * After the two-mode-editor refactor (WI-1), ViewMode = "wysiwyg" | "source".
 * The old four-mode values ("split", "editor-only", "preview-only") are removed.
 *
 * We verify two invariants via static source analysis:
 *   1. The dead case strings are absent from the hook source.
 *   2. The working `set-view-mode` handler — and both valid ViewMode values —
 *      remain present in the hook source.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_PATH = path.resolve(__dirname, "../src/hooks/useMenuEvents.ts");
const src = fs.readFileSync(SRC_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Dead code — must NOT be present after the refactor
// ---------------------------------------------------------------------------

describe("useMenuEvents — dead view-mode cases are removed", () => {
  it('does not contain case "view.cycle" (Rust emits cycle-view-mode, not view.cycle)', () => {
    expect(src).not.toMatch(/case\s+["']view\.cycle["']/);
  });

  it('does not contain case "view.split"', () => {
    expect(src).not.toMatch(/case\s+["']view\.split["']/);
  });

  it('does not contain case "view.editor_only"', () => {
    expect(src).not.toMatch(/case\s+["']view\.editor_only["']/);
  });

  it('does not contain case "view.preview_only"', () => {
    expect(src).not.toMatch(/case\s+["']view\.preview_only["']/);
  });

  it('does not contain case "view.wysiwyg"', () => {
    expect(src).not.toMatch(/case\s+["']view\.wysiwyg["']/);
  });

  it('does not accept "split" as a valid view mode value', () => {
    // The guard must not list "split" as a valid mode
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).not.toMatch(/["']split["']/);
  });

  it('does not accept "editor-only" as a valid view mode value', () => {
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).not.toMatch(/["']editor-only["']/);
  });

  it('does not accept "preview-only" as a valid view mode value', () => {
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).not.toMatch(/["']preview-only["']/);
  });
});

// ---------------------------------------------------------------------------
// Working handler — must remain present after the refactor
// ---------------------------------------------------------------------------

describe("useMenuEvents — working set-view-mode handler is intact", () => {
  it('contains the case "set-view-mode" branch', () => {
    expect(src).toMatch(/case\s+["']set-view-mode["']/);
  });

  it('accepts "wysiwyg" as a valid view mode value', () => {
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).toMatch(/["']wysiwyg["']/);
  });

  it('accepts "source" as a valid view mode value', () => {
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).toMatch(/["']source["']/);
  });

  it("calls onViewModeChange from within the set-view-mode branch", () => {
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).toMatch(/onViewModeChange/);
  });
});
