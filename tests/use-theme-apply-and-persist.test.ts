/**
 * WI-3 + WI-4 — `src/hooks/useTheme.ts`: apply-only hydration, and a
 * persistence failure that is surfaced rather than swallowed.
 *
 * Source plan:   `.claude/tdd-guardian/plan-20260923-preference-write-path.md`
 * Test matrix:   `.claude/tdd-guardian/tests-20260923-preference-write-path.md`
 *                (cases WI3-A/B/C, WI4-A … WI4-G)
 *
 * ── Branch selection (ADR-0031 step 5b) ──────────────────────────────────────
 *
 * `preferencesService` picks its branch with `isTauri()` from
 * `@tauri-apps/api/core`, read on every call; the shipping app takes the Tauri
 * branch. Every case below sets the `isTauri` spy (`tests/support/tauriCoreMock.ts`)
 * to `true`, so the REAL service reaches the recorder's `invoke`. The real
 * WebView marker is proven only by the ADR-0032 GUI run.
 *
 * The mock boundary is exactly two modules: `@tauri-apps/api/core#invoke` (the
 * shared recorder from `tests/support/preferenceRecorder.ts`) and
 * `@tauri-apps/api/event#listen`, the latter a REAL in-memory bus copied from
 * `tests/use-theme-listener-cancellation.test.ts:34-95` rather than a `vi.fn()`.
 * `preferencesService`, `themeStore`, `toastStore`, `loggingService` and
 * `loggingStore` are all first-party and REAL, so every assertion lands on
 * store state or on payloads that crossed the boundary — never on a call record
 * of a doubled collaborator. There is no `integration` lane in this repo and the
 * real transport is unreachable, so the paired real-path obligation is recorded
 * as unmet and discharged by the detector-flip work item (matrix § 0.6).
 *
 * ── The two laws ─────────────────────────────────────────────────────────────
 *
 * Law 1 (write-freedom of apply). For any sequence of `applyThemeMode` calls the
 *   store's `mode` equals the last applied value AND the number of
 *   `set_preferences` payloads carrying a `themeMode` key is zero. Idempotence
 *   is the `m, m` instance of the same law.
 *
 * Law 2 (rollback conservation). After any sequence of `setThemeMode` calls the
 *   store's `mode` equals the value of the last SUCCESSFUL call, or the seed if
 *   none succeeded. A failed write moves nothing — including when it settles
 *   late, after a newer call has already succeeded (WI4-G).
 *
 * ── The two-window clobber is closed BY CONSTRUCTION, not by a harness ───────
 *
 * The defect WI-3 exists for is: window B reads the old mode, window A writes a
 * new one, then B's hydration writes the old one back — last-writer-wins over a
 * choice the user just made. The fix removes the write from hydration entirely.
 * Once hydration issues no `set_preferences` payload at all, NO interleaving of
 * two hydrations can overwrite anything, because there is nothing to interleave.
 * WI3-A is therefore the whole proof: the reduction from "two windows cannot
 * clobber" to "hydration writes nothing" is sound, and a two-window harness
 * would add a Tauri runtime this repo has no lane for while proving strictly
 * less. Real multi-window behaviour is covered by the manual QA step recorded in
 * the WI-3 completion note, which is NOT equivalent and is not claimed to be.
 *
 * ── NOTE (rule 60 rubric): WI-4's rollback is a VISIBLE BEHAVIOUR CHANGE ─────
 *
 * A failed write now flips the theme back under the user. That is deliberate and
 * matches the sibling settings panels (`ExportSettings.tsx:37-39`,
 * `ImageSettings.tsx:58-61`). The alternative — log and keep the applied theme —
 * leaves the user looking at a setting that silently did not persist.
 *
 * WI-4 adds NO second toast. `preferencesService.setPreferences` already raises
 * "Failed to save preferences" (`preferencesService.ts:78`) and rule 30 §5
 * permits one signal per surface per event; WI4-C counts toast-store
 * *transitions* precisely so a duplicated identical toast is detectable at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { LogEntryPayload } from "../src/types/logging";
import type { RecordedCall } from "./support/preferenceRecorder";
import { createRecorder } from "./support/preferenceRecorder";
import { makePreferences } from "./support/preferenceFixtures";

// ---------------------------------------------------------------------------
// Boundary 1 — @tauri-apps/api/core#invoke, routed to the shared recorder.
// The holder indirection exists because `vi.mock` is hoisted above the
// `beforeEach` that builds a fresh recorder per case.
// ---------------------------------------------------------------------------
const { invokeHolder } = vi.hoisted(() => ({
  invokeHolder: {
    fn: null as null | ((cmd: string, args?: unknown) => Promise<unknown>),
  },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: unknown) => {
    if (!invokeHolder.fn) {
      return Promise.reject(new Error(`no recorder installed for invoke("${cmd}")`));
    }
    return invokeHolder.fn(cmd, args);
  },
}));

// ---------------------------------------------------------------------------
// Boundary 2 — @tauri-apps/api/event#listen, a REAL in-memory bus.
// Shape copied from tests/use-theme-listener-cancellation.test.ts:34-95. A
// `vi.fn()` here would let a hook that registers and never removes pass.
// ---------------------------------------------------------------------------
const { bus } = vi.hoisted(() => {
  type BusHandler = (event: { payload: unknown }) => void;
  const state = {
    handlers: new Map<string, Set<BusHandler>>(),
    subscribeCount: 0,
  };
  return {
    bus: {
      state,
      count(evt: string): number {
        return state.handlers.get(evt)?.size ?? 0;
      },
      listen(evt: string, handler: BusHandler): Promise<() => void> {
        state.subscribeCount += 1;
        return Promise.resolve().then(() => {
          const set = state.handlers.get(evt) ?? new Set<BusHandler>();
          set.add(handler);
          state.handlers.set(evt, set);
          return () => {
            set.delete(handler);
          };
        });
      },
      reset(): void {
        state.handlers.clear();
        state.subscribeCount = 0;
      },
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (evt: string, handler: (event: { payload: unknown }) => void) =>
    bus.listen(evt, handler),
}));

import { isTauri } from "@tauri-apps/api/core";
import { useTheme } from "../src/hooks/useTheme";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useThemeStore } from "../src/stores/themeStore";
import type { ThemeMode } from "../src/stores/themeStore";
import { useToastStore } from "../src/stores/toastStore";
import { collectionCases } from "./support/collectionCases";

const MODES: ThemeMode[] = ["light", "dark", "system"];

let recorder: ReturnType<typeof createRecorder>;

/** Flush React effects plus the microtask queue the boundary's `.then()` rides on. */
const tick = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Node surfaces unhandled rejections on a macrotask turn, not a microtask one. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The `{ preferences: … }` object a recorded `set_preferences` call carried. */
function writtenPreferences(call: RecordedCall): Record<string, unknown> {
  const args = call.args as { preferences?: Record<string, unknown> } | null | undefined;
  return args?.preferences ?? {};
}

