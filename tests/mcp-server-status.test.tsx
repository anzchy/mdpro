/**
 * WI-6 (ADR-0039) — Settings shows the truth about the MCP server.
 *
 * Cases UI-01 … UI-07 of `.claude/tdd-guardian/tests-20260926-235500.md`, plus
 * UI-08 from its rev-3 addendum. ADR-0031 step 5b (WI-6, DEC-1 Option A) renames
 * UI-03 to N1 and adds N2 (`tests-20260927-031000.md`): the inline note now means
 * "disk disagrees after a successful write", and every "no note" assertion
 * matches both the old and the new copy (RB-X item 8).
 *
 * Every case renders the real `SettingsDialog` → `IntegrationsSettings` →
 * `McpServerStatus` → `mcpStatusView` chain. The only mock is the IPC boundary,
 * `@tauri-apps/api/core` (`invoke`, plus the `isTauri` spy set true so
 * `preferencesService` takes the Tauri branch); without it `get_preferences` / `set_preferences`
 * would never reach `invoke` and every write assertion would be vacuous.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import type { McpStatus } from "../src/services/mcpService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import type { McpConfig, UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";

const SERVER = /Enable MCP Server/i;
/** Any notSaved copy, old or new (RB-X item 8). */
const NOT_SAVED_NOTE = /Not saved|Changed elsewhere/i;
/** Written from the DEC-1 spec text, not imported, so the assertion is not tautological. */
const CHANGED_ELSEWHERE = /Changed elsewhere — reopen Settings to see the saved value/;
const SAVE_FAILED_TOAST = "Failed to save preferences";
const noop = () => {};

let statusReply: McpStatus | Error;
let prefsMcp: McpConfig;
let setReplies: Array<"ok" | "reject">;

function status(partial: Partial<McpStatus>): McpStatus {
  return { running: true, port: 55045, binaryPath: "b", launch: "running", configured: "enabled", ...partial };
}

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

async function route(cmd: unknown, args: unknown): Promise<unknown> {
  switch (cmd) {
    case "mcp_get_status":
      if (statusReply instanceof Error) throw statusReply;
      return { ...statusReply };
    case "mcp_get_installations":
      return [];
    case "get_preferences":
      return makePreferences({ mcp: prefsMcp });
    case "set_preferences": {
      if ((setReplies.shift() ?? "ok") === "reject") throw new Error("disk full");
      const sent = (args as { preferences: Partial<UserPreferences> }).preferences;
      return makePreferences(sent);
    }
    default:
      return null;
  }
}

