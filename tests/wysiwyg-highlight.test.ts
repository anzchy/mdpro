// @vitest-environment node
/**
 * Tests for issue #26 — ⌘⇧H highlight routing in WYSIWYG mode.
 *
 * Original bug (#26): in WYSIWYG mode, `viewRef.current` is null (CodeMirror
 * not mounted) so `highlightCommand(viewRef.current)` silently did nothing.
 *
 * Fix #26: `milkdownHighlightCommand` was introduced to dispatch directly on
 * the ProseMirror view. `MilkdownEditor` accepts `highlightRequest` and calls it.
 *
 * Fix #376: `milkdownHighlightCommand` was updated to use `toggleMark()` instead
 * of raw `insertText("==text==")` so the highlight mark renders immediately.
 * Unit tests for the command itself live in milkdownHighlightCommand.test.ts.
 *
 * Coverage here:
 *   Static-analysis tests confirming the wiring in MilkdownEditor and App.tsx.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// Unit tests for milkdownHighlightCommand are in milkdownHighlightCommand.test.ts.

// ---------------------------------------------------------------------------
// Static-analysis tests — wiring verification
// ---------------------------------------------------------------------------

describe("MilkdownEditor source — highlightRequest wiring (fix for #26)", () => {
  const milkdownEditorSrc = readSrc("components/Editor/MilkdownEditor.tsx");

  it("imports milkdownHighlightCommand", () => {
    expect(milkdownEditorSrc).toMatch(/milkdownHighlightCommand/);
  });

  it("accepts highlightRequest prop in MilkdownEditorInner", () => {
    // The inner component must receive and use highlightRequest.
    // Re-pinned in D261-WI-1d (policy rule 12): the prop shape changed by design
    // from a bare counter (`number`) to `HighlightRequest = { seq, token }`, so
    // the request carries the menu-target token the effect checks before it
    // touches the view. The bare number re-fired into the next document on a
    // remount; the specification (the prop exists and drives the effect) holds.
    expect(milkdownEditorSrc).toMatch(/highlightRequest\?:\s*HighlightRequest/);
    const tokenSrc = readSrc("utils/menuTargetToken.ts");
    expect(tokenSrc).toMatch(
      /export interface HighlightRequest \{\s*seq: number;\s*token: MenuTargetToken;\s*\}/,
    );
  });

  it("checks the token (abandonIfStale) before calling milkdownHighlightCommand in the effect", () => {
    // Added in D261-WI-1d: a stale request must not reach the view.
    const effect = milkdownEditorSrc.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[highlightRequest\]\);/);
    expect(effect).not.toBeNull();
    const body = effect![1];
    const check = body.search(/abandonIfStale\(/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.search(/milkdownHighlightCommand\(/));
  });

  it("has a useEffect that reacts to highlightRequest", () => {
    // The effect must depend on highlightRequest
    expect(milkdownEditorSrc).toMatch(/\[highlightRequest\]/);
  });

  it("calls milkdownHighlightCommand inside the effect", () => {
    expect(milkdownEditorSrc).toMatch(/milkdownHighlightCommand\s*\(/);
  });

  it("passes highlightRequest from MilkdownEditor wrapper to inner component", () => {
    // D261-WI-1d (rule 12): unchanged pass-through; the value is now a
    // HighlightRequest ({ seq, token }) rather than a number.
    expect(milkdownEditorSrc).toMatch(/highlightRequest=\{highlightRequest\}/);
  });

  it("exports MilkdownEditor with a highlightRequest prop type", () => {
    // The outer exported interface must include highlightRequest
    expect(milkdownEditorSrc).toMatch(/interface MilkdownEditorProps/);
  });
});

describe("App.tsx — passes highlightRequest to MilkdownEditor (fix for #26)", () => {
  const appSrc = readSrc("App.tsx");

  it("passes highlightRequest prop to MilkdownEditor", () => {
    // D261-WI-1d (rule 12): unchanged pass-through of the { seq, token } request.
    expect(appSrc).toMatch(/MilkdownEditor\s+highlightRequest=\{highlightRequest\}/);
  });
});

describe("Editor.tsx — CodeMirror highlight path unchanged", () => {
  const editorSrc = readSrc("components/Editor/Editor.tsx");

  it("still calls highlightCommand for CodeMirror (source/split mode)", () => {
    expect(editorSrc).toMatch(/highlightCommand\s*\(\s*viewRef\.current\s*\)/);
  });
});
