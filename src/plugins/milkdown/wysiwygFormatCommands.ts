/**
 * Purpose: pure ProseMirror commands shared by WYSIWYG menu and v1 shortcuts.
 * @coordinates-with ../../utils/editorMenuCommands.ts
 * @coordinates-with typoraKeymapPlugin.ts
 */
import { setBlockType, toggleMark } from "@milkdown/kit/prose/commands";
import { TextSelection, type Command } from "@milkdown/kit/prose/state";

/** Shift the enclosing paragraph/heading by one level without changing its inline content. */
export function makeHeadingLevelCommand(direction: "increase" | "decrease"): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!$from.sameParent($to)) return false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const name = $from.node(depth).type.name;
      if (name === "table" || name === "table_cell" || name === "table_header" || name === "code_block") {
        return false;
      }
    }
    const block = $from.parent;
    if (block.type.name !== "paragraph" && block.type.name !== "heading") return false;
    const level = block.type.name === "heading" ? Number(block.attrs.level) : 0;
    if (direction === "increase" && level === 1) return false;
    if (direction === "decrease" && level === 0) return false;
    const nextLevel = direction === "increase" ? (level === 0 ? 6 : level - 1) : level + 1;
    const type = nextLevel > 6 ? state.schema.nodes.paragraph : state.schema.nodes.heading;
    if (!type) return false;
    return setBlockType(type, nextLevel > 6 ? undefined : { level: nextLevel })(state, dispatch);
  };
}

/** Select the current word, or the next identical occurrence of an existing selection. */
export function selectWordCommand(): Command {
  return (state, dispatch) => {
    const { $from, $to, empty } = state.selection;
    if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
    const start = $from.start();
    // Inline atoms each occupy one ProseMirror position. Preserve that slot
    // in the segmenter input so its offsets also work for image/hard-break text.
    const text = $from.parent.textBetween(0, $from.parent.content.size, "", "\uFFFC");
    let from: number;
    let to: number;
    if (!empty) {
      const selected = text.slice($from.parentOffset, $to.parentOffset);
      if (!selected) return false;
      const next = text.indexOf(selected, $to.parentOffset);
      if (next < 0) return false;
      from = start + next;
      to = from + selected.length;
    } else {
      const offset = $from.parentOffset;
      // The app's TS lib predates Segmenter; macOS 13's runtime provides it.
      const Segmenter = (Intl as typeof Intl & {
        Segmenter: new (locale: string | undefined, options: { granularity: "word" }) => {
          segment(input: string): Iterable<{ index: number; segment: string; isWordLike?: boolean }>;
        };
      }).Segmenter;
      const segmenter = new Segmenter(undefined, { granularity: "word" });
      const segments = Array.from(segmenter.segment(text));
      const current = segments.find((segment) => segment.isWordLike &&
        ((offset >= segment.index && offset < segment.index + segment.segment.length) ||
          (offset === segment.index + segment.segment.length &&
            (offset === text.length || !/\p{L}|\p{N}/u.test(text[offset])))));
      if (!current) return false;
      from = start + current.index;
      to = from + current.segment.length;
    }
    const nextSelection = TextSelection.create(state.doc, from, to);
    if (nextSelection.eq(state.selection)) return false;
    if (dispatch) dispatch(state.tr.setSelection(nextSelection));
    return true;
  };
}

/** Select the content of the enclosing textblock, including a multiline code block. */
export function selectLineCommand(): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.content.size === 0) return false;
    const next = TextSelection.create(state.doc, $from.start(), $from.end());
    if (next.eq(state.selection)) return false;
    if (dispatch) dispatch(state.tr.setSelection(next));
    return true;
  };
}

const CLEARABLE_MARKS = ["strong", "emphasis", "inlineCode", "strike_through", "highlight", "underline"];

/** Remove selected inline formatting in one transaction while retaining links. */
export function clearFormatCommand(): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const tr = state.tr;
    for (const name of CLEARABLE_MARKS) {
      const mark = state.schema.marks[name];
      if (mark) tr.removeMark(from, to, mark);
    }
    if (!tr.docChanged) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/** Toggle the registered underline mark without importing its parser plugin. */
export function underlineCommand(): Command {
  return (state, dispatch) => {
    const mark = state.schema.marks.underline;
    return mark ? toggleMark(mark)(state, dispatch) : false;
  };
}
