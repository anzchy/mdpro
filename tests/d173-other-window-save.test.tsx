/**
 * D173-WI-3 — the receipt policy for save notices (plan r2 §6, ADR-0086 decision 5).
 *
 * After a successful write, Rust broadcasts `file:changed` (`modified`) with an
 * additive `origin: { windowLabel, documentId }` (D173-WI-2). Every window's one
 * listener — and capture replay, which reaches the same `recordFileChange` — applies
 * one policy:
 * - record every matching document except the exact origin: the origin document in
 *   the origin window;
 * - the skipped origin's slot is never touched: an own-save notice never clears or
 *   replaces a pending change;
 * - a receipt whose only owner was skipped logs outcome `own-save` and is not offered
 *   to the open/Save As capture;
 * - an event without `origin` (every watcher event) behaves exactly as before.
 *
 * This window's label is the harness's `WINDOW_LABEL` ("main").
 *
 * Driven through App's real wiring (`tests/support/externalChangeHarness.tsx`), the
 * real `performSave` → `documentSave.saveActiveDocument` and the real
 * `saveActiveDocumentAs`. Mock boundary: the Tauri event / core / window modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { WINDOW_LABEL, bus, logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  B,
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
import { saveActiveDocument, saveActiveDocumentAs } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

const T0 = 1_700_000_000_000;
const OTHER_WINDOW = "mdpro-other";
const DIRTY_B = { ...B, content: "# b, edited\n", isModified: true };
/** A second tab on B's path in this window (e.g. it got B's path through Save As). */
const B2 = makeDoc({ id: "b2", path: B.path, content: "# b, tab 2\n", isModified: true });

/** One save notice, as Rust's `notice_saved` emits it. */
function emitNotice(path: string, windowLabel: string, documentId: string, timestamp = Date.now()) {
  act(() =>
    bus.emit("file:changed", { path, changeType: "modified", newPath: null, timestamp, origin: { windowLabel, documentId } }),
  );
}

function save(actionId = "save-1") {
  return performSave(actionId, {
    saveActiveDocument,
    updateRecentFiles: () => {},
    showToast: (message) => void toasts.push(message),
  });
}

function activate(id: string) {
  act(() => {
    view.current?.api.setActiveDocumentById(id);
  });
}

const blockedLines = () =>
  logLines("file.change.pending").filter((l) => (l.context as { action?: string }).action === "save-blocked");

