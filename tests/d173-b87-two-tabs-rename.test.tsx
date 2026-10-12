/**
 * D173-WI-3b (audit b87, on D178): two tabs on one path in one window, both with a
 * pending `modified`, then an external rename.
 *
 * `recordFileChange` writes both moved slots at the new path, then follows the rename
 * with one `updateDocumentPath` per tab. The first call changes `documents`, which
 * fires the documentStore prune; the second tab's slot is already at the new path
 * while that tab is still at the old one, so the prune drops it as `path-changed`.
 * The second tab then follows the rename with no pending change: no prompt, and its
 * ⌘S writes the pre-modify buffer over the external edit.
 *
 * The spec pinned here: both tabs move to the new path, both keep their slot there,
 * and each prompts on activation and blocks ⌘S. The fix applies every move in one
 * `set` (`documentStore.updateDocumentPaths`), so the prune runs once against the
 * final paths.
 *
 * Driven through App's real wiring (`tests/support/externalChangeHarness.tsx`).
 * Mock boundary: the Tauri event / core / window modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  MODIFIED_MSG,
  advance,
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
import { pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";

const T0 = 1_700_000_000_000;
const OLD_PATH = "/tmp/b87.md";
const NEW_PATH = "/tmp/b87-moved.md";
const T1 = makeDoc({ id: "t1", path: OLD_PATH, content: "# tab 1, edited\n", isModified: true });
const T2 = makeDoc({ id: "t2", path: OLD_PATH, content: "# tab 2, edited\n", isModified: true });

function save(actionId: string) {
  return performSave(actionId, {
    saveActiveDocument,
    updateRecentFiles: () => {},
    showToast: (message) => void toasts.push(message),
  });
}

const blockedFor = (id: string) =>
  logLines("file.change.pending").filter((l) => {
    const c = l.context as { action?: string; documentId?: string };
    return c.action === "save-blocked" && c.documentId === id;
  });

const pathOf = (id: string) => useDocumentStore.getState().getDocumentById(id)?.path;

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  onIpc("release_watch_hold", async () => "keptRaw");
  useLoggingStore.setState({ enabled: true, level: "info" });
  useToastStore.setState({ message: null });
  useDocumentStore.setState({ documents: [A, T1, T2], activeDocumentId: "a" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D173-WI-3b (b87) — a rename keeps every same-path tab's pending change", () => {
  it("red: both tabs move, both keep a slot at the new path, and each prompts and blocks ⌘S", async () => {
    await mountPrompt();
    emitChange(OLD_PATH, "modified", { timestamp: T0 + 1 });
    expect(pendingFileChangeFor("t1")).toBeDefined();
    expect(pendingFileChangeFor("t2")).toBeDefined();

    emitChange(OLD_PATH, "renamed", { newPath: NEW_PATH, timestamp: T0 + 2 });
    expect(pathOf("t1")).toBe(NEW_PATH);
    expect(pathOf("t2")).toBe(NEW_PATH);
    expect(pendingFileChangeFor("t1")?.path).toBe(NEW_PATH);
    expect(pendingFileChangeFor("t2")?.path).toBe(NEW_PATH);

    for (const id of ["t1", "t2"]) {
      act(() => {
        view.current?.api.setActiveDocumentById(id);
      });
      advance(300);
      expect(reloadMessage(), `${id} prompts`).toBe(MODIFIED_MSG);
      await flush(() => save(`save-${id}`));
      expect(blockedFor(id), `${id}'s ⌘S is blocked`).toHaveLength(1);
    }
    expect(ipcCount("save_file")).toBe(0);
  });
});
