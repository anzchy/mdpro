import type { Command } from "@milkdown/kit/prose/state";

const CODE_BLOCK_INDENT = "    ";

type CodeBlockIndentDirection = "indent" | "outdent";

function getLineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function findLineIndex(lineStarts: number[], offset: number): number {
  let lineIndex = 0;
  for (let index = 1; index < lineStarts.length; index += 1) {
    if (lineStarts[index] > offset) break;
    lineIndex = index;
  }
  return lineIndex;
}

function getOutdentLength(lineText: string, indentUnit: string): number {
  if (lineText.startsWith("\t")) return 1;
  let spaces = 0;
  while (spaces < lineText.length && lineText[spaces] === " ") {
    spaces += 1;
  }
  return Math.min(spaces, indentUnit.length);
}

/**
 * Returns a ProseMirror Command that indents or outdents selected lines inside a
 * fenced code block. Outside code blocks it returns false so Milkdown's list
 * keymaps can continue handling Tab / Shift-Tab.
 */
export function makeCodeBlockIndentCommand(
  direction: CodeBlockIndentDirection,
  indentUnit = CODE_BLOCK_INDENT,
): Command {
  return (state, dispatch) => {
    const { selection } = state;
    const { $from, $to, empty, from, to } = selection;

    if ($from.parent !== $to.parent) return false;
    if ($from.parent.type.name !== "code_block") return false;

    const codeText = $from.parent.textContent;
    const blockStart = $from.start($from.depth);
    const fromOffset = Math.max(0, Math.min(from - blockStart, codeText.length));
    const toOffset = Math.max(0, Math.min(to - blockStart, codeText.length));
    const effectiveToOffset = !empty && toOffset > fromOffset
      ? toOffset - 1
      : toOffset;

    const lineStarts = getLineStartOffsets(codeText);
    const firstLine = findLineIndex(lineStarts, fromOffset);
    const lastLine = findLineIndex(lineStarts, effectiveToOffset);

    const changes: Array<{ from: number; to: number; text?: string }> = [];

    for (let line = firstLine; line <= lastLine; line += 1) {
      const lineStart = lineStarts[line];
      const nextLineStart = lineStarts[line + 1];
      const lineEnd = nextLineStart === undefined ? codeText.length : nextLineStart - 1;
      const lineText = codeText.slice(lineStart, lineEnd);
      const absoluteLineStart = blockStart + lineStart;

      if (direction === "indent") {
        changes.push({
          from: absoluteLineStart,
          to: absoluteLineStart,
          text: indentUnit,
        });
        continue;
      }

      const removeLength = getOutdentLength(lineText, indentUnit);
      if (removeLength > 0) {
        changes.push({
          from: absoluteLineStart,
          to: absoluteLineStart + removeLength,
        });
      }
    }

    if (changes.length === 0) return true;

    let tr = state.tr;
    [...changes]
      .sort((a, b) => b.from - a.from)
      .forEach((change) => {
        if (change.from === change.to) {
          tr = tr.insertText(change.text ?? "", change.from);
        } else {
          tr = tr.delete(change.from, change.to);
        }
      });

    if (tr.docChanged) {
      dispatch?.(tr.scrollIntoView());
    }
    return true;
  };
}
