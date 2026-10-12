/**
 * D171 WI-1 — an external change to a document in a background tab is recorded at
 * once and surfaced when that document is (or becomes) active.
 *
 * Before D171 `useFileWatcher` listened only for the active path, dropped every other
 * path as `other-path`, and tore its listener (and the 300 ms debounce timer) down on
 * each tab switch; Rust re-baselines when it emits, so the change was never reported
 * again and the next ⌘S overwrote it.
 *
 * Driven through App's real wiring (`useExternalChangePrompt` + `useDocument`, see
 * `tests/support/externalChangeHarness.tsx`). Mock boundary: the Tauri event / core /
 * window modules only; stores, hooks and `loggingService` are real.
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
  emitChange,
  mountPrompt,
  reloadMessage,
  resetExternalChangeHarness,
  view,
} from "./support/externalChangeHarness";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const T0 = 1_700_000_000_000;

function activate(id: string) {
  act(() => {
    view.current?.api.setActiveDocumentById(id);
  });
}

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

describe("D171 WI-1 — a background document's change is kept until it is shown", () => {
  it("red 1: an external write to inactive B prompts once B is activated", async () => {
    await mountPrompt();
    emitChange(B.path!);
    advance(1000);
    expect(reloadMessage()).toBeNull(); // A is active: nothing to show yet

    activate("b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("red 2: B's event, a switch away before 300 ms, and a switch back still prompts", async () => {
    useDocumentStore.setState({ activeDocumentId: "b" });
    await mountPrompt();
    emitChange(B.path!);
    advance(100);
    activate("a");
    advance(1000);
    expect(reloadMessage()).toBeNull();

    activate("b");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("a background deletion prompts with the deleted message on activation", async () => {
    await mountPrompt();
    emitChange(B.path!, "deleted");
    advance(1000);
    activate("b");
    advance(300);
    expect(reloadMessage()).toBe(DELETED_MSG);
  });

  it("a background rename is followed on activation: the path moves, no prompt", async () => {
    await mountPrompt();
    emitChange(B.path!, "renamed", { newPath: "/tmp/b-renamed.md" });
    advance(1000);
    expect(useDocumentStore.getState().getDocumentById("b")?.path).toBe(B.path);
    activate("b");
    advance(300);
    expect(useDocumentStore.getState().getDocumentById("b")?.path).toBe("/tmp/b-renamed.md");
    expect(reloadMessage()).toBeNull();
  });

  it("the listener is up with no document open; a document opened later records its change", async () => {
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
    await mountPrompt();
    act(() => {
      useDocumentStore.setState({ documents: [B], activeDocumentId: "b" });
    });
    emitChange(B.path!);
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });

  it("logs recorded for a background document and other-path for a path nothing has open", async () => {
    await mountPrompt();
    emitChange(B.path!);
    emitChange("/tmp/nobody.md");
    expect(receivedOutcomes()).toEqual(["recorded", "other-path"]);
    const pending = logLines("file.change.pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].context).toMatchObject({ action: "recorded", documentId: "b" });
    expect(JSON.stringify(pending[0].context)).not.toContain(B.path!);
  });

  it("two documents on one path each keep their own record; closing one leaves the other's", async () => {
    const B2 = makeDoc({ id: "b2", path: B.path, content: "# b2\n" });
    useDocumentStore.setState({ documents: [A, B, B2], activeDocumentId: "a" });
    await mountPrompt();
    emitChange(B.path!);
    advance(1000);
    act(() => useDocumentStore.getState().closeDocument("b"));
    activate("b2");
    advance(300);
    expect(reloadMessage()).toBe(MODIFIED_MSG);
  });
});
