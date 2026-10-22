// @vitest-environment node
/**
 * WI-2 — loggingService.hydrateSettings()
 *
 * Why this unit exists: `hydrateSettings()` reads the logging preference through
 * `getLoggingSettings()` -> `safeInvoke` -> `invoke("get_logging_settings")`, a
 * fail-closed path that never rejects. It was introduced while
 * `preferencesService` used a `withGlobalTauri` global as its detector, which
 * the shipping app never has (D24); ADR-0031 step 5b replaced that detector with
 * `isTauri()`, and WI-2-C now pins that both paths reach Rust.
 *
 * Mode: WI-2-A/B/D/E/F/G exercise `loggingService` alone, which never consults
 * `isTauri`; `beforeEach` sets the spy false anyway so the default is explicit.
 *
 * Mock policy: `@tauri-apps/api/core` ONLY. The real `useLoggingStore` is used
 * throughout — mocking the store would make every case assert its own mock
 * (rule 10 anti-pattern), and the store write IS the behavior under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
import type { LogLevel, LogSettings } from "../src/types/logging";
import { loggingService } from "../src/services/loggingService";
import { preferencesService } from "../src/services/preferencesService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { makePreferences } from "./support/preferenceFixtures";
import { collectionCases } from "./support/collectionCases";

const ALL_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** The full 8-value backend domain: {enabled} x {level}. Exhaustive beats sampling here. */
const ALL_SETTINGS: LogSettings[] = [true, false].flatMap((enabled) =>
  ALL_LEVELS.map((level) => ({ enabled, level })),
);

const nextLevel = (level: LogLevel): LogLevel =>
  ALL_LEVELS[(ALL_LEVELS.indexOf(level) + 1) % ALL_LEVELS.length];

/**
 * MANDATORY SENTINEL: seed the store to a value differing from the expected end
 * state in BOTH fields. The store's initial `enabled` is `true`, so any case
 * that skips this would pass vacuously against an empty no-op implementation.
 * Seeded per-row in the test body (not beforeEach) because it depends on the row.
 */
const seedSentinelFor = (v: LogSettings) => {
  useLoggingStore.setState({ enabled: !v.enabled, level: nextLevel(v.level) });
};

const readStore = () => {
  const { enabled, level } = useLoggingStore.getState();
  return { enabled, level };
};

const callsFor = (command: string) =>
  invokeMock.mock.calls.filter((call) => call[0] === command);

