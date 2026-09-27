/**
 * WI-0.5 — write-through save-failure UX, plus ADR-0031 step 5b (WI-1) D5/D6.
 *
 * The preferences write-through model previously failed silently on a disk
 * error: many call sites do `void preferencesService.setPreferences(...)`, so a
 * rejected invoke vanished with no user signal. setPreferences must now surface
 * a "Failed to save preferences" toast on failure (and still reject so callers
 * that await can react).
 *
 * 5b adds the redaction law (matrix `tests-20260927-031000.md` D5/D6): every
 * rejection gives exactly one toast with the exact copy, exactly one
 * `ui.preferences.save` fail entry whose context is `{ reason: "invoke_rejected" }`,
 * a rethrow of the SAME value, and no rejection text in any log payload of the
 * row. Success is silent. The Tauri branch is selected with the `isTauri` spy
 * from `tests/support/tauriCoreMock.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
import { preferencesService } from "../src/services/preferencesService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import { makePreferences } from "./support/preferenceFixtures";

const TOAST = "Failed to save preferences";

type Payload = { event: string; status: string; context?: Record<string, unknown> } & Record<string, unknown>;

function logPayloads(): Payload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: Payload }).payload);
}

function recordToastEmissions(): { emissions: string[]; stop: () => void } {
  const emissions: string[] = [];
  const stop = useToastStore.subscribe((s) => {
    if (s.message !== null) emissions.push(s.message);
  });
  return { emissions, stop };
}

function enableDebugLogging(): void {
  useLoggingStore.setState({ enabled: true, level: "debug" });
  expect(useLoggingStore.getState()).toMatchObject({ enabled: true, level: "debug" });
}

describe("preferencesService.setPreferences — write-through failure UX", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ message: null });
    // Force the Tauri code path: `isTauri()` is read at call time.
    vi.mocked(isTauri).mockReturnValue(true);
  });

  it("shows a 'Failed to save preferences' toast when the backend rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      preferencesService.setPreferences({ showSidebar: false }),
    ).rejects.toThrow();
    expect(useToastStore.getState().message).toMatch(/failed to save preferences/i);
  });

  it("does not toast on a successful save", async () => {
    invokeMock.mockResolvedValueOnce({ showSidebar: false });
    await preferencesService.setPreferences({ showSidebar: false });
    expect(useToastStore.getState().message).toBeNull();
  });

  it("re-rejects so awaiting callers can still handle the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("EACCES"));
    await expect(
      preferencesService.setPreferences({ showSidebar: true }),
    ).rejects.toThrow(/EACCES/);
  });

  it("D5: every rejection shape — same value rethrown, one exact toast, enum-only logs across the row", async () => {
    enableDebugLogging();
    const shapes: unknown[] = [
      new Error("disk full at /Users/x/.mdpro/config.json"),
      "EACCES /Users/x/.mdpro/config.json",
      { ParseError: { message: "key must be a string at line 1 column 3 /Users/x" } },
    ];
    expect(shapes).toHaveLength(3);

    for (const shape of shapes) {
      invokeMock.mockReset();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "set_preferences") throw shape;
        return null;
      });
      useToastStore.getState().clearToast();
      const { emissions, stop } = recordToastEmissions();

      let caught: unknown = "not rejected";
      try {
        await preferencesService.setPreferences({ showSidebar: false });
      } catch (error) {
        caught = error;
      }
      stop();

      expect(caught).toBe(shape);
      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toBe(TOAST);

      const all = logPayloads();
      const fails = all.filter((p) => p.event === "ui.preferences.save" && p.status === "fail");
      expect(fails).toHaveLength(1);
      expect(fails[0].context).toEqual({ reason: "invoke_rejected" });
      expect(fails[0]).not.toHaveProperty("error");

      expect(all.length).toBeGreaterThanOrEqual(1);
      const row = JSON.stringify(all);
      for (const forbidden of ["disk full", "EACCES", "line 1", "/Users", "message"]) {
        expect(row).not.toContain(forbidden);
      }
    }
  });

  it("D6: success is silent — no toast, no ui.preferences payload, no fail payload", async () => {
    enableDebugLogging();
    const reply = makePreferences({ showSidebar: false });
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "set_preferences" ? reply : null));
    const { emissions, stop } = recordToastEmissions();

    const result = await preferencesService.setPreferences({ showSidebar: false });
    stop();

    expect(result).toEqual(reply);
    expect(emissions).toHaveLength(0);
    const all = logPayloads();
    expect(all.filter((p) => p.event.startsWith("ui.preferences"))).toHaveLength(0);
    expect(all.filter((p) => p.status === "fail")).toHaveLength(0);
  });
});
