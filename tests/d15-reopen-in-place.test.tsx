/**
 * D15-WI-6 — same-id reopen and recovery paths rebuild the WYSIWYG editor.
 *
 * The finding-(A) data-loss class from D15-WI-5, on the remaining wholesale sites in
 * `useDocument`: ids are path-derived, so ⌘O on a file already open and active (or the
 * dialog landing on it, or a re-decode under another encoding, or a draft recovered
 * under the original id) runs `upsertDocument` in place. Without a rebuild the editor
 * keeps the old doc, and the edit-sync controller writes it plus the next keystroke over
 * the reopened content.
 *
 * `createDocument` is not covered: its ids are fresh UUIDs (`Document::new()` →
 * `Uuid::new_v4()`, fallback `crypto.randomUUID()`), so it cannot collide with an open doc.
 *
 * Real `MilkdownEditor`, real stores, real `useDocument`. Only process boundaries are
 * mocked: `@tauri-apps/api/{core,event,window}` and `loggingService`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
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
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  sleep,
  typeAtEnd,
} from "./helpers/milkdownEditorHarness";

const SETTLE_MS = 350;
const REBUILD_TIMEOUT_MS = 3000;
const CASE_TIMEOUT_MS = 20_000;
const A_PATH = "/tmp/a.md";
const OLD_TEXT = "Hello world";
const NEW_TEXT = "Changed on disk";

const docA = () => docById("doc-a")!;
const liveEditor = () => useMilkdownEditorStore.getState().getEditor() as Editor | null;
const editorText = () => document.querySelector(".ProseMirror")?.textContent ?? "";

let unmountEditor: (() => void) | null = null;

async function mount(): Promise<Editor> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  return mounted.instance;
}

/** Run one `useDocument` entry point inside act. */
async function withApi(run: (api: ReturnType<typeof useDocument>) => unknown): Promise<void> {
  const { result } = renderHook(() => useDocument());
  await act(async () => {
    await run(result.current);
  });
}

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

/** The shared expectation: new content shown, not dirtied by the reopen, keystroke on top. */
async function expectRebuiltOn(old: Editor, text: string, isModified: boolean): Promise<void> {
  const next = await rebuiltEditorShowing(old, text);
  expect(editorText()).not.toContain(OLD_TEXT);
  expect(docA().isModified).toBe(isModified);
  await sleep(SETTLE_MS);
  expect(docA().content).toBe(text);
  expect(docA().isModified).toBe(isModified);
  await act(async () => typeAtEnd(next, "Z"));
  await sleep(SETTLE_MS);
  expect(docA().content).toContain(`${text}Z`);
  expect(docA().content).not.toContain(OLD_TEXT);
}

const reopened = (): { document: Document } => ({ document: makeDoc("doc-a", NEW_TEXT, A_PATH) });

beforeEach(() => {
  installIntersectionObserverDouble();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "open_file" || cmd === "open_file_dialog") return reopened();
    return null;
  });
  resetStores([makeDoc("doc-a", OLD_TEXT, A_PATH), makeDoc("doc-b", "Other")]);
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("R — reopen-in-place rebuilds the editor on the reopened content", { timeout: CASE_TIMEOUT_MS }, () => {
  it("R1 ⌘O on the open, active path (openDocumentFromPath)", async () => {
    const old = await mount();
    await withApi((api) => api.openDocumentFromPath(A_PATH));
    await expectRebuiltOn(old, NEW_TEXT, false);
  });

  it("R2 the open dialog landing on the open, active file (openDocumentFromDialog)", async () => {
    const old = await mount();
    await withApi((api) => api.openDocumentFromDialog());
    await expectRebuiltOn(old, NEW_TEXT, false);
  });

  it("R3 a re-decode under another encoding (openDocumentWithEncoding)", async () => {
    const old = await mount();
    await withApi((api) => api.openDocumentWithEncoding(A_PATH, "GBK"));
    await expectRebuiltOn(old, NEW_TEXT, false);
  });

  it("R4 a draft recovered onto the open id (upsertAndActivateDocument, as App builds it)", async () => {
    const old = await mount();
    const recovered: Document = { ...makeDoc("doc-a", "Recovered draft", A_PATH), isModified: true };
    await withApi((api) => api.upsertAndActivateDocument(recovered));
    await expectRebuiltOn(old, "Recovered draft", true);
  });

  it("R5 an edit pending at reopen time never overwrites the reopened content", async () => {
    const old = await mount();
    await act(async () => typeAtEnd(old, "Q"));
    await withApi((api) => api.openDocumentFromPath(A_PATH));
    await rebuiltEditorShowing(old, NEW_TEXT);
    await sleep(SETTLE_MS);
    expect(docA().content).toBe(NEW_TEXT);
    expect(docA().isModified).toBe(false);
  });
});
