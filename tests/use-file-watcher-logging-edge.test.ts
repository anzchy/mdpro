/**
 * D32 WI-5 — edge and failure cases of `file.change.received` logging.
 * Matrix `.claude/tdd-guardian/tests-20260926-124422.md`, cases fh5-fh9.
 * Only the Tauri modules are doubled; loggingService and useLoggingStore are real.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);

import {
  bus,
  invokeCount,
  logLines,
  resetHarness,
  setLogEventRejects,
  setWindowThrows,
} from "./helpers/fileWatcherLogHarness";
import { useFileWatcher, type FileChangedEvent } from "../src/hooks/useFileWatcher";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { LogLevel } from "../src/types/logging";

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

describe("fh5: unmount before the debounce timer", () => {
  it("logs scheduled but never delivered, and does not update state late", async () => {
    const consoleError = vi.spyOn(console, "error");
    const { unmount } = await mount(ACTIVE);
    emit(change(T0 + 1));
    advance(100);
    unmount();
    advance(1000);
    emit(change(T0 + 2));
    advance(1000);

    expect(byOutcome("scheduled")).toHaveLength(1);
    expect(byOutcome("delivered")).toHaveLength(0);
    expect(logLines(RECEIVED)).toHaveLength(1);
    expect(bus.count("file:changed")).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("fh6: getCurrentWindow throws", () => {
  it('labels every line "unknown" and still delivers', async () => {
    setWindowThrows(true);
    const { result } = await mount(ACTIVE);
    emit(change(T0 + 1));
    advance(300);

    const lines = logLines(RECEIVED);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map((l) => (l.context as { windowLabel: string }).windowLabel)).toEqual(
      lines.map(() => "unknown"),
    );
    expect(byOutcome("delivered")).toHaveLength(1);
    expect(result.current.event).toEqual(change(T0 + 1));
  });
});

type Setting = { enabled: boolean; level: LogLevel };

/** One script: other-path, an active-path event, then a [100] burst (no save window since D86 WI-4). */
async function runScript(setting: Setting) {
  resetHarness();
  vi.setSystemTime(T0);
  useLoggingStore.setState(setting);
  const { result, unmount } = await mount(ACTIVE);
  const trajectory: Array<FileChangedEvent | null> = [];
  const step = (ms: number) => {
    advance(ms);
    trajectory.push(result.current.event);
  };

  emit(change(T0 + 1, "/private/tmp/b.md"));
  step(300);
  emit(change(T0 + 2));
  step(300);
  emit(change(T0 + 3));
  step(100);
  emit(change(T0 + 4));
  step(300);
  step(1000);

  const logInvokes = invokeCount("log_event");
  unmount();
  return { trajectory, logInvokes };
}

describe("fh7: behaviour neutrality across logging settings", () => {
  it("gives the same state trajectory with logging on, off, and filtered to warn", async () => {
    const on = await runScript({ enabled: true, level: "info" });
    const off = await runScript({ enabled: false, level: "info" });
    const warn = await runScript({ enabled: true, level: "warn" });

    expect(on.trajectory).toEqual([null, change(T0 + 2), change(T0 + 2), change(T0 + 4), change(T0 + 4)]);
    expect(off.trajectory).toEqual(on.trajectory);
    expect(warn.trajectory).toEqual(on.trajectory);
    expect(on.logInvokes).toBeGreaterThan(0);
    expect(off.logInvokes).toBe(0);
    expect(warn.logInvokes).toBe(0);
  });
});

describe("fh8: null activePath", () => {
  it("subscribes to nothing and logs nothing", async () => {
    const { result } = await mount(null);
    emit(change(T0 + 1));
    advance(1000);

    expect(bus.count("file:changed")).toBe(0);
    expect(logLines()).toHaveLength(0);
    expect(result.current.event).toBeNull();
  });
});

describe("fh9: log_event IPC rejects", () => {
  it("still delivers the event with no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      setLogEventRejects(true);
      const { result } = await mount(ACTIVE);
      emit(change(T0 + 1));
      advance(300);
      expect(result.current.event).toEqual(change(T0 + 1));

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(invokeCount("log_event")).toBeGreaterThan(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
