/**
 * D19 WI-4 guards: the save paths' failure branches after `applySaveResult` extraction.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-232521-d19.md` §5 (W4-reject, W4-cancel,
 * W4-success-false, W4-prefs-reject). Guards: they pass before and after WI-4.
 *
 * Boundary: `invoke` (held through `tests/helpers/heldInvoke.ts`) and `loggingService`.
 * Stores, `useDocument` and `performSave` are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { loggingService } from "../src/services/loggingService";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";
import { A_PATH, SAVED_AT, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const TOC_INITIAL = useTOCStore.getState();
const T0 = "|a|b|\n|-|-|\n|1|2|\n";
type Api = ReturnType<typeof useDocument>;
type TauriGlobal = { __TAURI__?: unknown };

let held: HeldInvoke;
const docA = () => useDocumentStore.getState().documents.find((d) => d.id === "doc-a");
const write = (id: string, content: string) =>
  act(() => { useDocumentStore.getState().updateDocumentContent(id, content); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function doc(id: string, content: string, path: string | null, isModified: boolean): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

function resetStores(aContent = "BASE", aPath: string | null = A_PATH): void {
  useDocumentStore.setState({
    documents: [doc("doc-a", aContent, aPath, true), doc("doc-b", "OTHER", null, false)],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "source" });
  useTOCStore.setState(TOC_INITIAL, true);
}

function mountApi(): Api {
  return renderHook(() => useDocument()).result.current;
}

/** The in-flight save. Boxed: an async function returning a bare Promise would adopt it. */
type InFlight = { p: Promise<unknown> };

async function start(run: () => Promise<unknown>, cmd: string): Promise<InFlight> {
  let p!: Promise<unknown>;
  await act(async () => {
    p = run();
    await held.whenCalled(cmd);
  });
  return { p };
}

/** Settle the held call by resolving (`value`) or rejecting (`error`), then await the save. */
async function finish(
  save: InFlight,
  cmd: string,
  outcome: { value: unknown } | { error: unknown },
): Promise<unknown> {
  let out: unknown;
  await act(async () => {
    if ("error" in outcome) held.fail(cmd, outcome.error);
    else held.release(cmd, outcome.value);
    out = await save.p;
  });
  await settle();
  return out;
}

function performSaveDeps(api: Api) {
  return {
    markSaveInProgress: vi.fn(),
    saveActiveDocument: api.saveActiveDocument,
    updateRecentFiles: vi.fn(),
    showToast: vi.fn(),
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  resetStores();
  (globalThis as TauriGlobal).__TAURI__ = {};
});

afterEach(() => {
  held.assertDrained();
  delete (globalThis as TauriGlobal).__TAURI__;
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D19 WI-4 guards — failure branches leave the document dirty and the draft kept", () => {
  it("W4-reject: save_file rejects during the await — dirty, draft kept, one failure toast", async () => {
    held.hold("save_file");
    const api = mountApi();
    const deps = performSaveDeps(api);
    const p = await start(() => performSave(undefined, deps), "save_file");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file", { error: new Error("disk full") });
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true, lastSaved: null, path: A_PATH });
    expect(held.calls("delete_draft")).toEqual([]);
    const toasts = deps.showToast.mock.calls.map(([m]) => m);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/^Save failed: disk full$/);
    expect(toasts).not.toContain("Saved");
  });

  it("W4-cancel: untitled Save As dialog cancelled during the await — dirty, untitled, returns null", async () => {
    resetStores("BASE", null);
    held.hold("save_file_dialog");
    const api = mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file_dialog");
    await write("doc-a", "BASE+NEW");
    const out = await finish(p, "save_file_dialog", { value: null });
    expect(out).toBeNull();
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true, path: null, lastSaved: null });
    expect(held.calls("delete_draft")).toEqual([]);
  });

  it("W4-success-false: save_file resolves success:false — dirty, no toast, recent files still updated", async () => {
    held.hold("save_file");
    const api = mountApi();
    const deps = performSaveDeps(api);
    const p = await start(() => performSave(undefined, deps), "save_file");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file", { value: { success: false, path: A_PATH, savedAt: SAVED_AT } });
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true, lastSaved: null });
    expect(held.calls("delete_draft")).toEqual([]);
    expect(deps.showToast.mock.calls.map(([m]) => m)).not.toContain("Saved");
    expect(deps.updateRecentFiles.mock.calls).toEqual([[A_PATH]]);
  });

  it("W4-prefs-reject: get_preferences rejects — original content saved, clean, draft deleted once", async () => {
    resetStores(T0);
    held.hold("get_preferences");
    const api = mountApi();
    const p = await start(() => api.saveActiveDocument(), "get_preferences");
    await finish(p, "get_preferences", { error: new Error("x") });
    const saves = held.calls("save_file");
    expect(saves).toHaveLength(1);
    expect(saves[0].content).toBe(T0);
    expect(docA()).toMatchObject({ content: T0, isModified: false, lastSaved: SAVED_AT, path: A_PATH });
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
  });
});

