/**
 * Purpose: bind one find plugin and its live view guard to a mounted Milkdown editor.
 * @coordinates-with ../../../components/Editor/MilkdownEditor.tsx
 */
import { useMemo, useState } from "react";
import { type Editor } from "@milkdown/kit/core";
import { $prose } from "@milkdown/kit/utils";
import { getMilkdownView } from "../../../utils/focusActiveEditor";
import { useDocumentStore } from "../../../stores/documentStore";
import { useMilkdownEditorStore } from "../../../stores/milkdownEditorStore";
import { createFindPlugin, type FindState } from "./findPlugin";

const initialFindState: FindState = {
  open: false, replacing: false, query: "", caseSensitive: false,
  wholeWord: false, matches: [], current: -1, focusEpoch: 0,
};

/** State callback is stable for the entire life of the editor provider. */
export function useFindHost() {
  const [findState, setFindState] = useState(initialFindState);
  const plugin = useMemo(() => $prose(() => createFindPlugin(setFindState)), []);
  return { findState, plugin };
}

/** Reject callbacks from a bar whose tab or provider generation has been replaced. */
export function liveFindView(editor: Editor | null, documentId: string | null, generation: number) {
  if (!documentId || useDocumentStore.getState().activeDocumentId !== documentId) return null;
  if ((useMilkdownEditorStore.getState().editorGenerations[documentId] ?? 0) !== generation) return null;
  const view = getMilkdownView(editor);
  return view && !view.isDestroyed && view.dom.isConnected ? view : null;
}
