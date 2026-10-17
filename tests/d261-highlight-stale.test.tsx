/**
 * D261-WI-1d: the highlight effects in `Editor.tsx` (Source) and
 * `MilkdownEditor.tsx` (WYSIWYG), fed `highlightRequest = { seq, token }`.
 *
 * Law: a highlight request mutates the editor iff its token is current when
 * the effect runs, and then exactly once per request. A retained request seen
 * again on a remount is stale (the generation moved) and mutates nothing; that
 * re-fire into the next document was a pre-existing defect of the bare-number
 * prop, which the token stops (delegator ruling, 2026-10-17).
 *
 * Staleness causes: SWITCH (d1 → d2), AWAY_BACK (d1 → d2 → d1) and REMOUNT
 * (a fresh editor on the same document), for both editor classes.
 *
 * Real `Editor`, real `MilkdownEditor`, real stores and `loggingService`.
 * Mocked: `@tauri-apps/api/{core,event,window}` only.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { win, logs } = vi.hoisted(() => ({
  win: { label: "A" },
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: win.label }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: { payload?: Record<string, unknown> } = {}) => {
    if (cmd === "log_event") logs.push(args.payload ?? {});
    return null;
  },
  convertFileSrc: (p: string) => `asset://${p}`,
}));

import { EditorSelection } from "@codemirror/state";
import type { EditorView as CMView } from "@codemirror/view";
import { editorViewCtx, type Editor as MilkdownInstance } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView as PMView } from "@milkdown/kit/prose/view";
import { Editor } from "../src/components/Editor/Editor";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { captureToken, type HighlightRequest } from "../src/utils/menuTargetToken";
import { doc } from "./support/editorGenerationDomain";

type Cause = "SWITCH" | "AWAY_BACK" | "REMOUNT";
const CAUSES: Cause[] = ["SWITCH", "AWAY_BACK", "REMOUNT"];

const staleLines = () =>
  logs.filter((l) => l.event === "ui.menu.select" && (l.context as { reason?: string })?.reason === "stale");

const request = (seq: number): HighlightRequest => ({ seq, token: captureToken("A") });

beforeEach(() => {
  win.label = "A";
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.getState().setEditorView(null);
  useEditorStore.setState({ viewMode: "source", sourceTableVerdicts: {} });
  useDocumentStore.setState({
    documents: [doc("d1", "hello world"), doc("d2", "abc")],
    activeDocumentId: "d1",
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ editorView: null });
});

// ---------------------------------------------------------------------------
// Source (CodeMirror, the real Editor)
// ---------------------------------------------------------------------------

function mountSource(value: string, highlightRequest?: HighlightRequest) {
  const r = render(<Editor value={value} onChange={vi.fn()} highlightRequest={highlightRequest} />);
  const view = useEditorStore.getState().editorView as CMView;
  expect(view).not.toBeNull();
  return {
    view,
    unmount: r.unmount,
    rerender: (req?: HighlightRequest) =>
      r.rerender(<Editor value={value} onChange={vi.fn()} highlightRequest={req} />),
  };
}

const selectCM = (view: CMView, from: number, to: number) =>
  view.dispatch({ selection: EditorSelection.range(from, to) });

const cmSnapshot = (view: CMView) => ({
  doc: view.state.doc.toString(),
  ranges: view.state.selection.ranges.map((r) => [r.anchor, r.head]),
});

describe("Source: a current request toggles the mark (S2)", () => {
  it("wraps the selection in ==…== exactly once and logs no stale line", () => {
    const ed = mountSource("hello world");
    selectCM(ed.view, 0, 5);
    act(() => ed.rerender(request(1)));
    expect(ed.view.state.doc.toString()).toBe("==hello== world");
    expect(staleLines()).toHaveLength(0);
  });
});

describe("Source: a stale request changes nothing (S4 over causes)", () => {
  it.each(CAUSES)("%s", (cause) => {
    let ed = mountSource("hello world");
    selectCM(ed.view, 0, 5);
    const req = request(1);

    if (cause === "SWITCH") {
      act(() => useDocumentStore.getState().setActiveDocument("d2"));
    } else if (cause === "AWAY_BACK") {
      act(() => {
        useDocumentStore.getState().setActiveDocument("d2");
        useDocumentStore.getState().setActiveDocument("d1");
      });
    } else {
      ed.unmount();
      ed = mountSource("hello world");
      selectCM(ed.view, 0, 5);
    }

    const before = cmSnapshot(ed.view);
    logs.length = 0;
    act(() => ed.rerender(req));

    expect(cmSnapshot(ed.view)).toEqual(before);
    const stale = staleLines();
    expect(stale).toHaveLength(1);
    expect(stale[0].context).toMatchObject({ windowLabel: "A", reason: "stale", stage: "highlight" });
  });
});

describe("Source: a retained request on remount does not re-fire (S5, the pre-existing defect)", () => {
  it("applies once in d1 and never in d2 when the same request object is remounted", () => {
    const first = mountSource("hello world");
    selectCM(first.view, 0, 5);
    const req = request(1);
    act(() => first.rerender(req));
    expect(first.view.state.doc.toString()).toBe("==hello== world");

    first.unmount();
    act(() => useDocumentStore.getState().setActiveDocument("d2"));
    const second = mountSource("abc", req);

    expect(second.view.state.doc.toString()).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// WYSIWYG (the real MilkdownEditor)
// ---------------------------------------------------------------------------

async function mountWysiwyg(highlightRequest?: HighlightRequest) {
  const r = render(<MilkdownEditor highlightRequest={highlightRequest} />);
  let instance: MilkdownInstance | null = null;
  await waitFor(
    () => {
      instance = (useMilkdownEditorStore.getState().getEditor() as MilkdownInstance | null) ?? null;
      expect(instance).not.toBeNull();
      expect(document.querySelector(".ProseMirror")).not.toBeNull();
    },
    { timeout: 5000 },
  );
  await act(async () => {
    await new Promise((res) => setTimeout(res, 50));
  });
  return {
    view: (): PMView =>
      (useMilkdownEditorStore.getState().getEditor() as MilkdownInstance).action((ctx) => ctx.get(editorViewCtx)),
    unmount: r.unmount,
    rerender: (req?: HighlightRequest) => r.rerender(<MilkdownEditor highlightRequest={req} />),
  };
}

const selectPM = (view: PMView, from: number, to: number) =>
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));

const hasHighlight = (view: PMView) => {
  let found = false;
  view.state.doc.descendants((n) => {
    if (n.marks.some((m) => m.type.name === "highlight")) found = true;
    return true;
  });
  return found;
};

describe("WYSIWYG: a current request toggles the mark (S2)", () => {
  it("adds the highlight mark over the selection and logs no stale line", async () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    const ed = await mountWysiwyg();
    selectPM(ed.view(), 1, 6);
    act(() => ed.rerender(request(1)));
    const view = ed.view();
    expect(view.state.doc.rangeHasMark(1, 6, view.state.schema.marks.highlight)).toBe(true);
    expect(staleLines()).toHaveLength(0);
  });
});

describe("WYSIWYG: a stale request changes nothing (S4 over causes)", () => {
  it.each(CAUSES)("%s", async (cause) => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    let ed = await mountWysiwyg();
    selectPM(ed.view(), 1, 6);
    const req = request(1);

    if (cause === "SWITCH") {
      act(() => useDocumentStore.getState().setActiveDocument("d2"));
    } else if (cause === "AWAY_BACK") {
      act(() => {
        useDocumentStore.getState().setActiveDocument("d2");
        useDocumentStore.getState().setActiveDocument("d1");
      });
    } else {
      ed.unmount();
      ed = await mountWysiwyg();
    }
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });
    // A non-empty selection on whatever editor is now in front, so a request
    // that were (wrongly) applied would visibly add a mark.
    selectPM(ed.view(), 1, 3);

    const before = ed.view().state;
    logs.length = 0;
    act(() => ed.rerender(req));

    const after = ed.view().state;
    expect(after.doc.eq(before.doc)).toBe(true);
    expect(after.selection.eq(before.selection)).toBe(true);
    expect(hasHighlight(ed.view())).toBe(false);
    const stale = staleLines();
    expect(stale).toHaveLength(1);
    expect(stale[0].context).toMatchObject({ windowLabel: "A", reason: "stale", stage: "highlight" });
  });
});

describe("WYSIWYG: re-renders of the editor do not stale a token (added during WI-1d green)", () => {
  // `useEditor` returns a new object every render; registering the getter per
  // render bumped the generation on every re-render, so no WYSIWYG token could
  // survive to its effect. The getter is now registered once per mount.
  it("typing (which re-renders the inner editor) leaves the token current, and the request applies", async () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    const ed = await mountWysiwyg();
    const getterBefore = useMilkdownEditorStore.getState().getEditor;
    const req = request(1);

    act(() => {
      const view = ed.view();
      view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 1));
    });
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });
    act(() => useDocumentStore.getState().updateDocumentContent("d1", "hello world!"));
    expect(useMilkdownEditorStore.getState().getEditor).toBe(getterBefore);

    selectPM(ed.view(), 1, 6);
    act(() => ed.rerender(req));
    const view = ed.view();
    expect(view.state.doc.rangeHasMark(1, 6, view.state.schema.marks.highlight)).toBe(true);
    expect(staleLines()).toHaveLength(0);
  });
});
