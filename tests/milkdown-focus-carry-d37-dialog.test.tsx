/**
 * D37 WI-6 — the confirm dialog on the real path: G-14 (approve, insert, type: the O2
 * pin), G-15 (an approved background-doc write) and G-17 (queued prompts: amended by D38,
 * the caret is carried under the second prompt instead of the end fallback).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md` G-14, G-15, and G-17 from
 * "Gap 2 decided" / "Gap 2 (a) amended". G-14 and G-15 are RED before WI-6: without a
 * focus return, focus falls to `<body>` after Approve (`O2-focus`).
 *
 * Real `MilkdownEditor`, `useMcpEvents`, `McpWriteConfirm`/`useMcpConfirm`, edit-sync
 * and stores. Mocked boundaries: `@tauri-apps/api/{core,event,window,webviewWindow}`
 * (webviewWindow as a fake bus, finding F5), `loggingService`, `IntersectionObserver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { eventListeners, webviewBus } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
  webviewBus: new Map<string, Set<(event: { payload: unknown }) => void>>(),
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
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
      const set = webviewBus.get(name) ?? new Set();
      set.add(cb);
      webviewBus.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Mock } from "vitest";
import { EditorView } from "@milkdown/kit/prose/view";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { resetFocusCarry } from "../src/utils/milkdownFocusCarry";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import {
  countOutcome, emitConfirmRequest, emitMcp, focusInLiveView, gen, liveScrollDispatches,
  liveView, placeCaret, pmEl, restoreLogs, stripOneTrailingNewline, typeAtFocus, waitForNewPm,
} from "./helpers/focusCarryD37Fixture";

const CASE_TIMEOUT_MS = 20_000;
const END = 12;
const logSpy = loggingService.logEventSync as Mock;
let unmountEditor: (() => void) | null = null;

const content = (id: string) => stripOneTrailingNewline(docById(id)!.content);
const confirm = (requestId: string, documentId = "doc-a") => ({
  requestId, documentId, documentTitle: `${documentId}.md`, operation: "insert", expiresInMs: 60_000,
});
const insert = (position: "start" | "end", text: string) => ({
  document_id: "doc-a", position, text, window_label: null,
});

/** Mount the confirm container and the editor, focus doc-a with the caret at END. */
async function mountWithDialog(): Promise<HTMLElement> {
  const mounted = await mountAndWait(
    <>
      <McpWriteConfirm />
      <MilkdownEditor />
    </>,
  );
  unmountEditor = mounted.unmount;
  await sleep(20);
  placeCaret(viewOf(mounted.instance), END);
  expect(viewOf(mounted.instance).hasFocus(), "harness: focused").toBe(true);
  return pmEl()!;
}

/**
 * jsdom has no `Range` layout. Once focus is back in the view, userEvent's selection
 * changes reach ProseMirror's DOMObserver, which scrolls to the selection and measures a
 * Range (async, after the test body). Zero-size rects stand in; nothing here asserts
 * layout. Removed again after each case.
 */
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
let rangeShimmed: string[] = [];
beforeEach(() => {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof proto[name] !== "function");
  for (const name of rangeShimmed) {
    proto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
});
afterEach(async () => {
  await sleep(50);
  const proto = Range.prototype as unknown as Record<string, unknown>;
  for (const name of rangeShimmed) delete proto[name];
  rangeShimmed = [];
});

async function click(name: "Approve" | "Reject"): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
  webviewBus.clear();
  resetFocusCarry();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  useEditorStore.setState({ editorView: null });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  resetFocusCarry();
  vi.restoreAllMocks();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D37 confirm dialog on the real path (WI-6)", { timeout: CASE_TIMEOUT_MS }, () => {
  it("G-14 approve, then the MCP insert, then type: the character lands", async () => {
    const oldPm = await mountWithDialog();
    await emitConfirmRequest(webviewBus, confirm("r1"));
    expect(document.activeElement, "harness: Reject has focus").toBe(
      screen.getByRole("button", { name: "Reject" }),
    );
    await click("Approve");
    expect(screen.queryByRole("dialog"), "harness: dialog closed").toBeNull();
    expect(focusInLiveView(), "O2-focus: focus is back in the editor").toBe(true);
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " MCP-END"));
    await waitForNewPm(oldPm, "Hello world MCP-END");
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("Hello worldZ MCP-END");
    expect(countOutcome(logSpy, "restored")).toBe(1);
  });

  it("G-15 an approved background-doc write keeps the active editor focused and unrebuilt", async () => {
    const pmBefore = await mountWithDialog();
    await emitConfirmRequest(webviewBus, confirm("r1", "doc-b"));
    await click("Approve");
    expect(screen.queryByRole("dialog"), "harness: dialog closed").toBeNull();
    expect(pmBefore.contains(document.activeElement), "O2-focus").toBe(true);
    await emitMcp(eventListeners, "mcp:write_document", {
      document_id: "doc-b", content: "MCP-BG", window_label: null,
    });
    await sleep(100);
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    expect(pmEl()).toBe(pmBefore);
    expect(gen("doc-a")).toBe(0);
    expect(gen("doc-b")).toBe(1);
    expect(content("doc-a")).toBe("Hello worldZ");
    expect(content("doc-b")).toBe("MCP-BG");
    expect(restoreLogs(logSpy)).toHaveLength(0);
  });

  it("G-17 queued prompts: keystrokes land once, at the caret, scrolled into view (D38 fixed)", async () => {
    const oldPm = await mountWithDialog();
    await emitConfirmRequest(webviewBus, confirm("r1"));
    await emitConfirmRequest(webviewBus, confirm("r2"));
    await click("Approve");
    expect(document.activeElement, "harness: r2's Reject has focus").toBe(
      screen.getByRole("button", { name: "Reject" }),
    );
    // Spied before the rebuild: ProseMirror binds `this.dispatch` when the new view is
    // constructed, so the rebuilt view's restore scroll is recorded (the spy calls through).
    const dispatchSpy = vi.spyOn(EditorView.prototype, "dispatch");
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " ONE"));
    await waitForNewPm(oldPm, "Hello world ONE");
    expect(countOutcome(logSpy, "restored"), "D38: the carry ran under the prompt").toBe(1);

    await click("Approve");
    expect(screen.queryByRole("dialog"), "harness: queue drained").toBeNull();
    expect(liveView(), "harness: the spied EditorView is the one Milkdown uses").toBeInstanceOf(EditorView);
    expect(focusInLiveView(), "D38: the prompt's close focuses the rebuilt editor").toBe(true);
    const view = liveView();
    expect(view.state.selection.head, "D38: caret where it was").toBe(END);
    const scrolled = liveScrollDispatches(dispatchSpy as unknown as Mock);
    expect(scrolled.length, "D38: the deferred restore requested a scrollIntoView").toBeGreaterThanOrEqual(1);
    expect(scrolled.every((tr) => tr.getMeta("addToHistory") === false), "history off").toBe(true);

    const pm1 = pmEl();
    await emitMcp(eventListeners, "mcp:insert_content", insert("start", "TWO "));
    await waitForNewPm(pm1, "TWO Hello world ONE");
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    const text = content("doc-a");
    expect(text.split("Z")).toHaveLength(2);
    expect(text).toBe("TWO Hello worldZ ONE");
  });
});
