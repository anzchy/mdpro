/**
 * D151: D146 merges a recovered draft (UUID id) into its file's open clean tab and
 * re-keys it with `save_draft` under that tab's id, which replaces whatever draft is
 * stored there. After a crash with two dirty tabs on one file, two drafts are listed and
 * the file reopens clean under one of their ids; recovering the other one overwrote the
 * still-unrecovered draft and deleted its own. One recoverable version was lost silently.
 *
 * Rule under test: before merging, ask `get_draft` whether a draft is stored under the
 * open tab's id. If one is, or the check fails, the recovered draft opens in its own tab
 * and nothing is saved or deleted.
 *
 * Same chain and boundary as the D146 files: the real `recoverDraft`,
 * `draftRecoveryOutcome`, `applyRecoveredDocument` and `useDocument`; `invoke` (routed
 * per command), the `@tauri-apps/api/{event,window}` bus and `loggingService` mocked.
 *
 * Cases: (a) a draft under the open tab's id → its own tab, no save, no delete, toast,
 * log; (b) no draft there → D146's merge, save, delete (pin); (c) the check throws →
 * its own tab, no save, no delete, logged; (d) the open tab is dirty → collision-dirty
 * (pin).
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
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";

const UUID = "0b7e4f2a-9c1d-4e3b-8a6f-5d2c1b0a9e8f";
const PATH = "/x/notes.md";
const PATH_ID = "path-derived-notes";
const EXISTING_TOAST =
  "Another unsaved draft of notes.md is still waiting to be recovered, so this one opened in its own tab.";
const CHECK_FAILED_TOAST =
  "Could not check for another unsaved draft of notes.md, so this one opened in its own tab.";
const COLLISION_TOAST = "A recovered draft and an unsaved edit of notes.md are both open.";

const openClean = (): Document => ({
  id: PATH_ID,
  path: PATH,
  content: "disk text",
  encoding: "UTF-8",
  lineEnding: "lf",
  isModified: false,
  lastSaved: 1_760_000_000_000,
  fileSize: 9,
});

const docs = () => useDocumentStore.getState().documents;
const byId = (id: string) => docs().find((d) => d.id === id);
const activeId = () => useDocumentStore.getState().activeDocumentId;
const calls = (cmd: string) =>
  invokeMock.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args as Record<string, unknown>);
const logsOf = (event: string) =>
  vi.mocked(loggingService.logEventSync).mock.calls.map(([e]) => e).filter((e) => e.event === event);

type DraftUnderOpenId = "present" | "absent" | "throws";

function routeInvoke(draftUnderOpenId: DraftUnderOpenId): void {
  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "recover_draft":
        return { content: "draft text", originalPath: PATH, title: "Untitled" };
      case "get_draft":
        if (draftUnderOpenId === "throws") throw { IoError: { message: "disk gone" } };
        if (draftUnderOpenId === "absent" || args?.documentId !== PATH_ID) return null;
        return {
          id: PATH_ID,
          originalPath: PATH,
          content: "the other unsaved draft",
          lastModified: 1_760_000_000_000,
          recovered: false,
        };
      case "save_draft":
        return { success: true };
      case "delete_draft":
        return true;
      default:
        return undefined;
    }
  });
}

/** The recovery chain `App.applyDraftOutcome` runs for a Recover click on the UUID draft. */
async function recover(): Promise<void> {
  const { result } = renderHook(() => useDocument());
  const deps = {
    upsertAndActivate: result.current.upsertAndActivateDocument,
    showToast: useToastStore.getState().showToast,
  };
  await act(async () => {
    const outcome = await recoverDraft(UUID);
    const { upsert } = draftRecoveryOutcome(UUID, { action: "recover", outcome });
    if (upsert) await applyRecoveredDocument(UUID, upsert, deps);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.mocked(loggingService.logEventSync).mockClear();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
  useEditorStore.setState({ viewMode: "source" });
  useToastStore.getState().clearToast();
});

afterEach(() => {
  vi.useRealTimers();
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D151 (a) a draft is already stored under the open clean tab's id", () => {
  it("opens the recovered draft in its own tab and saves or deletes nothing", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke("present");

    await recover();

    expect(calls("get_draft")).toEqual([{ documentId: PATH_ID }]);
    expect(calls("save_draft")).toEqual([]);
    expect(calls("delete_draft")).toEqual([]);
    expect(docs()).toHaveLength(2);
    expect(byId(PATH_ID)).toEqual(openClean());
    expect(byId(UUID)).toMatchObject({ path: PATH, content: "draft text", isModified: true });
    expect(activeId()).toBe(UUID);
    expect(useToastStore.getState().message).toBe(EXISTING_TOAST);
    expect(logsOf("file.draft.recover.merge")).toEqual([
      expect.objectContaining({
        level: "warn",
        context: { draftId: UUID, documentId: PATH_ID, outcome: "collision-existing-draft" },
      }),
    ]);
    expect(logsOf("file.draft.rekey")).toEqual([]);
    expect(logsOf("file.draft.delete")).toEqual([]);
  });

  it("the next autosave writes the recovered text under the draft id, never the open tab's", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke("present");
    await recover();
    invokeMock.mockClear();

    vi.useFakeTimers();
    renderHook(() => useAutoSave(5));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const savedIds = calls("save_draft").map((args) => args.documentId);
    expect(savedIds).not.toContain(PATH_ID);
    expect(savedIds).toContain(UUID);
  });
});