beforeEach(() => {
  // mockReset (not just clearMocks) so a persistent mockResolvedValue from the
  // idempotence case cannot leak an implementation into a later test.
  invokeMock.mockReset();
  vi.mocked(isTauri).mockReturnValue(false);
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("WI-2-A — applies every backend response verbatim", () => {
  it.each(collectionCases("tests/logging-hydrate-settings.test.ts:71", ALL_SETTINGS))(
    "hydrates enabled=$enabled level=$level into both the return value and the store",
    async (v) => {
      seedSentinelFor(v);
      invokeMock.mockResolvedValueOnce(v);

      const returned = await loggingService.hydrateSettings();

      // Level 1 (return value) and Level 2 (store state) are BOTH required.
      // Level 1 alone passes an implementation that computes correctly and never
      // writes; Level 2 alone passes one that writes and returns undefined.
      expect(returned).toEqual(v);
      expect(readStore()).toEqual({ enabled: v.enabled, level: v.level });
    },
  );
});

describe("WI-2-B — user opt-out survives hydration", () => {
  /**
   * Named regression case. Deliberately redundant with WI-2-A; it is the durable
   * commented record of the reported bug.
   *
   * What it pins: the backend value is applied VERBATIM rather than forced to
   * `enabled: true`. The `enabled: false` row is the load-bearing part — a user
   * who turned logging off must stay off after hydration. It also applies a
   * `level` the old broken path could never produce (`"warn"`, vs. the
   * browser-mode constant's `"info"`).
   *
   * What it does NOT do: it has zero coupling to the `App.tsx` call site. If
   * someone reverts the call to `hydrateSettings()` during startup, this test
   * still passes. Detecting that is not this case's job.
   */
  it("keeps enabled:false from the backend instead of forcing it true", async () => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockResolvedValueOnce({ enabled: false, level: "warn" });

    await loggingService.hydrateSettings();

    expect(readStore()).toEqual({ enabled: false, level: "warn" });
  });
});

describe("WI-2-C — real-desktop shape: both paths reach Rust", () => {
  /**
   * SPEC CHANGE (ADR-0031 step 5b, RB-X item 2). This case used to pin D24:
   * with `withGlobalTauri` off, the detector-gated `preferencesService` stayed in
   * browser mode. With `isTauri()` as the detector, the shipping shape
   * (`isTauri()` true) sends `getPreferences` to `get_preferences`, and
   * `hydrateSettings` still reaches `get_logging_settings`.
   *
   * Honest limitation: `invoke` and `isTauri` are mocked, so this does NOT prove
   * the WebView carries the marker — that is the ADR-0032 GUI run.
   */
  it("with isTauri() true, getPreferences reaches get_preferences and hydrateSettings reaches get_logging_settings", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    useLoggingStore.setState({ enabled: false, level: "error" });
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "get_logging_settings" ? { enabled: true, level: "debug" } : makePreferences(),
    );

    await preferencesService.getPreferences("app_hydrate");
    await loggingService.hydrateSettings();

    expect(callsFor("get_preferences")).toHaveLength(1);
    expect(callsFor("get_logging_settings")).toHaveLength(1);
    expect(readStore()).toEqual({ enabled: true, level: "debug" });
  });
});

describe("WI-2-D — IPC failure fails closed without rejecting", () => {
  // AMENDED. This block previously pinned a fail-OPEN fallback of
  // `{ enabled: true, level: "info" }`. That specification was wrong, and it is
  // recorded here rather than quietly rewritten:
  //
  //   1. It contradicted the guarantee written at CHANGELOG.md:37 by the very
  //      same change — "a user who explicitly turned logging off stays off".
  //      An IPC failure silently switched that user's logging back on.
  //   2. It was undetectable in practice, because the asserted value was
  //      byte-identical to `useLoggingStore`'s initial state. The assertion
  //      could not distinguish "the fallback was applied" from "nothing
  //      happened at all" — so the bug could not have shown up as a red test.
  //
  // What did NOT change: the `.resolves` shape. Non-rejection is the property
  // App.tsx#loadPreferences depends on, and only the asserted value moves.
  it("resolves to the disabled fallback when invoke throws", async () => {
    // Seed differs from the fail-closed value in BOTH fields. The old seed
    // (`{ enabled: false, level: "error" }`) already carried `enabled: false`,
    // so against the new expectation an implementation that writes only `level`
    // and never touches `enabled` would have passed vacuously.
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockRejectedValueOnce(new Error("ipc bridge unavailable"));

    // `.resolves` rather than a bare await: asserting NON-REJECTION explicitly is
    // the property WI-3 depends on to keep the rest of loadPreferences running.
    await expect(loggingService.hydrateSettings()).resolves.toEqual({
      enabled: false,
      level: "info",
    });

    expect(readStore()).toEqual({ enabled: false, level: "info" });
  });
});

describe("WI-2-E — hydration is idempotent", () => {
  it.each(collectionCases("tests/logging-hydrate-settings.test.ts:175", ALL_SETTINGS))(
    "a second hydrate of enabled=$enabled level=$level changes nothing",
    async (v) => {
      seedSentinelFor(v);
      invokeMock.mockResolvedValue(v); // persistent, not Once — both calls resolve

      await loggingService.hydrateSettings();
      const afterFirst = readStore();

      await loggingService.hydrateSettings();
      const afterSecond = readStore();

      // Asserting equality with BOTH the snapshot and `v` prevents the degenerate
      // pass where both calls are no-ops and the two snapshots merely agree.
      expect(afterSecond).toEqual(afterFirst);
      expect(afterSecond).toEqual({ enabled: v.enabled, level: v.level });
    },
  );
});

