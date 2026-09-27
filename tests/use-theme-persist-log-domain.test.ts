/**
 * ADR-0031 step 5b (WI-1) — `useTheme#setThemeMode` failure log, closed domain.
 *
 * Matrix `.claude/tdd-guardian/tests-20260927-031000.md` T2. Law: on every
 * persist failure the `ui.theme.persist` context has exactly the keys
 * `{requestedMode, previousMode, reason}`, the modes are in {light, dark, system},
 * `reason === "invoke_rejected"`, and no substring of the rejection appears in
 * any log payload of the row. Enumerated over the 6 ordered mode pairs × 3
 * rejection shapes Tauri can deliver (18 rows).
 *
 * Sibling of `use-theme-apply-and-persist.test.ts` (already over 300 lines), which
 * holds T1. The recorder there only fails with `Error`s, so this file routes
 * `invoke` itself to also reject with a string and a serialized-enum object.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { isTauri } from "@tauri-apps/api/core";
import { useTheme } from "../src/hooks/useTheme";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useThemeStore, type ThemeMode } from "../src/stores/themeStore";
import { useToastStore } from "../src/stores/toastStore";
import type { LogEntryPayload } from "../src/types/logging";

const MODES: ThemeMode[] = ["light", "dark", "system"];
const SHAPES: unknown[] = [
  new Error("disk full at /Users/x/.mdpro/config.json"),
  "EACCES /Users/x/.mdpro/config.json",
  { ParseError: { message: "key must be a string at line 1 column 3 /Users/x" } },
];
const FORBIDDEN = ["disk full", "EACCES", "line 1", "/Users", "message"];
const ALLOWED_VALUES = new Set(["light", "dark", "system", "invoke_rejected"]);

function logPayloads(): LogEntryPayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogEntryPayload }).payload);
}

const tick = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useToastStore.getState().clearToast();
});

describe("useTheme — T2: persist-failure log context is a closed enum domain", () => {
  it("T2: every (previous, next) pair × rejection shape logs enum-only context, one exact toast", async () => {
    expect(useLoggingStore.getState()).toMatchObject({ enabled: true, level: "debug" });
    const rows: Array<{ previous: ThemeMode; next: ThemeMode; shape: unknown }> = [];
    for (const previous of MODES) {
      for (const next of MODES) {
        if (previous === next) continue;
        for (const shape of SHAPES) rows.push({ previous, next, shape });
      }
    }
    expect(rows).toHaveLength(18);

    const { result, unmount } = renderHook(() => useTheme());
    try {
      for (const { previous, next, shape } of rows) {
        useThemeStore.setState({ mode: previous, resolvedTheme: "light", activeTheme: null });
        await tick();
        invokeMock.mockReset();
        invokeMock.mockImplementation(async (cmd: string) => {
          if (cmd === "set_preferences") throw shape;
          if (cmd === "get_system_theme") return "light";
          return null;
        });
        useToastStore.getState().clearToast();
        const emissions: string[] = [];
        const stop = useToastStore.subscribe((s) => {
          if (s.message !== null) emissions.push(s.message);
        });

        await act(async () => {
          await result.current.setThemeMode(next);
        });
        await tick();
        stop();

        const all = logPayloads();
        const fails = all.filter((p) => p.event === "ui.theme.persist" && p.status === "fail");
        expect(fails).toHaveLength(1);
        const context = fails[0].context as Record<string, unknown>;
        expect(Object.keys(context).sort()).toEqual(["previousMode", "reason", "requestedMode"]);
        expect(context.requestedMode).toBe(next);
        expect(context.previousMode).toBe(previous);
        expect(context.reason).toBe("invoke_rejected");
        for (const value of Object.values(context)) {
          expect(ALLOWED_VALUES.has(String(value))).toBe(true);
        }

        const row = JSON.stringify(all);
        for (const forbidden of FORBIDDEN) expect(row).not.toContain(forbidden);

        expect(emissions).toEqual(["Failed to save preferences"]);
      }
    } finally {
      unmount();
      useToastStore.getState().clearToast();
      useThemeStore.setState({ mode: "system", resolvedTheme: "light", activeTheme: null });
    }
  });
});
