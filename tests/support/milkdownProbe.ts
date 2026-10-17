/**
 * @module tests/support/milkdownProbe
 * Purpose: the generic probe of the composed Milkdown editor (M1A-WI-6, matrix
 * R2-1a / R3-4). Mounts the real `MilkdownEditor`, builds six editor states,
 * and asks every `handleKeyDown` prop whether it handles each chord of a domain.
 * The per-platform files set `navigator.platform` before any import, because
 * prosemirror-keymap and prosemirror-commands read it once at module load; the
 * boundary mocks live in those files (vi.mock is hoisted only there).
 *
 * A handler that throws counts as reached: it matched the chord and ran.
 */
import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { Selection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { CellSelection } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { parseChord, type Chord } from "../../src/commands/chord";
import type { OwnershipContext, Platform } from "../../src/commands/commandTable.types";
import { MilkdownEditor } from "../../src/components/Editor/MilkdownEditor";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";

export const STATES = ["i", "ii", "iii", "iv", "v", "vi"] as const;
export type StateName = (typeof STATES)[number];
/** (i) and (ii) are table states. */
export const stateContext = (s: StateName): OwnershipContext => (s === "i" || s === "ii" ? "tableW" : "editorW");

const DOC = "hello\n\nworld\n\n```\ncode\n```\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| c | d |\n";

export async function mountMilkdown(): Promise<EditorView> {
  useDocumentStore.setState({
    documents: [{ id: "doc-a", path: null, content: DOC, encoding: "UTF-8", lineEnding: "lf",
      isModified: false, lastSaved: null, fileSize: null }],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  render(createElement(MilkdownEditor));
  let editor: Editor | null = null;
  await waitFor(() => {
    editor = (useMilkdownEditorStore.getState().getEditor() as Editor | null) ?? null;
    expect(editor).not.toBeNull();
  }, { timeout: 10_000 });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  return editor!.action((ctx) => ctx.get(editorViewCtx));
}

export function unmountMilkdown(): void {
  cleanup();
}

/** The six probe states over the one mounted document. */
export function buildStates(base: EditorState): Record<StateName, EditorState> {
  const doc = base.doc;
  const paras: number[] = [];
  const items: number[] = [];
  const cells: number[] = [];
  let code = -1;
  doc.descendants((node, pos, parent) => {
    const role = node.type.spec.tableRole as string | undefined;
    if (role === "cell" || role === "header_cell") cells.push(pos);
    if (node.type.name === "paragraph" && parent === doc) paras.push(pos);
    if (node.type.name === "code_block") code = pos;
    if (node.type.name === "list_item") items.push(pos);
  });
  expect([paras.length >= 2, code >= 0, items.length, cells.length]).toEqual([true, true, 2, 4]);
  const cell0 = doc.nodeAt(cells[0])!;
  const sel: Record<StateName, Selection> = {
    i: Selection.near(doc.resolve(cells[0] + cell0.nodeSize - 1), -1),
    ii: CellSelection.create(doc, cells[0], cells[3]),
    iii: TextSelection.create(doc, paras[1] + 1),
    iv: TextSelection.create(doc, paras[1] + 1, paras[1] + 6),
    v: TextSelection.create(doc, code + 2),
    vi: TextSelection.create(doc, items[1] + 2),
  };
  expect(doc.textBetween(paras[1] + 1, paras[1] + 6)).toBe("world");
  return Object.fromEntries(STATES.map((s) => [s, base.apply(base.tr.setSelection(sel[s]))])) as Record<StateName, EditorState>;
}

const PUNCT: Record<string, readonly [string, number]> = {
  "`": ["Backquote", 192], "~": ["Backquote", 192], "-": ["Minus", 189], _: ["Minus", 189],
  "=": ["Equal", 187], "[": ["BracketLeft", 219], "{": ["BracketLeft", 219],
  "]": ["BracketRight", 221], "}": ["BracketRight", 221], "\\": ["Backslash", 220], "|": ["Backslash", 220],
  ";": ["Semicolon", 186], ":": ["Semicolon", 186], "'": ["Quote", 222], '"': ["Quote", 222],
  ",": ["Comma", 188], "<": ["Comma", 188], ".": ["Period", 190], ">": ["Period", 190],
  "/": ["Slash", 191], "?": ["Slash", 191],
};
const SHIFTED_DIGITS = ")!@#$%^&*(";
const NAMED: Record<string, readonly [string, string, number]> = {
  Up: ["ArrowUp", "ArrowUp", 38], Down: ["ArrowDown", "ArrowDown", 40], Left: ["ArrowLeft", "ArrowLeft", 37],
  Right: ["ArrowRight", "ArrowRight", 39], Space: [" ", "Space", 32], Backspace: ["Backspace", "Backspace", 8],
  Delete: ["Delete", "Delete", 46], Enter: ["Enter", "Enter", 13], Tab: ["Tab", "Tab", 9],
  Escape: ["Escape", "Escape", 27], Home: ["Home", "Home", 36], End: ["End", "End", 35],
  PageUp: ["PageUp", "PageUp", 33], PageDown: ["PageDown", "PageDown", 34],
};

/** `key`, `code`, `keyCode` of a canonical key on a US layout, as a real US keyboard sends it. */
export function usKey(key: string, shift: boolean): readonly [string, string, number] {
  if (NAMED[key]) return NAMED[key];
  const f = /^F(\d+)$/.exec(key);
  if (f) return [key, key, 111 + Number(f[1])];
  if (/^[A-Z]$/.test(key)) return [shift ? key : key.toLowerCase(), `Key${key}`, key.charCodeAt(0)];
  if (/^[0-9]$/.test(key)) return [shift ? SHIFTED_DIGITS[Number(key)] : key, `Digit${key}`, key.charCodeAt(0)];
  const d = SHIFTED_DIGITS.indexOf(key);
  if (d >= 0) return [key, `Digit${d}`, 48 + d];
  const [code, keyCode] = PUNCT[key] ?? ["Unidentified", 0];
  return [shift ? (SHIFTED_PUNCT[key] ?? key) : key, code, keyCode];
}

/** What Shift turns an unshifted US punctuation key into. */
const SHIFTED_PUNCT: Record<string, string> = {
  "`": "~", "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?",
};

export function keyEvent(chord: Chord, p: Platform): KeyboardEvent {
  const [key, code, keyCode] = usKey(chord.key, chord.shift);
  const mac = p === "macos";
  return new KeyboardEvent("keydown", {
    key, code, keyCode, bubbles: true, cancelable: true,
    metaKey: mac && chord.cmd, ctrlKey: mac ? chord.ctrl : chord.cmd || chord.ctrl,
    altKey: chord.option, shiftKey: chord.shift,
  } as KeyboardEventInit);
}

/** Does any `handleKeyDown` prop take this event in this state? */
export function handles(view: EditorView, state: EditorState, ev: KeyboardEvent): boolean {
  if (view.state !== state) view.updateState(state);
  try {
    return view.someProp("handleKeyDown", (f) => f(view, ev)) === true;
  } catch {
    return true;
  }
}

/** chord → the states it is handled in, over a domain of normalised chords. */
export function probeAll(
  view: EditorView, states: Record<StateName, EditorState>, chords: readonly string[], p: Platform,
): Map<string, Set<StateName>> {
  const out = new Map<string, Set<StateName>>();
  for (const c of chords) {
    const chord = parseChord(c, p)!;
    const hit = new Set<StateName>();
    for (const s of STATES) if (handles(view, states[s], keyEvent(chord, p))) hit.add(s);
    out.set(c, hit);
  }
  view.updateState(states.iii);
  return out;
}
