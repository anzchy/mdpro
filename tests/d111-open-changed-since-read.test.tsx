/**
 * D111-WI-3 — an open or Save As reply's `changedSinceRead` (Rust's seed check after
 * the watch registration, ADR-0081 "Open-time check") becomes a pending external
 * change on the document the open guard actually committed, and a `file:changed`
 * event that arrives while the open or Save As is in flight, before that document is
 * in the store, is captured and replayed against it (Codex interleavings 5 and 6).
 *
 * - A true flag records a slot (source `open-check`) on the committed document: a new
 *   tab, a clean reopen, a D145 in-place reload (the tab's id, not the decoded one),
 *   a dialog open, an encoding retry, or the Save As target.
 * - An open that focuses an existing dirty tab installs nothing, so the flag attaches
 *   to no document. A cancelled retry or a failed open attaches nothing.
 * - A false flag never clears a pending slot.
 *
 * Driven through App's real wiring (`tests/support/externalChangeHarness.tsx`), the
 * real `useDocument` open entry points and the real `saveActiveDocumentAs`. Mock
 * boundary: the Tauri modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  A,
  B,
  DELETED_MSG,
  MODIFIED_MSG,
  advance,
  deferred,
  emitChange,
  flush,
  mountPrompt,
  onIpc,
  reloadMessage,
  resetExternalChangeHarness,
  view,
} from "./support/externalChangeHarness";
import { saveActiveDocumentAs } from "../src/services/documentSave";
import { useDocumentStore } from "../src/stores/documentStore";
import { pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const T0 = 1_700_000_000_000;
const C = makeDoc({ id: "c", path: "/tmp/c.md", content: "# c\n" });
const COPY = "/tmp/a-copy.md";

const openReply = (document = C, changedSinceRead = true) => ({ document, recoveredDraft: null, changedSinceRead });

const openPath = (path: string) => flush(() => view.current?.api.openPathOutcome(path));

const receivedOutcomes = () =>
  logLines("file.change.received").map((l) => (l.context as { outcome: string }).outcome);

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [A, B], activeDocumentId: "a" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D111-WI-3 — the flag attaches to the committed document", () => {
  it("a: a new tab opened with changedSinceRead records an open-check change and prompts", async () => {
    onIpc("open_file", async () => openReply());
    await mountPrompt();
    await openPath(C.path!);
    const slot = pendingFileChangeFor("c");
    expect(slot?.source).toBe("open-check");
    expect(slot?.path).toBe(C.path);
    const recorded = logLines("file.change.pending").map((l) => l.context as Record<string, unknown>);
    expect(recorded).toEqual([expect.objectContaining({ action: "recorded", documentId: "c", source: "open-check" })]);
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("b: changedSinceRead false records nothing", async () => {
    onIpc("open_file", async () => openReply(C, false));
    await mountPrompt();
    await openPath(C.path!);
    advance(1000);
    expect(pendingFileChangeFor("c")).toBeUndefined();
    expect(reloadMessage()).toBeNull();
  });

  it("c: a false flag on a clean reopen never clears B's pending change", async () => {
    onIpc("open_file", async () => openReply(B, false));
    await mountPrompt();
    emitChange(B.path!);
    const before = pendingFileChangeFor("b");
    await openPath(B.path!);
    expect(pendingFileChangeFor("b")).toEqual(before);
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("d: a D145 in-place reload attaches to the tab's id, not the decoded id", async () => {
    onIpc("open_file", async () => openReply(makeDoc({ id: "b-decoded", path: B.path, content: "# b2\n" })));
    await mountPrompt();
    await openPath(B.path!);
    expect(useDocumentStore.getState().getDocumentById("b")?.content).toBe("# b2\n");
    expect(pendingFileChangeFor("b")?.source).toBe("open-check");
    expect(pendingFileChangeFor("b-decoded")).toBeUndefined();
  });

  it("e: an open that focuses the dirty B installs nothing, so the flag attaches nowhere", async () => {
    act(() => useDocumentStore.getState().markDocumentModified("b", true));
    onIpc("open_file", async () => openReply(makeDoc({ id: "b", path: B.path, content: "# b2\n" })));
    await mountPrompt();
    await openPath(B.path!);
    expect(useDocumentStore.getState().getDocumentById("b")?.content).toBe(B.content);
    expect(pendingFileChangeFor("b")).toBeUndefined();
    expect(logLines("file.change.pending")).toEqual([]);
  });

  it("f: the Open dialog's flag attaches to the opened tab", async () => {
    onIpc("open_file_dialog", async () => openReply());
    await mountPrompt();
    await flush(() => view.current?.api.openDocumentFromDialog());
    expect(pendingFileChangeFor("c")?.source).toBe("open-check");
  });

  it("g: an encoding retry's flag attaches; a cancelled retry's does not", async () => {
    onIpc("open_file", async () => openReply());
    await mountPrompt();
    const controller = new AbortController();
    controller.abort();
    await flush(() => view.current!.api.openDocumentWithEncoding(C.path!, "GBK", undefined, controller.signal));
    expect(pendingFileChangeFor("c")).toBeUndefined();
    await flush(() => view.current!.api.openDocumentWithEncoding(C.path!, "GBK"));
    expect(pendingFileChangeFor("c")?.source).toBe("open-check");
  });

  it("h: a Save As whose target changed records against the document under its new path", async () => {
    onIpc("save_file_dialog", async () => ({ success: true, path: COPY, savedAt: T0 + 1, changedSinceRead: true }));
    await mountPrompt();
    await flush(() => saveActiveDocumentAs());
    expect(useDocumentStore.getState().getDocumentById("a")?.path).toBe(COPY);
    expect(pendingFileChangeFor("a")).toEqual(expect.objectContaining({ path: COPY, source: "open-check" }));
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("i: a Save As with an unchanged target records nothing", async () => {
    onIpc("save_file_dialog", async () => ({ success: true, path: COPY, savedAt: T0 + 1, changedSinceRead: false }));
    await mountPrompt();
    await flush(() => saveActiveDocumentAs());
    expect(pendingFileChangeFor("a")).toBeUndefined();
  });
});

describe("D111-WI-3 — events during an in-flight open or Save As are kept", () => {
  it("j: an event for the path before the open replies is replayed onto the new tab", async () => {
    const reply = deferred<unknown>();
    onIpc("open_file", () => reply.promise);
    await mountPrompt();
    let opening: Promise<unknown> = Promise.resolve();
    act(() => {
      opening = view.current!.api.openPathOutcome(C.path!);
    });
    emitChange(C.path!, "deleted");
    expect(receivedOutcomes()).toEqual(["captured"]);
    await flush(async () => {
      reply.resolve(openReply(C, false));
      await opening;
    });
    expect(pendingFileChangeFor("c")?.event.changeType).toBe("deleted");
    advance(300);
    expect(reloadMessage()).toBe(DELETED_MSG);
  });

  it("k: with a true flag too, the replayed watcher event is the one presented", async () => {
    const reply = deferred<unknown>();
    onIpc("open_file", () => reply.promise);
    await mountPrompt();
    let opening: Promise<unknown> = Promise.resolve();
    act(() => {
      opening = view.current!.api.openPathOutcome(C.path!);
    });
    emitChange(C.path!, "deleted");
    await flush(async () => {
      reply.resolve(openReply(C, true));
      await opening;
    });
    expect(pendingFileChangeFor("c")?.event.changeType).toBe("deleted");
  });

  it("l: the Open dialog keeps only the picked path's events", async () => {
    const reply = deferred<unknown>();
    onIpc("open_file_dialog", () => reply.promise);
    await mountPrompt();
    let opening: Promise<unknown> = Promise.resolve();
    act(() => {
      opening = view.current!.api.openDocumentFromDialog();
    });
    emitChange("/tmp/elsewhere.md");
    emitChange(C.path!);
    await flush(async () => {
      reply.resolve(openReply(C, false));
      await opening;
    });
    expect(pendingFileChangeFor("c")?.event.path).toBe(C.path);
    const pending = logLines("file.change.pending").map((l) => (l.context as { documentId: string }).documentId);
    expect(pending).toEqual(["c"]);
  });

  it("m: a Save As keeps the target's event that lands before it replies", async () => {
    const reply = deferred<unknown>();
    onIpc("save_file_dialog", () => reply.promise);
    await mountPrompt();
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = saveActiveDocumentAs();
    });
    emitChange(COPY);
    await flush(async () => {
      reply.resolve({ success: true, path: COPY, savedAt: T0 + 1, changedSinceRead: false });
      await saving;
    });
    expect(pendingFileChangeFor("a")).toEqual(expect.objectContaining({ path: COPY, source: "watcher" }));
  });

  it("n: a failed open drops what it captured; a later open does not inherit it", async () => {
    onIpc("open_file", async () => {
      emitChange(C.path!);
      throw new Error("disk on fire");
    });
    await mountPrompt();
    await openPath(C.path!);
    expect(receivedOutcomes()).toEqual(["captured"]);
    onIpc("open_file", async () => openReply(C, false));
    await openPath(C.path!);
    expect(pendingFileChangeFor("c")).toBeUndefined();
  });

  it("o: with nothing in flight an unmatched event is still dropped as other-path", async () => {
    await mountPrompt();
    emitChange(C.path!);
    expect(receivedOutcomes()).toEqual(["other-path"]);
  });
});
