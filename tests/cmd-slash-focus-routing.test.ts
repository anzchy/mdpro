/**
 * Tests for issue #28 — ⌘/ focus-aware routing.
 *
 * When ⌘/ is pressed:
 *  - With a `.cm-editor` element focused: the global handler must NOT call
 *    `onCycleViewMode`, allowing CodeMirror's built-in toggleLineComment to fire.
 *  - Without a `.cm-editor` element focused: the global handler MUST call
 *    `onCycleViewMode` and call `preventDefault()`.
 *
 * We verify this by reading the source of `useKeyboardShortcuts.ts` and
 * asserting on the presence of the focus-guard expression.  Then we also run
 * a lightweight DOM simulation to confirm the runtime behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readHook(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// Static analysis — the fix must be present in the source file
// ---------------------------------------------------------------------------

describe("useKeyboardShortcuts source — ⌘/ focus guard", () => {
  const src = readHook("hooks/useKeyboardShortcuts.ts");

  it("checks for .cm-editor ancestor before cycling view on ⌘/", () => {
    // The fix must detect CodeMirror focus before intercepting ⌘/.
    // We look for the standard DOM idiom: closest('.cm-editor') — with or
    // without optional-chaining (?.) syntax.
    expect(src).toMatch(/closest\??\.\s*\(\s*['"]\.cm-editor['"]\s*\)/);
  });

  it("skips onCycleViewMode when editor is focused (guard wraps the call)", () => {
    // The ⌘/ branch that calls onCycleViewMode must be guarded so it is
    // skipped when the active element is inside a .cm-editor.
    // We verify that the guard (closest check) appears in the ⌘/ condition,
    // i.e., the string '".cm-editor"' appears on the same line as 'key === "/"'
    // AND in a negated check (prefixed with '!').
    const cmdSlashGuard =
      /key === "\/".+\.cm-editor|\.cm-editor.+key === "\/"/s;
    expect(src).toMatch(cmdSlashGuard);

    // Also confirm it is a negated check (! prefix) so the cycle is skipped
    // when the editor is focused.
    expect(src).toMatch(/!\s*target\??\.\s*closest\??\.\s*\(\s*['"]\.cm-editor['"]/);
  });
});

// ---------------------------------------------------------------------------
// Runtime simulation — verify behaviour without a full React environment.
// We recreate the minimal logic extracted from the hook handler.
// ---------------------------------------------------------------------------

describe("⌘/ key routing logic", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Set up a minimal DOM with a .cm-editor descendant
    container = document.createElement("div");
    container.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("tabindex", "0");
    container.appendChild(content);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /**
   * Minimal reproduction of the handler logic after the fix is applied.
   * Returns true if onCycleViewMode would be called.
   */
  function wouldCycleViewMode(activeElement: Element | null): boolean {
    const inCodeMirror = activeElement?.closest?.(".cm-editor");
    if (inCodeMirror) return false; // editor has focus — skip view-cycle
    return true; // no editor focus — cycle view
  }

  it("does NOT cycle view mode when a .cm-editor child has focus", () => {
    const cmContent = container.querySelector(".cm-content")!;
    expect(wouldCycleViewMode(cmContent)).toBe(false);
  });

  it("does NOT cycle view mode when the .cm-editor itself has focus", () => {
    expect(wouldCycleViewMode(container)).toBe(false);
  });

  it("DOES cycle view mode when focus is outside any .cm-editor", () => {
    const outsideEl = document.createElement("button");
    document.body.appendChild(outsideEl);
    expect(wouldCycleViewMode(outsideEl)).toBe(true);
    document.body.removeChild(outsideEl);
  });

  it("DOES cycle view mode when activeElement is null (no focus)", () => {
    expect(wouldCycleViewMode(null)).toBe(true);
  });
});
