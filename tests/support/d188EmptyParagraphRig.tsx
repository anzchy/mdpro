/**
 * Purpose: the real-editor rig for the D188 / ADR-0091 empty-paragraph tests. It mounts
 * the REAL `MilkdownEditor` (the app's own plugin list) next to a `useDocument` probe,
 * against the real stores, so an edit reaches `documentStore` through edit-sync and a
 * save reaches `save_file` through the app's save path (`documentSave` → `fileService`).
 *
 * Holds no mocks: `vi.mock` is hoisted per file, so each test file mocks
 * `@tauri-apps/api/{core,event,window}` and `loggingService` itself and hands the rig
 * its `createHeldInvoke` double.
 *
 * `shape()` renders the ProseMirror doc as a compact string: `∅` is an empty paragraph,
 * `p(a)` a paragraph, `h2(T)` a heading, `bq[…]` a blockquote, `ul[li[…] …]` a list,
 * `code("…")` a code block; inline html shows its source value, a hardbreak shows `⏎`.
 *
 * @coordinates-with tests/helpers/milkdownEditorHarness.tsx — mount, stores, makeDoc
 * @coordinates-with tests/helpers/heldInvoke.ts — the `invoke` double the save reads
 */
import { act } from "@testing-library/react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import type { Node as PmNode, Schema } from "@milkdown/kit/prose/model";
import { MilkdownEditor } from "../../src/components/Editor/MilkdownEditor";
import { useDocument } from "../../src/hooks/useDocument";
import { EDIT_SYNC_DELAY_MS } from "../../src/plugins/milkdown/editSync/controller";
import { useDocumentStore } from "../../src/stores/documentStore";
import type { Document } from "../../src/types/document";
import { A_PATH, type HeldInvoke } from "../helpers/heldInvoke";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  sleep,
  viewOf,
} from "../helpers/milkdownEditorHarness";

/** Edit-sync debounce plus slack for the timer write to land. */
export const SETTLE_MS = EDIT_SYNC_DELAY_MS + 150;
const UNMOUNT_SETTLE_MS = 100;

type Api = ReturnType<typeof useDocument>;
let api: Api | null = null;
function Probe() {
  api = useDocument();
  return null;
}

/** Compact, assertion-friendly rendering of a ProseMirror node. */
export function shape(node: PmNode): string {
  const kids = (n: PmNode) => {
    const out: string[] = [];
    n.forEach((c) => out.push(shape(c)));
    return out.join(" ");
  };
  const inline = (n: PmNode) => {
    let s = "";
    n.forEach((c) => {
      if (c.isText) s += c.text;
      else if (c.type.name === "html") s += String(c.attrs.value);
      else if (c.type.name === "hardbreak") s += "⏎";
      else s += `<${c.type.name}>`;
    });
    return s;
  };
  switch (node.type.name) {
    case "doc":
      return kids(node);
    case "paragraph":
      return node.childCount === 0 ? "∅" : `p(${inline(node)})`;
    case "heading":
      return `h${node.attrs.level}(${inline(node)})`;
    case "code_block":
      return `code(${JSON.stringify(node.textContent)})`;
    case "blockquote":
      return `bq[${kids(node)}]`;
    case "bullet_list":
      return `ul[${kids(node)}]`;
    case "ordered_list":
      return `ol[${kids(node)}]`;
    case "list_item":
      return `li[${kids(node)}]`;
    default:
      return `${node.type.name}[${kids(node)}]`;
  }
}

/** Builders for editor content, given the live schema. */
export const b = {
  p: (s: Schema, text?: string) => s.nodes.paragraph.create(null, text ? s.text(text) : null),
  e: (s: Schema) => s.nodes.paragraph.create(),
  h2: (s: Schema, text: string) => s.nodes.heading.create({ level: 2 }, s.text(text)),
  bq: (s: Schema, kids: PmNode[]) => s.nodes.blockquote.create(null, kids),
  li: (s: Schema, kids: PmNode[]) => s.nodes.list_item.create(null, kids),
  ul: (s: Schema, items: PmNode[]) => s.nodes.bullet_list.create(null, items),
};

export interface OpenOptions {
  lineEnding?: Document["lineEnding"];
  extraDocs?: Document[];
}

