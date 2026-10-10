/**
 * D73: a pending ⌘K link request outlives the document that asked for it.
 *
 * One CodeMirror view is reused across tabs, and the Source callback only checked
 * `view.dom.isConnected`. With the "Insert Link" modal open, a document switch (native
 * ⌘W, MCP `create_document`, `file:open`) left the request pending, and Insert wrote
 * `[text](url)` into the other document at the old offsets. A view-mode change or the
 * last document closing left it pending too. `useLinkInsertBinding` (mounted once in
 * App) now binds the request to the document and view mode it was made in; any change
 * to either cancels it and closes the modal. The WYSIWYG ⌘K shares the store, so it is
 * covered by the same binding.
 *
 * Mocked only at the Tauri boundary (plus a spy on the logger). A real CodeMirror
 * `EditorView`, the real stores, the real hook and the real modal run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import * as fs from "fs";
import * as path from "path";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertLinkCommand } from "../src/plugins/codemirror/linkPlugin";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";
import { useLinkInsertBinding } from "../src/hooks/useLinkInsertBinding";
import { loggingService } from "../src/services/loggingService";
import type { Document } from "../src/types/document";

const A_TEXT = "say hello world";
const B_TEXT = "other document text";
const URL = "https://x.io";

let view: EditorView | null = null;
let unmountBinding: (() => void) | null = null;

// jsdom has no Range layout; CodeMirror's rAF measure calls it on a live view.
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
let rangeShimmed: string[] = [];

function doc(id: string, content: string): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

/** The single Source view, showing doc A with "hello" selected. */
function makeSourceView(): EditorView {
  const state = EditorState.create({ doc: A_TEXT, selection: EditorSelection.single(4, 9) });
  view = new EditorView({ state, parent: document.body });
  return view;
}

/**
 * What `Editor` does on a tab switch: the same view now shows another document. The
 * selection keeps A's offsets where they still fit — the stale offsets the bug wrote at.
 */
function showInView(v: EditorView, text: string): void {
  const from = Math.min(4, text.length);
  const to = Math.min(9, text.length);
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: text },
    selection: EditorSelection.single(from, to),
  });
}

/** What the modal's Insert does with whatever request is still pending. */
function pressInsert(url = URL): void {
  act(() => {
    const cb = useLinkInsertStore.getState().pendingCallback;
    useLinkInsertStore.getState().clearPendingCallback();
    cb?.(url);
  });
}

function cancelLogs() {
  return vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([entry]) => entry)
    .filter((entry) => entry.event === "ui.link-insert.cancel");
}

const dialog = () => screen.queryByRole("dialog", { name: "Insert link" });

beforeEach(() => {
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof rangeProto[name] !== "function");
  for (const name of rangeShimmed) {
    rangeProto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  useLinkInsertStore.setState({ pendingCallback: null });
  useDocumentStore.setState({ documents: [doc("a", A_TEXT), doc("b", B_TEXT)], activeDocumentId: "a" });
  useEditorStore.setState({ viewMode: "source" });
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  unmountBinding = renderHook(() => useLinkInsertBinding()).unmount;
});

afterEach(() => {
  act(() => useLinkInsertStore.getState().clearPendingCallback());
  unmountBinding?.();
  unmountBinding = null;
  view?.destroy();
  view = null;
  for (const name of rangeShimmed) delete rangeProto[name];
  rangeShimmed = [];
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  vi.restoreAllMocks();
});

