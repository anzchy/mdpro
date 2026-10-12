/**
 * D110-WI-1 (component half): a late answer from a superseded update check
 * must not touch the cache or the UI.
 *
 * The race (Codex, deferred promise): check A starts → the About panel is
 * unmounted and remounted → check B starts and writes the cache → A returns
 * and wipes (or overwrites) B's cache. R1 is the reported clearCache case;
 * R2 covers every late outcome of A. R3 (one instance, StrictMode) lives in
 * d110-about-settings-strict-mode.test.tsx. R4/R5 pin what must keep working: a check that
 * is still current when the panel closes still fills the cache, and every
 * check still logs one start and one terminal `ui.about.update_check` line.
 *
 * Mock boundary: `check` (plugin-updater), `invoke` (Tauri core), `relaunch`.
 * Paired real path: A6/A10 in about-settings-updater-ipc.test.tsx (real plugin
 * JS under mockIPC).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const { mockCheck, mockInvoke } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mockCheck }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { AboutSettings } from "../src/components/common/settings/AboutSettings";
import { useUpdaterStore } from "../src/stores/updaterStore";
import type { CacheSafeState } from "../src/stores/updaterStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";
const NETWORK = "error sending request for url (https://example.com/latest.json)";
const ERROR_COPY = "Couldn't get update information. Try again later.";
const UP_TO_DATE_TEXT = /You're up to date/;

type Outcome = "available" | "up-to-date" | "network" | "disabled";

interface Deferred {
  settle: (o: Outcome) => Promise<void>;
}

/** Queue one deferred answer for the next `check()` call. */
function deferCheck(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  mockCheck.mockImplementationOnce(() => p);
  return {
    settle: async (o) => {
      await act(async () => {
        if (o === "available") resolve({ version: "9.9.9", body: null, downloadAndInstall: vi.fn() });
        else if (o === "up-to-date") resolve(null);
        else if (o === "network") reject(NETWORK);
        else reject(EMPTY_ENDPOINTS);
        await p.catch(() => undefined);
      });
    },
  };
}

/** The cache a check with this outcome writes when it owns the cache. */
function cacheFor(o: Outcome): CacheSafeState | null {
  if (o === "available") return null;
  if (o === "up-to-date") return { phase: "up-to-date" };
  if (o === "network") return { phase: "error", message: ERROR_COPY };
  return { phase: "updates-disabled" };
}

function updateCheckStatuses(): string[] {
  return mockInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "log_event"
      && (args as { payload?: { event?: string } })?.payload?.event === "ui.about.update_check")
    .map(([, args]) => (args as { payload: { status: string } }).payload.status);
}

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
  useLoggingStore.setState({ enabled: true, level: "info" });
  mockCheck.mockReset();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) =>
    cmd === "get_app_version" ? "1.2.3" : undefined,
  );
});

/** A starts, the panel remounts, B starts; returns both deferreds and the live view. */
async function startRaceAcrossRemount() {
  const a = deferCheck();
  const first = render(<AboutSettings />);
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
  first.unmount();

  const b = deferCheck();
  const second = render(<AboutSettings />);
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
  return { a, b, second };
}

describe("AboutSettings — the cache belongs to the newest check (D110)", () => {
  it("R1: across an unmount, B returns before A and B's cache survives A finding an update", async () => {
    const { a, b, second } = await startRaceAcrossRemount();

    await b.settle("up-to-date");
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "up-to-date" });

    await a.settle("available");
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "up-to-date" });
    expect(screen.getByText(UP_TO_DATE_TEXT)).toBeInTheDocument();

    // A remount is a cache hit: no third check.
    second.unmount();
    render(<AboutSettings />);
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });

  it.each<[Outcome, Outcome]>([
    ["available", "up-to-date"],
    ["available", "network"],
    ["available", "disabled"],
    ["up-to-date", "network"],
    ["network", "up-to-date"],
    ["disabled", "up-to-date"],
    ["up-to-date", "disabled"],
  ])("R2: a late %s from superseded A leaves B's %s cache untouched", async (lateA, outcomeB) => {
    const { a, b } = await startRaceAcrossRemount();

    await b.settle(outcomeB);
    await waitFor(() => expect(useUpdaterStore.getState().cachedResult).toEqual(cacheFor(outcomeB)));
    const before = useUpdaterStore.getState().cachedResult;

    await a.settle(lateA);
    expect(useUpdaterStore.getState().cachedResult).toEqual(before);
  });

  it("R4: a check still current when the panel closes fills the cache for the next open", async () => {
    const a = deferCheck();
    const first = render(<AboutSettings />);
    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
    first.unmount();

    await a.settle("network");
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "error", message: ERROR_COPY });

    render(<AboutSettings />);
    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("R5: both checks of the race still log one start and one terminal line each", async () => {
    const { a, b } = await startRaceAcrossRemount();
    await b.settle("up-to-date");
    await a.settle("available");

    await waitFor(() => expect(updateCheckStatuses()).toHaveLength(4));
    expect(updateCheckStatuses()).toEqual(["start", "start", "success", "success"]);
  });
});