/** One mounted editor at a time; `reopen` is a real unmount → remount from bytes. */
export function createRig(held: HeldInvoke) {
  let unmount: (() => void) | null = null;
  let instance: Editor | null = null;

  const editor = (): Editor => {
    if (!instance) throw new Error("rig: no editor mounted");
    return instance;
  };

  const rig = {
    async open(content: string, opts: OpenOptions = {}): Promise<Editor> {
      await rig.close();
      const doc = { ...makeDoc("doc-a", content, A_PATH), lineEnding: opts.lineEnding ?? "lf" };
      resetStores([doc, ...(opts.extraDocs ?? [])]);
      await rig.mount();
      return editor();
    },
    /** Mount the editor for whatever the store's active document is now. */
    async mount(): Promise<Editor> {
      api = null;
      const mounted = await mountAndWait(
        <>
          <MilkdownEditor />
          <Probe />
        </>,
      );
      unmount = mounted.unmount;
      instance = mounted.instance;
      return instance;
    },
    async close(): Promise<void> {
      if (unmount) {
        unmount();
        unmount = null;
        instance = null;
        await sleep(UNMOUNT_SETTLE_MS);
      }
    },
    /** Unmount, then mount a fresh editor on `content` (a real reopen). */
    reopen: (content: string, opts?: OpenOptions) => rig.open(content, opts),
    /** Unmount, then remount on the store's current content (mode switch back). */
    async remountFromStore(): Promise<Editor> {
      await rig.close();
      return rig.mount();
    },
    /** Pick up the editor after a store-driven rebuild (tab switch, reload). */
    async adoptCurrent(prev: Editor): Promise<Editor> {
      const { useMilkdownEditorStore } = await import("../../src/stores/milkdownEditorStore");
      for (let i = 0; i < 100; i += 1) {
        const cur = useMilkdownEditorStore.getState().getEditor() as Editor | null;
        if (cur && cur !== prev && document.querySelector(".ProseMirror")) {
          instance = cur;
          await sleep(50);
          return cur;
        }
        await sleep(20);
      }
      throw new Error("rig: the editor was not rebuilt");
    },
    editor,
    shape: () => shape(viewOf(editor()).state.doc),
    serialize: (): string =>
      editor().action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
    /** A user edit (history-recorded) that replaces the whole document body. */
    replaceWith(build: (s: Schema) => PmNode[]): void {
      const view = viewOf(editor());
      const nodes = build(view.state.schema);
      act(() => {
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes));
      });
    },
    /** A user edit: insert `text` at the start of the first textblock starting with `needle`. */
    typeAtStartOf(needle: string, text: string): void {
      const view = viewOf(editor());
      let pos = -1;
      view.state.doc.descendants((node, p) => {
        if (pos >= 0) return false;
        if (node.isTextblock && node.textContent.startsWith(needle)) {
          pos = p + 1;
          return false;
        }
        return true;
      });
      if (pos < 0) throw new Error(`rig: no textblock starts with: ${needle}`);
      act(() => {
        view.dispatch(view.state.tr.insertText(text, pos));
      });
    },
    /** A user edit: append `text` to the end of the first textblock whose text ends with `needle`. */
    typeAtEndOf(needle: string, text: string): void {
      const view = viewOf(editor());
      let pos = -1;
      view.state.doc.descendants((node, p) => {
        if (pos >= 0) return false;
        if (node.isTextblock && node.textContent.endsWith(needle)) {
          pos = p + node.nodeSize - 1;
          return false;
        }
        return true;
      });
      if (pos < 0) throw new Error(`rig: no textblock ends with: ${needle}`);
      act(() => {
        view.dispatch(view.state.tr.insertText(text, pos));
      });
    },
    /** A user edit: insert one empty paragraph right after the textblock starting with `needle`. */
    insertEmptyAfter(needle: string): void {
      const view = viewOf(editor());
      let pos = -1;
      view.state.doc.descendants((node, p) => {
        if (pos >= 0) return false;
        if (node.isTextblock && node.textContent.startsWith(needle)) {
          pos = p + node.nodeSize;
          return false;
        }
        return true;
      });
      if (pos < 0) throw new Error(`rig: no textblock starts with: ${needle}`);
      act(() => {
        view.dispatch(view.state.tr.insert(pos, view.state.schema.nodes.paragraph.create()));
      });
    },
    settle: () => sleep(SETTLE_MS),
    doc: (id = "doc-a") => docById(id)!,
    activate(id: string): void {
      act(() => {
        useDocumentStore.getState().setActiveDocument(id);
      });
    },
    /** Run the app's ⌘S path and return the args of the `save_file` call it made. */
    async save(): Promise<Record<string, unknown>> {
      if (!api) throw new Error("rig: useDocument probe never rendered");
      const before = held.calls("save_file").length;
      await act(async () => {
        await api!.saveActiveDocument();
      });
      const calls = held.calls("save_file");
      if (calls.length !== before + 1) throw new Error("rig: save did not call save_file once");
      return calls[calls.length - 1];
    },
  };
  return rig;
}

export type Rig = ReturnType<typeof createRig>;
