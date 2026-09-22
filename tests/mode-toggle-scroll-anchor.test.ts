/**
 * @module mode-toggle-scroll-anchor.test
 * Purpose: HELD test for the WI-8 editorStore wiring (not landed with the
 * first half — editorStore.ts is out of scope for it). Written as if it lives
 * in tests/: paths are relative to tests/. It will FAIL until
 * `runViewModeTransition` calls `captureScrollAnchorForTransition`; that
 * failure is its red.
 *
 * Verifies: every transition trigger writes the one-shot scroll slot through
 * the same path as the WI-2.6 table-cell capture — setViewMode and
 * cycleViewMode write it, a same-mode call writes nothing, a null capture
 * clears a stale anchor, a count mismatch is dropped on restore, and a
 * document above the WYSIWYG threshold still restores by heading tier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: vi.fn(() => "id") },
}));
// Layout read — jsdom has none. Its contract is pinned elsewhere.
const readSpyLineRange = vi.fn();
vi.mock("../src/utils/codemirrorViewportLine", async (importActual) => ({
  ...(await importActual<typeof import("../src/utils/codemirrorViewportLine")>()),
  readSpyLineRange: (...args: unknown[]) => readSpyLineRange(...args),
}));
const captureFromMilkdown = vi.fn();
vi.mock("../src/utils/scrollAnchor/milkdown", async (importActual) => ({
  ...(await importActual<typeof import("../src/utils/scrollAnchor/milkdown")>()),
  captureMilkdownScrollAnchorFromEditor: (...args: unknown[]) => captureFromMilkdown(...args),
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import {
  anchorFromSourceLine,
  buildSourceModel,
  getPendingScrollAnchor,
  setPendingScrollAnchor,
  type ScrollAnchor,
} from "../src/utils/scrollAnchor/anchor";
import { restoreSourceScrollAnchor } from "../src/utils/scrollAnchor/source";
import { LARGE_DOCUMENT_STRUCTURE_THRESHOLD } from "../src/utils/largeDocumentGuard";
import type { TOCEntry } from "../src/types/toc";

const DOC = "doc-held";
const CONTENT = "# A\n\np1\n\n## B\n\np2\n\n## C\n\np3\n";
const STALE: ScrollAnchor = {
  documentId: DOC,
  block: { blockIndex: 0, fraction: 0, blockCount: 6 },
  heading: null,
};

const views: EditorView[] = [];
function makeView(doc: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
  views.push(view);
  return view;
}

beforeEach(() => {
  readSpyLineRange.mockReset();
  captureFromMilkdown.mockReset();
  useDocumentStore.setState({ activeDocumentId: DOC });
  useMilkdownEditorStore.setState({ getEditor: () => null });
  useTOCStore.setState({ entries: [], documentId: null });
  setPendingScrollAnchor(null);
});

afterEach(() => {
  setPendingScrollAnchor(null);
  while (views.length) views.pop()!.destroy();
});

describe("source → wysiwyg writes the slot from CodeMirror", () => {
  it("setViewMode captures the probe line's anchor", () => {
    const view = makeView(CONTENT);
    useEditorStore.setState({ viewMode: "source", editorView: view });
    readSpyLineRange.mockReturnValue({ topLine: 7, bottomLine: 11, atScrollLimit: false });
    useEditorStore.getState().setViewMode("wysiwyg");
    expect(getPendingScrollAnchor()).toEqual(anchorFromSourceLine(buildSourceModel(CONTENT), 7, DOC));
  });

  it("cycleViewMode captures through the same path", () => {
    const view = makeView(CONTENT);
    useEditorStore.setState({ viewMode: "source", editorView: view });
    readSpyLineRange.mockReturnValue({ topLine: 5, bottomLine: 11, atScrollLimit: false });
    useEditorStore.getState().cycleViewMode();
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
    expect(getPendingScrollAnchor()?.block?.blockIndex).toBe(2);
  });
});

describe("wysiwyg → source writes the slot from Milkdown", () => {
  it("uses the registered editor", () => {
    const fakeEditor = {};
    useMilkdownEditorStore.setState({ getEditor: () => fakeEditor as never });
    useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
    const anchor: ScrollAnchor = { ...STALE, block: { blockIndex: 3, fraction: 0.5, blockCount: 6 } };
    captureFromMilkdown.mockReturnValue(anchor);
    useEditorStore.getState().setViewMode("source");
    expect(captureFromMilkdown).toHaveBeenCalledWith(fakeEditor, DOC);
    expect(getPendingScrollAnchor()).toEqual(anchor);
  });
});

describe("slot hygiene", () => {
  it("a same-mode call writes nothing (a stale anchor survives untouched)", () => {
    useEditorStore.setState({ viewMode: "source", editorView: makeView(CONTENT) });
    setPendingScrollAnchor(STALE);
    useEditorStore.getState().setViewMode("source");
    expect(readSpyLineRange).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toBe(STALE);
  });

  it("a null capture clears a stale anchor", () => {
    useEditorStore.setState({ viewMode: "source", editorView: makeView(CONTENT) });
    setPendingScrollAnchor(STALE);
    readSpyLineRange.mockReturnValue(null);
    useEditorStore.getState().setViewMode("wysiwyg");
    expect(getPendingScrollAnchor()).toBeNull();
  });
});

describe("restore on the inbound Source view", () => {
  it("drops an anchor whose counts match neither tier", () => {
    const view = makeView(CONTENT);
    const dispatch = vi.spyOn(view, "dispatch");
    setPendingScrollAnchor({
      documentId: DOC,
      block: { blockIndex: 1, fraction: 0, blockCount: 99 },
      heading: { headingOrdinal: 0, fraction: 0, headingCount: 99 },
    });
    expect(restoreSourceScrollAnchor(view, DOC)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("above the threshold restores by heading tier from the TOC", () => {
    const body = "x\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 10);
    const content = "## H0\n" + body + "## H1\n" + body;
    const h1Line = 2 + LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 10;
    const entry = (lineNumber: number): TOCEntry => ({
      key: `k${lineNumber}` as TOCEntry["key"],
      anchorSlug: `s${lineNumber}` as TOCEntry["anchorSlug"],
      level: 2,
      text: "H",
      lineNumber,
      offset: 0,
      children: [],
    });
    useTOCStore.setState({ documentId: DOC, entries: [entry(1), entry(h1Line)] });
    const view = makeView(content);
    const dispatch = vi.spyOn(view, "dispatch");
    setPendingScrollAnchor({
      documentId: DOC,
      block: null,
      heading: { headingOrdinal: 1, fraction: 0, headingCount: 2 },
    });
    expect(restoreSourceScrollAnchor(view, DOC)).toBe(true);
    const effects = dispatch.mock.calls[0][0].effects;
    const target = (Array.isArray(effects) ? effects[0] : effects) as { value: { range: { head: number } } };
    expect(target.value.range.head).toBe(view.state.doc.line(h1Line).from);
  });
});