/** Every recorded payload carrying a `themeMode` key — the WI-3 oracle. */
function themeModeWrites(): Record<string, unknown>[] {
  return recorder.calls
    .filter((call) => call.cmd === "set_preferences")
    .map(writtenPreferences)
    .filter((preferences) => "themeMode" in preferences);
}

/** Fail log entries this hook owns: `ui.*`, but not the service's own entry. */
function hookFailLogs(): LogEntryPayload[] {
  return recorder
    .logs()
    .filter(
      (entry) =>
        entry.status === "fail" &&
        /^ui\./.test(entry.event) &&
        entry.event !== "ui.preferences.save",
    );
}

function serviceFailLogs(): LogEntryPayload[] {
  return recorder
    .logs()
    .filter((entry) => entry.status === "fail" && entry.event === "ui.preferences.save");
}

/**
 * Collect every toast-store emission (matrix WI4-C — the recorder shape is part
 * of the specification). Deliberately NOT de-duplicated against the previous
 * message: two identical "Failed to save preferences" toasts are the likeliest
 * way anyone ships a duplicate, and a `s.message !== prev.message` guard would
 * record them as one, making the defect invisible.
 */
function recordToastEmissions(): { emissions: string[]; stop: () => void } {
  const emissions: string[] = [];
  const stop = useToastStore.subscribe((s) => {
    if (s.message !== null) emissions.push(s.message);
  });
  return { emissions, stop };
}

