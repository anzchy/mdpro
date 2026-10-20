/**
 * D171 — `externalChangeStore` transitions, driven through its exported actions and
 * the real `documentStore` (the prune subscription). Mock boundary: `invoke` only
 * (log capture through `fileWatcherLogHarness`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { useDocumentStore } from "../src/stores/documentStore";
import {
  acknowledgeFileChange,
  forgetFileChange,
  pendingFileChangeFor,
  recordFileChange,
  resetFileChanges,
  useExternalChangeStore,
} from "../src/stores/externalChangeStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { FileChangedEvent } from "../src/types/fileChange";

const A = makeDoc({ id: "a", path: "/tmp/a.md" });
const B = makeDoc({ id: "b", path: "/tmp/b.md" });
const ev = (path: string, timestamp = 1): FileChangedEvent => ({ path, changeType: "modified", timestamp });
const ignoredDeletion = (id: string) => (useExternalChangeStore.getState() as unknown as {
  ignoredDeletions?: Record<string, { documentId: string; path: string; seq: number }>;
}).ignoredDeletions?.[id];

beforeEach(() => {
  resetFileChanges();
  useDocumentStore.setState({ documents: [A, B], activeDocumentId: "a" });
  resetHarness(); // after the resets, so their log lines are not counted
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("D171 externalChangeStore", () => {
  it("D290-WI-3 retains an ignored deletion until explicit clearing or a path change", () => {
    recordFileChange({ path: B.path!, changeType: "deleted", timestamp: 1 }, "delete-1");
    const seq = pendingFileChangeFor("b")!.seq;
    expect(acknowledgeFileChange("b", seq, "ignored")).toBe(true);
    expect(ignoredDeletion("b")).toMatchObject({ documentId: "b", path: B.path, seq });
    useDocumentStore.getState().updateDocumentPath("b", "/tmp/b-new.md");
    expect(ignoredDeletion("b")).toBeUndefined();
  });

  it("D290-WI-3 supersedes an old ignored deletion with a new event", () => {
    recordFileChange({ path: B.path!, changeType: "deleted", timestamp: 1 }, "delete-1");
    const seq = pendingFileChangeFor("b")!.seq;
    acknowledgeFileChange("b", seq, "ignored");
    recordFileChange(ev(B.path!, 2), "modify-2");
    expect(ignoredDeletion("b")).toBeUndefined();
    expect(pendingFileChangeFor("b")!.seq).toBeGreaterThan(seq);
  });

  it("D290-WI-3 clears an ignored deletion on close or listener reset", () => {
    recordFileChange({ path: B.path!, changeType: "deleted", timestamp: 1 }, "delete-close");
    acknowledgeFileChange("b", pendingFileChangeFor("b")!.seq, "ignored");
    useDocumentStore.getState().closeDocument("b");
    expect(ignoredDeletion("b")).toBeUndefined();
    useDocumentStore.setState({ documents: [A, B] });
    recordFileChange({ path: B.path!, changeType: "deleted", timestamp: 2 }, "delete-reset");
    acknowledgeFileChange("b", pendingFileChangeFor("b")!.seq, "ignored");
    resetFileChanges();
    expect(ignoredDeletion("b")).toBeUndefined();
  });
  it("records against the matching open document only, with an increasing seq", () => {
    const first = recordFileChange(ev(B.path!), "x1");
    expect(first).toEqual({ documentIds: ["b"], activeRecorded: false });
    const s1 = pendingFileChangeFor("b")!.seq;
    recordFileChange(ev(B.path!, 2), "x2");
    expect(pendingFileChangeFor("b")!.seq).toBeGreaterThan(s1);
    expect(pendingFileChangeFor("a")).toBeUndefined();
    expect(recordFileChange(ev("/tmp/none.md"), "x3")).toEqual({ documentIds: [], activeRecorded: false });
  });

  it("acknowledge clears only up to the given seq; a newer change stays", () => {
    recordFileChange(ev(B.path!), "x1");
    const n = pendingFileChangeFor("b")!.seq;
    recordFileChange(ev(B.path!, 2), "x2");
    expect(acknowledgeFileChange("b", n, "reloaded")).toBe(false);
    expect(pendingFileChangeFor("b")!.seq).toBe(n + 1);
    expect(useExternalChangeStore.getState().settled.b).toBe(n);
    expect(acknowledgeFileChange("b", n + 1, "ignored")).toBe(true);
    expect(pendingFileChangeFor("b")).toBeUndefined();
  });

  it("acknowledging a document with no record creates nothing", () => {
    expect(acknowledgeFileChange("b", 99, "reloaded")).toBe(false);
    expect(useExternalChangeStore.getState()).toMatchObject({ pending: {}, settled: {} });
  });

  it("close removes only the closing document's record; a path change retires it", () => {
    recordFileChange(ev(A.path!), "x1");
    recordFileChange(ev(B.path!), "x2");
    useDocumentStore.getState().closeDocument("a");
    expect(pendingFileChangeFor("a")).toBeUndefined();
    expect(pendingFileChangeFor("b")).toBeDefined();
    useDocumentStore.getState().updateDocumentPath("b", "/tmp/b2.md");
    expect(pendingFileChangeFor("b")).toBeUndefined();
    recordFileChange(ev("/tmp/b2.md"), "x3");
    expect(pendingFileChangeFor("b")?.path).toBe("/tmp/b2.md");
  });

  it("forget drops one document's record; reset drops all; logs carry no path", () => {
    recordFileChange(ev(A.path!), "x1");
    recordFileChange(ev(B.path!), "x2");
    forgetFileChange("a", "withdrawn");
    expect(Object.keys(useExternalChangeStore.getState().pending)).toEqual(["b"]);
    resetFileChanges();
    expect(useExternalChangeStore.getState().pending).toEqual({});
    const lines = logLines("file.change.pending");
    expect(lines.map((l) => (l.context as { action: string }).action)).toEqual([
      "recorded",
      "recorded",
      "cleared",
      "cleared",
    ]);
    for (const line of lines) expect(JSON.stringify(line.context)).not.toContain("/tmp/");
  });
});
