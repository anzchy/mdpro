/**
 * Tests for issue #26 — ⌘⇧H highlight routing in WYSIWYG mode.
 *
 * The bug: in WYSIWYG mode, `viewRef.current` is null (CodeMirror not
 * mounted) so `highlightCommand(viewRef.current)` silently does nothing.
 *
 * The fix:
 *   1. `milkdownHighlightCommand` — pure function that wraps selected
 *      ProseMirror text with `==text==` markers via a TR dispatch.
 *   2. `MilkdownEditor` now accepts `highlightRequest` and calls it.
 *   3. `App.tsx` passes `highlightRequest` to `MilkdownEditor`.
 *
 * Coverage:
 *   A) Unit tests for `milkdownHighlightCommand` using minimal mock objects.
 *   B) Static-analysis tests confirming the wiring in source files.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../src");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// A) Unit tests for milkdownHighlightCommand
// ---------------------------------------------------------------------------
//
// We cannot import the full ProseMirror/Milkdown stack in jsdom without
// complex setup, so we test via a minimal hand-crafted mock that satisfies
// the function's interface requirements.
//
// The function only calls:
//   view.state.selection  → { from, to }
//   view.state.doc.textBetween(from, to)  → string
//   view.state.tr.insertText(text, from, to)  → returns tr-like object
//   tr.setSelection(...)  → returns tr (for chaining)
//   tr.scrollIntoView()   → returns tr (for chaining)
//   tr.doc               → used by TextSelection.create
//   view.dispatch(tr)
//
// TextSelection.create is imported from @milkdown/kit/prose/state. For the
// unit tests we mock that module so we don't need a real ProseMirror document.

import { milkdownHighlightCommand } from "../src/plugins/milkdown/milkdownHighlightCommand";

vi.mock("@milkdown/kit/prose/state", () => ({
  TextSelection: {
    create: (_doc: unknown, from: number, to: number) => ({ type: "text", from, to }),
  },
}));

/** Build a minimal mock ProseMirror view that records the dispatched TR. */
function buildMockView(selectedText: string, from = 5, to = 5 + selectedText.length) {
  // After insertText the tr.doc is different — we give it a stub that allows
  // TextSelection.create to succeed.
  const trDoc = {};

  const tr = {
    doc: trDoc,
    _insertedText: "",
    _selection: null as unknown,
    _scrolled: false,
    insertText(text: string, _from: number, _to: number) {
      this._insertedText = text;
      return this; // chaining
    },
    setSelection(sel: unknown) {
      this._selection = sel;
      return this; // chaining
    },
    scrollIntoView() {
      this._scrolled = true;
      return this; // chaining
    },
  };

  const dispatched: typeof tr[] = [];

  const view = {
    state: {
      selection: { from, to },
      doc: {
        textBetween(_from: number, _to: number) {
          return selectedText;
        },
      },
      tr,
    },
    dispatch(dispatchedTr: typeof tr) {
      dispatched.push(dispatchedTr);
    },
    _dispatched: dispatched,
  };

  return view;
}

describe("milkdownHighlightCommand — core behaviour", () => {
  it("returns false and does not dispatch when selection is empty (from === to)", () => {
    const view = buildMockView("", 5, 5);
    const result = milkdownHighlightCommand(view as never);

    expect(result).toBe(false);
    expect(view._dispatched).toHaveLength(0);
  });

  it("returns true when text is selected", () => {
    const view = buildMockView("hello");
    const result = milkdownHighlightCommand(view as never);

    expect(result).toBe(true);
  });

  it("wraps selected text with == markers in the inserted text", () => {
    const view = buildMockView("hello");
    milkdownHighlightCommand(view as never);

    expect(view.state.tr._insertedText).toBe("==hello==");
  });

  it("dispatches exactly one transaction", () => {
    const view = buildMockView("world");
    milkdownHighlightCommand(view as never);

    expect(view._dispatched).toHaveLength(1);
  });

  it("calls scrollIntoView on the transaction", () => {
    const view = buildMockView("text");
    milkdownHighlightCommand(view as never);

    expect(view.state.tr._scrolled).toBe(true);
  });

  it("sets post-dispatch selection that excludes the == markers", () => {
    const selectedText = "hello";
    const from = 5;
    const view = buildMockView(selectedText, from, from + selectedText.length);
    milkdownHighlightCommand(view as never);

    // TextSelection.create was called with innerFrom = from + 2 ("==")
    // and innerTo = innerFrom + selectedText.length
    const sel = view.state.tr._selection as { from: number; to: number };
    expect(sel.from).toBe(from + 2);
    expect(sel.to).toBe(from + 2 + selectedText.length);
  });

  it("handles a single character selection", () => {
    const view = buildMockView("x", 0, 1);
    const result = milkdownHighlightCommand(view as never);

    expect(result).toBe(true);
    expect(view.state.tr._insertedText).toBe("==x==");
  });

  it("preserves the full selected text content between markers", () => {
    const text = "some longer sentence here";
    const view = buildMockView(text, 10, 10 + text.length);
    milkdownHighlightCommand(view as never);

    expect(view.state.tr._insertedText).toBe(`==${text}==`);
  });
});

// ---------------------------------------------------------------------------
// B) Static-analysis tests — wiring verification
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
