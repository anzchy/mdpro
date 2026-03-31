/**
 * Tests for issue #30 — remove dead view-mode event handler cases.
 *
 * The Rust backend (menu.rs) emits `set-view-mode` actions for all four view
 * modes.  Four legacy case branches (`view.split`, `view.editor_only`,
 * `view.preview_only`, `view.wysiwyg`) were never emitted and must be removed.
 *
 * We verify two invariants via static source analysis:
 *   1. The dead case strings are absent from the hook source.
 *   2. The working `set-view-mode` handler — and all four ViewMode values —
 *      remain present in the hook source.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_PATH = path.resolve(__dirname, "../src/hooks/useMenuEvents.ts");
const src = fs.readFileSync(SRC_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Dead code — must NOT be present after the fix
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
});

// ---------------------------------------------------------------------------
// Working handler — must remain present after the fix
// ---------------------------------------------------------------------------

describe("useMenuEvents — working set-view-mode handler is intact", () => {
  it('contains the case "set-view-mode" branch', () => {
    expect(src).toMatch(/case\s+["']set-view-mode["']/);
  });

  it('handles the "split" view mode value', () => {
    expect(src).toMatch(/["']split["']/);
  });

  it('handles the "editor-only" view mode value', () => {
    expect(src).toMatch(/["']editor-only["']/);
  });

  it('handles the "preview-only" view mode value', () => {
    expect(src).toMatch(/["']preview-only["']/);
  });

  it('handles the "wysiwyg" view mode value', () => {
    expect(src).toMatch(/["']wysiwyg["']/);
  });

  it("calls onViewModeChange from within the set-view-mode branch", () => {
    // Verify that onViewModeChange is called inside the set-view-mode block.
    // The block spans from `case "set-view-mode":` to the closing `}` before
    // the next `case` or `default` statement.
    const setViewModeBlock = src.match(/case\s+["']set-view-mode["']\s*:[\s\S]*?(?=\n\s+case|\n\s+default)/)?.[0];
    expect(setViewModeBlock).toBeDefined();
    expect(setViewModeBlock).toMatch(/onViewModeChange/);
  });
});
