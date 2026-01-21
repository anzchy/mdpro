// TODO(003-redesign-plugin-system): Deprecated. Use src/plugins/codemirror/wysiwygDecorationsPlugin.ts instead.
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { codeFenceWidget, headingWidget, listWidget, quoteWidget } from "./widgets";

const buildDecorations = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const activeLines = new Set<number>();

  for (const range of state.selection.ranges) {
    activeLines.add(state.doc.lineAt(range.from).number);
    activeLines.add(state.doc.lineAt(range.to).number);
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (!activeLines.has(line.number)) {
        const text = line.text;
        const headingMatch = text.match(/^(#{1,6})\s+/);
        if (headingMatch) {
          const length = headingMatch[0].length;
          builder.add(
            line.from,
            line.from + length,
            Decoration.replace({ widget: headingWidget(headingMatch[1].length) }),
          );
        } else {
          const listMatch = text.match(/^(\s*)([-*+]|\d+\.)\s+/);
          if (listMatch) {
            const start = line.from + listMatch[1].length;
            const end = line.from + listMatch[0].length;
            builder.add(start, end, Decoration.replace({ widget: listWidget(listMatch[2]) }));
          }

          const quoteMatch = text.match(/^(>+)\s+/);
          if (quoteMatch) {
            const end = line.from + quoteMatch[0].length;
            builder.add(line.from, end, Decoration.replace({ widget: quoteWidget() }));
          }

          const codeMatch = text.match(/^```\w*/);
          if (codeMatch) {
            const end = line.from + codeMatch[0].length;
            builder.add(line.from, end, Decoration.replace({ widget: codeFenceWidget() }));
          }
        }
      }
      pos = line.to + 1;
    }
  }

  return builder.finish();
};

const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

export const wysiwygExtension: Extension = [wysiwygPlugin];