describe("D151 (b) no draft is stored under the open clean tab's id", () => {
  it("keeps D146's merge: into that tab, save_draft under its id, then delete the UUID draft", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke("absent");

    await recover();

    expect(calls("get_draft")).toEqual([{ documentId: PATH_ID }]);
    expect(docs()).toHaveLength(1);
    expect(byId(PATH_ID)).toEqual({ ...openClean(), content: "draft text", isModified: true });
    expect(calls("save_draft")).toEqual([
      { documentId: PATH_ID, content: "draft text", originalPath: PATH, title: "Untitled" },
    ]);
    expect(calls("delete_draft")).toEqual([{ documentId: UUID }]);
    expect(useToastStore.getState().message).toBeNull();
    expect(logsOf("file.draft.recover.merge")).toEqual([
      expect.objectContaining({
        context: { draftId: UUID, documentId: PATH_ID, outcome: "merged-into-clean" },
      }),
    ]);
  });
});

describe("D151 (c) the check for a draft under the open tab's id fails", () => {
  it("fails safe: its own tab, no save, no delete, and the failure is logged", async () => {
    useDocumentStore.setState({ documents: [openClean()], activeDocumentId: PATH_ID });
    routeInvoke("throws");

    await recover();

    expect(calls("save_draft")).toEqual([]);
    expect(calls("delete_draft")).toEqual([]);
    expect(docs()).toHaveLength(2);
    expect(byId(PATH_ID)).toEqual(openClean());
    expect(byId(UUID)).toMatchObject({ path: PATH, content: "draft text", isModified: true });
    expect(useToastStore.getState().message).toBe(CHECK_FAILED_TOAST);
    expect(logsOf("file.draft.recover.merge")).toEqual([
      expect.objectContaining({
        level: "warn",
        context: { draftId: UUID, documentId: PATH_ID, outcome: "collision-draft-check-failed" },
      }),
    ]);
  });
});

describe("D151 (d) the open tab is dirty", () => {
  it("stays collision-dirty: its own tab, the dirty tab untouched, nothing saved or deleted", async () => {
    const dirty = { ...openClean(), content: "my unsaved edit", isModified: true };
    useDocumentStore.setState({ documents: [dirty], activeDocumentId: PATH_ID });
    routeInvoke("present");

    await recover();

    expect(byId(PATH_ID)).toEqual(dirty);
    expect(byId(UUID)).toMatchObject({ content: "draft text", isModified: true });
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
