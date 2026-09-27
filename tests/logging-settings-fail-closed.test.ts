/**
 * WI-3 — loggingService.getLoggingSettings() / hydrateSettings() must FAIL CLOSED.
 *
 * Defect 2: the fallback used when `safeInvoke` swallows an IPC error was
 * `{ enabled: true, level: "info" }`. That silently re-enables logging for a
 * user who turned it off (contradicting the guarantee at CHANGELOG.md:37) and
 * is undetectable in practice because the value is byte-identical to
 * `useLoggingStore`'s initial state. The fallback must be
 * `{ enabled: false, level: "info" }` — only the field that carries a safety
 * meaning flips.
 *
 * Fresh installs are unaffected: `load_preferences`
 * (src-tauri/src/services/preferences.rs:62-77) creates config.json with
 * defaults and returns `Ok` when the file is absent, so a first launch reaches
 * `enabled: true` through the SUCCESS path. An `Err` means config.json is
 * genuinely unreadable or unparseable.
 *
 * Mock policy / paired real-path coverage: `@tauri-apps/api/core` ONLY — the
 * Tauri IPC bridge is a genuine process boundary and is on rule 10's mock
 * allow-list. The real `useLoggingStore` is used throughout; mocking the store
 * would make every case assert its own mock, and the store write IS the
 * behavior under test. The real backend path is covered by the `rust` lane
 * (WI-1's `apply_logging_settings` round-trip cases) and the cross-language
 * wire format is pinned by
 * `src-tauri/src/models/log_entry.rs::log_level_wire_format_matches_typescript_loglevel_union`.
 * RESIDUAL GAP, stated honestly: nothing automated spans the Tauri channel
 * itself — that is manual QA, and no lane in this repo can close it.
 *
 * LOAD-BEARING CONSTRAINT: every fail-closed assertion below spells out the
 * literal `{ enabled: false, level: "info" }`. It must NEVER import the
 * production fallback constant — doing so would make the assertion compare the
 * implementation against itself and pass for any value the constant is later
 * changed to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import type { LogLevel, LogSettings } from "../src/types/logging";
import { loggingService } from "../src/services/loggingService";
import { useLoggingStore } from "../src/stores/loggingStore";

const ALL_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** The full 8-value backend success domain: {enabled} x {level}. */
const ALL_SETTINGS: LogSettings[] = [true, false].flatMap((enabled) =>
  ALL_LEVELS.map((level) => ({ enabled, level })),
);

const nextLevel = (level: LogLevel): LogLevel =>
  ALL_LEVELS[(ALL_LEVELS.indexOf(level) + 1) % ALL_LEVELS.length];

const readStore = (): LogSettings => {
  const { enabled, level } = useLoggingStore.getState();
  return { enabled, level };
};

/**
 * MANDATORY SENTINEL: seed the store to a value differing from the expected end
 * state in BOTH fields, so neither "do nothing" nor "half-write" can pass
 * vacuously. Seeded per row (not in `beforeEach`) because it depends on the row.
 */
const seedSentinelFor = (expected: LogSettings) => {
  useLoggingStore.setState({ enabled: !expected.enabled, level: nextLevel(expected.level) });
};

const callsFor = (command: string) => invokeMock.mock.calls.filter((call) => call[0] === command);