// ---- Coverage / logging gaps: no active document, and a rejected delete_draft ----

const logMock = vi.mocked(loggingService.logEventSync);
const logsOf = (event: string) => logMock.mock.calls.map((c) => c[0]).filter((e) => e.event === event);

describe("COV-no-doc — with no active document, a save is a no-op", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
    logMock.mockClear();
  });

  it("COV-no-doc-save: saveActiveDocument resolves null and invokes nothing", async () => {
    const before = useDocumentStore.getState();
    const api = mountApi();
    let out: unknown = "unset";
    await act(async () => { out = await api.saveActiveDocument(); });
    expect(out).toBeNull();
    expect(held.calls("save_file")).toEqual([]);
    expect(held.calls("get_preferences")).toEqual([]);
    expect(useDocumentStore.getState().documents).toBe(before.documents);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
    expect(logsOf("file.save")).toEqual([]);
  });

  it("COV-no-doc-saveas: saveActiveDocumentAs resolves null and never opens the dialog", async () => {
    const before = useDocumentStore.getState();
    const api = mountApi();
    let out: unknown = "unset";
    await act(async () => { out = await api.saveActiveDocumentAs(); });
    expect(out).toBeNull();
    expect(held.calls("save_file_dialog")).toEqual([]);
    expect(held.calls("save_file")).toEqual([]);
    expect(useDocumentStore.getState().documents).toBe(before.documents);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
  });
});

describe("draft.delete — a rejected delete_draft after an applied save is logged, not thrown", () => {
  beforeEach(() => logMock.mockClear());

  async function saveWithDraftRejecting(error: unknown, actionId?: string) {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    held.reply("delete_draft", () => Promise.reject(error));
    const api = mountApi();
    let out: unknown;
    await act(async () => { out = await api.saveActiveDocument(actionId); });
    await settle();
    await settle();
    process.off("unhandledRejection", unhandled);
    return { out, unhandled };
  }

  it("COV-draft-reject-nonerror: a string rejection is logged verbatim as the error", async () => {
    const { out, unhandled } = await saveWithDraftRejecting("EACCES");
    expect(out).toMatchObject({ success: true, path: A_PATH });
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, lastSaved: SAVED_AT });
    expect(unhandled).not.toHaveBeenCalled();
    const warns = logsOf("draft.delete");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: "warn", status: "fail" });
    expect(warns[0].context).toMatchObject({ documentId: "doc-a", error: "EACCES" });
  });

  it("LOG-draft-reject-actionid: the draft.delete warn carries the caller's actionId", async () => {
    const { unhandled } = await saveWithDraftRejecting(new Error("x"), "act-1");
    expect(docA()).toMatchObject({ isModified: false });
    expect(unhandled).not.toHaveBeenCalled();
    const warns = logsOf("draft.delete");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: "warn", status: "fail", actionId: "act-1" });
    expect(warns[0].context).toMatchObject({ documentId: "doc-a", error: "x" });
  });
});
