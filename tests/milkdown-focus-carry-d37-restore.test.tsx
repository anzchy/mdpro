/**
 * D37 WI-4 — guards on the real path, part 2: where the restore lands (G-7, G-16, G-18,
 * G-19), when the record is dropped instead (G-8 doc switch, G-9 mode change), the slow
 * remount (G-10), that it does not dirty (G-11), the cross-editor diff (G-12) and the log
 * shape (G-13). Part 1 is `tests/milkdown-focus-carry-d37-guards.test.tsx`.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit: guards and real-path
 * pins", G-18/G-19 from the resolution sections, and the WI-4 size-cap note (G-13 pins
 * `durationMs`'s presence and type only).
 *
 * Real `MilkdownEditor`, `useMcpEvents`, edit-sync and stores. Mocked boundaries:
 * `@tauri-apps/api/{core,event,window,webviewWindow}`, `loggingService`,
 * `IntersectionObserver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

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
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ label: "main", listen: async () => () => {} })),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Mock } from "vitest";
import { undoDepth } from "@milkdown/kit/prose/history";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { resetFocusCarry } from "../src/utils/milkdownFocusCarry";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import {
  countOutcome, emitMcp, emitMcpInOneAct, focusInLiveView, Gate, liveView, placeCaret,
  pmEl, restoreLogs, setGate, stripOneTrailingNewline, typeAtFocus, waitForNewPm,
} from "./helpers/focusCarryD37Fixture";

const CASE_TIMEOUT_MS = 20_000;
const END = 12;
const BEFORE_WORLD = 7;
/** Longer than the 1000 ms TTL the plan first proposed (O1). */
const SLOW_REMOUNT_MS = 1200;
const RESTORED_KEYS = ["anchor", "documentId", "durationMs", "outcome", "reason"];
const logSpy = loggingService.logEventSync as Mock;
let unmountEditor: (() => void) | null = null;

const insertEnd = { document_id: "doc-a", position: "end", text: " MCP-END", window_label: null };
const write = (content: string) => ({ document_id: "doc-a", content, window_label: null });
const content = (id: string) => stripOneTrailingNewline(docById(id)!.content);

async function mountFocused(pos: number, ui = <MilkdownEditor />): Promise<HTMLElement> {
  const mounted = await mountAndWait(ui);
  unmountEditor = mounted.unmount;
  placeCaret(viewOf(mounted.instance), pos);
  expect(viewOf(mounted.instance).hasFocus(), "harness: focused").toBe(true);
  return pmEl()!;
}

