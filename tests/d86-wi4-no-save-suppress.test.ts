/**
 * D86 WI-4: the frontend no longer drops `file:changed` for the active path after
 * our own save. Rust recognises its own saves (the self-write mark held while
 * `save_file` writes, and the baseline bound to the written bytes), so a real
 * external change landing within 3 s of ⌘S must reach the reload decision.
 *
 * Boundary: the three Tauri modules (`fileWatcherLogHarness`), with `save_file`
 * answering a successful save. Stores, `performSave`, `saveActiveDocument` and
 * `loggingService` are real.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => {
  const h = await import("./helpers/fileWatcherLogHarness");
  return {
    ...h.coreModule,
    invoke: async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      const base = await h.coreModule.invoke(cmd, args);
      if (cmd !== "save_file") return base;
      return { success: true, path: String(args?.path), savedAt: 1_700_000_000_500 };
    },
  };
});

import { bus, invokeCount, logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { useFileWatcher, type FileChangedEvent } from "../src/hooks/useFileWatcher";
import { saveActiveDocument } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const ACTIVE = "/tmp/b.md";
const T0 = 1_700_000_000_000;

type LegacyWatcher = { markSaveInProgress?: () => void };

/** The pre-WI-4 save mark, called only while the hook still returns it. */
function legacyMark(api: object): void {
  (api as LegacyWatcher).markSaveInProgress?.();
}

/** The deps App.tsx passed before WI-4: the hook's save mark, when it exists. */
function legacyDeps(api: object): { markSaveInProgress: () => void } {
  return { markSaveInProgress: () => legacyMark(api) };
}

function change(timestamp: number, path = ACTIVE): FileChangedEvent {
  return { path, changeType: "modified", timestamp };
}

async function mount() {
  const hook = renderHook(() => useFileWatcher(ACTIVE));
  await act(async () => {
    await Promise.resolve();
  });
  return hook;
}

function emit(ev: FileChangedEvent) {
  act(() => bus.emit("file:changed", ev));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const outcomes = () =>
  logLines("file.change.received").map((l) => (l.context as { outcome: string }).outcome);

beforeEach(() => {
  resetHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [makeDoc()], activeDocumentId: "doc-1" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D86 WI-4: an external change right after our save is delivered", () => {
  it.each([100, 2900])("a/b: event %i ms after a save is delivered after the 300 ms debounce", async (gap) => {
    const { result } = await mount();
    act(() => legacyMark(result.current));
    vi.setSystemTime(T0 + gap);
    emit(change(T0 + gap));
    advance(299);
    expect(result.current.event).toBeNull();
    advance(1);
    expect(result.current.event).toEqual(change(T0 + gap));
    expect(outcomes()).toEqual(["scheduled", "delivered"]);
  });

  it("c: an event for another path is still dropped", async () => {
    const { result } = await mount();
    act(() => legacyMark(result.current));
    emit(change(T0 + 1, "/private/tmp/b.md"));
    advance(1000);
    expect(result.current.event).toBeNull();
    expect(outcomes()).toEqual(["other-path"]);
  });

  it("d: two events within 300 ms deliver only the last", async () => {
    const { result } = await mount();
    emit(change(T0 + 1));
    advance(200);
    emit(change(T0 + 2));
    advance(299);
    expect(result.current.event).toBeNull();
    advance(1);
    expect(result.current.event).toEqual(change(T0 + 2));
    advance(1000);
    expect(outcomes()).toEqual(["scheduled", "scheduled", "delivered"]);
  });

  it("e: performSave succeeds, then an external change 1 s later is delivered", async () => {
    const { result } = await mount();
    const showToast = vi.fn();
    const updateRecentFiles = vi.fn();
    const deps = { ...legacyDeps(result.current), saveActiveDocument, updateRecentFiles, showToast };
    await act(async () => {
      await performSave("save-1", deps);
    });
    expect(invokeCount("save_file")).toBe(1);
    expect(showToast.mock.calls).toEqual([["Saved"]]);
    expect(useDocumentStore.getState().documents[0]).toMatchObject({ isModified: false, path: ACTIVE });

    vi.setSystemTime(T0 + 1000);
    emit(change(T0 + 1000));
    advance(300);
    expect(result.current.event).toEqual(change(T0 + 1000));
    expect(outcomes()).toEqual(["scheduled", "delivered"]);
  });
});
