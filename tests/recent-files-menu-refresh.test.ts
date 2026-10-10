/**
 * D43 WI-4 — `useRecentFilesMenuRefresh(viewMode)` rebuilds the menu on a
 * view-mode change by sending `refresh`, never a list.
 *
 * Cases RF-01 … RF-03 of `.claude/tdd-guardian/tests-20261007-143049.md`.
 *
 * **Law**: none. An effect keyed on one value: one refresh per distinct
 * `viewMode`, never a list.
 *
 * **Mocked:** only `@tauri-apps/api/core`. The hooks, services and the
 * session fake's model (real `pushRecent` / `mergePending`) are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { useRecentFilesMenuRefresh } from "../src/hooks/useRecentFilesMenuRefresh";
import { useLoggingStore } from "../src/stores/loggingStore";
import { createSessionFake, SYNC_COMMAND, type SyncArgs } from "./support/recentSessionFake";
import type { ViewMode } from "../src/types/editor";

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

function syncArgs() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === SYNC_COMMAND)
    .map(([, args]) => args as SyncArgs);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(mode: ViewMode) {
  return renderHook(
    ({ mode: m }: { mode: ViewMode }) => ({
      rf: useRecentFiles(),
      _: useRecentFilesMenuRefresh(m),
    }),
    { initialProps: { mode } },
  );
}

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

describe("useRecentFilesMenuRefresh (D43 WI-4)", () => {
  it("RF-01 mount sends refresh, and the refresh response never changes the list", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const fake = createSessionFake({
      answer: (args) => (args.op.kind === "refresh" ? ["/x.md"] : null),
    });
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) =>
      cmd === SYNC_COMMAND ? fake.handle(args) : null,
    );

    const { result } = mount("source");
    act(() => result.current.rf.hydrateRecentFiles(["/s1.md"]));
    await flush();

    expect(result.current.rf.recentFiles).toEqual(["/s1.md"]);
    // Level 6 supplement: the refresh carried the mode and no list.
    expect(syncArgs()).toContainEqual({ op: { kind: "refresh" }, viewMode: "source" });
    expect(fake.installModes[0]).toBe("source");
  });

  it("RF-02 a viewMode change sends one refresh; a same-value rerender sends none", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const fake = createSessionFake();
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) =>
      cmd === SYNC_COMMAND ? fake.handle(args) : null,
    );

    const { rerender } = mount("source");
    await flush();
    expect(fake.menuViewMode).toBe("source");
    rerender({ mode: "wysiwyg" });
    await flush();
    rerender({ mode: "wysiwyg" });
    await flush();

    expect(fake.menuViewMode).toBe("wysiwyg");
    expect(syncArgs().filter((a) => a.op.kind === "refresh")).toHaveLength(2);
  });

  it("RF-03a a rejected refresh is silent and leaves the list unchanged", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) => {
      if (cmd === SYNC_COMMAND && (args as SyncArgs).op.kind === "refresh") {
        throw new Error("menu down");
      }
      return null;
    });

    const { result } = mount("source");
    act(() => result.current.rf.hydrateRecentFiles(["/s1.md"]));
    await flush();
    await flush();

    expect(result.current.rf.recentFiles).toEqual(["/s1.md"]);
    expect(syncArgs().some((a) => a.op.kind === "refresh")).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it("RF-03b browser mode is silent and invokes nothing", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    const { result } = mount("wysiwyg");
    await flush();
    await flush();

    expect(result.current.rf.recentFiles).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });
});
