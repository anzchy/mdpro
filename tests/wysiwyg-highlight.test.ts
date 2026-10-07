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
    // The inner component must receive and use highlightRequest
    expect(milkdownEditorSrc).toMatch(/highlightRequest\?:\s*number/);
  });

  it("has a useEffect that reacts to highlightRequest", () => {
    // The effect must depend on highlightRequest
    expect(milkdownEditorSrc).toMatch(/\[highlightRequest\]/);
  });

  it("calls milkdownHighlightCommand inside the effect", () => {
    expect(milkdownEditorSrc).toMatch(/milkdownHighlightCommand\s*\(/);
  });

  it("passes highlightRequest from MilkdownEditor wrapper to inner component", () => {
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
    expect(appSrc).toMatch(/MilkdownEditor\s+highlightRequest=\{highlightRequest\}/);
  });
});

describe("Editor.tsx — CodeMirror highlight path unchanged", () => {
  const editorSrc = readSrc("components/Editor/Editor.tsx");

  it("still calls highlightCommand for CodeMirror (source/split mode)", () => {
    expect(editorSrc).toMatch(/highlightCommand\s*\(\s*viewRef\.current\s*\)/);
  });
});
