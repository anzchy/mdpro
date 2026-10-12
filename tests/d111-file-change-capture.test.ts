/**
 * D111-WI-3 — `utils/fileChangeCapture.ts` on its own: which events a capture holds,
 * how many, and what settling replays. The store is real; the Tauri modules are the
 * only mocks (the store's log lines go through `invoke`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { pendingFileChangeFor, resetFileChanges } from "../src/stores/externalChangeStore";
import type { FileChangedEvent } from "../src/types/fileChange";
import { MAX_HELD, beginCapture, captureUnmatched, saveAsCommitTarget } from "../src/utils/fileChangeCapture";

const C = makeDoc({ id: "c", path: "/tmp/c.md" });
const ev = (path: string, timestamp = 1): FileChangedEvent => ({ path, changeType: "modified", timestamp });

beforeEach(() => {
  resetFileChanges();
  resetHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [C], activeDocumentId: "c" });
});

describe("D111-WI-3 — fileChangeCapture", () => {
  it("a capture with a path holds only that path; one without holds every path", () => {
    const byPath = beginCapture("/tmp/c.md");
    expect(captureUnmatched(ev("/tmp/other.md"), "r1")).toBe(false);
    const any = beginCapture(null);
    expect(captureUnmatched(ev("/tmp/other.md"), "r2")).toBe(true);
    byPath.settle(null);
    any.settle(null);
    expect(captureUnmatched(ev("/tmp/c.md"), "r3")).toBe(false);
  });

  it("settling replays the target path's events in order, the latest one kept", () => {
    const capture = beginCapture(null);
    captureUnmatched(ev("/tmp/c.md", 1), "r1");
    captureUnmatched(ev("/tmp/other.md", 2), "r2");
    captureUnmatched({ ...ev("/tmp/c.md", 3), changeType: "deleted" }, "r3");
    capture.settle({ documentId: "c", path: "/tmp/c.md" });
    const slot = pendingFileChangeFor("c");
    expect(slot?.event).toEqual({ ...ev("/tmp/c.md", 3), changeType: "deleted" });
    expect(slot?.actionId).toBe("r3");
  });

  it(`holds at most ${MAX_HELD} events, dropping the oldest`, () => {
    const capture = beginCapture(null);
    for (let i = 1; i <= MAX_HELD + 1; i += 1) captureUnmatched(ev("/tmp/c.md", i), `r${i}`);
    capture.settle({ documentId: "c", path: "/tmp/c.md" });
    const replayed = logLines("file.change.pending").map((l) => (l.context as { action: string }).action);
    expect(replayed).toEqual(Array(MAX_HELD).fill("recorded"));
    expect(logLines("file.change.pending")[0].actionId).toBe("r2");
    expect(pendingFileChangeFor("c")?.event.timestamp).toBe(MAX_HELD + 1);
  });

  it("settle is idempotent: a second settle records nothing more", () => {
    const capture = beginCapture(null);
    captureUnmatched(ev("/tmp/c.md"), "r1");
    capture.settle(null);
    capture.settle({ documentId: "c", path: "/tmp/c.md" }, true);
    expect(pendingFileChangeFor("c")).toBeUndefined();
  });

  it("the Save As target is the document only once it moved to the path", () => {
    expect(saveAsCommitTarget("c", "/tmp/c.md")).toEqual({ documentId: "c", path: "/tmp/c.md" });
    expect(saveAsCommitTarget("c", "/tmp/elsewhere.md")).toBeNull();
    expect(saveAsCommitTarget("gone", "/tmp/c.md")).toBeNull();
  });
});
