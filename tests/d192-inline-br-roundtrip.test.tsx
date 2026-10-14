/**
 * D192 — loading Markdown into WYSIWYG must not drop an inline `<br>` (BLOCK, data loss).
 *
 * @milkdown/preset-commonmark 7.18.0's `visitEmptyLine` splices EVERY mdast `html`
 * node whose trimmed value is `<br />` / `<br>` / `<br >` / `<br/>`, wherever it sits,
 * so `first<br />second` loads as `firstsecond`. Opening writes nothing (the editSync
 * baseline guard), but the first edit anywhere commits the loss to documentStore and
 * ⌘S writes it to disk.
 *
 * Harness: mounts the REAL `MilkdownEditor` component, so the editor is built from
 * the app's own plugin list (commonmark, gfm, tableParityPlugins, tableNodeViewPlugin,
 * history, editSyncMilkdownPlugin, typoraKeymap, pasteHtmlSanitizer, imagePaste,
 * highlightMark, inlineEdit), against the real documentStore and milkdownEditorStore.
 * Only process boundaries are mocked (`@tauri-apps/api/{core,event,window}`,
 * `loggingService`, jsdom's missing IntersectionObserver), as in
 * tests/wysiwyg-edit-persistence.test.tsx.
 *
 * A kept inline br serializes through the html node's `node.attrs.value`, i.e. in the
 * input's own spelling (`<br />`, `<br>`, `<br/>`), never normalised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { Document } from "../src/types/document";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

/** editSync's debounce (200 ms) plus slack, as in wysiwyg-edit-persistence. */
const SETTLE_MS = 350;

function makeDoc(content: string): Document {
  return {
    id: "doc-a",
    path: null,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

async function sleep(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let unmountCurrent: (() => void) | null = null;

/** Load `markdown` into the app's real WYSIWYG editor and return the instance. */
async function load(markdown: string): Promise<Editor> {
  useDocumentStore.setState({ documents: [makeDoc(markdown)], activeDocumentId: "doc-a" });
  const { unmount } = render(<MilkdownEditor />);
  unmountCurrent = unmount;
  let instance: Editor | null = null;
  await waitFor(
    () => {
      instance = (useMilkdownEditorStore.getState().getEditor() as Editor | null) ?? null;
      expect(instance).not.toBeNull();
      expect(document.querySelector(".ProseMirror")).not.toBeNull();
    },
    { timeout: 5000 },
  );
  await sleep(50);
  return instance!;
}

const viewOf = (e: Editor): EditorView => e.action((ctx) => ctx.get(editorViewCtx));
const serialize = (e: Editor): string =>
  e.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
const docA = () => useDocumentStore.getState().documents.find((d) => d.id === "doc-a")!;

/** Insert `text` at the start of the first textblock whose text starts with `needle`. */
function typeAtStartOf(e: Editor, needle: string, text: string): void {
  const view = viewOf(e);
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.isTextblock && node.textContent.startsWith(needle)) {
      pos = p + 1;
      return false;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no textblock starts with: ${needle}`);
  view.dispatch(view.state.tr.insertText(text, pos));
}

beforeEach(() => {
  installIntersectionObserverDouble();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

afterEach(async () => {
  if (unmountCurrent) {
    unmountCurrent();
    unmountCurrent = null;
    await sleep(100);
  }
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D192 — an inline <br> survives load → serialize (RED until the visitor is narrowed)", () => {
  it("R1 keeps `<br />` between two words of a paragraph", async () => {
    const e = await load("first<br />second\n");
    expect(serialize(e), "inline <br /> was dropped on load").toBe("first<br />second\n");
  });

  it("R2 keeps two `<br>` in one paragraph", async () => {
    const e = await load("a<br>b<br>c\n");
    expect(serialize(e), "inline <br> was dropped on load").toBe("a<br>b<br>c\n");
  });

  it("R3 keeps `<br/>` inside a list item", async () => {
    const e = await load("- item<br/>more\n");
    expect(serialize(e), "list-item <br/> was dropped on load").toBe("- item<br/>more\n");
  });

  it("R4 keeps `<br>` inside a table cell, through the app's table plugins", async () => {
    const e = await load("| h |\n| - |\n| x<br>y |\n");
    const out = serialize(e);
    // Padding-independent: column width is the serializer's choice, the br is not.
    expect(out, "table-cell <br> was dropped on load").toMatch(/^\| x<br>y +\|$/m);
    expect(out, "table cell collapsed to xy").not.toMatch(/\| xy +\|/);
    expect(out).toMatch(/^\| h +\|\n\| -+ +\|\n/);
  });

  it("R5 the first edit elsewhere does not commit the loss to documentStore", async () => {
    const e = await load("first<br />second\n\nother\n");
    await act(async () => typeAtStartOf(e, "other", "X"));
    await sleep(SETTLE_MS);
    expect(docA().isModified, "the edit did not reach documentStore").toBe(true);
    expect(docA().content, "first edit committed the dropped <br />").toBe(
      "first<br />second\n\nXother\n",
    );
  });
});

describe("D192 guards — behaviour the fix must keep (GREEN now)", () => {
  it("G1 a lone `<br />` paragraph loads as an empty paragraph and round-trips (D188)", async () => {
    const e = await load("first\n\n<br />\n\nsecond\n");
    const doc = viewOf(e).state.doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).childCount, "the block br must load as an EMPTY paragraph").toBe(0);
    expect(serialize(e)).toBe("first\n\n\n\nsecond\n");
  });

  it("G2 plain text without a br round-trips unchanged", async () => {
    const e = await load("first line\n\nsecond line\n");
    expect(serialize(e)).toBe("first line\n\nsecond line\n");
  });

  it("G3 an edit on plain text persists to documentStore unchanged elsewhere", async () => {
    const e = await load("first line\n\nother\n");
    await act(async () => typeAtStartOf(e, "other", "X"));
    await sleep(SETTLE_MS);
    expect(docA().content).toBe("first line\n\nXother\n");
  });
});