async function openIntegrations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  await screen.findByRole("checkbox", { name: SERVER });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(route);
  statusReply = status({});
  prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
  setReplies = [];
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("WI-6 McpServerStatus", () => {
  it("UI-01 running + configured disabled shows the restart copy in one status region", async () => {
    const user = userEvent.setup();
    statusReply = status({ launch: "running", configured: "disabled" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    const region = await screen.findByRole("status");
    expect(region).toHaveTextContent("Running");
    expect(region).toHaveTextContent("Takes effect after you restart mdpro");
    expect(screen.queryByText(NOT_SAVED_NOTE)).toBeNull();
    expect(screen.queryByText(/unreadable/i)).toBeNull();
  });

  it("UI-02 disabled + configured disabled shows Off and no note", async () => {
    const user = userEvent.setup();
    statusReply = status({ running: false, port: null, launch: "disabled", configured: "disabled" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    const region = await screen.findByRole("status");
    expect(region).toHaveTextContent("Off");
    expect(screen.queryByText(/restart/i)).toBeNull();
    expect(screen.queryByText(NOT_SAVED_NOTE)).toBeNull();
  });

  it("N1 (was UI-03) a successful write that disk still disagrees with shows Changed elsewhere; a close and reopen clears it", async () => {
    const user = userEvent.setup();
    prefsMcp = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    statusReply = status({ running: false, port: null, launch: "disabled", configured: "disabled" });
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    const server = screen.getByRole("checkbox", { name: SERVER });
    await waitFor(() => expect(server).toBeEnabled());
    await waitFor(() => expect(server).not.toBeChecked());

    // Phase 1
    await user.click(server);
    const note = await screen.findByText(CHANGED_ELSEWHERE);
    expect(screen.getByRole("status")).toContainElement(note);
    expect(screen.getByRole("status")).not.toHaveTextContent(/can't be changed/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/Not saved/);
    expect(screen.queryByText(/restart/i)).toBeNull();
    await waitFor(() => expect(callsFor("mcp_get_status")).toHaveLength(2));
    // Additive (N1): the write did succeed, so "after a successful write" is observed, not assumed.
    expect(callsFor("set_preferences")).toHaveLength(1);
    expect(useToastStore.getState().message).toBeNull();

    // Phase 2 — same disk, same status, new session.
    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Off"));
    const reopened = screen.getByRole("checkbox", { name: SERVER });
    await waitFor(() => expect(reopened).toBeEnabled());
    await waitFor(() => expect(reopened).not.toBeChecked());
    expect(within(screen.getByRole("status")).queryByText(NOT_SAVED_NOTE)).toBeNull();
    expect(screen.queryByText(/restart/i)).toBeNull();
  });

  it("UI-04 a failed status fetch shows no badge at all", async () => {
    const user = userEvent.setup();
    statusReply = new Error("x");
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    expect(await screen.findByText("x")).toBeInTheDocument();
    expect(screen.queryByText(/^Off$/)).toBeNull();
    expect(screen.queryByText(/Running/)).toBeNull();
    expect(screen.queryByText(/restart/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("UI-05 flipping the server toggle logs ui.toggle.change with the enum controlId only", async () => {
    const user = userEvent.setup();
    useLoggingStore.setState({ enabled: true, level: "debug" });
    prefsMcp = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    statusReply = status({ running: false, port: null, launch: "disabled", configured: "disabled" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    const server = screen.getByRole("checkbox", { name: SERVER });
    await waitFor(() => expect(server).toBeEnabled());
    await waitFor(() => expect(server).not.toBeChecked());

    await user.click(server);

    const toggles = callsFor("log_event")
      .map(([, a]) => (a as { payload: { event: string; context: unknown } }).payload)
      .filter((p) => p.event === "ui.toggle.change");
    expect(toggles).toHaveLength(1);
    expect(toggles[0].context).toEqual({
      controlId: "settings.integrations.mcp.serverEnabled",
      newValue: true,
    });
  });

  it("UI-06 the status region carries no path and no binary path", async () => {
    const user = userEvent.setup();
    const binaryPath = "/Applications/mdpro.app/Contents/MacOS/mdpro_mcp";
    statusReply = status({ binaryPath, launch: "running", configured: "unreadable" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    const regions = await screen.findAllByRole("status");
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.textContent ?? "").not.toContain("/");
      expect(region.textContent ?? "").not.toContain(binaryPath);
    }
  });

  it("UI-07 disabled + unreadable does not claim MCP is running", async () => {
    const user = userEvent.setup();
    statusReply = status({ running: false, port: null, launch: "disabled", configured: "unreadable" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    const region = await screen.findByRole("status");
    expect(region).toHaveTextContent("Off");
    expect(region).toHaveTextContent(/unreadable/i);
    expect(region).not.toHaveTextContent(/left running/i);
  });

  it("M5-a running + configured unreadable says the settings file is unreadable and MCP was left running", async () => {
    const user = userEvent.setup();
    statusReply = status({ launch: "running", configured: "unreadable" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    const region = await screen.findByRole("status");
    expect(region).toHaveTextContent("Running");
    expect(region).toHaveTextContent("Settings file unreadable — MCP left running");
    expect(region).not.toHaveTextContent(/next launch/i);
  });

  it("M5-b disabled + configured unreadable says MCP will try to start on next launch", async () => {
    const user = userEvent.setup();
    statusReply = status({ running: false, port: null, launch: "disabled", configured: "unreadable" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    const region = await screen.findByRole("status");
    expect(region).toHaveTextContent("Settings file unreadable — MCP will try to start on next launch");
  });

  it("UI-08 a failed write rolls back pendingToggle as well as the checkbox", async () => {
    const user = userEvent.setup();
    prefsMcp = { serverEnabled: true, startOnLaunch: true, autoApproveEdits: false };
    statusReply = status({ launch: "running", configured: "enabled" });
    setReplies = ["reject"];
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    const server = screen.getByRole("checkbox", { name: SERVER });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Start on launch/i })).toBeChecked());

    await user.click(server);
    await waitFor(() => expect(callsFor("set_preferences")).toHaveLength(1));
    await waitFor(() => expect(server).toBeChecked());
    await waitFor(() => expect(callsFor("mcp_get_status")).toHaveLength(2));

    expect(server).toBeChecked();
    expect(within(screen.getByRole("status")).queryByText(NOT_SAVED_NOTE)).toBeNull();
    expect(screen.queryByText(/restart/i)).toBeNull();
  });

  it("N2 a failed write yields exactly one signal — the toast — and no inline note", async () => {
    const user = userEvent.setup();
    prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    statusReply = status({ launch: "running", configured: "enabled" });
    setReplies = ["reject"];
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    const server = screen.getByRole("checkbox", { name: SERVER });
    await waitFor(() => expect(server).toBeEnabled());
    await waitFor(() => expect(server).toBeChecked());

    const emissions: string[] = [];
    const stop = useToastStore.subscribe((s) => {
      if (s.message !== null) emissions.push(s.message);
    });
    try {
      await user.click(server);
      await waitFor(() => expect(callsFor("mcp_get_status")).toHaveLength(2));
      await waitFor(() => expect(server).toBeChecked());

      expect(screen.getByRole("status").textContent).toBe("Running");
      expect(screen.queryByText(/Changed elsewhere/)).toBeNull();
      expect(screen.queryByText(/Not saved/)).toBeNull();
      expect(screen.queryByText(/restart/i)).toBeNull();
      expect(emissions).toEqual([SAVE_FAILED_TOAST]);
    } finally {
      stop();
    }
  });
});
