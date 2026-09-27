/**
 * WI-2 (ADR-0031 step 5b) — `tests/support/tauriCoreMock.ts`, the one place
 * that builds a `@tauri-apps/api/core` mock module.
 *
 * Matrix `.claude/tdd-guardian/tests-20260927-031000.md` H1–H3. The helper has
 * no behaviour of its own; these cases exist so that a helper returning a
 * hardcoded constant cannot pass. Every case reads the helper THROUGH the mocked
 * module (hoisted `vi.mock` for H1, `vi.doMock` + a fresh import for H2/H3),
 * because the hoisting shape is where a helper like this breaks.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);

import { isTauri } from "@tauri-apps/api/core";

type CoreModule = typeof import("@tauri-apps/api/core");

/** Re-import `@tauri-apps/api/core` through a fresh, non-hoisted mock. */
async function importCoreMockedWith(
  options: Parameters<typeof import("./support/tauriCoreMock").createTauriCoreMock>[0],
): Promise<CoreModule> {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", async () =>
    (await import("./support/tauriCoreMock")).createTauriCoreMock(options),
  );
  return import("@tauri-apps/api/core");
}

describe("tauriCoreMock — the shared @tauri-apps/api/core mock", () => {
  it("H1: with no arguments the mocked module reports browser mode", () => {
    expect(isTauri()).toBe(false);
  });

  it("H2: built with true, then flipped per test, and the flip is seen through the module", async () => {
    const core = await importCoreMockedWith({ isTauri: true });

    const seen: boolean[] = [core.isTauri()];
    vi.mocked(core.isTauri).mockReturnValue(false);
    seen.push(core.isTauri());
    vi.mocked(core.isTauri).mockReturnValue(true);
    seen.push(core.isTauri());

    expect(seen).toEqual([true, false, true]);
  });

  it("H3: invoke is forwarded to the caller's mock with arguments and return value intact", async () => {
    const invokeMock = vi.fn(async () => ({ sentinel: 91 }));
    const core = await importCoreMockedWith({ invoke: invokeMock });

    await expect(core.invoke("cmd_x", { a: 1 })).resolves.toEqual({ sentinel: 91 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cmd_x", { a: 1 });
  });
});
