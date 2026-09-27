/**
 * ADR-0031 step 5b follow-up (5B-FU-1) — `useSidebarPreference` emits one
 * structured `ui.sidebar.preference` log per hydration-relevant event, with an
 * enum-only context `{ outcome }`.
 *
 * Outcomes:
 *   buffered          toggle before hydration settles
 *   reconciled_write  hydrate after a pre-settle toggle, buffered ≠ disk
 *   reconciled_noop   hydrate after a pre-settle toggle, buffered = disk
 *   applied_stored    hydrate with no pre-settle toggle
 *   hydrate_failed    fail()
 * An ordinary post-settle toggle logs nothing here (`preferencesService` owns
 * the write log).
 *
 * **Mocked:** only `@tauri-apps/api/core`. Logs are observed as the
 * `log_event` invoke payload that the real `loggingService` sends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSidebarPreference } from "../src/hooks/useSidebarPreference";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { LogEntryPayload } from "../src/types/logging";
import { makePreferences } from "./support/preferenceFixtures";

const EVENT = "ui.sidebar.preference";

function sidebarLogs(): LogEntryPayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogEntryPayload }).payload)
    .filter((p) => p.event === EVENT);
}

function outcomes(): unknown[] {
  return sidebarLogs().map((p) => p.context?.outcome);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: unknown) =>
    cmd === "set_preferences" ? makePreferences() : null,
  );
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useEditorStore.setState({ showSidebar: true });
});

describe("useSidebarPreference — ui.sidebar.preference logging", () => {
  it("L1 a pre-settle toggle logs exactly one `buffered`", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle());
    await flush();
    expect(outcomes()).toEqual(["buffered"]);
  });

  it("L2 hydrate after a pre-settle toggle that differs from disk logs `reconciled_write`", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle()); // true → false; disk says true
    act(() => result.current.hydrate(true));
    await flush();
    expect(outcomes()).toEqual(["buffered", "reconciled_write"]);
  });

  it("L3 hydrate after a pre-settle toggle equal to disk logs `reconciled_noop`", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle()); // true → false; disk says false
    act(() => result.current.hydrate(false));
    await flush();
    expect(outcomes()).toEqual(["buffered", "reconciled_noop"]);
  });

  it("L4 hydrate with no pre-settle toggle logs `applied_stored`", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrate(false));
    await flush();
    expect(outcomes()).toEqual(["applied_stored"]);
  });

  it("L5 fail() logs exactly one `hydrate_failed`", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.fail());
    await flush();
    expect(outcomes()).toEqual(["hydrate_failed"]);
  });

  it("L6 a post-settle toggle logs nothing under this event", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrate(true));
    await flush();
    invokeMock.mockClear();
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    await flush();
    expect(sidebarLogs()).toEqual([]);
  });

  it("L7 a second hydrate after settle logs nothing more", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrate(true));
    act(() => result.current.hydrate(false));
    await flush();
    expect(outcomes()).toEqual(["applied_stored"]);
  });

  it("L8 two pre-settle toggles log one `buffered` each", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    await flush();
    expect(outcomes()).toEqual(["buffered", "buffered"]);
  });

  it("L9 the given actionId is passed through on a buffered toggle", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle("act-42"));
    await flush();
    expect(sidebarLogs()).toHaveLength(1);
    expect(sidebarLogs()[0].actionId).toBe("act-42");
  });

  it("L10 every context carries only the `outcome` key", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.toggle("a1"));
    act(() => result.current.hydrate(true));
    const second = renderHook(() => useSidebarPreference());
    act(() => second.result.current.fail());
    const third = renderHook(() => useSidebarPreference());
    act(() => third.result.current.hydrate(false));
    await flush();

    const logs = sidebarLogs();
    expect(logs).toHaveLength(4);
    for (const log of logs) {
      expect(Object.keys(log.context ?? {})).toEqual(["outcome"]);
      expect(log.error).toBeUndefined();
    }
  });

  it("L11 hydrate_failed is a warn/fail entry; other outcomes are info/success", async () => {
    const { result } = renderHook(() => useSidebarPreference());
    act(() => result.current.hydrate(true));
    const failing = renderHook(() => useSidebarPreference());
    act(() => failing.result.current.fail());
    await flush();

    const [applied, failed] = sidebarLogs();
    expect([applied.level, applied.status]).toEqual(["info", "success"]);
    expect([failed.level, failed.status]).toEqual(["warn", "fail"]);
  });
});