const mount = () => renderHook(() => useTheme());

const seed = (mode: ThemeMode, resolvedTheme: "light" | "dark" = "light") => {
  useThemeStore.setState({ mode, resolvedTheme, activeTheme: null });
};

beforeEach(() => {
  bus.reset();
  recorder = createRecorder(makePreferences());
  invokeHolder.fn = recorder.invoke;
  // Deterministic third union arm: `applyThemeMode("system")` resolves through
  // `preferencesService.getSystemTheme()`, which under the Tauri branch is an
  // `invoke("get_system_theme")`. Unstubbed, the recorder would reject it
  // (property 3) and `useTheme`'s catch would set "light" — making every
  // system-mode baseline accidental rather than chosen.
  recorder.set("get_system_theme", "light");
  // D238: every mode change also sets the native appearance; stubbed so the
  // recorder does not reject it (property 3) and add a native-appearance fail log.
  recorder.set("plugin:app|set_app_theme", null);
  // jsdom has no matchMedia; only reachable if `isTauri()` somehow reads false.
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  // Force the Tauri branch of the REAL preferencesService (matrix § 0, plan
  // framing 2). Without this every case would run the browser branch, record
  // zero boundary calls, and go vacuously green.
  vi.mocked(isTauri).mockReturnValue(true);
  // MANDATORY precondition for WI4-D: `loggingService.shouldLog` drops
  // everything when the store is disabled, and that case would pass vacuously.
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useToastStore.getState().clearToast();
  seed("light");
});

afterEach(() => {
  invokeHolder.fn = null;
  // `showToast` arms a real 3000 ms timer (`toastStore.ts:14`); clear it so no
  // stray timer leaks into a later file (matrix WI4-C harness note).
  useToastStore.getState().clearToast();
  useThemeStore.setState({ mode: "system", resolvedTheme: "light", activeTheme: null });
});

describe("useTheme — WI-3: hydration applies the theme without persisting it", () => {
  it.each(MODES)(
    "WI3-A: applyThemeMode(%s) applies the mode and writes nothing",
    async (mode) => {
      seed(mode === "light" ? "dark" : "light");
      const { result } = mount();
      await tick();

      await act(async () => {
        result.current.applyThemeMode(mode);
      });
      await tick();

      expect(useThemeStore.getState().mode).toBe(mode);
      expect(themeModeWrites()).toEqual([]);
    },
  );

  it.each(
    collectionCases("tests/use-theme-apply-and-persist.test.ts:264", MODES.flatMap((first) =>
      MODES.map((second) => [first, second, first === second] as const),
    )),
  )(
    "WI3-A: applyThemeMode(%s) then (%s) ends at the last applied value and writes nothing (idempotence row: %s)",
    async (first, second, isIdempotenceRow) => {
      seed(first === "light" ? "dark" : "light");
      const { result } = mount();
      await tick();

      await act(async () => {
        result.current.applyThemeMode(first);
      });
      await tick();
      const afterFirst = { ...useThemeStore.getState() };

      await act(async () => {
        result.current.applyThemeMode(second);
      });
      await tick();
      const afterSecond = { ...useThemeStore.getState() };

      expect(afterSecond.mode).toBe(second);
      expect(themeModeWrites()).toEqual([]);

      if (isIdempotenceRow) {
        // Idempotence is the `m, m` instance of Law 1: not merely "mode is still
        // m" but "nothing in the store moved at all".
        expect({
          mode: afterSecond.mode,
          resolvedTheme: afterSecond.resolvedTheme,
          activeTheme: afterSecond.activeTheme,
        }).toEqual({
          mode: afterFirst.mode,
          resolvedTheme: afterFirst.resolvedTheme,
          activeTheme: afterFirst.activeTheme,
        });
      }
    },
  );

  it.each(MODES)(
    "WI3-B: positive control — setThemeMode(%s) still issues exactly one themeMode payload",
    async (mode) => {
      // Seed a different mode so a hook that never changes anything cannot pass.
      seed(mode === "dark" ? "light" : "dark");
      const { result } = mount();
      await tick();

      await act(async () => {
        await result.current.setThemeMode(mode);
      });
      await tick();

      const writes = themeModeWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0].themeMode).toBe(mode);
      expect(useThemeStore.getState().mode).toBe(mode);
    },
  );

  it.each(["dark", "light"] as const)(
    "WI3-C: applyThemeMode('system') resolves through get_system_theme (=%s) and still writes nothing",
    async (systemTheme) => {
      recorder.set("get_system_theme", systemTheme);
      // Seed a non-system mode so applying "system" is a real transition.
      seed(systemTheme === "dark" ? "light" : "dark", systemTheme === "dark" ? "light" : "dark");
      const { result } = mount();
      await tick();

      await act(async () => {
        result.current.applyThemeMode("system");
      });
      await tick();

      expect(useThemeStore.getState().mode).toBe("system");
      expect(useThemeStore.getState().resolvedTheme).toBe(systemTheme);
      expect(
        recorder.calls.some((call) => call.cmd === "get_system_theme"),
        "resolution went through the service, not matchMedia",
      ).toBe(true);
      expect(themeModeWrites()).toEqual([]);
    },
  );
});

