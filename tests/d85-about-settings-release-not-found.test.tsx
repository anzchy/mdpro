/**
 * D85: About → Updates when the update server answered but no valid release
 * came back. tauri-plugin-updater 2.9.0 (`updater.rs:442-446`) collapses every
 * non-2xx answer (404, 401, 403, 5xx) into one `Error::ReleaseNotFound`
 * ("Could not fetch a valid release JSON from the remote"), so the status code
 * never reaches JS. That result is uncertain, not "updates disabled": it shows
 * the error text with an enabled Check Again, caches `error`, and logs
 * start → fail. Only EmptyEndpoints is disabled.
 *
 * D1 is labelled per status but is ONE equivalence class: every row rejects
 * with the same string, because that is all the plugin hands over.
 * D2 is a characterization guard (green before D85) against a classifier that
 * widens to malformed-metadata texts.
 * D3–D5 cover recovery after an uncertain result; D4 pins the stale-cache fix
 * (finding an update clears the cached error so a remount re-checks).
 *
 * Mock boundary: `check` (plugin-updater) and `invoke` (Tauri core) only.
 * Paired real paths: A10 in about-settings-updater-ipc.test.tsx (real plugin
 * JS + real loggingService under mockIPC), K1/K2 in
 * src-tauri/tests/updater_error_wire.rs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MALFORMED_METADATA_TEXTS } from "./support/updaterErrorTexts";

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
import { collectionCases } from "./support/collectionCases";

const REAL_RELEASE_NOT_FOUND = "Could not fetch a valid release JSON from the remote";
const ERROR_COPY = "Couldn't get update information. Try again later.";
const OLD_ERROR_COPY = /Couldn't reach the update server/;
const DISABLED_TEXT = "Automatic updates coming soon.";
const UP_TO_DATE_TEXT = /You're up to date/;
const AVAILABLE_TEXT = /Update available — v0\.3\.1/;

type LogPayload = {
  level: string;
  event: string;
  status: string;
  actionId: string;
  context?: Record<string, unknown>;
};

function updateCheckLogs(): LogPayload[] {
  return mockInvoke.mock.calls
    .filter(
      ([cmd, args]) =>
        cmd === "log_event" &&
        (args as { payload?: LogPayload } | undefined)?.payload?.event === "ui.about.update_check",
    )
    .map(([, args]) => (args as { payload: LogPayload }).payload);
}

function checkAgain() {
  return screen.getByRole("button", { name: "Check Again" });
}

function availableUpdate() {
  return { version: "0.3.1", body: null, downloadAndInstall: vi.fn() };
}

async function expectUncertainPane() {
  expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument();
  expect(screen.queryByText(DISABLED_TEXT)).toBeNull();
  expect(checkAgain()).toBeEnabled();
  expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "error", message: ERROR_COPY });
}

async function expectStartThenFail(rawError: string) {
  await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
  const logs = updateCheckLogs();
  expect(logs.map((p) => p.status)).toEqual(["start", "fail"]);
  expect(logs[1].level).toBe("error");
  expect(logs[1].context).toEqual({ error: rawError });
  expect("outcome" in (logs[1].context ?? {})).toBe(false);
  expect(logs[1].actionId).toBe(logs[0].actionId);
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

describe("D85 — ReleaseNotFound is uncertain, not updates-disabled", () => {
  // One equivalence class: the plugin erases the status, so every row sends the same string.
  it.each([404, 401, 403, 500, 502, 503])(
    "D1: an HTTP %i answer (plugin → ReleaseNotFound) shows the error and Check Again, logs fail",
    async () => {
      mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND);
      render(<AboutSettings />);

      await expectUncertainPane();
      await expectStartThenFail(REAL_RELEASE_NOT_FOUND);
    },
  );

  it("D1b: the Error-wrapped ReleaseNotFound rejection behaves the same", async () => {
    mockCheck.mockRejectedValue(new Error(REAL_RELEASE_NOT_FOUND));
    render(<AboutSettings />);

    await expectUncertainPane();
    await expectStartThenFail(REAL_RELEASE_NOT_FOUND);
  });

  it("D1c: the error pane no longer shows the old connection copy", async () => {
    mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND);
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText(OLD_ERROR_COPY)).toBeNull();
  });

  // Characterization (green before D85): copy-agnostic on purpose.
  it.each(collectionCases("tests/d85-about-settings-release-not-found.test.tsx:130", [...MALFORMED_METADATA_TEXTS]))(
    "D2: malformed release metadata %j is an error with Check Again, never disabled",
    async (text) => {
      mockCheck.mockRejectedValue(new Error(text));
      render(<AboutSettings />);

      expect(await screen.findByRole("button", { name: "Check Again" })).toBeEnabled();
      await waitFor(() => expect(useUpdaterStore.getState().cachedResult?.phase).toBe("error"));
      expect(screen.queryByText(DISABLED_TEXT)).toBeNull();
      await expectStartThenFail(text);
    },
  );
});

describe("D85 — recovery after an uncertain result", () => {
  it("D3: Check Again finding an update shows it with Install Update; two complete log pairs", async () => {
    const user = userEvent.setup();
    mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND);
    render(<AboutSettings />);
    await expectUncertainPane();

    mockCheck.mockResolvedValue(availableUpdate());
    await user.click(checkAgain());

    expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Update" })).toBeEnabled();
    expect(screen.queryByText(ERROR_COPY)).toBeNull();

    await waitFor(() => expect(updateCheckLogs()).toHaveLength(4));
    const logs = updateCheckLogs();
    expect(logs.map((p) => p.status)).toEqual(["start", "fail", "start", "success"]);
    expect(logs[1].context).toEqual({ error: REAL_RELEASE_NOT_FOUND });
    expect(logs[2].context).toEqual({ forceRefresh: true });
    expect(logs[3].context).toEqual({ hasUpdate: true, version: "0.3.1" });
    expect(new Set(logs.map((p) => p.actionId)).size).toBe(1);
  });

  it("D4: a cached error, then Check Again → update, then remount shows the update, not the stale error", async () => {
    const user = userEvent.setup();
    mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND);
    const first = render(<AboutSettings />);
    await expectUncertainPane();
    expect(useUpdaterStore.getState().cachedResult?.phase).toBe("error");

    mockCheck.mockResolvedValue(availableUpdate());
    await user.click(checkAgain());
    expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();
    expect(useUpdaterStore.getState().cachedResult).toBeNull();
    first.unmount();

    const callsBeforeRemount = mockCheck.mock.calls.length;
    render(<AboutSettings />);

    expect(await screen.findByText(AVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Update" })).toBeEnabled();
    expect(screen.queryByText(ERROR_COPY)).toBeNull();
    expect(screen.queryByText(OLD_ERROR_COPY)).toBeNull();
    expect(mockCheck).toHaveBeenCalledTimes(callsBeforeRemount + 1);
  });

  it("D5: Check Again resolving null shows up to date and caches it", async () => {
    const user = userEvent.setup();
    mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND);
    render(<AboutSettings />);
    await expectUncertainPane();

    mockCheck.mockResolvedValue(null);
    await user.click(checkAgain());

    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_COPY)).toBeNull();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "up-to-date" });
  });
});
