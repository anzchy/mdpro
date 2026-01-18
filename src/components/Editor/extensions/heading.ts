import { EditorView } from "@codemirror/view";

/**
 * Create a command that converts the current line to a heading of the specified level.
 * Level 0 means remove the heading (paragraph).
 */
export function makeHeadingCommand(level: number) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;

    // Get the line at the cursor position
    const line = state.doc.lineAt(from);
    const lineText = line.text;

    // Remove existing heading markers (# symbols at start)
    const headingMatch = lineText.match(/^(#{1,6})\s*/);
    const textWithoutHeading = headingMatch
      ? lineText.slice(headingMatch[0].length)
      : lineText;

    // Create new line with heading level
    let newLine: string;
    if (level === 0) {
      // Paragraph - just text without heading
      newLine = textWithoutHeading;
    } else {
      // Add heading markers
      const prefix = "#".repeat(level) + " ";
      newLine = prefix + textWithoutHeading;
    }

    // Calculate cursor position adjustment
    const oldHeadingLength = headingMatch ? headingMatch[0].length : 0;
    const newHeadingLength = level === 0 ? 0 : level + 1; // level + 1 for "# "

    // Calculate new cursor position
    let newCursorPos = from - line.from; // Position within line
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

// Pre-built commands for each heading level
export const heading1Command = makeHeadingCommand(1);
export const heading2Command = makeHeadingCommand(2);
export const heading3Command = makeHeadingCommand(3);
export const heading4Command = makeHeadingCommand(4);
export const heading5Command = makeHeadingCommand(5);
export const heading6Command = makeHeadingCommand(6);
export const paragraphCommand = makeHeadingCommand(0);

/**
 * Increase heading level (H2 -> H1, or add H6 if no heading)
 */
export function increaseHeadingCommand(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;

  const headingMatch = lineText.match(/^(#{1,6})\s*/);
  const currentLevel = headingMatch ? headingMatch[1].length : 0;

  if (currentLevel === 0) {
    // No heading, add H6
    return makeHeadingCommand(6)(view);
  } else if (currentLevel > 1) {
    // Decrease the number (H2 -> H1 means level 2 -> 1)
    return makeHeadingCommand(currentLevel - 1)(view);
  }

  // Already H1, do nothing
  return true;
}

/**
 * Decrease heading level (H1 -> H2, or remove if H6)
 */
export function decreaseHeadingCommand(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const lineText = line.text;

  const headingMatch = lineText.match(/^(#{1,6})\s*/);
  const currentLevel = headingMatch ? headingMatch[1].length : 0;

  if (currentLevel === 0) {
    // No heading, do nothing
    return true;
  } else if (currentLevel < 6) {
    // Increase the number (H1 -> H2 means level 1 -> 2)
    return makeHeadingCommand(currentLevel + 1)(view);
  } else {
    // H6, remove heading
    return makeHeadingCommand(0)(view);
  }
}
