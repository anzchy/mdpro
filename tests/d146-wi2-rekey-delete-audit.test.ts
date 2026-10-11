/**
 * D146 WI-2: the re-key's draft deletion is auditable. After a recovered draft is
 * merged into its file's open clean tab, the UUID draft is deleted once `save_draft`
 * under the tab's id has succeeded; that deletion is the one draft deletion outside
 * the recovery dialog, so it logs its own `file.draft.delete` line naming the reason,
 * where the text went and how many bytes moved. No delete, no line.
 *
 * Same chain and boundary as the WI-1 file: the real `recoverDraft`,
 * `draftRecoveryOutcome` and `applyRecoveredDocument`; `invoke` and `loggingService`
 * mocked.
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

import { useDocument } from "../src/hooks/useDocument";
import { recoverDraft } from "../src/services/draftService";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";

const UUID = "0b7e4f2a-9c1d-4e3b-8a6f-5d2c1b0a9e8f";
const PATH = "/x/notes.md";
const PATH_ID = "path-derived-notes";
const DRAFT = "draft text — é";
const DRAFT_BYTES = new TextEncoder().encode(DRAFT).length;

const logsOf = (event: string) =>
  vi.mocked(loggingService.logEventSync).mock.calls.map(([e]) => e).filter((e) => e.event === event);

function routeInvoke(failing: "save_draft" | "delete_draft" | null): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === failing) throw `${cmd} failed`;
    if (cmd === "recover_draft") return { content: DRAFT, originalPath: PATH, title: "Untitled" };
    if (cmd === "save_draft") return { success: true };
    if (cmd === "delete_draft") return true;
    return undefined;
  });
}

async function recoverIntoOpenCleanTab(): Promise<void> {
  useDocumentStore.setState({
    documents: [
      {
        id: PATH_ID,
        path: PATH,
        content: "disk text",
        encoding: "UTF-8",
        lineEnding: "lf",
        isModified: false,
        lastSaved: null,
        fileSize: null,
      },
    ],
    activeDocumentId: PATH_ID,
  });
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
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D146 WI-2 the re-key's draft deletion is logged", () => {
  it("logs file.draft.delete with reason rekeyed, the target id and the byte length", async () => {
    routeInvoke(null);

    await recoverIntoOpenCleanTab();

    expect(logsOf("file.draft.delete")).toEqual([
      expect.objectContaining({
        level: "info",
        status: "success",
        context: { draftId: UUID, reason: "rekeyed", rekeyedTo: PATH_ID, bytes: DRAFT_BYTES },
      }),
    ]);
  });

  it("logs no deletion when save_draft under the tab's id fails", async () => {
    routeInvoke("save_draft");

    await recoverIntoOpenCleanTab();

    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toEqual([]);
    expect(logsOf("file.draft.delete")).toEqual([]);
  });

  it("logs no deletion when delete_draft itself fails", async () => {
    routeInvoke("delete_draft");

    await recoverIntoOpenCleanTab();

    expect(logsOf("file.draft.delete")).toEqual([]);
  });
});
