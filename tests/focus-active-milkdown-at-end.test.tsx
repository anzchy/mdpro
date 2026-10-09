/**
 * D37 WI-6 — `focusActiveMilkdownAtEnd()`, the MCP confirm dialog's focus fallback.
 * The unit test named in `.claude/tdd-guardian/tests-20260930-233000.md` "Gap 2 (a)
 * amended": a real editor; after the call the head is at the end, the view has focus, a
 * scroll was requested and `undoDepth` is 0. Plus: no editor → null, no throw; the
 * document is not dirtied.
 *
 * D72: a document that ends in a thematic break (`---`, Milkdown's selectable leaf atom
 * `hr`) must still get an empty TextSelection — inherited `Selection.atEnd` returned a
 * NodeSelection on the rule, so the next typed character replaced it. The caret lands at
 * the end of the last textblock instead; a document ending in a paragraph is unchanged.
 *
 * Real `MilkdownEditor` and stores. Mocked boundaries: `@tauri-apps/api/{core,event,
 * window,webviewWindow}`, `loggingService`, `IntersectionObserver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ label: "main", listen: async () => () => {} })),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Mock } from "vitest";
import { undoDepth } from "@milkdown/kit/prose/history";
import { NodeSelection, Selection, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { focusActiveMilkdownAtEnd } from "../src/utils/focusActiveMilkdownAtEnd";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import { liveScrollDispatches } from "./helpers/focusCarryD37Fixture";

const CASE_TIMEOUT_MS = 20_000;
const START = 1;
let unmountEditor: (() => void) | null = null;

beforeEach(() => {
  installIntersectionObserverDouble();
  resetStores([makeDoc("doc-a", "Hello world\n\nSecond paragraph", "/tmp/a.md")]);
  useEditorStore.setState({ editorView: null });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  vi.restoreAllMocks();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("focusActiveMilkdownAtEnd", { timeout: CASE_TIMEOUT_MS }, () => {
  it("puts the caret at the end, focuses, scrolls, and records no history", async () => {
    const mounted = await mountAndWait();
    unmountEditor = mounted.unmount;
    const view = viewOf(mounted.instance);
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, START))
        .setMeta("addToHistory", false),
    );
    (view.dom as HTMLElement).blur();
    expect(view.hasFocus(), "harness: unfocused").toBe(false);
    const dispatchSpy = vi.spyOn(EditorView.prototype, "dispatch");
    // ProseMirror binds `this.dispatch` per instance in its constructor, so a prototype spy
    // installed after the view exists never sees it. Re-bind this view to the spied method
    // (what a view constructed after the spy would hold); the spy calls through.
    view.dispatch = EditorView.prototype.dispatch.bind(view);

    const returned = focusActiveMilkdownAtEnd();

    expect(returned).toBe(view.dom);
    expect(view.state.selection.head).toBe(TextSelection.atEnd(view.state.doc).head);
    expect(view.state.selection.empty).toBe(true);
    expect(view.hasFocus()).toBe(true);
    const scrolled = liveScrollDispatches(dispatchSpy as unknown as Mock);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].docChanged).toBe(false);
    expect(undoDepth(view.state)).toBe(0);
    await sleep(50);
    expect(docById("doc-a")!.isModified).toBe(false);
  });

  it("returns null and throws nothing when no editor is registered", () => {
    useMilkdownEditorStore.setState({ getEditor: () => null });
    expect(() => focusActiveMilkdownAtEnd()).not.toThrow();
    expect(focusActiveMilkdownAtEnd()).toBeNull();
  });

  it("returns null and throws nothing when the editor has no view yet", () => {
    useMilkdownEditorStore.setState({
      getEditor: () => ({
        action: () => {
          throw new Error("Context \"editorView\" not found");
        },
      }),
    });
    expect(() => focusActiveMilkdownAtEnd()).not.toThrow();
    expect(focusActiveMilkdownAtEnd()).toBeNull();
  });
});

describe("focusActiveMilkdownAtEnd — D72 trailing atom", { timeout: CASE_TIMEOUT_MS }, () => {
  it("a document ending in `---` gets an empty TextSelection at the end of the last textblock", async () => {
    resetStores([makeDoc("doc-a", "Hello world\n\n---", "/tmp/a.md")]);
    const mounted = await mountAndWait();
    unmountEditor = mounted.unmount;
    const view = viewOf(mounted.instance);
    const { doc } = view.state;
    expect(doc.lastChild?.type.name, "harness: doc ends in a rule").toBe("hr");
    const paragraph = doc.firstChild!;
    expect(paragraph.textContent, "harness: paragraph first").toBe("Hello world");
    const endOfText = 1 + paragraph.content.size;

    focusActiveMilkdownAtEnd();

    const sel = view.state.selection;
    expect(sel instanceof NodeSelection, "not a NodeSelection on the rule").toBe(false);
    expect(sel instanceof TextSelection).toBe(true);
    expect(sel.empty).toBe(true);
    expect(sel.head).toBe(endOfText);
    expect(view.hasFocus()).toBe(true);

    // The next typed character is inserted, not a replacement of the rule.
    view.dispatch(view.state.tr.insertText("!"));
    expect(view.state.doc.lastChild?.type.name).toBe("hr");
    expect(view.state.doc.firstChild?.textContent).toBe("Hello world!");
  });

  it("a document ending in a paragraph keeps the caret at the very end", async () => {
    resetStores([makeDoc("doc-a", "---\n\nTail paragraph", "/tmp/a.md")]);
    const mounted = await mountAndWait();
    unmountEditor = mounted.unmount;
    const view = viewOf(mounted.instance);
    const { doc } = view.state;
    expect(doc.lastChild?.type.name, "harness: doc ends in a paragraph").toBe("paragraph");

    focusActiveMilkdownAtEnd();

    const sel = view.state.selection;
    expect(sel instanceof TextSelection).toBe(true);
    expect(sel.empty).toBe(true);
    expect(sel.head).toBe(doc.content.size - 1);
  });

  it("a document with no textblock falls back to the end selection without throwing", async () => {
    resetStores([makeDoc("doc-a", "---", "/tmp/a.md")]);
    const mounted = await mountAndWait();
    unmountEditor = mounted.unmount;
    const view = viewOf(mounted.instance);
    const { doc } = view.state;
    expect(doc.childCount, "harness: a lone rule").toBe(1);
    expect(doc.firstChild?.type.name, "harness: a lone rule").toBe("hr");

    expect(focusActiveMilkdownAtEnd()).toBe(view.dom);
    expect(view.state.selection.eq(Selection.atEnd(view.state.doc))).toBe(true);
    expect(view.hasFocus()).toBe(true);
  });
});
