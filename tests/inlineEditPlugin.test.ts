import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import {
  inlineEditPluginKey,
  inlineEditProsemirrorPlugin,
} from "../src/plugins/milkdown/inlineEditPlugin";

const inlineEditTestSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    inlineCode: {
      code: true,
      parseDOM: [{ tag: "code" }],
      toDOM(): [string, number] { return ["code", 0]; },
    },
  },
});

function makeInlineCodeState(selectionPos: number) {
  const codeText = "auto_compact";
  const paragraph = inlineEditTestSchema.nodes.paragraph.create(null, [
    inlineEditTestSchema.text("\""),
    inlineEditTestSchema.text(codeText, [inlineEditTestSchema.marks.inlineCode.create()]),
    inlineEditTestSchema.text("小于 3 \""),
  ]);
  const doc = inlineEditTestSchema.nodes.doc.create(null, [paragraph]);

  return EditorState.create({
    schema: inlineEditTestSchema,
    doc,
    selection: TextSelection.create(doc, selectionPos, selectionPos),
    plugins: [inlineEditProsemirrorPlugin],
  });
}

describe("inlineEditPlugin — inline code cursor markers", () => {
  it("renders the closing backtick as a widget before the cursor at the code end", () => {
    const codeStart = 2;
    const codeEnd = codeStart + "auto_compact".length;
    const state = makeInlineCodeState(codeEnd);
    const decorationSet = inlineEditPluginKey.getState(state) as DecorationSet;
    const decorations = decorationSet.find();

    const closingMarker = decorations.find((decoration) => (
      decoration.from === codeEnd &&
      decoration.to === codeEnd &&
      decoration.spec.key === `inline-code-close-${codeEnd}`
    ));

    expect(closingMarker).toBeDefined();
    expect(closingMarker?.spec.side).toBe(-1);
  });
});
