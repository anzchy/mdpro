/**
 * D37 — D37-INT-PROBE and D37-INT-R1..R4: after an MCP wholesale rebuild of the
 * WYSIWYG-active document, keyboard focus and the caret are carried into the new
 * editor, so the next keystroke lands at the equivalent position.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit: D37 end-to-end path
 * (WI-1)". Real `MilkdownEditor`, edit-sync, `useMcpEvents` and stores. Only process
 * boundaries are mocked: `@tauri-apps/api/{core,event,window}`, `loggingService`, and
 * jsdom's missing `IntersectionObserver`.
 *
 * RED protocol: every R case asserts, in order, `D37-focus` (activeElement inside the
 * NEW `.ProseMirror`), `D37-caret` (head at the equivalent position), `D37-content`
 * (exact store content after typing "Z"). Harness preconditions are untagged, so a
 * failure there is visibly a harness error rather than the defect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const { eventListeners } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Editor } from "@milkdown/kit/core";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import {
  emitMcp,
  gen,
  liveEditor,
  liveView,
  placeCaret,
  pmEl,
  stripOneTrailingNewline,
  typeAtFocus,
} from "./helpers/focusCarryD37Fixture";
import type { Mock } from "vitest";
import { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { resetFocusCarry } from "../src/utils/milkdownFocusCarry";
import { liveScrollDispatches, restoreLogs } from "./helpers/focusCarryD37Fixture";

const REBUILD_TIMEOUT_MS = 3000;
const REBUILD_SETTLE_MS = 50;
const CASE_TIMEOUT_MS = 20_000;
/** "Hello world" is one paragraph: text runs 1..12, so 12 is the end caret. */
const END_OF_HELLO_WORLD = 12;
/** Between "Hello " and "world". */
const BEFORE_WORLD = 7;

let unmountEditor: (() => void) | null = null;

interface Mounted {
  old: Editor;
  oldPm: HTMLElement;
}

/** Mount doc-a, focus it and place the caret; harness preconditions are untagged. */
async function mountFocusedAt(pos: number): Promise<Mounted> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  const view = viewOf(mounted.instance);
  placeCaret(view, pos);
  expect(view.hasFocus(), "harness: the old view has focus before the MCP event").toBe(true);
  expect(view.state.selection.head, "harness: caret placed").toBe(pos);
  return { old: mounted.instance, oldPm: pmEl()! };
}

/** Wait for the rebuilt editor (new instance, new `.ProseMirror`) showing `text`. */
async function waitForRebuild({ old, oldPm }: Mounted, text: string): Promise<void> {
  await waitFor(
    () => {
      expect(gen("doc-a")).toBe(1);
      const el = pmEl();
      expect(el).not.toBeNull();
      expect(el).not.toBe(oldPm);
      expect(el!.textContent).toContain(text);
      const next = liveEditor();
      expect(next).not.toBeNull();
      expect(next).not.toBe(old);
    },
    { timeout: REBUILD_TIMEOUT_MS },
  );
  await sleep(REBUILD_SETTLE_MS);
}