/** Caret at `pos`, `write_document(next)`, wait for the rebuild, return what Z typed. */
async function writeAndType(pos: number, next: string, visible: string) {
  const oldPm = await mountFocused(pos);
  await emitMcp(eventListeners, "mcp:write_document", write(next));
  await waitForNewPm(oldPm, visible);
  const head = liveView().state.selection.head;
  return { head, typed: await typeAtFocus("Z") };
}

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
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
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D37 guards, part 2", { timeout: CASE_TIMEOUT_MS }, () => {
  it("G-7 a shrinking write restores a valid caret", async () => {
    const { head, typed } = await writeAndType(END, "Hi", "Hi");
    expect(head).toBe(3);
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("HiZ");
  });

  it("G-16 a paragraph prepended, caret at the start of the original paragraph", async () => {
    const { typed } = await writeAndType(1, "Prefix\n\nHello world", "Prefix");
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("Prefix\n\nZHello world");
  });

  it("G-18 a paragraph turned heading: the caret is placed near the region start", async () => {
    const { head, typed } = await writeAndType(BEFORE_WORLD, "# Hello world", "Hello world");
    expect(head).toBe(1);
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("# ZHello world");
  });

  it("G-19 a repeated-text paragraph prepended: the caret follows its own paragraph", async () => {
    const { head, typed } = await writeAndType(1, "Hello\n\nHello world", "Hello world");
    expect(head).toBe(8);
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("Hello\n\nZHello world");
  });

  it("G-8 a doc switch before the remount drops the record; switching back restores nothing", async () => {
    const oldPm = await mountFocused(END);
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insertEnd]], () =>
      useDocumentStore.setState({ activeDocumentId: "doc-b" }),
    );
    await waitForNewPm(oldPm, "Other");
    expect(focusInLiveView(), "not focused after the doc-b mount").toBe(false);
    const pmB = pmEl();
    await act(async () => useDocumentStore.setState({ activeDocumentId: "doc-a" }));
    await waitForNewPm(pmB, "Hello world MCP-END");
    expect(focusInLiveView(), "not focused after switching back").toBe(false);
    expect(countOutcome(logSpy, "skipped:doc-changed")).toBe(1);
    expect(countOutcome(logSpy, "restored")).toBe(0);
  });

  it("G-9 a viewMode change drops the record (O1)", async () => {
    const oldPm = await mountFocused(END);
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insertEnd]], () => {
      useEditorStore.setState({ viewMode: "source" });
      useEditorStore.setState({ viewMode: "wysiwyg" });
    });
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect((await typeAtFocus("Z")).outcome).toBe("lost");
    expect(countOutcome(logSpy, "skipped:mode-changed")).toBe(1);
    expect(countOutcome(logSpy, "restored")).toBe(0);
  });

  it("G-10 a slow remount beyond 1000 ms still restores (O1, real timers)", async () => {
    const oldPm = await mountFocused(END, <Gate><MilkdownEditor /></Gate>);
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insertEnd]], () => setGate(false));
    await sleep(SLOW_REMOUNT_MS);
    await act(async () => setGate(true));
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect(focusInLiveView()).toBe(true);
    expect((await typeAtFocus("Z")).outcome).toBe("typed");
    expect(content("doc-a")).toBe("Hello worldZ MCP-END");
    expect(countOutcome(logSpy, "restored")).toBe(1);
  });

  it("G-11 the restore does not dirty", async () => {
    const oldPm = await mountFocused(END);
    await emitMcp(eventListeners, "mcp:insert_content", insertEnd);
    const modifiedBefore = docById("doc-a")!.isModified;
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect(countOutcome(logSpy, "restored"), "precondition: the restore ran").toBe(1);
    expect(useMilkdownEditorStore.getState().flushPendingEdits("probe")).toEqual({ status: "clean" });
    expect(undoDepth(liveView().state)).toBe(0);
    expect(docById("doc-a")!.isModified).toBe(modifiedBefore);
  });

  it("G-12 cross-editor diff: the schemas differ and the anchor is 'diff'", async () => {
    const oldPm = await mountFocused(END);
    const oldDoc = liveView().state.doc;
    await emitMcp(eventListeners, "mcp:insert_content", insertEnd);
    await waitForNewPm(oldPm, "Hello world MCP-END");
    const newDoc = liveView().state.doc;
    expect(oldDoc.type.schema).not.toBe(newDoc.type.schema);
    expect(oldDoc.content.findDiffStart(newDoc.content)).toBe(0);
    const restored = restoreLogs(logSpy).filter((e) => e.context?.outcome === "restored");
    expect(restored).toHaveLength(1);
    expect(restored[0].context?.anchor).toBe("diff");
  });

  it("G-13 log shape: exact keys, a numeric durationMs, no content", async () => {
    const oldPm = await mountFocused(END);
    await emitMcp(eventListeners, "mcp:insert_content", insertEnd);
    await waitForNewPm(oldPm, "Hello world MCP-END");
    const lines = restoreLogs(logSpy);
    const restored = lines.filter((e) => e.context?.outcome === "restored");
    expect(restored).toHaveLength(1);
    const context = restored[0].context!;
    expect(Object.keys(context).sort()).toEqual(RESTORED_KEYS);
    expect(context.documentId).toBe("doc-a");
    expect(context.reason).toBe("mcp-insert");
    expect(Number.isFinite(context.durationMs)).toBe(true);
    expect(context.durationMs as number).toBeGreaterThanOrEqual(0);
    for (const line of lines) {
      for (const value of Object.values(line.context ?? {})) {
        expect(String(value)).not.toMatch(/MCP-|Hello/);
      }
    }
  });
});
