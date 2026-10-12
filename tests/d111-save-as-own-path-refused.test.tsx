/**
 * D111-WI-1 — Save As onto the document's own path, while that document has an
 * unresolved external change, refuses exactly as ⌘S does (D171): nothing is written,
 * the document stays dirty, its reload prompt shows, and `file.change.pending` logs
 * `save-blocked` with route `save-as`. Any other target never blocks.
 *
 * The dialog runs in Rust and writes as soon as a path is picked, so the frontend
 * cannot check the picked path itself: it sends the document's own path as
 * `refusePath` (only while a change is pending) and Rust answers
 * `blockedByPendingChange` when the pick names that file.
 *
 * Driven through App's real wiring (`tests/support/externalChangeHarness.tsx`) and the
 * real `documentSave.saveActiveDocumentAs`. Mock boundary: the Tauri modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { logLines, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  B,
  MODIFIED_MSG,
  advance,
  emitChange,
  flush,
  ipcCalls,
  mountPrompt,
  onIpc,
  reloadMessage,
  resetExternalChangeHarness,
} from "./support/externalChangeHarness";
import { saveActiveDocumentAs } from "../src/services/documentSave";
import { useDocumentStore } from "../src/stores/documentStore";
import { pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { ExternalChangePendingError } from "../src/utils/externalChangeGuard";

const T0 = 1_700_000_000_000;
const DIRTY_B = { ...B, content: "# b, edited\n", isModified: true };
const COPY = "/tmp/b-copy.md";

const dialogArgs = () => ipcCalls.filter((c) => c.cmd === "save_file_dialog").map((c) => c.args);

const blockedLines = () =>
  logLines("file.change.pending").filter((l) => (l.context as { action?: string }).action === "save-blocked");

/** Rust's reply when the pick named the refused path. */
function refusingDialog() {
  onIpc("save_file_dialog", async (args) => ({
    success: false,
    path: String(args.refusePath),
    savedAt: 0,
    changedSinceRead: false,
    blockedByPendingChange: true,
  }));
}

function dialogPicking(path: string) {
  onIpc("save_file_dialog", async () => ({
    success: true,
    path,
    savedAt: T0 + 5,
    changedSinceRead: false,
    blockedByPendingChange: false,
  }));
}

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  onIpc("delete_draft", async () => undefined);
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [A, DIRTY_B], activeDocumentId: "b" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D111-WI-1 — Save As onto the own path with a pending change", () => {
  it("sends the own path as refusePath, and a refused reply writes nothing and shows the prompt", async () => {
    await mountPrompt();
    emitChange(B.path!);
    const seq = pendingFileChangeFor("b")!.seq;
    refusingDialog();

    let error: unknown = null;
    await flush(async () => {
      await saveActiveDocumentAs("save-as-1").catch((e: unknown) => {
        error = e;
      });
    });

    expect(dialogArgs()).toHaveLength(1);
    expect(dialogArgs()[0].refusePath).toBe(B.path);
    expect(error).toBeInstanceOf(ExternalChangePendingError);
    const b = useDocumentStore.getState().getDocumentById("b");
    expect(b?.isModified).toBe(true);
    expect(b?.path).toBe(B.path);
    expect(b?.content).toBe(DIRTY_B.content);
    expect(blockedLines()).toHaveLength(1);
    expect(blockedLines()[0].context).toMatchObject({ documentId: "b", seq, route: "save-as" });
    expect(pendingFileChangeFor("b")?.seq).toBe(seq);

    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("another target is never blocked: the save applies and moves the document", async () => {
    await mountPrompt();
    emitChange(B.path!);
    dialogPicking(COPY);

    let path: string | undefined;
    await flush(async () => {
      path = (await saveActiveDocumentAs("save-as-2"))?.path;
    });

    expect(path).toBe(COPY);
    expect(dialogArgs()[0].refusePath).toBe(B.path);
    const b = useDocumentStore.getState().getDocumentById("b");
    expect(b?.path).toBe(COPY);
    expect(b?.isModified).toBe(false);
    expect(blockedLines()).toHaveLength(0);
  });

  it("with no pending change, refusePath is not sent and the own path saves", async () => {
    await mountPrompt();
    dialogPicking(B.path!);

    await flush(() => saveActiveDocumentAs("save-as-3"));

    expect(dialogArgs()[0].refusePath ?? null).toBeNull();
    expect(useDocumentStore.getState().getDocumentById("b")?.isModified).toBe(false);
    expect(blockedLines()).toHaveLength(0);
  });

  it("another document's pending change does not make this Save As send refusePath", async () => {
    await mountPrompt();
    emitChange(A.path!);
    dialogPicking(B.path!);

    await flush(() => saveActiveDocumentAs("save-as-4"));

    expect(dialogArgs()[0].refusePath ?? null).toBeNull();
    expect(blockedLines()).toHaveLength(0);
  });

  it("an untitled document never sends refusePath", async () => {
    const untitled = { ...DIRTY_B, id: "u", path: null };
    act(() => useDocumentStore.setState({ documents: [A, untitled], activeDocumentId: "u" }));
    await mountPrompt();
    dialogPicking(COPY);

    await flush(() => saveActiveDocumentAs("save-as-5"));

    expect(dialogArgs()[0].refusePath ?? null).toBeNull();
  });
});
