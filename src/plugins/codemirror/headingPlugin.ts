import { EditorView, keymap } from "@codemirror/view";
import { createPlugin } from "../core/pluginTypes";

export function makeHeadingCommand(level: number) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;

    const line = state.doc.lineAt(from);
    const lineText = line.text;

    const headingMatch = lineText.match(/^(#{1,6})\s*/);
    const textWithoutHeading = headingMatch
      ? lineText.slice(headingMatch[0].length)
      : lineText;

    let newLine: string;
    if (level === 0) {
      newLine = textWithoutHeading;
    } else {
      const prefix = "#".repeat(level) + " ";
      newLine = prefix + textWithoutHeading;
    }

    const oldHeadingLength = headingMatch ? headingMatch[0].length : 0;
    const newHeadingLength = level === 0 ? 0 : level + 1;

    let newCursorPos = from - line.from;
    newCursorPos = Math.max(0, newCursorPos - oldHeadingLength + newHeadingLength);
    newCursorPos = Math.min(newLine.length, newCursorPos);

    view.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: newLine,
      },
      selection: {
        anchor: line.from + newCursorPos,
      },
    });

    return true;
  };
}

export const heading1Command = makeHeadingCommand(1);
export const heading2Command = makeHeadingCommand(2);
export const heading3Command = makeHeadingCommand(3);
export const heading4Command = makeHeadingCommand(4);
export const heading5Command = makeHeadingCommand(5);
export const heading6Command = makeHeadingCommand(6);
export const paragraphCommand = makeHeadingCommand(0);

export function increaseHeadingCommand(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;

  const headingMatch = lineText.match(/^(#{1,6})\s*/);
  const currentLevel = headingMatch ? headingMatch[1].length : 0;

  if (currentLevel === 0) {
    return makeHeadingCommand(6)(view);
  }
  if (currentLevel > 1) {
    return makeHeadingCommand(currentLevel - 1)(view);
  }

  return true;
}

export function decreaseHeadingCommand(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;

  const headingMatch = lineText.match(/^(#{1,6})\s*/);
  const currentLevel = headingMatch ? headingMatch[1].length : 0;

  if (currentLevel === 0) {
    return true;
  }
  if (currentLevel < 6) {
    return makeHeadingCommand(currentLevel + 1)(view);
  }

  return makeHeadingCommand(0)(view);
}

export const headingPlugin = createPlugin({
  name: "heading",
  displayName: "Heading",
  supportedModes: ["codemirror"],
  priority: 90,
  defaultConfig: {
    enabled: true,
  },
  codemirrorExtension: () =>
    keymap.of([
      { key: "Mod-1", run: heading1Command },
      { key: "Mod-2", run: heading2Command },
      { key: "Mod-3", run: heading3Command },
      { key: "Mod-4", run: heading4Command },
      { key: "Mod-5", run: heading5Command },
      { key: "Mod-6", run: heading6Command },
      { key: "Mod-0", run: paragraphCommand },
      { key: "Mod-=", run: increaseHeadingCommand },
      { key: "Mod--", run: decreaseHeadingCommand },
    ]),
});
