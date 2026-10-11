/**
 * D146 WI-1: recovering a draft whose file is already open under another id (for
 * example the path-derived id of a file opened at launch) added a second tab for the
 * same file, and the two tabs could overwrite each other on ⌘S.
 *
 * The recovery runs the chain `App.applyDraftOutcome` runs: the real `recoverDraft`
 * (draftService), the real `draftRecoveryOutcome`, then `applyRecoveredDocument` with the
 * real `useDocument().upsertAndActivateDocument` and the real toast store. Boundary
 * only: `invoke` (routed: `recover_draft`, `save_draft`, `delete_draft`), the
 * `@tauri-apps/api/{event,window}` bus and `loggingService`.
 *
 * Cases: (a) open clean → merged into that tab; (b) open dirty → second tab, toast,
 * collision log; (c) no path match and (d) no path → unchanged; (e) after (a) the draft
 * lives under the open tab's id and the UUID draft is deleted only after that write;
 * (f) pending WYSIWYG edits that dirty the open tab count as dirty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { useAutoSave } from "../src/hooks/useAutoSave";
import { useDocument } from "../src/hooks/useDocument";
import { recoverDraft } from "../src/services/draftService";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";

const TOC_INITIAL = useTOCStore.getState();
const UUID = "0b7e4f2a-9c1d-4e3b-8a6f-5d2c1b0a9e8f";
const PATH = "/x/notes.md";
const PATH_ID = "path-derived-notes";
const OTHER_ID = "path-derived-other";
const SAVED_AT = 1_760_000_000_000;
const COLLISION_TOAST = "A recovered draft and an unsaved edit of notes.md are both open.";

function doc(overrides: Partial<Document> & { id: string }): Document {
  return {
    path: null,
    content: "",
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...overrides,
  };
}

const openClean = () =>
  doc({
    id: PATH_ID,
    path: PATH,
    content: "disk text",
    encoding: "GBK",
    lineEnding: "crlf",
    lastSaved: SAVED_AT,
    fileSize: 9,
  });

const docs = () => useDocumentStore.getState().documents;
const byId = (id: string) => docs().find((d) => d.id === id);
const activeId = () => useDocumentStore.getState().activeDocumentId;
const generation = (id: string) => useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;
const calls = (cmd: string) =>
  invokeMock.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args as Record<string, unknown>);
const commandOrder = () => invokeMock.mock.calls.map(([name]) => name as string);
const logsOf = (event: string) =>
  vi.mocked(loggingService.logEventSync).mock.calls.map(([e]) => e).filter((e) => e.event === event);

interface Routes {
  originalPath: string | null;
  saveDraftFails?: boolean;
}

function routeInvoke({ originalPath, saveDraftFails = false }: Routes): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "recover_draft":
        return { content: "draft text", originalPath, title: "Untitled" };
      case "save_draft":
        if (saveDraftFails) throw "a quit has committed: draft saving is closed";
        return { success: true };
      case "delete_draft":
        return true;
      default:
        return undefined;
    }
  });
}

/** The recovery chain `App.applyDraftOutcome` runs for a Recover click on `draftId`. */
async function recover(draftId: string): Promise<void> {
  const { result } = renderHook(() => useDocument());
  const deps = {
    upsertAndActivate: result.current.upsertAndActivateDocument,
    showToast: useToastStore.getState().showToast,
  };
  await act(async () => {
    const outcome = await recoverDraft(draftId);
    const { upsert } = draftRecoveryOutcome(draftId, { action: "recover", outcome });
    if (upsert) await applyRecoveredDocument(draftId, upsert, deps);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.mocked(loggingService.logEventSync).mockClear();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
  useEditorStore.setState({ viewMode: "source" });
  useTOCStore.setState(TOC_INITIAL, true);
  useToastStore.getState().clearToast();
});

afterEach(() => {
  vi.useRealTimers();
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D146 (a) the file is open and clean under another id", () => {
  it("puts the draft into that tab, modified, keeping its metadata, with no second tab", async () => {
    const other = doc({ id: OTHER_ID, path: "/x/other.md", content: "o" });
    useDocumentStore.setState({ documents: [openClean(), other], activeDocumentId: OTHER_ID });
    routeInvoke({ originalPath: PATH });
    const generationBefore = generation(PATH_ID);

    await recover(UUID);

    expect(docs()).toHaveLength(2);
    expect(byId(UUID)).toBeUndefined();
    expect(activeId()).toBe(PATH_ID);
    expect(byId(PATH_ID)).toEqual({
      ...openClean(),
      content: "draft text",
      isModified: true,
    });
    expect(generation(PATH_ID)).toBe(generationBefore + 1);
    expect(useToastStore.getState().message).toBeNull();
    expect(logsOf("file.draft.recover.merge")).toEqual([
      expect.objectContaining({
        status: "success",
        context: { draftId: UUID, documentId: PATH_ID, outcome: "merged-into-clean" },
      }),
    ]);
  });
});

describe("D146 (b) the file is open and dirty under another id", () => {
  it("opens the draft as its own tab, leaves the open tab alone, toasts and logs", async () => {
    const dirty = { ...openClean(), content: "my unsaved edit", isModified: true };
    useDocumentStore.setState({ documents: [dirty], activeDocumentId: PATH_ID });
    routeInvoke({ originalPath: PATH });

    await recover(UUID);

    expect(docs()).toHaveLength(2);
    expect(byId(PATH_ID)).toEqual(dirty);
    expect(byId(UUID)).toMatchObject({ path: PATH, content: "draft text", isModified: true });
    expect(activeId()).toBe(UUID);
    expect(useToastStore.getState().message).toBe(COLLISION_TOAST);
    expect(logsOf("file.draft.recover.merge")).toEqual([
      expect.objectContaining({
        level: "warn",
        context: { draftId: UUID, documentId: PATH_ID, outcome: "collision-dirty" },
      }),
    ]);
    expect(calls("save_draft")).toEqual([]);
    expect(calls("delete_draft")).toEqual([]);
  });
});

describe("D146 (c, d) no open tab shares the draft's path", () => {
  it("(c) a path nobody has open opens a new tab under the draft id", async () => {
    const other = doc({ id: OTHER_ID, path: "/x/other.md", content: "o" });
    useDocumentStore.setState({ documents: [other], activeDocumentId: OTHER_ID });
    routeInvoke({ originalPath: PATH });

    await recover(UUID);

    expect(docs()).toHaveLength(2);
    expect(byId(OTHER_ID)).toEqual(other);
    expect(byId(UUID)).toMatchObject({ path: PATH, content: "draft text", isModified: true });
    expect(activeId()).toBe(UUID);
    expect(logsOf("file.draft.recover.merge")).toEqual([]);
    expect(useToastStore.getState().message).toBeNull();
    expect(calls("delete_draft")).toEqual([]);
  });

  it("(d) a draft without a path never matches an untitled tab", async () => {
    const untitled = doc({ id: OTHER_ID, content: "" });
    useDocumentStore.setState({ documents: [untitled], activeDocumentId: OTHER_ID });
    routeInvoke({ originalPath: null });

    await recover(UUID);

    expect(docs()).toHaveLength(2);
    expect(byId(OTHER_ID)).toEqual(untitled);
    expect(byId(UUID)).toMatchObject({ path: null, content: "draft text", isModified: true });
    expect(activeId()).toBe(UUID);
    expect(logsOf("file.draft.recover.merge")).toEqual([]);
    expect(calls("delete_draft")).toEqual([]);
  });
});

describe("D146 (e) after a merge the draft belongs to the open tab's id", () => {
  it("writes the draft under the open tab's id, then deletes the UUID draft", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke({ originalPath: PATH });

    await recover(UUID);

    expect(calls("save_draft")).toEqual([
      { documentId: PATH_ID, content: "draft text", originalPath: PATH, title: "Untitled" },
    ]);
    expect(calls("delete_draft")).toEqual([{ documentId: UUID }]);
    const order = commandOrder();
    expect(order.indexOf("save_draft")).toBeLessThan(order.indexOf("delete_draft"));
    expect(logsOf("file.draft.rekey")).toEqual([
      expect.objectContaining({
        status: "success",
        context: { draftId: UUID, documentId: PATH_ID },
      }),
    ]);
  });

  it("keeps the UUID draft when the write under the open tab's id fails", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke({ originalPath: PATH, saveDraftFails: true });

    await recover(UUID);

    expect(byId(PATH_ID)).toMatchObject({ content: "draft text", isModified: true });
    expect(calls("save_draft")).toHaveLength(1);
    expect(calls("delete_draft")).toEqual([]);
    expect(logsOf("file.draft.rekey")).toEqual([
      expect.objectContaining({
        status: "fail",
        context: { draftId: UUID, documentId: PATH_ID, stage: "save_draft" },
      }),
    ]);
  });

  it("the next autosave writes the draft under the open tab's id", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke({ originalPath: PATH });
    await recover(UUID);
    invokeMock.mockClear();

    vi.useFakeTimers();
    renderHook(() => useAutoSave(5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(calls("save_draft")).toEqual([
      { documentId: PATH_ID, content: "draft text", originalPath: PATH, title: "Untitled" },
    ]);
  });
});

describe("D146 (f) the open tab's pending WYSIWYG edits are flushed before it is judged", () => {
  it("treats a tab that the flush made dirty as dirty: no overwrite, a second tab", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    useMilkdownEditorStore.getState().registerFlusher(PATH_ID, () => {
      useDocumentStore.getState().updateDocumentContent(PATH_ID, "typed, not yet synced");
      return { status: "written" };
    });
    routeInvoke({ originalPath: PATH });

    await recover(UUID);

    expect(docs()).toHaveLength(2);
    expect(byId(PATH_ID)).toMatchObject({ content: "typed, not yet synced", isModified: true });
    expect(byId(UUID)).toMatchObject({ content: "draft text" });
    expect(useToastStore.getState().message).toBe(COLLISION_TOAST);
  });

  it("treats a failed flush of the open tab as dirty", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    useMilkdownEditorStore.getState().registerFlusher(PATH_ID, () => ({ status: "failed" }));
    routeInvoke({ originalPath: PATH });

    await recover(UUID);

    expect(byId(PATH_ID)).toMatchObject({ content: "disk text", isModified: false });
    expect(byId(UUID)).toMatchObject({ content: "draft text" });
    expect(calls("delete_draft")).toEqual([]);
  });
});
