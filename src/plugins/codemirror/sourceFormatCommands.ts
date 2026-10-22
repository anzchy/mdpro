/**
 * Purpose: Source-mode Markdown formatting as single CodeMirror transactions.
 * Each command reads the live view and leaves refused operations unchanged.
 *
 * @coordinates-with ../../utils/editorMenuSourceCommands.ts
 * @coordinates-with sourceFormatPlugin.ts
 */
import { deleteGroupBackward, isolateHistory } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Toggle a Markdown delimiter for every selection, refusing newline spans atomically. */
export function toggleInlineMark(view: EditorView, marker: string): boolean {
  if (view.state.readOnly) return false;
  const state = view.state;
  if (state.selection.ranges.some((range) => state.sliceDoc(range.from, range.to).includes("\n"))) return false;
  if (state.selection.ranges.some((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    return selected.length > 0 && selected.split("").every((char) => marker.includes(char));
  })) return false;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const length = marker.length;
    const markerChar = marker[0];
    const leading = selected.match(new RegExp(`^\\${markerChar}+`))?.[0].length ?? 0;
    const trailing = selected.match(new RegExp(`\\${markerChar}+$`))?.[0].length ?? 0;
    const balanced = leading === trailing && leading > 0 && selected.length > leading + trailing;
    const wrapped = markerChar === "*"
      ? balanced && leading <= 3 && (length === 1 ? leading === 1 || leading === 3 : leading === 2 || leading === 3)
      : balanced && leading === length;
    const content = wrapped ? selected.slice(length, -length) : selected;
    const insert = wrapped ? content : `${marker}${content}${marker}`;
    const from = wrapped ? range.from : range.from + length;
    const to = from + content.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(from, to),
    };
  });
  view.dispatch(state.update(transaction, { userEvent: "input", annotations: isolateHistory.of("full") }));
  return true;
}

export const strongCommand = (view: EditorView): boolean => toggleInlineMark(view, "**");
export const emphasisCommand = (view: EditorView): boolean => toggleInlineMark(view, "*");
export const codeCommand = (view: EditorView): boolean => toggleInlineMark(view, "`");
export const strikeCommand = (view: EditorView): boolean => toggleInlineMark(view, "~~");

/** Toggle exact HTML underline tags around every Source selection in one transaction. */
export function underlineCommand(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const state = view.state;
  if (state.selection.ranges.some((range) => state.sliceDoc(range.from, range.to).includes("\n"))) return false;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const wrapped = /^<u>(?:(?!<\/?u>).)*<\/u>$/s.test(selected);
    const content = wrapped ? selected.slice(3, -4) : selected;
    const insert = wrapped ? content : `<u>${selected}</u>`;
    const from = wrapped ? range.from : range.from + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(from, from + content.length),
    };
  });
  view.dispatch(state.update(transaction, { userEvent: "input", annotations: isolateHistory.of("full") }));
  return true;
}

/** True when any selected line intersects an already-open fenced block. */
function touchesExistingFence(state: EditorView["state"], from: number, to: number): boolean {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (let number = 1; number <= last.number; number += 1) {
    const line = state.doc.line(number);
    // A fenced block may be nested in one or more blockquotes. Strip only
    // their container markers; keep any indentation that follows them.
    const syntax = line.text.replace(/^ {0,3}(?:> ?)+/, "");
    if (fence) {
      const candidate = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(syntax)?.[1];
      if (candidate && candidate[0] === fence.marker && candidate.length >= fence.length) {
        if (number >= first.number && number <= last.number) return true;
        fence = null;
      }
    } else {
      const candidate = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(syntax);
      if (candidate && !(candidate[1][0] === "`" && candidate[2].includes("`"))) {
        if (number >= first.number && number <= last.number) return true;
        fence = { marker: candidate[1][0] as "`" | "~", length: candidate[1].length };
      }
    }
    if (number === first.number && fence) return true;
  }
  return false;
}

/** Fence selected whole lines, with a caret in the body for an empty line. */
export function codeFencesCommand(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  if (state.selection.ranges.some((range) => touchesExistingFence(state, range.from, range.to))) return false;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
  const selected = state.sliceDoc(first.from, last.to);
  const trailing = last.number < state.doc.lines ? "\n" : "";
  const insert = `\`\`\`\n${selected}\n\`\`\`${trailing}`;
  const caret = first.from + 4;
  view.dispatch({
    changes: { from: first.from, to: last.to + (trailing ? 1 : 0), insert },
    selection: EditorSelection.cursor(caret),
    userEvent: "input",
    annotations: isolateHistory.of("full"),
  });
  return true;
}

type LinePrefix = "ordered" | "unordered" | "quote";

/** Toggle selected line prefixes as one batch while preserving indentation. */
export function toggleLinePrefix(view: EditorView, kind: LinePrefix): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to).number;
  const lines = Array.from({ length: last - first + 1 }, (_, index) => state.doc.line(first + index));
  const prefix = kind === "ordered" ? /^\d+\. / : kind === "unordered" ? /^- / : /^> /;
  const allHaveTarget = lines.every((line) => prefix.test(line.text.slice(/^\s*/.exec(line.text)?.[0].length ?? 0)));
  const changes = lines.map((line, index) => {
    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    const body = line.text.slice(indent.length);
    const listPrefix = /^(?:\d+\. |- )/.exec(body)?.[0] ?? "";
    const removed = kind === "quote" ? (prefix.exec(body)?.[0] ?? "") : listPrefix;
    const content = body.slice(removed.length);
    const next = allHaveTarget ? `${indent}${content}`
      : `${indent}${kind === "ordered" ? `${index + 1}. ` : kind === "unordered" ? "- " : "> "}${content}`;
    return { from: line.from, to: line.to, insert: next };
  });
  if (changes.every((change, index) => change.insert === lines[index].text)) return false;
  view.dispatch({ changes, userEvent: "input", annotations: isolateHistory.of("full") });
  return true;
}

export const orderedListCommand = (view: EditorView): boolean => toggleLinePrefix(view, "ordered");
export const unorderedListCommand = (view: EditorView): boolean => toggleLinePrefix(view, "unordered");
export const quoteCommand = (view: EditorView): boolean => toggleLinePrefix(view, "quote");

/** Put the selected text inside a standalone `$$` block. */
export function mathBlockCommand(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  const { from, to } = state.selection.main;
  const body = state.sliceDoc(from, to);
  const before = from > 0 && state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
  const after = to < state.doc.length && state.sliceDoc(to, to + 1) !== "\n" ? "\n" : "";
  const insert = `${before}$$\n${body}\n$$${after}`;
  const bodyFrom = from + before.length + 3;
  view.dispatch({
    changes: { from, to, insert },
    selection: body.length ? EditorSelection.range(bodyFrom, bodyFrom + body.length)
      : EditorSelection.cursor(bodyFrom),
    userEvent: "input",
    annotations: isolateHistory.of("full"),
  });
  return true;
}

/** Run CodeMirror's group deletion while separating adjacent invocations in history. */
export function deleteWordCommand(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  view.dispatch({ annotations: isolateHistory.of("before") });
  const changed = deleteGroupBackward(view);
  view.dispatch({ annotations: isolateHistory.of("after") });
  return changed;
}
