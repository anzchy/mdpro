/**
 * Purpose: keep WYSIWYG find state and decorations in ProseMirror without changing its document.
 * @coordinates-with findModel.ts
 * @coordinates-with ../../../components/Editor/FindReplaceBar.tsx
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { findMatches, type FindOptions, type FindRange } from "./findModel";

export interface FindState extends FindOptions {
  open: boolean;
  replacing: boolean;
  query: string;
  matches: FindRange[];
  current: number;
  focusEpoch: number;
}

type FindAction =
  | { type: "open"; replacing: boolean; selection: string }
  | { type: "query"; query: string }
  | { type: "options"; options: Partial<FindOptions> }
  | { type: "move"; direction: 1 | -1 }
  | { type: "close" };

export const findPluginKey = new PluginKey<FindState>("mdpro-find");
const empty: FindState = { open: false, replacing: false, query: "", caseSensitive: false, wholeWord: false, matches: [], current: -1, focusEpoch: 0 };

export function getFindState(state: EditorState): FindState {
  return findPluginKey.getState(state) ?? empty;
}

function reduceFind(tr: Transaction, state: FindState): FindState {
  const action = tr.getMeta(findPluginKey) as FindAction | undefined;
  if (action?.type === "close") return { ...state, open: false, replacing: false, matches: [], current: -1 };
  let next = state;
  if (action?.type === "open") next = {
    ...next, open: true, replacing: action.replacing, focusEpoch: next.focusEpoch + 1,
    query: action.selection || next.query,
  };
  if (action?.type === "query") next = { ...next, open: true, query: action.query };
  if (action?.type === "options") next = { ...next, ...action.options };
  if (!next.open) return next;
  if (tr.docChanged || action?.type === "open" || action?.type === "query" || action?.type === "options") {
    const matches = findMatches(tr.doc, next.query, next);
    const oldRange = state.matches[state.current];
    const mappedStart = tr.docChanged && oldRange ? tr.mapping.map(oldRange.from, 1) : -1;
    const mappedCurrent = matches.findIndex((range) => range.from === mappedStart);
    const nextAfterRemoved = matches.findIndex((range) => range.from >= mappedStart);
    const current = !matches.length ? -1 : mappedCurrent >= 0 ? mappedCurrent
      : mappedStart >= 0 && nextAfterRemoved >= 0 ? nextAfterRemoved
        : tr.docChanged && mappedStart >= 0 ? 0 : Math.min(Math.max(next.current, 0), matches.length - 1);
    return { ...next, matches, current };
  }
  if (action?.type === "move" && next.matches.length) {
    return { ...next, current: (next.current + action.direction + next.matches.length) % next.matches.length };
  }
  return next;
}

function decorations(state: EditorState): DecorationSet {
  const find = getFindState(state);
  if (!find.open) return DecorationSet.empty;
  return DecorationSet.create(state.doc, find.matches.map((range, index) => Decoration.inline(range.from, range.to, {
    class: index === find.current ? "mdpro-find-match is-current" : "mdpro-find-match",
  })));
}

/** A fresh plugin instance belongs to each editor; the callback updates its mounted bar. */
export function createFindPlugin(onChange?: (state: FindState) => void): Plugin {
  return new Plugin<FindState>({
    key: findPluginKey,
    state: { init: () => empty, apply: reduceFind },
    props: { decorations },
    view: () => ({
      update: (nextView) => {
        const next = getFindState(nextView.state);
        onChange?.(next);
        if (next.open && next.current >= 0) {
          nextView.dom.querySelector(".mdpro-find-match.is-current")?.scrollIntoView?.({ block: "nearest" });
        }
      },
      destroy: () => onChange?.(empty),
    }),
  });
}

function dispatchAction(view: EditorView, action: FindAction): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, action).setMeta("addToHistory", false));
}

export function openFind(view: EditorView, replacing: boolean): void {
  const { from, to } = view.state.selection;
  const selection = from === to ? "" : view.state.doc.textBetween(from, to, " ");
  dispatchAction(view, { type: "open", replacing, selection });
}

export function setFindQuery(view: EditorView, query: string): void {
  dispatchAction(view, { type: "query", query });
}

export function setFindOptions(view: EditorView, options: Partial<FindOptions>): void {
  dispatchAction(view, { type: "options", options });
}

export function moveFind(view: EditorView, direction: 1 | -1): boolean {
  if (!getFindState(view.state).matches.length) return false;
  dispatchAction(view, { type: "move", direction });
  return true;
}

export function closeFind(view: EditorView): void {
  dispatchAction(view, { type: "close" });
}

/** Replace the current match or the pre-operation match set as one isolated undo event. */
export function replaceFind(view: EditorView, replacement: string, all: boolean): boolean {
  if (view.isDestroyed || !view.dom.isConnected || !view.editable || view.composing) return false;
  const find = getFindState(view.state);
  if (!find.open || !find.query || find.current < 0) return false;
  const ranges = all ? find.matches : [find.matches[find.current]];
  if (!ranges.length || ranges.some((range) => !range)) return false;
  let tr = closeHistory(view.state.tr);
  for (const range of [...ranges].reverse()) tr = tr.insertText(replacement, range.from, range.to);
  view.dispatch(tr);
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
  return true;
}
