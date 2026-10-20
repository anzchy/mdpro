/** Real editor and Recovery fixtures for D291 fix round 1. No internal modules are mocked. */
import { useState } from "react";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState as ProseState } from "@milkdown/kit/prose/state";
import { EditorView as ProseView } from "@milkdown/kit/prose/view";
import { history as proseHistory } from "@milkdown/kit/prose/history";
import { EditorState as CmState, EditorSelection } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";
import { history as cmHistory } from "@codemirror/commands";
import { RecoveryDialog } from "../../src/components/common/RecoveryDialog";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import { makeDoc } from "../helpers/milkdownEditorHarness";

export const recoveryDraft = {
  id: "draft-b", title: "Draft B", originalPath: null,
  lastModified: "2026-10-20 12:00", recovered: false,
};

/** One-row Recovery card; resolve completion closes the card, as App does. */
export function Recovery({
  onResolve,
}: { onResolve?: (id: string) => void | Promise<void> }) {
  const [rows, setRows] = useState([recoveryDraft]);
  const resolve = async (id: string) => { await onResolve?.(id); setRows([]); };
  return <RecoveryDialog drafts={rows} onRecover={resolve} onDiscard={resolve} />;
}

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

/** A real ProseMirror view whose transactions update the real document store. */
export function mountProse(text: string, id = "a"): ProseView {
  const host = document.createElement("div");
  document.body.append(host);
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  let view: ProseView;
  view = new ProseView(host, {
    state: ProseState.create({ doc, plugins: [proseHistory()] }),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) useDocumentStore.getState().updateDocumentContent(id, view.state.doc.textContent);
    },
  });
  return view;
}

/** A real CodeMirror view, optionally with an explicit selection. */
export function mountSource(text: string, id = "a", selection?: { anchor: number; head: number }): CmView {
  const view = new CmView({
    state: CmState.create({
      doc: text,
      ...(selection ? { selection: EditorSelection.range(selection.anchor, selection.head) } : {}),
      extensions: [cmHistory(), CmView.updateListener.of((update) => {
        if (update.docChanged) useDocumentStore.getState().updateDocumentContent(id, update.state.doc.toString());
      })],
    }),
    parent: document.body,
  });
  useEditorStore.getState().setEditorView(view);
  return view;
}

/** Reset only the stores the focus path reads; no test double for any store. */
export function resetFocusStores(content = "Hello", mode: "wysiwyg" | "source" = "wysiwyg"): void {
  useDocumentStore.setState({ documents: [makeDoc("a", content)], activeDocumentId: "a" });
  useEditorStore.setState({ viewMode: mode, editorView: null, activeDocumentId: "a" });
  useMilkdownEditorStore.setState({ getEditor: () => null, editorGenerations: {}, flushers: {} });
}

/** jsdom omits Range geometry used by both editors for caret measurement. */
export function installRangeGeometry(): () => void {
  const names = ["getClientRects", "getBoundingClientRect"] as const;
  const missing = names.filter((name) => typeof Range.prototype[name] !== "function");
  for (const name of missing) {
    Object.defineProperty(Range.prototype, name, {
      configurable: true,
      value: name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0),
    });
  }
  return () => { for (const name of missing) delete (Range.prototype as unknown as Record<string, unknown>)[name]; };
}
