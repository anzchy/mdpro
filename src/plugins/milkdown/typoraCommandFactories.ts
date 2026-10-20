/**
 * Purpose: reusable ProseMirror commands shared by the Typora keymap and the
 * native-menu editor dispatcher. Resolve schema types from live editor state.
 *
 * @coordinates-with typoraKeymapPlugin.ts
 * @coordinates-with ../../utils/editorMenuCommands.ts
 */
import { setBlockType, toggleMark } from "@milkdown/kit/prose/commands";
import type { Command } from "@milkdown/kit/prose/state";

/** Convert the current block to a heading; refuse when schema lacks it. */
export function makeHeadingCommand(level: number): Command {
  return (state, dispatch) => {
    const headingType = state.schema.nodes["heading"];
    if (!headingType) return false;
    return setBlockType(headingType, { level })(state, dispatch);
  };
}

/** Convert the current block to a paragraph. */
export function makeParagraphCommand(): Command {
  return (state, dispatch) => {
    const paragraphType = state.schema.nodes["paragraph"];
    if (!paragraphType) return false;
    return setBlockType(paragraphType)(state, dispatch);
  };
}

/** Toggle the schema's strong mark. */
export function makeBoldCommand(): Command {
  return (state, dispatch) => {
    const strongMark = state.schema.marks["strong"];
    if (!strongMark) return false;
    return toggleMark(strongMark)(state, dispatch);
  };
}

/** Toggle the schema's emphasis mark. */
export function makeItalicCommand(): Command {
  return (state, dispatch) => {
    const emphasisMark = state.schema.marks["emphasis"];
    if (!emphasisMark) return false;
    return toggleMark(emphasisMark)(state, dispatch);
  };
}
