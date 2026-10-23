import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

export interface PrototypeMatch { from: number; to: number; preview: string }
export interface PrototypeSearch { query: string; caseSensitive: boolean; wholeWord: boolean; current: number }
const key = new PluginKey<DecorationSet>("findReplacePrototype");
const changeKey = "findReplacePrototypeSearch";

export function findPrototypeMatches(doc: ProseNode, search: PrototypeSearch): PrototypeMatch[] {
  if (!search.query) return [];
  const matches: PrototypeMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const source = node.text;
    const haystack = search.caseSensitive ? source : source.toLocaleLowerCase();
    const needle = search.caseSensitive ? search.query : search.query.toLocaleLowerCase();
    let cursor = 0;
    while (cursor <= haystack.length - needle.length) {
      const at = haystack.indexOf(needle, cursor);
      if (at < 0) break;
      const before = source[at - 1] ?? "";
      const after = source[at + needle.length] ?? "";
      const boundary = !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
      if (!search.wholeWord || boundary) matches.push({ from: pos + at, to: pos + at + needle.length, preview: source.slice(Math.max(0, at - 24), Math.min(source.length, at + needle.length + 32)) });
      cursor = at + Math.max(needle.length, 1);
    }
  });
  return matches;
}

export function installPrototypeSearch(view: EditorView, onMatches: (matches: PrototypeMatch[]) => void): () => void {
  const originalPlugins = view.state.plugins;
  let search: PrototypeSearch = { query: "", caseSensitive: false, wholeWord: false, current: 0 };
  const plugin = new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, previous) {
        const next = transaction.getMeta(changeKey) as PrototypeSearch | undefined;
        if (next) search = next;
        if (!next && !transaction.docChanged) return previous;
        const matches = findPrototypeMatches(transaction.doc, search);
        return DecorationSet.create(transaction.doc, matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === search.current ? "find-prototype-match is-current" : "find-prototype-match" })));
      },
    },
    props: { decorations: (state) => key.getState(state) ?? DecorationSet.empty },
    view: () => ({ update(updatedView) { onMatches(findPrototypeMatches(updatedView.state.doc, search)); } }),
  });
  view.updateState(view.state.reconfigure({ plugins: [...originalPlugins, plugin] }));
  return () => {
    if (!view.isDestroyed) view.updateState(view.state.reconfigure({ plugins: view.state.plugins.filter((item) => item !== plugin) }));
  };
}

export function updatePrototypeSearch(view: EditorView, search: PrototypeSearch): PrototypeMatch[] {
  view.dispatch(view.state.tr.setMeta(changeKey, search));
  return findPrototypeMatches(view.state.doc, search);
}

export function selectPrototypeMatch(view: EditorView, match: PrototypeMatch) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView());
}
