/**
 * D58 WI-3: an MCP table action through the REAL `MilkdownEditor`, the real edit-sync
 * plugin and the real `useMcpEvents` listener — the paired integration cases for the
 * fake-editor unit files (D58-INT-1..3).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: the real MilkdownEditor +
 * edit-sync plugin + useMcpEvents listener (WI-3)". Scaffolding from
 * `tests/mcp-insert-wysiwyg-d35-editor.test.tsx`, except that `loggingService` is real (C1):
 * `invoke` comes from `vi.hoisted`, logging is enabled, and log entries are read as
 * `log_event` calls. Mocked: `@tauri-apps/api/{core,event,window}` and jsdom's missing
 * `IntersectionObserver`. Real timers. Cell content is "CELLX9", the sentinel here.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { eventListeners, invoke } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, typeAtEnd } from "./helpers/milkdownEditorHarness";
import {
  D58_ACTION_ID,
  F,
  R,
  bindInvoke,
  canon,
  closedWorldViolations,
  flushContexts,
  sentinelViolations,
  successLog,
  tableLogs,
} from "./helpers/mcpTableD58Fixture";

const DELAY_MS = 200;
const SETTLE_MS = DELAY_MS + 150;
const CASE_TIMEOUT_MS = 20_000;
const CELL = "CELLX9";

const docA = () => docById("doc-a")!;
const gen = (id: string) => useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;
const liveEditor = () => useMilkdownEditorStore.getState().getEditor() as Editor | null;
const editorText = () => document.querySelector(".ProseMirror")?.textContent ?? "";
const setCell = (content: string) => ({
  document_id: "doc-a",
  action: "set_cell",
  payload: { row: 1, col: 0, content },
  window_label: null,
  action_id: D58_ACTION_ID,
});

let unmountEditor: (() => void) | null = null;

async function mount(docAText: string): Promise<Editor> {
  resetStores([makeDoc("doc-a", docAText, "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  return mounted.instance;
}

/** Emit `mcp:table_action` through the listener the real hook registered. */
async function emitTable(payload: Record<string, unknown>): Promise<void> {
  renderHook(() => useMcpEvents());
  await act(async () => {});
  const handler = eventListeners.get("mcp:table_action");
  expect(handler, "no mcp:table_action listener").toBeTypeOf("function");
  await act(async () => {
    handler!({ payload });
  });
}

/** D58-7 with "CELLX9", and D58-7b rules 2–4 on the allowed events. */
function logChecks(): void {
  expect(sentinelViolations([CELL])).toEqual([]);
  expect(closedWorldViolations(["set_cell"], true)).toEqual([]);
}

beforeAll(() => {
  bindInvoke(invoke);
});

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D58-INT a table action reaches the real editor", { timeout: CASE_TIMEOUT_MS }, () => {
  it("D58-INT-1 an edit typed inside the debounce window survives a set_cell", async () => {
    const old = await mount(F);
    invoke.mockClear();
    await act(async () => typeAtEnd(old, "Q"));
    await emitTable(setCell(CELL));

    const check = () => {
      expect(editorText()).toContain("OutroQ");
      expect(editorText()).toContain(CELL);
      expect(docA().content).toContain("OutroQ");
      expect(docA().content).toContain(CELL);
      expect(liveEditor()).toBe(old);
      expect(gen("doc-a")).toBe(0);
    };
    check();
    expect(flushContexts()).toContainEqual({ reason: "mcp-table", documentId: "doc-a", outcome: "written" });
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    await sleep(SETTLE_MS);
    check();
    logChecks();
  });

  it("D58-INT-2 no pending edit: the editor shows the cell, and the timer writes nothing stale", async () => {
    const old = await mount(F);
    invoke.mockClear();
    await emitTable(setCell(CELL));

    const check = () => {
      expect(editorText()).toContain(CELL);
      expect(docA().content).toContain(CELL);
      expect(docA().isModified).toBe(true);
      expect(liveEditor()).toBe(old);
      expect(gen("doc-a")).toBe(0);
    };
    check();
    await sleep(SETTLE_MS);
    check();
    logChecks();
  });

  it("D58-INT-3 the no-op rule against the real parser: a padding-only change does not dispatch", async () => {
    expect(canon(R)).not.toBeNull();
    expect(canon(R)).not.toBe(R);
    const old = await mount(R);
    invoke.mockClear();
    const docBefore = old.action((ctx) => ctx.get(editorViewCtx).state.doc);
    await emitTable(setCell("1"));

    expect(old.action((ctx) => ctx.get(editorViewCtx).state.doc)).toBe(docBefore);
    expect(docA()).toEqual({ ...docA(), content: canon(R), isModified: true });
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    await sleep(SETTLE_MS);
    expect(liveEditor()).toBe(old);
    expect(gen("doc-a")).toBe(0);
    logChecks();
  });
});
