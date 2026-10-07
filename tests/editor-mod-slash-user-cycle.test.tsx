/**
 * D24 WI-2 — `Mod-/` in the mounted Source editor is an explicit user cycle.
 *
 * Mounts the REAL `Editor` (real `<CodeMirror>` wrapper, real `viewModeKeymap`) the way
 * `source-editor-tab-precedence.test.tsx` does, and drives keys through
 * `runScopeHandlers` — the handler path CodeMirror's own keydown listener uses, over
 * every keymap on the view. The observable result is the editor store: `viewMode`
 * flips and `userViewModeChoice` records exactly one new choice for the landed mode.
 *
 * `Mod` resolves from `navigator.platform` at CodeMirror load; jsdom reports a
 * non-Mac platform, so the modifier is picked at runtime from the same test.
 *
 * Mocked boundaries: `@tauri-apps/api/core` and `@tauri-apps/api/event` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { act, cleanup, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { ViewMode } from "../src/types/editor";

const DOC = "Just prose.\nSecond line.\n";
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

let unmountEditor: (() => void) | null = null;

function mountEditor(viewMode: ViewMode, seq: number): EditorView {
  useDocumentStore.setState({ activeDocumentId: "doc-1" });
  useEditorStore.setState({
    editorView: null,
    sourceTableVerdicts: {},
    viewMode,
    userViewModeChoice: { seq, mode: viewMode },
  });
  const r = render(<Editor value={DOC} onChange={vi.fn()} />);
  unmountEditor = r.unmount;
  const view = useEditorStore.getState().editorView;
  // Preconditions — a harness failure must never be read as a behaviour failure.
  expect(view).not.toBeNull();
  expect(view!.state.doc.toString()).toBe(DOC);
  return view!;
}

function pressSlash(view: EditorView, alt: boolean): boolean {
  let handled = false;
  act(() => {
    handled = runScopeHandlers(
      view,
      new KeyboardEvent("keydown", {
        key: "/",
        code: "Slash",
        keyCode: 191,
        metaKey: IS_MAC,
        ctrlKey: !IS_MAC,
        altKey: alt,
      }),
      "editor",
    );
  });
  return handled;
}

beforeEach(() => {
  useEditorStore.setState({
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
  });
});

afterEach(() => {
  unmountEditor?.();
  unmountEditor = null;
  cleanup();
  useEditorStore.setState({
    editorView: null,
    sourceTableVerdicts: {},
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
  });
  useDocumentStore.setState({ activeDocumentId: null });
});

describe("D24 WI-2 — Mod-/ in the mounted Source editor", () => {
  it("MS-1: Mod-/ from source cycles to wysiwyg and records one user choice", () => {
    const view = mountEditor("source", 4);
    const before = useEditorStore.getState().userViewModeChoice;

    expect(pressSlash(view, false)).toBe(true);

    const s = useEditorStore.getState();
    expect(s.viewMode).toBe("wysiwyg");
    expect(s.userViewModeChoice).not.toBe(before);
    expect(s.userViewModeChoice).toEqual({ seq: 5, mode: "wysiwyg" });
    // Mod-/ is consumed by the cycle, never reaching the comment command.
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("MS-2: two Mod-/ presses go round the cycle, seq +1 per press, mode tracks landed mode", () => {
    const view = mountEditor("source", 0);
    const trace: Array<{ viewMode: ViewMode; seq: number; mode: ViewMode }> = [];
    for (let i = 0; i < 2; i++) {
      pressSlash(view, false);
      const s = useEditorStore.getState();
      trace.push({ viewMode: s.viewMode, ...s.userViewModeChoice });
    }
    expect(trace).toEqual([
      { viewMode: "wysiwyg", seq: 1, mode: "wysiwyg" },
      { viewMode: "source", seq: 2, mode: "source" },
    ]);
  });

  it("MS-3 (control): Mod-Alt-/ leaves viewMode and the user choice untouched", () => {
    const view = mountEditor("source", 3);
    view.dispatch({ selection: EditorSelection.cursor(3) });
    const before = useEditorStore.getState().userViewModeChoice;

    pressSlash(view, true);

    const s = useEditorStore.getState();
    expect(s.viewMode).toBe("source");
    expect(s.userViewModeChoice).toBe(before);
    expect(s.userViewModeChoice).toEqual({ seq: 3, mode: "source" });
    // Markdown has only block comment tokens, so toggleLineComment changes nothing
    // on prose (see report: Mod-Alt-/ is a no-op in the Source editor).
    expect(view.state.doc.toString()).toBe(DOC);
  });
});
