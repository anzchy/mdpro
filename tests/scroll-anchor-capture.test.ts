// @vitest-environment node
/**
 * @module scroll-anchor-capture.test
 * Purpose: pin `captureScrollAnchorForTransition` (WI-8) — the one call the
 * mode transition makes on the OUTGOING editor. It must pick the adapter for
 * the mode being left, ALWAYS write the slot (null included, so a stale
 * capture never survives), and never throw into the store's `set()`.
 *
 * The two adapters are mocked: their geometry is pinned in
 * `scroll-anchor-correspondence.test.ts` and `scroll-anchor-source.test.ts`;
 * this file pins only the wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));
const logEventSync = vi.fn();
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: (p: unknown) => logEventSync(p), generateActionId: () => "id" },
}));

const captureSource = vi.fn();
const captureMilkdown = vi.fn();
vi.mock("../src/utils/scrollAnchor/source", () => ({
  captureSourceScrollAnchor: (...args: unknown[]) => captureSource(...args),
}));
vi.mock("../src/utils/scrollAnchor/milkdown", () => ({
  captureMilkdownScrollAnchorFromEditor: (...args: unknown[]) => captureMilkdown(...args),
}));

import type { EditorView } from "@codemirror/view";
import type { Editor } from "@milkdown/kit/core";
import { captureScrollAnchorForTransition } from "../src/utils/scrollAnchor/capture";
import {
  getPendingScrollAnchor,
  setPendingScrollAnchor,
  type ScrollAnchor,
} from "../src/utils/scrollAnchor/anchor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";

const DOC = "doc-a";
const ANCHOR: ScrollAnchor = {
  documentId: DOC,
  block: { blockIndex: 4, fraction: 0.5, blockCount: 9 },
  heading: null,
};
const STALE: ScrollAnchor = { ...ANCHOR, documentId: "stale" };
const fakeView = {} as EditorView;
const fakeEditor = {} as Editor;

beforeEach(() => {
  captureSource.mockReset();
  captureMilkdown.mockReset();
  logEventSync.mockReset();
  setPendingScrollAnchor(STALE);
  useDocumentStore.setState({ activeDocumentId: DOC });
  useMilkdownEditorStore.setState({ getEditor: () => null });
});

describe("captureScrollAnchorForTransition", () => {
  it("leaving Source: captures from the CodeMirror view for the active document", () => {
    captureSource.mockReturnValue(ANCHOR);
    captureScrollAnchorForTransition("source", fakeView);
    expect(captureSource).toHaveBeenCalledWith(fakeView, DOC);
    expect(captureMilkdown).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toEqual(ANCHOR);
  });

  it("leaving WYSIWYG: captures from the registered Milkdown editor", () => {
    useMilkdownEditorStore.setState({ getEditor: () => fakeEditor });
    captureMilkdown.mockReturnValue(ANCHOR);
    captureScrollAnchorForTransition("wysiwyg", null);
    expect(captureMilkdown).toHaveBeenCalledWith(fakeEditor, DOC);
    expect(captureSource).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toEqual(ANCHOR);
  });

  it("a null capture clears a stale slot", () => {
    captureSource.mockReturnValue(null);
    captureScrollAnchorForTransition("source", fakeView);
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("no CodeMirror view: writes null without calling the adapter", () => {
    captureScrollAnchorForTransition("source", null);
    expect(captureSource).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("no registered Milkdown editor (still loading): writes null", () => {
    captureScrollAnchorForTransition("wysiwyg", null);
    expect(captureMilkdown).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("no active document: writes null without calling any adapter", () => {
    useDocumentStore.setState({ activeDocumentId: null });
    captureScrollAnchorForTransition("source", fakeView);
    expect(captureSource).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("never throws: an adapter that throws writes null", () => {
    captureSource.mockImplementation(() => {
      throw new Error("view destroyed");
    });
    expect(() => captureScrollAnchorForTransition("source", fakeView)).not.toThrow();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("logs one capture event naming the tiers it carries", () => {
    captureSource.mockReturnValue(ANCHOR);
    captureScrollAnchorForTransition("source", fakeView);
    expect(logEventSync).toHaveBeenCalledTimes(1);
    expect(logEventSync.mock.calls[0][0]).toMatchObject({
      event: "editor.scroll_anchor.capture",
      status: "success",
      context: { fromMode: "source", documentId: DOC, block: true, heading: false },
    });
  });

  it("logs a failed capture as fail, with the error message", () => {
    captureSource.mockImplementation(() => {
      throw new Error("boom");
    });
    captureScrollAnchorForTransition("source", fakeView);
    expect(logEventSync.mock.calls[0][0]).toMatchObject({
      event: "editor.scroll_anchor.capture",
      status: "fail",
      error: "boom",
    });
  });
});
