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

export const inlineEditPluginKey = new PluginKey("inlineEdit");

/**
 * Find the full range of a mark around a position
 */
function findMarkRange(
  doc: Node,
  pos: number,
  markType: string
): { from: number; to: number; mark: Mark } | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  // Find the mark at the cursor
  let targetMark: Mark | null = null;
  let from = pos;
  let to = pos;

  // Get the offset within parent
  const offset = $pos.parentOffset;

  // Find which child node contains the cursor
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

  // Now find the full extent of this mark
  // Scan backwards
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

  // Expand to include consecutive text nodes with the same mark
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

/**
 * Create decorations for expanded inline elements
 */
function createDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const decorations: Decoration[] = [];

  // Only process if we have a cursor (not a range selection)
  if (!selection.empty) {
    return DecorationSet.empty;
  }

  const pos = selection.from;

  // Check for link mark
  const linkRange = findMarkRange(state.doc, pos, "link");
  if (linkRange) {
    const { from, to, mark } = linkRange;
    const href = mark.attrs.href || "";

    // Add decoration with data attributes for CSS
    decorations.push(
      Decoration.inline(from, to, {
        class: "milkdown-inline-expanded milkdown-link-expanded",
        "data-href": href,
      })
    );
  }

  // Check for inlineCode mark
  const codeRange = findMarkRange(state.doc, pos, "inlineCode");
  if (codeRange) {
    const { from, to } = codeRange;

    decorations.push(
      Decoration.inline(from, to, {
        class: "milkdown-inline-expanded milkdown-code-expanded",
      })
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * ProseMirror plugin for Typora-style inline editing
 */
export const inlineEditProsemirrorPlugin = new Plugin({
  key: inlineEditPluginKey,

  state: {
    init(_, state) {
      return createDecorations(state);
    },
    apply(tr: Transaction, oldDecorations: DecorationSet, _oldState, newState) {
      // Recreate decorations if selection changed or document changed
      if (tr.selectionSet || tr.docChanged) {
        return createDecorations(newState);
      }
      // Map decorations through document changes
      return oldDecorations.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

/**
 * Milkdown plugin wrapper for the inline edit plugin
 */
export const inlineEditPlugin = $prose(() => inlineEditProsemirrorPlugin);
