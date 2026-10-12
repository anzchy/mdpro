/**
 * D171 WI-4 — Reload and Ignore settle only the change they were shown.
 *
 * The prompt carries a token: the document id and the sequence number of the change
 * it displays. Reload captures that token when it starts:
 * - on success it clears sequences up to the token's, so a change N+1 that arrived
 *   while the reload read was in flight still prompts;
 * - on failure it keeps the record and the prompt (the old blanket clear lost it);
 * - when it settles, it dismisses the prompt only if the prompt still shows its token,
 *   so A's reload finishing after A closed cannot erase B's record or B's prompt
 *   (found by the D172 audit).
 * Ignore acknowledges only the displayed sequence: a later change prompts again, the
 * acknowledged one never does.
 *
 * Driven through App's real wiring (`tests/support/externalChangeHarness.tsx`).
 * Mock boundary: the Tauri modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  B,
  DELETED_MSG,
  MODIFIED_MSG,
  advance,
  deferred,
  emitChange,
  flush,
  ipcCount,
  mountPrompt,
  onIpc,
  reloadMessage,
  resetExternalChangeHarness,
  toasts,
  view,
} from "./support/externalChangeHarness";
import { saveActiveDocument } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";

const T0 = 1_700_000_000_000;
const FRESH_B = makeDoc({ id: "b", path: B.path, content: "# b, reloaded\n" });

function activate(id: string) {
  act(() => {
    view.current?.api.setActiveDocumentById(id);
  });
}

function save() {
  return performSave("save-1", {
    saveActiveDocument,
    updateRecentFiles: () => {},
    showToast: (message) => void toasts.push(message),
  });
}

/** Start Reload with `reload_file` held in flight; returns its settle handles. */
async function startReload() {
  const read = deferred<Document>();
  onIpc("reload_file", () => read.promise);
  let done: Promise<void> = Promise.resolve();
  await flush(() => {
    done = view.current!.handleReloadFile();
  });
  return { read, done: () => done };
}

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [A, B], activeDocumentId: "b" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D171 WI-4 — Reload settles only its own sequence", () => {
  it("red 8a: Reload of N while N+1 arrives → N+1 still prompts", async () => {
    await mountPrompt();
    emitChange(B.path!, "modified", { timestamp: T0 + 1 });
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    const { read, done } = await startReload();
    emitChange(B.path!, "deleted", { timestamp: T0 + 2 }); // N+1 lands mid-read
    advance(300);
    await flush(() => read.resolve(FRESH_B));
    await flush(done);
    expect(toasts).toContain("File reloaded");
    advance(300);
    expect(reloadMessage()).toBe(DELETED_MSG);
  });

  it("red 8b: a failed Reload keeps the change pending and the prompt up", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(300);
    const { read, done } = await startReload();
    await flush(() => read.reject(new Error("read failed")));
    await flush(done);
    expect(toasts).toContain("Reload failed");
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    act(() => useDocumentStore.getState().markDocumentModified("b", true));
    await flush(save);
    expect(ipcCount("save_file")).toBe(0); // still unresolved
  });

  it("red 8c: A's reload settling after A closed leaves B's record and B's prompt alone", async () => {
    useDocumentStore.setState({ activeDocumentId: "a" });
    await mountPrompt();
    emitChange(A.path!);
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    const { read, done } = await startReload(); // A's read in flight
    await flush(() => view.current?.api.closeDocumentById("a", true)); // A closes; B is active
    emitChange(B.path!, "deleted");
    advance(300);
    expect(reloadMessage()).toBe(DELETED_MSG); // B's prompt is up

    await flush(() => read.resolve(makeDoc({ id: "a", path: A.path })));
    await flush(done);
    expect(reloadMessage()).toBe(DELETED_MSG);
    activate("b");
    advance(1000);
    expect(reloadMessage()).toBe(DELETED_MSG);
    act(() => useDocumentStore.getState().markDocumentModified("b", true));
    await flush(save);
    expect(ipcCount("save_file")).toBe(0); // B's record survived
  });

  it("Save As during Reload: the old path's record is retired, later events follow the new path", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(300);
    const { read, done } = await startReload();
    act(() => useDocumentStore.getState().updateDocumentPath("b", "/tmp/b-saved-as.md"));
    await flush(() => read.resolve(FRESH_B));
    await flush(done);
    advance(1000);
    expect(reloadMessage()).toBeNull();

    emitChange(B.path!); // the old path: nothing owns it now
    advance(1000);
    expect(reloadMessage()).toBeNull();
    emitChange("/tmp/b-saved-as.md");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });
});

describe("D171 WI-4 — Ignore acknowledges only the displayed sequence", () => {
  it("Ignore of N, then N+1 arriving → N+1 prompts again", async () => {
    await mountPrompt();
    emitChange(B.path!, "modified", { timestamp: T0 + 1 });
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    emitChange(B.path!, "deleted", { timestamp: T0 + 2 });
    advance(300);
    expect(reloadMessage()).toBe(DELETED_MSG);
  });

  it("an acknowledged change never prompts again, across a tab round trip", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(300);
    act(() => view.current?.handleIgnoreReload());
    expect(reloadMessage()).toBeNull();
    activate("a");
    advance(1000);
    activate("b");
    advance(1000);
    expect(reloadMessage()).toBeNull();
  });
});