const receivedOutcomes = () =>
  logLines("file.change.received").map((l) => (l.context as { outcome?: string }).outcome);

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  onIpc("release_watch_hold", async () => "keptRaw");
  useLoggingStore.setState({ enabled: true, level: "info" });
  useToastStore.setState({ message: null });
  useDocumentStore.setState({ documents: [A, DIRTY_B], activeDocumentId: "b" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D173-WI-3 — another window's save", () => {
  it("(a) guard: another window's notice records `modified` and blocks ⌘S", async () => {
    await mountPrompt();
    emitNotice(B.path!, OTHER_WINDOW, "b");
    expect(pendingFileChangeFor("b")?.event.changeType).toBe("modified");

    await flush(() => save());
    expect(ipcCount("save_file")).toBe(0);
    expect(blockedLines()).toHaveLength(1);
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("(d) guard: the same document id in another window is recorded (ids are path-derived)", async () => {
    await mountPrompt();
    emitNotice(B.path!, OTHER_WINDOW, "b");
    expect(pendingFileChangeFor("b")).toBeDefined();
    expect(receivedOutcomes()).toEqual(["scheduled"]);
  });

  it("guard: Reload clears the recorded notice and ⌘S then writes", async () => {
    await mountPrompt();
    emitNotice(B.path!, OTHER_WINDOW, "b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);

    onIpc("reload_file", async () => makeDoc({ id: "b", path: B.path, content: "# b, as the other window saved it\n" }));
    await flush(() => view.current!.handleReloadFile());
    expect(reloadMessage()).toBeNull();
    expect(pendingFileChangeFor("b")).toBeUndefined();

    await flush(() => save());
    expect(ipcCount("save_file")).toBe(1);
  });

  it("(g) guard, recorded limit: a save already past its guard writes, and the notice still records after it", async () => {
    await mountPrompt();
    const inFlight = deferred<unknown>();
    onIpc("save_file", () => inFlight.promise);
    let first: Promise<void> = Promise.resolve();
    await flush(() => {
      first = save("save-1");
    });
    expect(ipcCount("save_file")).toBe(1); // past the guard

    emitNotice(B.path!, OTHER_WINDOW, "b"); // the other window's save lands meanwhile
    await flush(() => inFlight.resolve({ success: true, path: B.path, savedAt: T0 + 1 }));
    await flush(() => first);

    expect(pendingFileChangeFor("b")).toBeDefined(); // reported, not prevented
    act(() => {
      useDocumentStore.getState().updateDocumentContent("b", "# b, more\n");
      useDocumentStore.getState().markDocumentModified("b", true);
    });
    await flush(() => save("save-2"));
    expect(ipcCount("save_file")).toBe(1);
    expect(blockedLines()).toHaveLength(1);
  });

  it("(i) guard: an event without `origin` is recorded as before", async () => {
    await mountPrompt();
    emitChange(B.path!);
    expect(pendingFileChangeFor("b")).toBeDefined();
    expect(receivedOutcomes()).toEqual(["scheduled"]);
  });
});

describe("D173-WI-3 — this window's own save", () => {
  it("(b) red: the origin document records nothing, logs `own-save`, and ⌘S proceeds", async () => {
    await mountPrompt();
    emitNotice(B.path!, WINDOW_LABEL, "b");

    expect(pendingFileChangeFor("b")).toBeUndefined();
    expect(receivedOutcomes()).toEqual(["own-save"]);
    advance(1000);
    expect(reloadMessage()).toBeNull();

    await flush(() => save());
    expect(ipcCount("save_file")).toBe(1);
    expect(blockedLines()).toHaveLength(0);
  });

  it("(c) red: a sibling tab on the same path in the saving window is recorded; the saver is not", async () => {
    useDocumentStore.setState({ documents: [A, DIRTY_B, B2], activeDocumentId: "b" });
    await mountPrompt();
    emitNotice(B.path!, WINDOW_LABEL, "b");

    expect(pendingFileChangeFor("b")).toBeUndefined();
    expect(pendingFileChangeFor("b2")?.event.changeType).toBe("modified");
    expect(receivedOutcomes()).toEqual(["recorded"]); // b2 is a background tab

    activate("b2");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
    await flush(() => save());
    expect(ipcCount("save_file")).toBe(0);
    expect(blockedLines()[0]?.context).toMatchObject({ documentId: "b2" });
  });

  it("(e) red: an own-save notice never clears or replaces the origin's pending change", async () => {
    await mountPrompt();
    emitChange(B.path!, "modified", { timestamp: T0 + 1 }); // an external write, unanswered
    const before = pendingFileChangeFor("b");
    expect(before).toBeDefined();

    emitNotice(B.path!, WINDOW_LABEL, "b", T0 + 2);
    expect(pendingFileChangeFor("b")).toEqual(before);

    await flush(() => save());
    expect(ipcCount("save_file")).toBe(0);
    expect(blockedLines()).toHaveLength(1);
  });

  it("(h) red: an own-save notice is never captured, even with a Save As capture open", async () => {
    await mountPrompt();
    const dialog = deferred<unknown>();
    onIpc("save_file_dialog", () => dialog.promise);
    let saving: Promise<unknown> = Promise.resolve();
    await flush(() => {
      saving = saveActiveDocumentAs(); // opens a capture with no path
    });

    emitNotice(B.path!, WINDOW_LABEL, "b");
    const outcomes = receivedOutcomes();

    // Settle the Save As before asserting, so a red here leaves no save queued.
    await flush(() => dialog.resolve(null)); // cancelled
    await flush(() => saving);
    expect(outcomes).toEqual(["own-save"]);
    expect(pendingFileChangeFor("b")).toBeUndefined();
  });

  it("(f) red: Save As in flight — its notice is captured, and the replay skips the origin", async () => {
    const NEW_PATH = "/tmp/d173-save-as-target.md";
    await mountPrompt();
    const dialog = deferred<unknown>();
    onIpc("save_file_dialog", () => dialog.promise);
    let saving: Promise<unknown> = Promise.resolve();
    await flush(() => {
      saving = saveActiveDocumentAs();
    });

    // Rust emits the notice before the reply moves B to the new path.
    emitNotice(NEW_PATH, WINDOW_LABEL, "b");
    expect(receivedOutcomes()).toEqual(["captured"]); // guard: no document has the path yet

    await flush(() =>
      dialog.resolve({
        success: true,
        path: NEW_PATH,
        savedAt: T0 + 5,
        changedSinceRead: false,
        blockedByPendingChange: false,
        holdGen: 3,
      }),
    );
    await flush(() => saving);

    const moved: Document | undefined = useDocumentStore.getState().getDocumentById("b");
    expect(moved?.path).toBe(NEW_PATH);
    expect(pendingFileChangeFor("b")).toBeUndefined();
    activate("b");
    advance(1000);
    expect(reloadMessage()).toBeNull();
  });
});
