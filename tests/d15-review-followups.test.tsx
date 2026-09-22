/**
 * D15-WI-5 — review follow-ups on the D15/D18 edit-sync fix, through the REAL editor.
 *
 * (A) BLOCK: a wholesale replacement of the open document's content from outside the
 * editor (file reload via `useDocument.replaceDocument`, MCP `write_document`) keeps the
 * same document id, so the editor used to stay on the pre-reload doc. The edit-sync
 * controller's "store changed underneath me → write back" rule then wrote the stale text
 * plus the next keystroke over the reloaded content. Required: the editor shows the new
 * content, the next keystroke lands on top of it, and the reload does not dirty the doc.
 *
 * Also ported here (C): G1 / G2 and the two close-helper X-retention rows used to call
 * `resolveCloseRequest` / `resolveWindowClose`, dead helpers only tests reached. These
 * cases compose the decision exactly as `App.tsx` does.
 *
 * Real `MilkdownEditor`, real serializer, real stores, real `useDocument` / `useMcpEvents`.
 * Only process boundaries are mocked: `@tauri-apps/api/{core,event,window}` and
 * `loggingService`, plus jsdom's missing `IntersectionObserver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { eventListeners } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
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
import { useDocument } from "../src/hooks/useDocument";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  activeDocumentAfterFlush,
  decideCloseRequest,
  decideWindowClose,
  hasUnsavedChangesAfterFlush,
} from "../src/utils/dataLossGuards";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  sleep,
  typeAtEnd,
  typeHistoryless,
  viewOf,
} from "./helpers/milkdownEditorHarness";

const DELAY_MS = 200;
const SETTLE_MS = DELAY_MS + 150;
const REBUILD_TIMEOUT_MS = 3000;
const CASE_TIMEOUT_MS = 20_000;
const OLD_TEXT = "Hello world";
const NEW_TEXT = "Reloaded from disk";

const docA = () => docById("doc-a")!;
const liveEditor = () => useMilkdownEditorStore.getState().getEditor() as Editor | null;
const editorText = () => document.querySelector(".ProseMirror")?.textContent ?? "";

let unmountEditor: (() => void) | null = null;

async function mount(): Promise<Editor> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  return mounted.instance;
}

/** The file-reload leg App.tsx runs: `replaceDocument` with a fresh, clean document. */
async function reloadDocA(content: string): Promise<void> {
  const { result } = renderHook(() => useDocument());
  await act(async () => {
    result.current.replaceDocument(makeDoc("doc-a", content, "/tmp/a.md"));
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
  resetStores([makeDoc("doc-a", OLD_TEXT, "/tmp/a.md"), makeDoc("doc-b", "Other")]);
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("A — a wholesale replacement rebuilds the WYSIWYG editor on the new content", { timeout: CASE_TIMEOUT_MS }, () => {
  it("A1 after replaceDocument the editor DOM shows the reloaded text, not the old", async () => {
    const old = await mount();
    await reloadDocA(NEW_TEXT);
    await rebuiltEditorShowing(old, NEW_TEXT);
    expect(editorText()).not.toContain(OLD_TEXT);
  });

  it("A2 the next keystroke lands on the reloaded content, never the stale text", async () => {
    const old = await mount();
    await reloadDocA(NEW_TEXT);
    const next = await rebuiltEditorShowing(old, NEW_TEXT);
    await act(async () => typeAtEnd(next, "Z"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain(`${NEW_TEXT}Z`);
    expect(docA().content).not.toContain(OLD_TEXT);
    expect(docA().isModified).toBe(true);
  });

  it("A3 the reload itself leaves the document clean and its content as reloaded", async () => {
    const old = await mount();
    await reloadDocA(NEW_TEXT);
    await rebuiltEditorShowing(old, NEW_TEXT);
    await sleep(SETTLE_MS);
    expect(docA().isModified).toBe(false);
    expect(docA().content).toBe(NEW_TEXT);
  });

  it("A4 an edit still pending at reload time never overwrites the reloaded content", async () => {
    const old = await mount();
    await act(async () => typeAtEnd(old, "Q"));
    await reloadDocA(NEW_TEXT);
    await rebuiltEditorShowing(old, NEW_TEXT);
    await sleep(SETTLE_MS);
    expect(docA().content).toBe(NEW_TEXT);
    expect(docA().isModified).toBe(false);
  });

  it("A5 the editor's own writes never rebuild it (the cursor survives typing)", async () => {
    const instance = await mount();
    const view = viewOf(instance);
    await act(async () => typeAtEnd(instance, "a"));
    await sleep(SETTLE_MS);
    await act(async () => typeAtEnd(instance, "b"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain(`${OLD_TEXT}ab`);
    expect(liveEditor()).toBe(instance);
    expect(viewOf(liveEditor()!)).toBe(view);
  });

  it("A6 MCP write_document on the active doc shows in WYSIWYG and the next keystroke builds on it", async () => {
    const old = await mount();
    renderHook(() => useMcpEvents());
    await act(async () => {});
    const handler = eventListeners.get("mcp:write_document");
    expect(handler, "no mcp:write_document listener").toBeTypeOf("function");
    await act(async () => {
      handler!({ payload: { document_id: "doc-a", content: "From MCP", window_label: null } });
    });
    const next = await rebuiltEditorShowing(old, "From MCP");
    await act(async () => typeAtEnd(next, "Z"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("From MCPZ");
    expect(docA().content).not.toContain(OLD_TEXT);
  });
});

describe("C — close decisions composed as App.tsx composes them (ported G1, G2, retention)", { timeout: CASE_TIMEOUT_MS }, () => {
  const closeDecision = () => decideCloseRequest(activeDocumentAfterFlush());
  const windowDecision = () =>
    decideWindowClose({ allowWindowClose: false, hasUnsavedChanges: hasUnsavedChangesAfterFlush() });

  it("G1' a pending history-less edit makes both close kinds prompt", async () => {
    const instance = await mount();
    let close: unknown;
    let win: unknown;
    await act(async () => {
      typeHistoryless(instance, "PROG");
      close = closeDecision();
      win = windowDecision();
    });
    expect(close).toBe("prompt");
    expect(win).toBe("prompt");
    expect(docA().isModified).toBe(true);
  });

  it("G2' a user-typed clean document prompts for both close kinds", async () => {
    const instance = await mount();
    let close: unknown;
    let win: unknown;
    await act(async () => {
      typeAtEnd(instance, "W");
      close = closeDecision();
      win = windowDecision();
    });
    expect(close).toBe("prompt");
    expect(win).toBe("prompt");
  });

  it("X-retention' both flush-then-read helpers see a token typed inside the delay", async () => {
    const instance = await mount();
    let seenByTabClose = "";
    let seenByWindowClose = "";
    await act(async () => {
      typeAtEnd(instance, "R1");
      seenByTabClose = activeDocumentAfterFlush()?.content ?? "<no doc>";
      typeAtEnd(instance, "R2");
      hasUnsavedChangesAfterFlush();
      seenByWindowClose = docA().content;
    });
    expect(seenByTabClose).toContain("R1");
    expect(seenByWindowClose).toContain("R1R2");
  });
});
