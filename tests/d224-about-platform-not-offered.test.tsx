/**
 * D224: About → Updates on Windows and Linux. latest.json lists only darwin (ADR-0102), and
 * tauri-plugin-updater 2.13.1's `check()` rejects with `TargetsNotFound` whenever the manifest
 * has no entry for the client's platform, even when nothing is newer. Since the 2.13.1 upgrade
 * that showed "Couldn't get update information" on every open. Off macOS it now shows the
 * updates-disabled state, "Automatic updates coming soon." with no Check Again (user's ruling
 * 「A: coming soon (Recommended)」), caches it, and logs start → success with
 * `outcome: "platform-not-offered"`. On macOS the same rejection means a broken release and stays
 * an error. Windows and Linux updates are not enabled: latest.json is untouched.
 *
 * Mock boundary: `check` (plugin-updater) and `invoke` (Tauri core) only, as in
 * d85-about-settings-release-not-found.test.tsx. Texts pinned in Rust by K3
 * (src-tauri/tests/updater_error_wire.rs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PLATFORM_NOT_IN_MANIFEST_TEXTS } from "./support/updaterErrorTexts";

const { mockCheck, mockInvoke } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mockCheck }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { AboutSettings } from "../src/components/common/settings/AboutSettings";
import { useUpdaterStore } from "../src/stores/updaterStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const [WINDOWS_TEXT, LINUX_TEXT] = PLATFORM_NOT_IN_MANIFEST_TEXTS;
const DISABLED_TEXT = "Automatic updates coming soon.";
const ERROR_COPY = "Couldn't get update information. Try again later.";
const ORIGINAL_PLATFORM = window.navigator.platform;

type LogPayload = { level: string; event: string; status: string; context?: Record<string, unknown> };

function updateCheckLogs(): LogPayload[] {
  return mockInvoke.mock.calls
    .filter(
      ([cmd, args]) =>
        cmd === "log_event" &&
        (args as { payload?: LogPayload } | undefined)?.payload?.event === "ui.about.update_check",
    )
    .map(([, args]) => (args as { payload: LogPayload }).payload);
}

function setPlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
}

async function expectComingSoon() {
  expect(await screen.findByText(DISABLED_TEXT)).toBeInTheDocument();
  expect(screen.queryByText(ERROR_COPY)).toBeNull();
  expect(screen.queryByRole("button", { name: "Check Again" })).toBeNull();
  expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
}

async function expectStartThenNotOffered(rawError: string) {
  await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
  const [start, end] = updateCheckLogs();
  expect(start.status).toBe("start");
  expect(end.status).toBe("success");
  expect(end.level).toBe("info");
  expect(end.context).toEqual({ outcome: "platform-not-offered", error: rawError });
}

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
  useLoggingStore.setState({ enabled: true, level: "info" });
  mockCheck.mockReset();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "get_app_version" ? "0.3.4" : undefined));
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

describe("D224 — a missing platform entry is not an error off macOS", () => {
  it("P1: on Windows, the rejection shows 'coming soon' with no Check Again, cached, logged as success", async () => {
    setPlatform("Win32");
    mockCheck.mockRejectedValue(WINDOWS_TEXT);
    render(<AboutSettings />);

    await expectComingSoon();
    await expectStartThenNotOffered(WINDOWS_TEXT);
  });

  it("P2: on Linux, the same", async () => {
    setPlatform("Linux x86_64");
    mockCheck.mockRejectedValue(LINUX_TEXT);
    render(<AboutSettings />);

    await expectComingSoon();
    await expectStartThenNotOffered(LINUX_TEXT);
  });

  it("P3: an Error-wrapped rejection behaves the same", async () => {
    setPlatform("Win32");
    mockCheck.mockRejectedValue(new Error(WINDOWS_TEXT));
    render(<AboutSettings />);

    await expectComingSoon();
    await expectStartThenNotOffered(WINDOWS_TEXT);
  });

  it("P4: reopening About shows the cached state and does not check again", async () => {
    setPlatform("Win32");
    mockCheck.mockRejectedValue(WINDOWS_TEXT);
    const first = render(<AboutSettings />);
    await expectComingSoon();
    first.unmount();

    render(<AboutSettings />);
    await expectComingSoon();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("P5: on macOS the same rejection is a broken release: the error and Check Again, logged as fail", async () => {
    setPlatform("MacIntel");
    mockCheck.mockRejectedValue(WINDOWS_TEXT);
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText(DISABLED_TEXT)).toBeNull();
    expect(screen.getByRole("button", { name: "Check Again" })).toBeEnabled();
    await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
    expect(updateCheckLogs().map((p) => p.status)).toEqual(["start", "fail"]);
  });
});