beforeEach(() => {
  // `mockReset()`, NOT `clearMocks`: a persistent `mockResolvedValue` left by an
  // earlier row must not leak forward and silently satisfy a later one.
  invokeMock.mockReset();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("F1: totality — every invoke outcome resolves, and the store equals the returned value", () => {
  type Row = { name: string; arrange: () => void; expected: LogSettings };

  const resolveRows: Row[] = ALL_SETTINGS.map((settings) => ({
    name: `resolves { enabled: ${settings.enabled}, level: "${settings.level}" } -> applied verbatim`,
    arrange: () => invokeMock.mockResolvedValueOnce(settings),
    expected: settings,
  }));

  const degenerateRows: Row[] = [
    {
      name: 'resolves null -> fails closed',
      arrange: () => invokeMock.mockResolvedValueOnce(null),
      expected: { enabled: false, level: "info" },
    },
    {
      name: 'resolves undefined -> fails closed',
      arrange: () => invokeMock.mockResolvedValueOnce(undefined),
      expected: { enabled: false, level: "info" },
    },
    {
      // Message deliberately avoids the phrase "command not found" (the matrix's
      // suggested wording): the tdd-guardian receipt CLI regex-scans lane output
      // for that phrase and would misclassify this genuine assertion failure as a
      // broken runner. The rejection *reason* is not load-bearing here — F1's
      // equivalence class is "rejected, for any reason".
      name: 'rejects with an Error -> fails closed',
      arrange: () => invokeMock.mockRejectedValueOnce(new Error("ipc bridge unavailable")),
      expected: { enabled: false, level: "info" },
    },
    {
      // A BARE STRING is the shape Tauri actually rejects with; an
      // `instanceof Error` guard would miss it.
      name: 'rejects with a bare string -> fails closed',
      arrange: () => invokeMock.mockRejectedValueOnce("get_logging_settings not allowed"),
      expected: { enabled: false, level: "info" },
    },
    {
      // A serialized error object: also not an `Error` instance.
      name: 'rejects with a plain object -> fails closed',
      arrange: () => invokeMock.mockRejectedValueOnce({ code: "Forbidden", message: "denied" }),
      expected: { enabled: false, level: "info" },
    },
  ];

  const rows: Row[] = [...resolveRows, ...degenerateRows];

  it.each(rows)("$name", async ({ arrange, expected }) => {
    // Each row arranges its own `...Once` outcome and seeds its own sentinel, so
    // the table passes when a row is run alone and under `--shuffle`.
    arrange();
    seedSentinelFor(expected);

    // (a) non-rejection half of totality, stated with `.resolves` so the shape
    //     of the claim is explicit.
    await expect(loggingService.hydrateSettings()).resolves.toEqual(expected);

    // (b) the store ends at the expected value.
    expect(readStore()).toEqual(expected);
  });

  it.each(rows)("$name — store/return agreement", async ({ arrange, expected }) => {
    arrange();
    seedSentinelFor(expected);

    const returned = await loggingService.hydrateSettings();

    // (c) independently kills an implementation that returns the right value
    //     without writing, or writes without returning.
    expect(readStore()).toEqual(returned);
    expect(returned).toEqual(expected);
  });
});

describe("F2: IPC rejection leaves the store disabled — the Defect-2 regression test", () => {
  it("actively writes { enabled: false, level: \"info\" } into the store", async () => {
    // Seed differs from the expected end state in BOTH fields, so a no-op
    // cannot pass vacuously. The store's initial state is
    // `{ enabled: true, level: "info" }` — "leave the store untouched" is a
    // DIFFERENT and WRONG behavior, which this `enabled: true` seed detects.
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockRejectedValueOnce(new Error("ipc bridge unavailable"));

    await expect(loggingService.hydrateSettings()).resolves.toEqual({
      enabled: false,
      level: "info",
    });
    expect(readStore()).toEqual({ enabled: false, level: "info" });
  });
});

describe("F3: after a failed hydration, no frontend log record flows — even at error level", () => {
  /**
   * SCOPE OF THE CLAIM: this pins exactly one thing — a `logEventSync` call made
   * AFTER `hydrateSettings()` has settled, on the FRONTEND, emits nothing. It
   * does NOT prove "logging is off": Rust-side `logger::log_event` keeps its own
   * cache initialized with `unwrap_or_default()` (i.e. enabled) under the same
   * unreadable-config condition, and `logEventSync` calls that run during the
   * startup window before hydration resolves are also out of reach here.
   */
  it("emits zero invoke(\"log_event\", ...) calls", async () => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockRejectedValueOnce(new Error("boom"));

    await loggingService.hydrateSettings();

    loggingService.logEventSync({
      level: "error", // top of `levelRank` — clears every threshold, so only
      // `enabled: false` can suppress it.
      event: "ui.button.click",
      status: "fail",
      actionId: "a1",
    });

    // Filtering by command string is MANDATORY: hydration itself legitimately
    // calls invoke("get_logging_settings", {}).
    expect(callsFor("log_event")).toHaveLength(0);
  });
});

describe("F4: success verbatim, enabled: false — the opt-out survives", () => {
  it("applies { enabled: false, level: \"warn\" } without clamping or merging", async () => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockResolvedValueOnce({ enabled: false, level: "warn" });

    await expect(loggingService.hydrateSettings()).resolves.toEqual({
      enabled: false,
      level: "warn",
    });
    expect(readStore()).toEqual({ enabled: false, level: "warn" });
  });
});

describe("F5: success verbatim, enabled: true — proves the fix did not hard-code false", () => {
  it("applies { enabled: true, level: \"debug\" } without forcing the fallback", async () => {
    useLoggingStore.setState({ enabled: false, level: "error" });
    invokeMock.mockResolvedValueOnce({ enabled: true, level: "debug" });

    await expect(loggingService.hydrateSettings()).resolves.toEqual({
      enabled: true,
      level: "debug",
    });
    expect(readStore()).toEqual({ enabled: true, level: "debug" });
  });
});

describe("F6: null and undefined payloads fail closed, identically to a rejection", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("resolving %s fails closed", async (_name, value) => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockResolvedValueOnce(value);

    await expect(loggingService.hydrateSettings()).resolves.toEqual({
      enabled: false,
      level: "info",
    });
    expect(readStore()).toEqual({ enabled: false, level: "info" });
  });
});

describe("F7: hydrateSettings remains callable when destructured, on the failure path", () => {
  it("does not depend on `this` when taking the fail-closed branch", async () => {
    const { hydrateSettings } = loggingService;
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockRejectedValueOnce(new Error("boom"));

    // A `this`-dependent implementation throws TypeError here.
    await expect(hydrateSettings()).resolves.toEqual({ enabled: false, level: "info" });
    expect(readStore()).toEqual({ enabled: false, level: "info" });
  });
});

describe("F8: a failed hydration makes exactly one IPC call and never writes back", () => {
  /**
   * Fail-closed must be a READ-SIDE DEFAULT, never a persisted decision. An
   * implementation that "persists the safe state" by calling
   * `setLoggingSettings(fallback)` on the failure path would turn a TRANSIENT
   * startup read failure into a PERMANENT write of `enabled: false` into
   * config.json, destroying the user's real setting with no path back. F3
   * cannot see such a write (it filters for `log_event`); only this case can.
   */
  it("calls get_logging_settings once and nothing else", async () => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    invokeMock.mockRejectedValueOnce(new Error("boom"));

    await loggingService.hydrateSettings();

    expect(invokeMock.mock.calls).toEqual([["get_logging_settings", {}]]);
  });
});
