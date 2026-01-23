/**
 * Typora-style Inline Editing Plugin for ProseMirror/Milkdown
 *
 * This plugin provides cursor-aware expansion/collapse of inline elements:
 * - Links: Show `[text](url)` when cursor is inside, styled link when outside
 * - Inline Code: Show `code` with backticks when cursor is inside, styled code when outside
 */

import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node, Mark } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { createPlugin } from "../core/pluginTypes";

export const inlineEditPluginKey = new PluginKey("inlineEdit");

function findMarkRange(
  doc: Node,
  pos: number,
  markType: string,
): { from: number; to: number; mark: Mark } | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  let targetMark: Mark | null = null;
  let from = pos;
  let to = pos;

  const offset = $pos.parentOffset;

  let currentOffset = 0;
  parent.forEach((child) => {
    const childEnd = currentOffset + child.nodeSize;

    if (child.isText && offset >= currentOffset && offset <= childEnd) {
      const mark = child.marks.find((m) => m.type.name === markType);
      if (mark) {
        targetMark = mark;
      }
    }
    currentOffset = childEnd;
  });

  if (!targetMark) return null;

  currentOffset = 0;
  parent.forEach((child, childOffset) => {
    if (child.isText && child.marks.some((m) => m.eq(targetMark!))) {
      const childStart = parentStart + childOffset;
      const childEnd = childStart + child.nodeSize;

      if (childEnd >= from && childStart <= to) {
        from = Math.min(from, childStart);
        to = Math.max(to, childEnd);
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    currentOffset = 0;
    parent.forEach((child, childOffset) => {
      if (child.isText && child.marks.some((m) => m.eq(targetMark!))) {
        const childStart = parentStart + childOffset;
        const childEnd = childStart + child.nodeSize;

        if (childStart === to) {
          to = childEnd;
          changed = true;
        }
        if (childEnd === from) {
          from = childStart;
          changed = true;
        }
      }
    });
  }

  return { from, to, mark: targetMark };
}

function createDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const decorations: Decoration[] = [];

  if (!selection.empty) {
    return DecorationSet.empty;
  }

  const pos = selection.from;

  const linkRange = findMarkRange(state.doc, pos, "link");
  if (linkRange) {
    const { from, to, mark } = linkRange;
    const href = mark.attrs.href || "";

    decorations.push(
      Decoration.inline(from, to, {
        class: "milkdown-inline-expanded milkdown-link-expanded",
        "data-href": href,
      }),
    );
  }

  const codeRange = findMarkRange(state.doc, pos, "inlineCode");
  if (codeRange) {
    const { from, to } = codeRange;

    decorations.push(
      Decoration.inline(from, to, {
        class: "milkdown-inline-expanded milkdown-code-expanded",
      }),
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

export const inlineEditProsemirrorPlugin = new Plugin({
  key: inlineEditPluginKey,

  state: {
    init(_, state) {
      return createDecorations(state);
    },
    apply(tr: Transaction, oldDecorations: DecorationSet, _oldState, newState) {
      if (tr.selectionSet || tr.docChanged) {
        return createDecorations(newState);
      }
      return oldDecorations.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

export const inlineEditMilkdownPlugin = $prose(() => inlineEditProsemirrorPlugin);

export const inlineEditPlugin = createPlugin({
  name: "inline-edit",
  displayName: "Inline Edit",
  supportedModes: ["milkdown"],
  priority: 80,
  defaultConfig: {
    enabled: true,
  },
  milkdownPlugin: () => inlineEditMilkdownPlugin,
});
