/**
 * About → Updates: how a rejected updater check() is presented (WI-1,
 * plan-20261009-122014). tauri-plugin-updater 2.9.0 rejects an empty endpoint
 * list with "Updater does not have any endpoints set."; the pane must show the
 * updates-disabled text, not the network error and its Check Again button.
 *
 * Mock boundary: the Tauri IPC surface only (`check`, `invoke`, `relaunch`) —
 * there is no Tauri runtime under jsdom. Paired real paths: A6
 * (about-settings-updater-ipc.test.tsx, real plugin JS under mockIPC), K1
 * (src-tauri/tests/updater_error_wire.rs) and the verify-build device check.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const REAL_EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";
const NETWORK_MESSAGE =
  "error sending request for url (https://github.com/anzchy/mdpro/releases/latest/download/latest.json)";
const DISABLED_TEXT = "Automatic updates coming soon.";
const ERROR_TEXT = /Couldn't reach the update server/;
const UP_TO_DATE_TEXT = /You're up to date/;

function checkAgainButton() {
  return screen.queryByRole("button", { name: "Check Again" });
}

async function expectDisabledPane() {
  expect(await screen.findByText(DISABLED_TEXT)).toBeInTheDocument();
  expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  expect(checkAgainButton()).toBeNull();
}

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
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

  it("A4: the legacy release-not-found message still shows the disabled text", async () => {
    mockCheck.mockRejectedValue("Could not fetch a valid release JSON from the remote");
    render(<AboutSettings />);

    await expectDisabledPane();
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
});
