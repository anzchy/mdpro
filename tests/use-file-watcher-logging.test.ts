/**
 * D32 WI-5 — `file.change.received` logging in the `file:changed` listener.
 * Matrix `.claude/tdd-guardian/tests-20260926-124422.md`, cases fh1-fh4.
 * Only the Tauri modules are doubled; loggingService and useLoggingStore are real.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);

import { bus, logLines, resetHarness } from "./helpers/fileWatcherLogHarness";
import { useFileWatcher, type FileChangedEvent } from "../src/hooks/useFileWatcher";
import { useLoggingStore } from "../src/stores/loggingStore";

const RECEIVED = "file.change.received";
const ACTIVE = "/tmp/b.md";
const T0 = 1_700_000_000_000;

function change(timestamp: number, path = ACTIVE): FileChangedEvent {
  return { path, changeType: "modified", timestamp };
}

async function mount(activePath: string | null) {
  const hook = renderHook(() => useFileWatcher(activePath));
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

const byOutcome = (outcome: string) =>
  logLines(RECEIVED).filter((l) => (l.context as { outcome: string }).outcome === outcome);

beforeEach(() => {
  resetHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fh1: other-path event", () => {
  it("is filtered and logged once with both paths", async () => {
    const { result } = await mount("/tmp/b.md");
    emit({ path: "/private/tmp/b.md", changeType: "modified", timestamp: 1700000000777 });
    advance(1000);

    expect(result.current.event).toBeNull();
    const lines = logLines(RECEIVED);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", event: RECEIVED, status: "cancel" });
    expect(lines[0].context).toEqual({
      outcome: "other-path",
      path: "/private/tmp/b.md",
      activePath: "/tmp/b.md",
      eventTimestamp: 1700000000777,
      windowLabel: "main",
      changeType: "modified",
    });
    expect(logLines()).toHaveLength(1);
  });
});

describe("fh2: save-suppress window boundary", () => {
  it("suppresses at +1000 and +2999, schedules and delivers at +3000", async () => {
    const { result } = await mount(ACTIVE);
    act(() => result.current.markSaveInProgress());

    vi.setSystemTime(T0 + 1000);
    emit(change(T0 + 1000));
    advance(300);
    expect(result.current.event).toBeNull();

    vi.setSystemTime(T0 + 2999);
    emit(change(T0 + 2999));
    advance(300);
    expect(result.current.event).toBeNull();

    vi.setSystemTime(T0 + 3000);
    emit(change(T0 + 3000));
    expect(byOutcome("scheduled")).toHaveLength(1);
    expect(byOutcome("delivered")).toHaveLength(0);
    advance(300);

    expect(result.current.event).toEqual(change(T0 + 3000));
    const suppressed = byOutcome("save-suppressed");
    expect(suppressed).toHaveLength(2);
    expect(suppressed.every((l) => l.status === "cancel")).toBe(true);
    expect(suppressed.map((l) => (l.context as { eventTimestamp: number }).eventTimestamp)).toEqual([
      T0 + 1000,
      T0 + 2999,
    ]);
    expect(byOutcome("scheduled")).toHaveLength(1);
    expect(byOutcome("delivered")).toHaveLength(1);
    expect(logLines(RECEIVED).map((l) => (l.context as { outcome: string }).outcome)).toEqual([
      "save-suppressed",
      "save-suppressed",
      "scheduled",
      "delivered",
    ]);
  });
});

/** Test-side oracle: an event is delivered iff the next gap is >= 300ms or it is the last. */
function deliveredIndexes(gaps: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i <= gaps.length; i++) {
    if (i === gaps.length || gaps[i] >= 300) out.push(i);
  }
  return out;
}

describe("fh3: burst conservation law", () => {
  const scripts: number[][] = [[], [100], [100, 100], [100, 100, 100, 100], [400], [100, 400, 100], [299], [300]];
  const expectedDelivered = [1, 1, 1, 1, 2, 2, 1, 2];

  it.each(scripts.map((gaps, i) => [JSON.stringify(gaps), gaps, expectedDelivered[i]] as const))(
    "script %s",
    async (_label, gaps, expectedCount) => {
      const { result, unmount } = await mount(ACTIVE);
      const stamps = Array.from({ length: gaps.length + 1 }, (_, i) => T0 + 10_000 + i);
      emit(change(stamps[0]));
      gaps.forEach((gap, i) => {
        advance(gap);
        emit(change(stamps[i + 1]));
      });
      advance(1000);

      const oracle = deliveredIndexes(gaps);
      expect(oracle).toHaveLength(expectedCount);
      const scheduled = byOutcome("scheduled");
      const delivered = byOutcome("delivered");
      expect(scheduled).toHaveLength(stamps.length);
      expect(delivered).toHaveLength(expectedCount);
      expect(delivered.map((l) => (l.context as { eventTimestamp: number }).eventTimestamp)).toEqual(
        oracle.map((i) => stamps[i]),
      );
      expect(result.current.event?.timestamp).toBe(stamps[stamps.length - 1]);
      for (const d of delivered) {
        expect(scheduled.filter((s) => s.actionId === d.actionId)).toHaveLength(1);
      }
      unmount();
    },
  );
});

describe("fh4: delivered reuses its scheduled actionId", () => {
  it("pairs each delivery with its own scheduled line; the superseded one is unpaired", async () => {
    const { result } = await mount(ACTIVE);
    emit(change(T0 + 1));
    advance(100);
    emit(change(T0 + 2));
    advance(1000);
    emit(change(T0 + 3));
    advance(300);

    const scheduled = byOutcome("scheduled");
    const delivered = byOutcome("delivered");
    expect(scheduled).toHaveLength(3);
    expect(new Set(scheduled.map((l) => l.actionId)).size).toBe(3);
    expect(scheduled.every((l) => typeof l.actionId === "string" && l.actionId.length > 0)).toBe(true);
    expect(delivered).toHaveLength(2);
    expect(delivered[0].actionId).toBe(scheduled[1].actionId);
    expect(delivered[1].actionId).toBe(scheduled[2].actionId);
    expect(delivered.some((l) => l.actionId === scheduled[0].actionId)).toBe(false);
    expect(scheduled.every((l) => l.status === "start")).toBe(true);
    expect(delivered.every((l) => l.status === "success")).toBe(true);
    expect(result.current.event).toEqual(change(T0 + 3));
  });
});
