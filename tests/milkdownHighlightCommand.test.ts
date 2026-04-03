/**
 * Tests for milkdownHighlightCommand — fix for #376.
 *
 * Bug: the old implementation calls view.state.tr.insertText("==text==", from, to)
 *      which inserts raw markup rather than applying the ProseMirror mark.
 *
 * Fix: use toggleMark(markType)(state, dispatch) so the ProseMirror highlight
 *      mark is applied directly, rendering immediately without a mode switch.
 *
 * Coverage:
 *   A) Behavioral tests — early-exit paths that do not require a real PM state.
 *   B) Source analysis — regression tests confirming insertText is gone and
 *      toggleMark is wired in (prevents future regressions without editor setup).
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { milkdownHighlightCommand } from "../src/plugins/milkdown/milkdownHighlightCommand";

const SRC = path.resolve(__dirname, "../src/plugins/milkdown/milkdownHighlightCommand.ts");
const src = fs.readFileSync(SRC, "utf-8");

// ── A) Behavioral tests ───────────────────────────────────────────────────────

/** Minimal view that satisfies the early-exit paths only. */
function makeView(from: number, to: number, hasHighlightMark: boolean) {
  const dispatch = vi.fn();
  return {
    state: {
      selection: { from, to },
      schema: {
        marks: {
          highlight: hasHighlightMark ? { name: "highlight" } : undefined,
        },
      },
      // tr and doc intentionally omitted — should not be touched in early exits
    },
    dispatch,
    _dispatch: dispatch,
  };
}

describe("milkdownHighlightCommand — early exits", () => {
  it("returns false for empty selection (from === to)", () => {
    const view = makeView(5, 5, true);
    const result = milkdownHighlightCommand(view as never);

    expect(result).toBe(false);
  });

  it("does not dispatch for empty selection", () => {
    const view = makeView(5, 5, true);
    milkdownHighlightCommand(view as never);

    expect(view._dispatch).not.toHaveBeenCalled();
  });

  it("returns false when highlight mark is absent from schema", () => {
    const view = makeView(0, 5, false);
    const result = milkdownHighlightCommand(view as never);

    expect(result).toBe(false);
  });

  it("does not dispatch when highlight mark is absent from schema", () => {
    const view = makeView(0, 5, false);
    milkdownHighlightCommand(view as never);

    expect(view._dispatch).not.toHaveBeenCalled();
  });
});

// ── B) Success path with real ProseMirror schema ─────────────────────────────
//
// Build a minimal Schema + EditorState that includes the highlight mark so we
// can verify the command calls dispatch (applies the mark) on a non-empty selection.

const highlightSchema = new Schema({
  nodes: {
    doc: { content: "text*" },
    text: { group: "inline" },
  },
  marks: {
    highlight: {
      parseDOM: [{ tag: "mark" }],
      toDOM(): [string, number] { return ["mark", 0]; },
    },
  },
});

function makeRealView(selFrom: number, selTo: number) {
  const doc = highlightSchema.node("doc", null, [highlightSchema.text("hello world")]);
  const state = EditorState.create({
    schema: highlightSchema,
    doc,
    selection: TextSelection.create(doc, selFrom, selTo),
  });
  const dispatch = vi.fn();
  return {
    state,
    dispatch,
    isDestroyed: false,
    _dispatch: dispatch,
  };
}

describe("milkdownHighlightCommand — success path (real ProseMirror schema)", () => {
  it("returns true for a non-empty selection when highlight mark exists in schema", () => {
    const view = makeRealView(1, 6); // selects "hello"
    const result = milkdownHighlightCommand(view as never);

    expect(result).toBe(true);
  });

  it("calls dispatch when applying the highlight mark to a selection", () => {
    const view = makeRealView(1, 6);
    milkdownHighlightCommand(view as never);

    expect(view._dispatch).toHaveBeenCalledTimes(1);
  });

  it("applies the highlight mark (dispatch receives a transaction with mark added)", () => {
    const view = makeRealView(1, 6);
    milkdownHighlightCommand(view as never);

    const tr = view._dispatch.mock.calls[0][0];
    // The dispatched transaction should add the highlight mark at the selected range
    expect(tr.doc.rangeHasMark(1, 6, highlightSchema.marks.highlight)).toBe(true);
  });
});

// ── C) Source analysis — regression tests ────────────────────────────────────

describe("milkdownHighlightCommand — source regression (#376)", () => {
  it("imports toggleMark from @milkdown/kit/prose/commands", () => {
    expect(src).toMatch(/import.*toggleMark.*from\s+["']@milkdown\/kit\/prose\/commands["']/);
  });

  it("does NOT contain insertText call (old buggy behaviour removed)", () => {
    // Old code: state.tr.insertText("==text==", from, to)
    expect(src).not.toMatch(/insertText/);
  });

  it("does NOT contain HIGHLIGHT_OPEN or HIGHLIGHT_CLOSE constants (== markers removed)", () => {
    expect(src).not.toMatch(/HIGHLIGHT_OPEN|HIGHLIGHT_CLOSE/);
  });

  it("calls toggleMark in the function body", () => {
    expect(src).toMatch(/toggleMark\s*\(/);
  });

  it("resolves mark type from view.state.schema.marks.highlight", () => {
    expect(src).toMatch(/schema\.marks\.highlight/);
  });
});
