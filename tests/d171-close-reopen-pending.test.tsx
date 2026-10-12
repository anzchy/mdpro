/**
 * D171 WI-3 — a pending record belongs to one document lifetime.
 *
 * - Closing B removes B's record; a reopen reads the current bytes, so the old event
 *   must not prompt for the new lifetime (document ids are path-derived, so the
 *   reopened B has the same id).
 * - A late event for B's path after B closed has no owner: it is logged and dropped.
 * - An open that the open guard turns into focusing an existing DIRTY B (content not
 *   replaced) keeps B's pending record, so the prompt still appears.
 * - A cancelled (superseded) encoding retry neither clears nor creates records.
 *
 * Driven through App's real wiring and `useDocument`'s real open entry points
 * (`tests/support/externalChangeHarness.tsx`). Mock boundary: the Tauri modules only.
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
  MODIFIED_MSG,
  advance,
  emitChange,
  flush,
  mountPrompt,
  onIpc,
  reloadMessage,
  resetExternalChangeHarness,
  view,
} from "./support/externalChangeHarness";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const T0 = 1_700_000_000_000;
const FRESH_B = makeDoc({ id: "b", path: B.path, content: "# b, as now on disk\n" });

function activate(id: string) {
  act(() => {
    view.current?.api.setActiveDocumentById(id);
  });
}

async function closeB() {
  await flush(() => view.current?.api.closeDocumentById("b", true));
}

const receivedOutcomes = () =>
  logLines("file.change.received").map((l) => (l.context as { outcome: string }).outcome);

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  onIpc("open_file", async () => ({ document: FRESH_B }));
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [A, B], activeDocumentId: "a" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D171 WI-3 — close, reopen and the open guard", () => {
  it("red 7a: pending old event on B → close B → reopen → no prompt from the old event", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(1000);
    await closeB();
    await flush(() => view.current?.api.openPathOutcome(B.path!));
    expect(useDocumentStore.getState().activeDocumentId).toBe("b");
    advance(1000);
    expect(reloadMessage()).toBeNull();
  });

  it("red 7b: a late event after close is dropped and does not prompt the reopened B", async () => {
    await mountPrompt();
    await closeB();
    emitChange(B.path!);
    expect(receivedOutcomes()).toEqual(["other-path"]);
    await flush(() => view.current?.api.openPathOutcome(B.path!));
    advance(1000);
    expect(reloadMessage()).toBeNull();
  });

  it("red 7c: a reopen that focuses the existing DIRTY B keeps B's pending record", async () => {
    act(() => useDocumentStore.getState().markDocumentModified("b", true));
    await mountPrompt();
    emitChange(B.path!);
    advance(1000);
    await flush(() => view.current?.api.openPathOutcome(B.path!));
    const b = useDocumentStore.getState().getDocumentById("b");
    expect(b?.content).toBe(B.content); // focused, not replaced
    expect(useDocumentStore.getState().activeDocumentId).toBe("b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("red 7d: a cancelled encoding retry leaves B's record in place and creates none", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(1000);
    const controller = new AbortController();
    controller.abort();
    let kind = "";
    await flush(async () => {
      kind = (await view.current!.api.openDocumentWithEncoding(B.path!, "GBK", undefined, controller.signal)).kind;
    });
    expect(kind).toBe("cancelled");
    expect(logLines("file.change.pending").map((l) => (l.context as { action: string }).action)).toEqual([
      "recorded",
    ]);
    activate("b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });
});