describe("D73 — Source ⌘K request is bound to its document and view mode", () => {
  it("D73-1 switching the active document cancels the request: B is untouched, modal closed", () => {
    const v = makeSourceView();
    insertLinkCommand(v);
    render(<LinkInsertModal />);
    expect(dialog()).not.toBeNull();

    act(() => useDocumentStore.getState().setActiveDocumentId("b"));
    showInView(v, B_TEXT);
    pressInsert();

    expect(v.state.doc.toString()).toBe(B_TEXT);
    expect(dialog()).toBeNull();
    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(cancelLogs().map((e) => e.context)).toEqual([
      { screen: "source", reason: "document-switched" },
    ]);
  });

  it("D73-2 a view-mode change cancels the request and leaves the document unchanged", () => {
    const v = makeSourceView();
    insertLinkCommand(v);
    render(<LinkInsertModal />);

    act(() => useEditorStore.setState({ viewMode: "wysiwyg" }));
    pressInsert();

    expect(v.state.doc.toString()).toBe(A_TEXT);
    expect(dialog()).toBeNull();
    expect(cancelLogs().map((e) => e.context?.reason)).toEqual(["view-mode-changed"]);
  });

  it("D73-3 closing the requesting document (the last one) cancels the request", () => {
    useDocumentStore.setState({ documents: [doc("a", A_TEXT)], activeDocumentId: "a" });
    const v = makeSourceView();
    insertLinkCommand(v);
    render(<LinkInsertModal />);

    act(() => useDocumentStore.getState().closeDocument("a"));
    showInView(v, "");
    pressInsert();

    expect(v.state.doc.toString()).toBe("");
    expect(dialog()).toBeNull();
    expect(cancelLogs().map((e) => e.context?.reason)).toEqual(["document-closed"]);
  });

  it("D73-4 closing another document, or editing this one, keeps the request; Insert writes into A once", async () => {
    const user = userEvent.setup();
    const v = makeSourceView();
    insertLinkCommand(v);
    render(<LinkInsertModal />);

    act(() => useDocumentStore.getState().closeDocument("b"));
    act(() => useDocumentStore.getState().updateDocumentContent("a", A_TEXT));
    expect(dialog()).not.toBeNull();

    await user.type(screen.getByLabelText("URL"), "x.io{Enter}");

    expect(v.state.doc.toString()).toBe("say [hello](https://x.io) world");
    expect(cancelLogs()).toEqual([]);
  });

  it("D73-5 after a request ends, a later document switch logs no cancellation", async () => {
    const user = userEvent.setup();
    const v = makeSourceView();
    insertLinkCommand(v);
    render(<LinkInsertModal />);
    await user.type(screen.getByLabelText("URL"), "x.io{Enter}");

    act(() => useDocumentStore.getState().setActiveDocumentId("b"));

    expect(cancelLogs()).toEqual([]);
  });
});

describe("D73 — the WYSIWYG ⌘K shares the store and the binding", () => {
  it("D73-6 a WYSIWYG request is cancelled by a document switch; its callback never runs", () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    const apply = vi.fn();
    act(() => useLinkInsertStore.getState().setPendingCallback(apply));
    render(<LinkInsertModal />);

    act(() => useDocumentStore.getState().setActiveDocumentId("b"));
    pressInsert();

    expect(apply).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(cancelLogs().map((e) => e.context)).toEqual([
      { screen: "wysiwyg", reason: "document-switched" },
    ]);
  });

  it("D73-7 a request made with no active document is cancelled when one opens", () => {
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
    useEditorStore.setState({ viewMode: "wysiwyg" });
    const apply = vi.fn();
    act(() => useLinkInsertStore.getState().setPendingCallback(apply));

    act(() => useDocumentStore.setState({ documents: [doc("b", B_TEXT)], activeDocumentId: "b" }));
    pressInsert();

    expect(apply).not.toHaveBeenCalled();
    expect(cancelLogs().map((e) => e.context?.reason)).toEqual(["document-switched"]);
  });

  it("D73-8 a request cleared by a raw setState stops watching and logs nothing", () => {
    act(() => useLinkInsertStore.getState().setPendingCallback(vi.fn(), "source"));
    act(() => useLinkInsertStore.setState({ pendingCallback: null }));

    act(() => useDocumentStore.getState().setActiveDocumentId("b"));
    act(() => useEditorStore.setState({ viewMode: "wysiwyg" }));

    expect(cancelLogs()).toEqual([]);
  });

  it("D73-8b a second request replaces the first binding: it is bound where it was made", () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => useLinkInsertStore.getState().setPendingCallback(first, "source"));
    act(() => useLinkInsertStore.setState({ pendingCallback: null }));
    act(() => useDocumentStore.getState().setActiveDocumentId("b"));
    act(() => useLinkInsertStore.getState().setPendingCallback(second, "source"));

    act(() => useDocumentStore.getState().updateDocumentContent("b", B_TEXT));
    pressInsert();

    expect(second).toHaveBeenCalledWith(URL);
    expect(first).not.toHaveBeenCalled();
    expect(cancelLogs()).toEqual([]);
  });
});

describe("D73 — the binding's lifetime and mount", () => {
  it("D73-9 unmounting the hook stops the watch of a pending request", () => {
    act(() => useLinkInsertStore.getState().setPendingCallback(vi.fn(), "source"));
    unmountBinding?.();
    unmountBinding = null;

    act(() => useDocumentStore.getState().setActiveDocumentId("b"));

    expect(cancelLogs()).toEqual([]);
    expect(useLinkInsertStore.getState().pendingCallback).not.toBeNull();
  });

  it("D73-10 App mounts useLinkInsertBinding once", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    expect(src.match(/^\s*useLinkInsertBinding\(\);/gm)).toHaveLength(1);
  });
});