/** The three tagged D37 assertions, in RED-protocol order. */
async function expectCarried(head: number, expectedContent: string): Promise<void> {
  const el = pmEl();
  expect(
    el !== null && el.contains(document.activeElement),
    `D37-focus: activeElement is <${document.activeElement?.tagName.toLowerCase()}>, not inside the new .ProseMirror`,
  ).toBe(true);
  expect(liveView().state.selection.head, "D37-caret: head in the rebuilt view").toBe(head);
  const typed = await typeAtFocus("Z");
  expect(typed.outcome, "D37-content: the keystroke reached the editor").toBe("typed");
  expect(typed.flush, "D37-content: the keystroke was written").toEqual({ status: "written" });
  expect(stripOneTrailingNewline(docById("doc-a")!.content), "D37-content: store content").toBe(
    expectedContent,
  );
}

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  useEditorStore.setState({ editorView: null });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D37 focus and caret carry across a WYSIWYG wholesale rebuild", { timeout: CASE_TIMEOUT_MS }, () => {
  it("D37-INT-PROBE a real ProseMirror is focusable in jsdom", async () => {
    const mounted = await mountAndWait();
    unmountEditor = mounted.unmount;
    const view = viewOf(mounted.instance);
    // No tabindex workaround: the attribute is whatever Milkdown/ProseMirror set (none).
    expect(view.dom.getAttribute("tabindex")).toBeNull();
    expect(view.dom.getAttribute("contenteditable")).toBe("true");
    view.focus();
    expect(view.hasFocus()).toBe(true);
    expect(view.dom.contains(document.activeElement)).toBe(true);
    expect(view.dom.getAttribute("tabindex")).toBeNull();
  });

  it("D37-INT-R1 insert at end, caret at end: Z lands right after 'world'", async () => {
    const m = await mountFocusedAt(END_OF_HELLO_WORLD);
    await emitMcp(eventListeners, "mcp:insert_content", {
      document_id: "doc-a",
      position: "end",
      text: " MCP-END",
      window_label: null,
    });
    await waitForRebuild(m, "Hello world MCP-END");
    await expectCarried(12, "Hello worldZ MCP-END");
  });

  it("D37-INT-R2 write_document prepends a paragraph, caret at end", async () => {
    const m = await mountFocusedAt(END_OF_HELLO_WORLD);
    await emitMcp(eventListeners, "mcp:write_document", {
      document_id: "doc-a",
      content: "Prefix\n\nHello world",
      window_label: null,
    });
    await waitForRebuild(m, "Prefix");
    await expectCarried(20, "Prefix\n\nHello worldZ");
  });

  it("D37-INT-R3 insert 'MCP ' at start, caret before 'world' (M1)", async () => {
    const m = await mountFocusedAt(BEFORE_WORLD);
    await emitMcp(eventListeners, "mcp:insert_content", {
      document_id: "doc-a",
      position: "start",
      text: "MCP ",
      window_label: null,
    });
    await waitForRebuild(m, "MCP Hello world");
    await expectCarried(11, "MCP Hello Zworld");
  });

  it("D37-INT-R4 numeric offset 2 before an end caret", async () => {
    const m = await mountFocusedAt(END_OF_HELLO_WORLD);
    await emitMcp(eventListeners, "mcp:insert_content", {
      document_id: "doc-a",
      position: 2,
      text: "XY",
      window_label: null,
    });
    await waitForRebuild(m, "HeXYllo world");
    await expectCarried(14, "HeXYllo worldZ");
  });

  // WI-4 additions (new blocks; the recorded WI-1 lines above are unchanged).

  it("D37-INT-R1-count Gap 5: one focus.restore line per armed record", async () => {
    resetFocusCarry();
    const m = await mountFocusedAt(END_OF_HELLO_WORLD);
    await emitMcp(eventListeners, "mcp:insert_content", {
      document_id: "doc-a",
      position: "end",
      text: " MCP-END",
      window_label: null,
    });
    await waitForRebuild(m, "Hello world MCP-END");
    expect(restoreLogs(loggingService.logEventSync as Mock), "Gap 5: R1 arms once").toHaveLength(1);
  });

  it("D37-INT-R3-scroll every restore scrolls the caret into view", async () => {
    resetFocusCarry();
    const m = await mountFocusedAt(BEFORE_WORLD);
    // Installed BEFORE the MCP event: the new view does not exist until the rebuild.
    const dispatchSpy = vi.spyOn(EditorView.prototype, "dispatch");
    await emitMcp(eventListeners, "mcp:insert_content", {
      document_id: "doc-a",
      position: "start",
      text: "MCP ",
      window_label: null,
    });
    await waitForRebuild(m, "MCP Hello world");
    expect(liveView(), "harness: the spied EditorView is the one Milkdown uses").toBeInstanceOf(EditorView);
    const scrolled = liveScrollDispatches(dispatchSpy as unknown as Mock);
    expect(scrolled.length, "D37-scroll: a scrollIntoView transaction reached the live view").toBeGreaterThanOrEqual(1);
    expect(scrolled.every((tr) => !tr.docChanged), "D37-scroll: selection-only").toBe(true);
    expect(scrolled.every((tr) => tr.getMeta("addToHistory") === false), "D37-scroll: history off").toBe(true);
  });
});