describe("WI-2-F — hydration governs actual log emission", () => {
  /**
   * The most valuable case here. Every other case asserts store state, which is
   * only a proxy for the fix. This one runs the real `shouldLog` against the real
   * store with nothing mocked between hydration and the observable, so it asserts
   * the actual reported symptom: do frontend log records flow? It defeats an
   * implementation that writes a correct value into a store nobody reads.
   *
   * Assertions filter by command string because hydration itself legitimately
   * calls `invoke("get_logging_settings", {})` — a bare "was invoke called"
   * assertion would be wrong. `logEventSync` is fire-and-forget (`void
   * safeInvoke(...)`), but `invoke` is still reached synchronously before the
   * first await, so no timer flush is needed.
   */
  it("enables emission when the backend turns logging on", async () => {
    useLoggingStore.setState({ enabled: false, level: "error" });
    invokeMock.mockResolvedValueOnce({ enabled: true, level: "info" });

    await loggingService.hydrateSettings();
    loggingService.logEventSync({
      level: "info",
      event: "ui.button.click",
      status: "success",
      actionId: "a1",
    });

    const logCalls = callsFor("log_event");
    expect(logCalls).toHaveLength(1);
    expect((logCalls[0][1] as { payload: { event: string } }).payload.event).toBe(
      "ui.button.click",
    );
  });

  it("suppresses emission when the backend turns logging off", async () => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockResolvedValueOnce({ enabled: false, level: "warn" });

    await loggingService.hydrateSettings();
    loggingService.logEventSync({
      level: "info",
      event: "ui.button.click",
      status: "success",
      actionId: "a1",
    });

    expect(callsFor("log_event")).toHaveLength(0);
  });
});

describe("WI-2-G — callable when destructured off the service object", () => {
  it("resolves normally with `this` undefined", async () => {
    const { hydrateSettings } = loggingService;
    const expected: LogSettings = { enabled: false, level: "warn" };
    seedSentinelFor(expected);
    invokeMock.mockResolvedValueOnce(expected);

    // A `this`-dependent implementation throws TypeError here.
    await expect(hydrateSettings()).resolves.toEqual(expected);
    expect(readStore()).toEqual({ enabled: false, level: "warn" });
  });
});

describe("D293 — logging read generation", () => {
  it("applies a fresh read started after a confirmed write", async () => {
    const saved: LogSettings = { enabled: true, level: "debug" };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "set_logging_settings") return saved;
      if (command === "get_logging_settings") return saved;
      return undefined;
    });

    await loggingService.setLoggingSettings(saved);
    useLoggingStore.setState({ enabled: false, level: "warn" });
    await loggingService.hydrateSettings();
    expect(readStore()).toEqual(saved);
  });

  it("records one enum-only cancellation when a confirmed write supersedes a read", async () => {
    const old: LogSettings = { enabled: false, level: "info" };
    const saved: LogSettings = { enabled: true, level: "info" };
    let releaseRead: () => void = () => {};
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_logging_settings") {
        return new Promise((resolve) => { releaseRead = () => resolve(old); });
      }
      if (command === "set_logging_settings") return Promise.resolve(saved);
      return Promise.resolve(undefined);
    });

    const pending = loggingService.hydrateSettings();
    await loggingService.setLoggingSettings(saved);
    useLoggingStore.setState(saved);
    releaseRead();
    await pending;
    expect(readStore()).toEqual(saved);
    const events = callsFor("log_event");
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ payload: {
      event: "ui.logging.settings.hydrate",
      status: "cancel",
      context: { reason: "confirmed_write_since_read" },
    } });
    expect(Object.keys((events[0][1] as { payload: { context: object } }).payload.context)).toEqual(["reason"]);
  });
});
