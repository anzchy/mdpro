/**
 * Purpose: shared real-editor harness for the D15 WI-3 flush-site tests. Mounts the REAL
 * `MilkdownEditor` against the real stores and drives it through ProseMirror transactions.
 *
 * Holds no mocks: `vi.mock` must stay in each test file (it is hoisted per file). A test
 * file using this harness mocks `@tauri-apps/api/*` and `loggingService` itself.
 *
 * Mirrors the helpers of `tests/wysiwyg-edit-persistence.test.tsx` (WI-2), which are not
 * imported from there so that file stays byte-identical to its recorded receipt.
 */
import type { ReactElement } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { MilkdownEditor } from "../../src/components/Editor/MilkdownEditor";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useTOCStore } from "../../src/stores/tocStore";
import type { Document } from "../../src/types/document";

const TOC_INITIAL = useTOCStore.getState();
const MOUNT_TIMEOUT_MS = 5000;
const POST_MOUNT_SETTLE_MS = 50;

export function makeDoc(id: string, content: string, path: string | null = null): Document {
  return {
    id,
    path,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

/** Fresh stores: the given documents (default doc-a + doc-b), first one active. */
export function resetStores(
  docs: Document[] = [makeDoc("doc-a", "Hello world"), makeDoc("doc-b", "Other")],
): void {
  useDocumentStore.setState({ documents: docs, activeDocumentId: docs[0]?.id ?? null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useTOCStore.setState(TOC_INITIAL, true);
}

export async function sleep(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

export async function mountAndWait(
  ui: ReactElement = <MilkdownEditor />,
): Promise<{ instance: Editor; unmount: () => void }> {
  const { unmount } = render(ui);
  let instance: Editor | null = null;
  await waitFor(
    () => {
      instance = (useMilkdownEditorStore.getState().getEditor() as Editor | null) ?? null;
      expect(instance).not.toBeNull();
      expect(document.querySelector(".ProseMirror")).not.toBeNull();
    },
    { timeout: MOUNT_TIMEOUT_MS },
  );
  await sleep(POST_MOUNT_SETTLE_MS);
  return { instance: instance!, unmount };
}

export function viewOf(instance: Editor): EditorView {
  return instance.action((ctx) => ctx.get(editorViewCtx));
}

/** A user edit (history-recorded): dirties synchronously, content after the delay. */
export function typeAtEnd(instance: Editor, text: string): void {
  const view = viewOf(instance);
  const end = view.state.doc.content.size - 1;
  view.dispatch(view.state.tr.insertText(text, end));
}

/** A history-less text change: neither content nor dirty until the write. */
export function typeHistoryless(instance: Editor, text: string): void {
  const view = viewOf(instance);
  const end = view.state.doc.content.size - 1;
  view.dispatch(view.state.tr.insertText(text, end).setMeta("addToHistory", false));
}

export const docById = (id: string): Document | undefined =>
  useDocumentStore.getState().documents.find((d) => d.id === id);
