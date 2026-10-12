/**
 * D166-WI-1: reopening Settings must not run an update check until the user
 * opens the About page again, and a check left in flight when the dialog
 * closed must not overwrite what a reopened About panel already showed.
 *
 * Root cause pinned here: SettingsDialog stays mounted while closed (AppDialogs
 * renders every slot) and kept `activePage`, so a reopen rendered the stale
 * "about" page once, AboutSettings mounted and its mount effect ran a check
 * whenever the cache was empty (after a check that found an update, D85).
 *
 * Semantics stated by these tests:
 * - Every open lands on General (the only page an open selects; there is no
 *   initial-page prop). A check runs only when About is shown: one per visit
 *   with an empty cache, none on a cache hit.
 * - Late write: once an About panel has shown the cached result, an older
 *   check still in flight may not change the cache, so panel and cache agree
 *   (L1). While no About panel has mounted since, that check still fills the
 *   cache for the next visit (L2, the D110 R4 behaviour).
 *
 * Mock boundary: `@tauri-apps/api/core` (`invoke`, `isTauri` false → browser
 * preferences), `check` (plugin-updater), `relaunch`. Paired real path: A6/A10
 * in about-settings-updater-ipc.test.tsx and the StrictMode suite in
 * d110-about-settings-strict-mode.test.tsx (real plugin JS under mockIPC).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockCheck, mockInvoke } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({
    invoke: (...args: unknown[]) => mockInvoke(...args),
  }),
);
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mockCheck }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import { useUpdaterStore } from "../src/stores/updaterStore";
import type { CacheSafeState } from "../src/stores/updaterStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const NETWORK = "error sending request for url (https://example.com/latest.json)";
const EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";
const ERROR_COPY = "Couldn't get update information. Try again later.";
const UP_TO_DATE_TEXT = /You're up to date/;
const AVAILABLE_TEXT = /Update available — v9\.9\.9/;
const noop = () => {};

type Outcome = "available" | "up-to-date" | "network" | "disabled";

function answer(o: Outcome): Promise<unknown> {
  if (o === "available") {
    return Promise.resolve({ version: "9.9.9", body: null, downloadAndInstall: vi.fn() });
  }
  if (o === "up-to-date") return Promise.resolve(null);
  return Promise.reject(o === "network" ? NETWORK : EMPTY_ENDPOINTS);
}

/** Queue one deferred answer for the next `check()` call. */
function deferCheck() {
  let release!: (o: Outcome) => void;
  const p = new Promise<Outcome>((res) => { release = res; }).then(answer);
  mockCheck.mockImplementationOnce(() => p);
  return {
    settle: async (o: Outcome) => {
      await act(async () => {
        release(o);
        await p.catch(() => undefined);
      });
    },
  };
}

/** Every `check()` answers `o` immediately. */
function answerAll(o: Outcome) {
  mockCheck.mockImplementation(() => answer(o));
}

function checkStarts(): number {
  return mockInvoke.mock.calls.filter(([cmd, args]) => cmd === "log_event"
    && (args as { payload?: { event?: string; status?: string } })?.payload?.event === "ui.about.update_check"
    && (args as { payload: { status: string } }).payload.status === "start").length;
}

function mount(open: boolean) {
  const view = render(<SettingsDialog open={open} onClose={noop} />);
  return {
    setOpen: (next: boolean) => view.rerender(<SettingsDialog open={next} onClose={noop} />),
  };
}

const user = () => userEvent.setup();
const aboutNav = () => screen.getByRole("button", { name: "About" });
const aboutHeading = () => screen.queryByRole("heading", { name: "About" });

async function visitAbout() {
  await user().click(aboutNav());
  expect(aboutHeading()).toBeInTheDocument();
}

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null, activeRequestId: 0 });
  useLoggingStore.setState({ enabled: true, level: "info" });
  mockCheck.mockReset();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: unknown) =>
    cmd === "get_app_version" ? "1.2.3" : undefined,
  );
});

describe("D166 — reopening Settings does not re-run the About update check", () => {
  it("C1: after a check that found an update, a reopen runs no check until About is opened, then exactly one", async () => {
    answerAll("available");
    const dlg = mount(true);
    await visitAbout();
    expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(useUpdaterStore.getState().cachedResult).toBeNull();

    dlg.setOpen(false);
    dlg.setOpen(true);
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(aboutHeading()).not.toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(mockCheck).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(checkStarts()).toBe(1));

    await visitAbout();
    expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(checkStarts()).toBe(2));
  });

  it("C2: with a cached result, a reopen lands on General and visiting About shows the cache without a check", async () => {
    answerAll("up-to-date");
    const dlg = mount(true);
    await visitAbout();
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();

    dlg.setOpen(false);
    dlg.setOpen(true);
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();

    await visitAbout();
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("C3: the very first open lands on General and runs no check", async () => {
    answerAll("available");
    mount(true);
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("C4: a dialog first mounted closed and then opened lands on General with no check", async () => {
    answerAll("available");
    const dlg = mount(false);
    dlg.setOpen(true);
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("C5 (law): over many open/close cycles with an always-empty cache, checks equal About visits", async () => {
    answerAll("available");
    const visits = [true, false, false, true, true, false, true, false];
    const dlg = mount(false);
    let expected = 0;
    for (const visit of visits) {
      dlg.setOpen(true);
      expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
      if (visit) {
        await visitAbout();
        expected += 1;
        expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();
      }
      await act(async () => { await Promise.resolve(); });
      expect(mockCheck).toHaveBeenCalledTimes(expected);
      dlg.setOpen(false);
    }
  });

  it("C6: closing and reopening inside one act (no paint between) still runs no check", async () => {
    answerAll("available");
    const dlg = mount(true);
    await visitAbout();
    expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();

    act(() => {
      dlg.setOpen(false);
      dlg.setOpen(true);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });
});

describe("D166 — a check in flight when Settings closed does not overwrite a reopened About panel", () => {
  async function checkAgainThenReopen(dlg: ReturnType<typeof mount>) {
    const pending = deferCheck();
    await user().click(screen.getByRole("button", { name: "Check Again" }));
    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
    dlg.setOpen(false);
    dlg.setOpen(true);
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    return pending;
  }

  it.each<[Outcome, string | RegExp]>([
    ["network", ERROR_COPY],
    ["disabled", /Automatic updates coming soon/],
    ["available", AVAILABLE_TEXT],
  ])("L1: a late %s from the earlier Check Again leaves the shown cache in place", async (late, lateText) => {
    answerAll("up-to-date");
    const dlg = mount(true);
    await visitAbout();
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    const pending = await checkAgainThenReopen(dlg);

    await visitAbout();
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(2);

    await pending.settle(late);
    const cached: CacheSafeState | null = useUpdaterStore.getState().cachedResult;
    expect(cached).toEqual({ phase: "up-to-date" });
    expect(screen.getByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(lateText)).not.toBeInTheDocument();
  });

  it("L2: the same check answering before About is reopened still fills the cache for the next visit", async () => {
    answerAll("up-to-date");
    const dlg = mount(true);
    await visitAbout();
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    const pending = await checkAgainThenReopen(dlg);

    await pending.settle("network");
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "error", message: ERROR_COPY });

    await visitAbout();
    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });
});