describe("useTheme — WI-4: a persistence failure is surfaced, not swallowed", () => {
  it("WI4-A: a rejected write rolls the mode back", async () => {
    seed("light");
    const { result } = mount();
    await tick();

    recorder.failCommand("set_preferences", new Error("EACCES"));

    await act(async () => {
      await result.current.setThemeMode("dark");
    });
    await tick();

    expect(useThemeStore.getState().mode).toBe("light");
  });

  it.each([
    ["(i) fail dark -> fail system", [["dark", false], ["system", false]], "light"],
    ["(ii) succeed dark -> fail system", [["dark", true], ["system", false]], "dark"],
    [
      "(iii) fail dark -> succeed system -> fail light",
      [["dark", false], ["system", true], ["light", false]],
      "system",
    ],
    ["(iv) succeed dark -> succeed light", [["dark", true], ["light", true]], "light"],
  ] as Array<[string, Array<[ThemeMode, boolean]>, ThemeMode]>)(
    "WI4-B: rollback conservation — %s ends at the last successful value",
    async (_label, steps, expected) => {
      seed("light");
      const { result } = mount();
      await tick();

      for (const [mode, succeeds] of steps) {
        if (!succeeds) {
          recorder.failNext("set_preferences", new Error(`EACCES:${mode}`));
        }
        await act(async () => {
          await result.current.setThemeMode(mode);
        });
        await tick();
      }

      expect(useThemeStore.getState().mode).toBe(expected);
    },
  );

  it("WI4-G: a late-settling failed write must not discard a newer successful one", async () => {
    seed("light");
    const { result } = mount();
    await tick();

    const { emissions, stop } = recordToastEmissions();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const slow = recorder.defer("set_preferences");

      // Fire-and-forget, exactly as `App.tsx:1019` and `useTheme.ts:66` call it.
      await act(async () => {
        void result.current.setThemeMode("dark");
        await Promise.resolve();
      });

      // A newer call wins the race and settles first.
      await act(async () => {
        await result.current.setThemeMode("system");
      });
      await tick();
      expect(useThemeStore.getState().mode, "the newer write landed").toBe("system");

      // Now the stale one fails. Its rollback target is "light" — the value it
      // captured before `setMode` — and stamping that over "system" is the
      // defect this case exists for.
      await act(async () => {
        slow.reject(new Error("EACCES"));
        await macrotask();
      });
      await tick();

      expect(useThemeStore.getState().mode).toBe("system");
      expect(emissions).toHaveLength(1);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      stop();
    }
  });

  it("WI4-H: a late-settling failure after a NEWER failure must not strand an unpersisted mode", async () => {
    seed("light");
    const { result } = mount();
    await tick();

    const { emissions, stop } = recordToastEmissions();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const slow = recorder.defer("set_preferences");

      await act(async () => {
        void result.current.setThemeMode("dark");
        await Promise.resolve();
      });

      // The newer call also fails, and settles FIRST. WI4-G covers the newer
      // call SUCCEEDING; this is the arm where it does not.
      recorder.failNext("set_preferences", new Error("EACCES newer"));
      await act(async () => {
        await result.current.setThemeMode("system");
      });
      await tick();

      await act(async () => {
        slow.reject(new Error("EACCES older"));
        await macrotask();
      });
      await tick();

      // Law 2: no call succeeded, so the store must sit at the seed. The
      // rollback target cannot be "the store value when this call was made" --
      // for the newer call that was "dark", an OPTIMISTIC value the older call
      // had already written and never persisted. Restoring it leaves the user
      // looking at a theme that is on no disk anywhere, and the older call
      // declines to correct it because a newer intent owns the store.
      expect(useThemeStore.getState().mode).toBe("light");
      expect(emissions).toHaveLength(2);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      stop();
    }
  });

  it("WI4-C: exactly one toast for the event, counted as store emissions", async () => {
    seed("light");
    const { result } = mount();
    await tick();

    const { emissions, stop } = recordToastEmissions();
    try {
      recorder.failCommand("set_preferences", new Error("EACCES"));

      await act(async () => {
        await result.current.setThemeMode("dark");
      });
      await tick();

      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toMatch(/failed to save preferences/i);
    } finally {
      stop();
    }
  });

  // SPEC CHANGE (ADR-0031 step 5b, matrix T1 / RB-X item 3): WI4-D used to pin
  // the error text INTO the context. Once the flip makes this path reachable in
  // the shipping app, that text is a path leak, so the context is enum-only.
  it("WI4-D (T1): exactly one hook-owned ui.* fail log, carrying enums and not the error text", async () => {
    // Precondition asserted explicitly — a disabled logging store would make
    // every assertion below vacuously true.
    expect(useLoggingStore.getState().enabled).toBe(true);

    seed("light");
    const { result } = mount();
    await tick();

    recorder.failCommand("set_preferences", new Error("EACCES /Users/x/.mdpro/config.json"));

    await act(async () => {
      await result.current.setThemeMode("dark");
    });
    await tick();

    const hookLogs = hookFailLogs();
    expect(hookLogs).toHaveLength(1);
    expect(hookLogs[0].context).toEqual({
      requestedMode: "dark",
      previousMode: "light",
      reason: "invoke_rejected",
    });

    // The service's own entry is still emitted exactly once, unduplicated.
    expect(serviceFailLogs()).toHaveLength(1);

    // Whole row: every log_event payload recorded in this case.
    const row = JSON.stringify(recorder.logs());
    expect(row).not.toContain("EACCES");
    expect(row).not.toContain("/Users");
  });

  it.each(["void setThemeMode", "cycleThemeMode"] as const)(
    "WI4-E: %s produces no unhandled rejection on the failure path",
    async (caller) => {
      seed("light");
      const { result } = mount();
      await tick();

      const rejections: unknown[] = [];
      const onUnhandled = (reason: unknown) => rejections.push(reason);
      process.on("unhandledRejection", onUnhandled);

      try {
        recorder.failCommand("set_preferences", new Error("EACCES"));

        await act(async () => {
          if (caller === "void setThemeMode") {
            void result.current.setThemeMode("dark");
          } else {
            result.current.cycleThemeMode();
          }
          await macrotask();
        });
        await tick();
        await macrotask();

        expect(rejections).toEqual([]);

        // Positive control: the listener must be wired, otherwise the assertion
        // above is satisfied by a test that could never observe anything.
        const control = Promise.reject(new Error("control"));
        await macrotask();
        expect(
          rejections.map((r) => (r instanceof Error ? r.message : String(r))),
          "the listener does catch a genuinely unhandled rejection",
        ).toEqual(["control"]);
        // Settle it so the runner's own reporter does not also claim it.
        control.catch(() => undefined);
        await macrotask();
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  it("WI4-F: success negative control — no toast, no fail log, mode stays", async () => {
    seed("light");
    const { result } = mount();
    await tick();

    const { emissions, stop } = recordToastEmissions();
    try {
      await act(async () => {
        await result.current.setThemeMode("dark");
      });
      await tick();

      expect(useThemeStore.getState().mode).toBe("dark");
      expect(emissions).toEqual([]);
      expect(recorder.logs().filter((entry) => entry.status === "fail")).toEqual([]);
    } finally {
      stop();
    }
  });
});
