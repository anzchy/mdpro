/**
 * D43 WI-4 — `syncRecentFilesMenu`, the typed wrapper over the
 * `sync_recent_files_menu` IPC command.
 *
 * Cases SVC-01 … SVC-04 of `.claude/tdd-guardian/tests-20261007-143049.md`.
 *
 * **Law**: none. A thin adapter with three outcomes (list, null, reject); the
 * cases enumerate the whole outcome space.
 *
 * **Mocked:** only `@tauri-apps/api/core` (`invoke` and the `isTauri` spy).
 * `loggingService` and `useLoggingStore` are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { syncRecentFilesMenu } from "../src/services/recentFilesMenuService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { createSessionFake, SYNC_COMMAND } from "./support/recentSessionFake";

function syncCallCount() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === SYNC_COMMAND).length;
}

function logPayloads() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: Record<string, unknown> }).payload);
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

describe("syncRecentFilesMenu (D43 WI-4)", () => {
  it("SVC-01 Tauri mode returns the Rust list; viewMode passes through, null included", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const fake = createSessionFake({ answer: () => ["/x.md", "/y.md"] });
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) =>
      cmd === SYNC_COMMAND ? fake.handle(args) : null,
    );

    await expect(syncRecentFilesMenu({ kind: "record", path: "/x.md" }, null)).resolves.toEqual([
      "/x.md",
      "/y.md",
    ]);
    await expect(syncRecentFilesMenu({ kind: "refresh" }, "source")).resolves.toEqual([
      "/x.md",
      "/y.md",
    ]);
  });

  it("SVC-02 browser mode returns null without invoking", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === SYNC_COMMAND ? ["/should-not.md"] : null,
    );

    await expect(syncRecentFilesMenu({ kind: "record", path: "/x.md" }, null)).resolves.toBeNull();
    await expect(
      syncRecentFilesMenu({ kind: "seed", stored: null, pendingNewestFirst: [] }, null),
    ).resolves.toBeNull();
    await expect(syncRecentFilesMenu({ kind: "refresh" }, "wysiwyg")).resolves.toBeNull();
    expect(syncCallCount()).toBe(0);
  });

  it("SVC-03 a rejection resolves null and logs an enum-only fail record", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === SYNC_COMMAND) throw new Error("boom /SECRET/x.md");
      return null;
    });

    await expect(
      syncRecentFilesMenu({ kind: "record", path: "/SECRET/x.md" }, null),
    ).resolves.toBeNull();
    await settle();

    const fails = logPayloads().filter((p) => p.event === "ui.recent_files.menu_sync");
    expect(fails).toHaveLength(1);
    expect(fails[0].status).toBe("fail");
    expect(fails[0].context).toEqual({ op: "record" });
    expect(JSON.stringify(fails[0])).not.toContain("SECRET");
  });

  it("SVC-04 a malformed response resolves null", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const replies: unknown[] = ["x", [1, 2], {}];
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === SYNC_COMMAND ? replies.shift() : null,
    );

    for (let i = 0; i < 3; i += 1) {
      await expect(
        syncRecentFilesMenu({ kind: "record", path: "/x.md" }, null),
        `reply ${i}`,
      ).resolves.toBeNull();
    }
    expect(syncCallCount()).toBe(3);
  });
});
