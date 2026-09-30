/**
 * D35 — D35-INT-1/2: an MCP `insert_content` into the WYSIWYG-active document, through
 * the REAL `MilkdownEditor`, the real edit-sync plugin and the real `useMcpEvents` listener.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-172500.md` (Revision 2), §"MilkdownEditor +
 * edit-sync plugin + useMcpEvents". Split from the unit file because fake timers are
 * incompatible with a mounted Milkdown; scaffolding copied from
 * `tests/d15-review-followups.test.tsx` A6. Only process boundaries are mocked:
 * `@tauri-apps/api/{core,event,window}`, `loggingService`, and jsdom's missing
 * `IntersectionObserver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

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
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  sleep,
  typeAtEnd,
} from "./helpers/milkdownEditorHarness";

const DELAY_MS = 200;
const SETTLE_MS = DELAY_MS + 150;
const REBUILD_TIMEOUT_MS = 3000;
const CASE_TIMEOUT_MS = 20_000;

const docA = () => docById("doc-a")!;
const gen = (id: string) => useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;
const liveEditor = () => useMilkdownEditorStore.getState().getEditor() as Editor | null;
const editorText = () => document.querySelector(".ProseMirror")?.textContent ?? "";

let unmountEditor: (() => void) | null = null;

async function mount(): Promise<Editor> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  return mounted.instance;
}

/** Emit `mcp:insert_content` through the listener the real hook registered. */
async function emitInsert(payload: Record<string, unknown>): Promise<void> {
  renderHook(() => useMcpEvents());
  await act(async () => {});
  const handler = eventListeners.get("mcp:insert_content");
  expect(handler, "no mcp:insert_content listener").toBeTypeOf("function");
  await act(async () => {
    handler!({ payload });
  });
}

/** Wait until a rebuilt editor (not `old`) shows `text`; return it. */
async function rebuiltEditorShowing(old: Editor, text: string): Promise<Editor> {
  let next: Editor | null = null;
  await waitFor(
    () => {
      expect(editorText()).toContain(text);
      next = liveEditor();
      expect(next).not.toBeNull();
      expect(next).not.toBe(old);
    },
    { timeout: REBUILD_TIMEOUT_MS },
  );
  await sleep(50);
  return next!;
}

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D35-INT a WYSIWYG-active insert reaches the real editor", { timeout: CASE_TIMEOUT_MS }, () => {
  it("D35-INT-1 the insert shows in the rebuilt editor and the next keystroke builds on it", async () => {
    const old = await mount();
    await emitInsert({ document_id: "doc-a", text: "MCP-START ", position: "start", window_label: null });
    const next = await rebuiltEditorShowing(old, "MCP-START Hello world");
    expect(editorText()).toContain("MCP-START Hello world");
    expect(next).not.toBe(old);
    expect(gen("doc-a")).toBe(1);
    await act(async () => typeAtEnd(next, "Z"));
    let flushed: unknown;
    await act(async () => {
      flushed = useMilkdownEditorStore.getState().flushPendingEdits("save");
    });
    expect(flushed).toEqual({ status: "written" });
    expect(docA().content).toContain("MCP-START Hello worldZ");
  });

  it("D35-INT-2 an edit typed inside the debounce window survives the insert", async () => {
    const old = await mount();
    await act(async () => typeAtEnd(old, "Q"));
    await emitInsert({ document_id: "doc-a", text: " MCP-END", position: "end", window_label: null });
    await rebuiltEditorShowing(old, "MCP-END");
    expect(editorText()).toContain("Hello worldQ");
    expect(editorText()).toContain("MCP-END");
    expect(docA().content).toContain("Hello worldQ");
    expect(docA().content.endsWith(" MCP-END")).toBe(true);
    await sleep(SETTLE_MS);
    expect(editorText()).toContain("Hello worldQ");
    expect(editorText()).toContain("MCP-END");
    expect(docA().content).toContain("Hello worldQ");
    expect(docA().content.endsWith(" MCP-END")).toBe(true);
  });
});
