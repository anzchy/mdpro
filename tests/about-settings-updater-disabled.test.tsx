/**
 * About → Updates: how a rejected updater check() is presented (WI-1,
 * plan-20261009-122014). tauri-plugin-updater 2.9.0 rejects an empty endpoint
 * list with "Updater does not have any endpoints set."; the pane must show the
 * updates-disabled text, not the network error and its Check Again button.
 * A8 (plan-20261010-093842 WI-1): an unrelated failure that merely mentions
 * "empty" is a real failure — error text and an enabled Check Again.
 * L1–L9 (plan-20261010-093842 WI-2): every non-cached check logs exactly one
 * `ui.about.update_check` start and one terminal line (success, success with
 * `outcome: "updates-disabled"`, or fail), observed as `log_event` IPC payloads
 * through the real loggingService; a cache hit logs nothing.
 * D85: only EmptyEndpoints is disabled. ReleaseNotFound (the plugin's answer to
 * any non-2xx) is a failure — error text, enabled Check Again, `fail` logged;
 * A4, L2, L6′ and L9 classes 3–4 changed under rule 12. More D85 cases live in
 * d85-about-settings-release-not-found.test.tsx.
 *
 * Mock boundary: the Tauri IPC surface only (`check`, `invoke`, `relaunch`) —
 * there is no Tauri runtime under jsdom. Paired real paths: A6
 * (about-settings-updater-ipc.test.tsx, real plugin JS under mockIPC), K1
 * (src-tauri/tests/updater_error_wire.rs) and the verify-build device check.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

const REAL_EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";
const REAL_RELEASE_NOT_FOUND = "Could not fetch a valid release JSON from the remote";
const NETWORK_MESSAGE =
  "error sending request for url (https://github.com/anzchy/mdpro/releases/latest/download/latest.json)";
const DISABLED_TEXT = "Automatic updates coming soon.";
// D85 / rule 12: error copy changed (user-approved).
const ERROR_TEXT = /Couldn't get update information\. Try again later\./;
const UP_TO_DATE_TEXT = /You're up to date/;

function checkAgainButton() {
  return screen.queryByRole("button", { name: "Check Again" });
}

async function expectDisabledPane() {
  expect(await screen.findByText(DISABLED_TEXT)).toBeInTheDocument();
  expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  expect(checkAgainButton()).toBeNull();
}

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

function logEventCalls() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === "log_event");
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

describe("AboutSettings — updates-disabled detection", () => {
  it("A2: a plain-string empty-endpoints rejection shows the disabled text", async () => {
    mockCheck.mockRejectedValue(REAL_EMPTY_ENDPOINTS);
    render(<AboutSettings />);

    await expectDisabledPane();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
  });

  it("A1: an Error empty-endpoints rejection shows the disabled text", async () => {
    mockCheck.mockRejectedValue(new Error(REAL_EMPTY_ENDPOINTS));
    render(<AboutSettings />);

    await expectDisabledPane();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
  });

  it("A3: a network failure shows the error text and an enabled Check Again", async () => {
    mockCheck.mockRejectedValue(NETWORK_MESSAGE);
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(DISABLED_TEXT)).toBeNull();
    expect(screen.getByRole("button", { name: "Check Again" })).toBeEnabled();
    expect(useUpdaterStore.getState().cachedResult?.phase).toBe("error");
  });

  // D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a false spec.
  it("A4: the plugin ReleaseNotFound message shows the error text and an enabled Check Again", async () => {
    mockCheck.mockRejectedValue("Could not fetch a valid release JSON from the remote");
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(DISABLED_TEXT)).toBeNull();
    expect(screen.getByRole("button", { name: "Check Again" })).toBeEnabled();
  });

  it("A5: the disabled result survives repeated remounts without re-checking", async () => {
    mockCheck.mockRejectedValue(REAL_EMPTY_ENDPOINTS);
    const first = render(<AboutSettings />);
    await expectDisabledPane();
    first.unmount();

    for (let i = 0; i < 3; i++) {
      const view = render(<AboutSettings />);
      await expectDisabledPane();
      expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
      view.unmount();
    }
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("A7: Check Again after a network failure replaces the cached result", async () => {
    const user = userEvent.setup();
    mockCheck.mockRejectedValue(NETWORK_MESSAGE);
    const first = render(<AboutSettings />);
    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();

    mockCheck.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "Check Again" }));

    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "up-to-date" });
    first.unmount();

    const callsBeforeRemount = mockCheck.mock.calls.length;
    mockCheck.mockRejectedValue(NETWORK_MESSAGE);
    render(<AboutSettings />);
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(mockCheck).toHaveBeenCalledTimes(callsBeforeRemount);
  });

  it("A8: a body error mentioning \"empty\" shows the error text and an enabled Check Again", async () => {
    mockCheck.mockRejectedValue(new Error("Failed to read response body: body is empty"));
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(DISABLED_TEXT)).toBeNull();
    expect(screen.getByRole("button", { name: "Check Again" })).toBeEnabled();
    expect(useUpdaterStore.getState().cachedResult?.phase).toBe("error");
  });
});

describe("AboutSettings — update-check log lines (WI-2)", () => {
  it("L1: a disabled Error rejection logs start then an info success with the outcome", async () => {
    mockCheck.mockRejectedValue(new Error(REAL_EMPTY_ENDPOINTS));
    render(<AboutSettings />);

    await expectDisabledPane();
    await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
    const logs = updateCheckLogs();
    expect(logs.map((p) => p.status)).toEqual(["start", "success"]);
    expect(logs[1]).toMatchObject({
      level: "info",
      event: "ui.about.update_check",
      status: "success",
      context: { outcome: "updates-disabled", error: REAL_EMPTY_ENDPOINTS },
    });
    expect(typeof logs[0].actionId).toBe("string");
    expect(logs[0].actionId.length).toBeGreaterThan(0);
    expect(logs[1].actionId).toBe(logs[0].actionId);
    expect(logs.some((p) => p.status === "fail")).toBe(false);
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
  });

  // D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a false spec.
  it("L2: the plain-string ReleaseNotFound rejection logs start then an error fail", async () => {
    mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND);
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
    const logs = updateCheckLogs();
    expect(logs.map((p) => p.status)).toEqual(["start", "fail"]);
    expect(logs[1].level).toBe("error");
    expect(logs[1].context).toEqual({ error: REAL_RELEASE_NOT_FOUND });
  });

  it("L3: a network rejection logs start then an error fail, never the outcome", async () => {
    mockCheck.mockRejectedValue(NETWORK_MESSAGE);
    render(<AboutSettings />);

    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
    const logs = updateCheckLogs();
    expect(logs.map((p) => p.status)).toEqual(["start", "fail"]);
    expect(logs[1]).toMatchObject({ level: "error", context: { error: NETWORK_MESSAGE } });
    expect(logs.every((p) => p.context?.outcome === undefined)).toBe(true);
  });

  it("L5: cache-hit remounts emit no log line", async () => {
    mockCheck.mockRejectedValue(new Error(REAL_EMPTY_ENDPOINTS));
    const first = render(<AboutSettings />);
    await expectDisabledPane();
    await waitFor(() => expect(updateCheckLogs().length).toBeGreaterThan(0));
    first.unmount();
    const n0 = updateCheckLogs().length;

    for (let i = 0; i < 3; i++) {
      const view = render(<AboutSettings />);
      await expectDisabledPane();
      expect(updateCheckLogs()).toHaveLength(n0);
      expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
      view.unmount();
    }
    expect(updateCheckLogs()).toHaveLength(n0);
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("L6′: a network failure then Check Again rejecting as disabled logs two complete pairs", async () => {
    const user = userEvent.setup();
    mockCheck.mockRejectedValue(NETWORK_MESSAGE);
    render(<AboutSettings />);
    expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();

    // D85 / rule 12: ReleaseNotFound is no longer in the disabled class; network → RNF is D3.
    mockCheck.mockRejectedValue(REAL_EMPTY_ENDPOINTS);
    await user.click(screen.getByRole("button", { name: "Check Again" }));
    await expectDisabledPane();

    await waitFor(() => expect(updateCheckLogs()).toHaveLength(4));
    const logs = updateCheckLogs();
    expect(logs.map((p) => p.status)).toEqual(["start", "fail", "start", "success"]);
    expect(logs[0].context).toEqual({ forceRefresh: false });
    expect(logs[1].level).toBe("error");
    expect(logs[2].context).toEqual({ forceRefresh: true });
    expect(logs[3].context?.outcome).toBe("updates-disabled");
    // Pairing: every start is followed by exactly one non-start before the next start.
    for (let i = 0; i < logs.length; i += 2) {
      expect(logs[i].status).toBe("start");
      expect(logs[i + 1].status).not.toBe("start");
    }
    expect(new Set(logs.map((p) => p.actionId)).size).toBe(1);
    expect(checkAgainButton()).toBeNull();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
  });

  it("L7: with logging disabled the disabled pane shows and nothing is logged", async () => {
    useLoggingStore.setState({ enabled: false });
    mockCheck.mockRejectedValue(new Error(REAL_EMPTY_ENDPOINTS));
    render(<AboutSettings />);

    await expectDisabledPane();
    expect(useLoggingStore.getState().enabled).toBe(false);
    expect(logEventCalls()).toHaveLength(0);
  });

  it.each([
    {
      name: "null (up to date)",
      result: null,
      waitFor: UP_TO_DATE_TEXT,
      context: { hasUpdate: false },
    },
    {
      name: "an available update",
      result: { version: "9.9.9", body: null, downloadAndInstall: vi.fn() },
      waitFor: /Update available — v9\.9\.9/,
      context: { hasUpdate: true, version: "9.9.9" },
    },
  ])("L8: the resolved-check success line is unchanged for $name", async ({ result, waitFor: text, context }) => {
    mockCheck.mockResolvedValue(result);
    render(<AboutSettings />);

    expect(await screen.findByText(text)).toBeInTheDocument();
    await waitFor(() => expect(updateCheckLogs()).toHaveLength(2));
    const logs = updateCheckLogs();
    expect(logs.map((p) => p.status)).toEqual(["start", "success"]);
    expect(logs[0].context).toEqual({ forceRefresh: false });
    expect(logs[1]).toMatchObject({ level: "info" });
    expect(logs[1].context).toEqual(context);
    expect("outcome" in (logs[1].context ?? {})).toBe(false);
  });

  const BODY_EMPTY = "Failed to read response body: body is empty";
  it.each([
    { cls: 1, setup: () => mockCheck.mockRejectedValue(new Error(REAL_EMPTY_ENDPOINTS)), text: DISABLED_TEXT, status: "success", level: "info", outcome: true },
    { cls: 2, setup: () => mockCheck.mockRejectedValue(REAL_EMPTY_ENDPOINTS), text: DISABLED_TEXT, status: "success", level: "info", outcome: true },
    // D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a false spec.
    { cls: 3, setup: () => mockCheck.mockRejectedValue(REAL_RELEASE_NOT_FOUND), text: ERROR_TEXT, status: "fail", level: "error", outcome: false },
    { cls: 4, setup: () => mockCheck.mockRejectedValue(new Error(REAL_RELEASE_NOT_FOUND)), text: ERROR_TEXT, status: "fail", level: "error", outcome: false },
    { cls: 5, setup: () => mockCheck.mockRejectedValue(NETWORK_MESSAGE), text: ERROR_TEXT, status: "fail", level: "error", outcome: false },
    { cls: 6, setup: () => mockCheck.mockRejectedValue(new Error(BODY_EMPTY)), text: ERROR_TEXT, status: "fail", level: "error", outcome: false },
    { cls: 7, setup: () => mockCheck.mockResolvedValue(null), text: UP_TO_DATE_TEXT, status: "success", level: "info", outcome: false },
    { cls: 8, setup: () => mockCheck.mockResolvedValue({ version: "9.9.9", body: null, downloadAndInstall: vi.fn() }), text: /Update available — v9\.9\.9/, status: "success", level: "info", outcome: false },
  ])(
    "L9: outcome class $cls logs exactly one start and one $status/$level terminal",
    async ({ setup, text, status, level, outcome }) => {
      setup();
      render(<AboutSettings />);

      expect(await screen.findByText(text)).toBeInTheDocument();
      await waitFor(() => expect(updateCheckLogs().length).toBeGreaterThanOrEqual(2));
      const logs = updateCheckLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].status).toBe("start");
      expect(logs[1].status).toBe(status);
      expect(logs[1].level).toBe(level);
      expect("outcome" in (logs[1].context ?? {})).toBe(outcome);
      expect(logs[1].actionId).toBe(logs[0].actionId);
    },
  );
});
