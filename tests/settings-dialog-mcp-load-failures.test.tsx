/**
 * MCP-FIX-C1 (ADR-0039) — how the Settings MCP section degrades when a read fails.
 *
 * Cases:
 * - M3: the status re-fetch after a server toggle fails → no badge, the inline
 *   error, and the toggle keeps the value that was written.
 * - M4: `get_preferences` resolves without an `mcp` group → failed-load state.
 * - Non-Error rejection: the load rejects with a plain string → failed-load
 *   state, and the `ui.settings.mcp.load` fail log carries that string.
 *
 * The only mock is `@tauri-apps/api/core#invoke` (route in
 * `tests/support/mcpSettingsHarness.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import type { LogEntryPayload } from "../src/types/logging";
import { mcp, mcpRoute, mcpStatus, resetMcp } from "./support/mcpSettingsHarness";

const MCP_TOGGLES = [/Enable MCP Server/i, /Start on launch/i, /Auto-approve/i] as const;
const [SERVER] = MCP_TOGGLES;
const noop = () => {};

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

function logged(event: string): LogEntryPayload[] {
  return callsFor("log_event")
    .map(([, a]) => (a as { payload: LogEntryPayload }).payload)
    .filter((p) => p.event === event);
}

function toggle(name: RegExp) {
  return screen.getByRole("checkbox", { name });
}

async function openIntegrations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  await screen.findByRole("checkbox", { name: SERVER });
}

async function expectFailedLoad() {
  await screen.findByText(/couldn.t be loaded/i);
  for (const name of MCP_TOGGLES) {
    expect(toggle(name)).toBeDisabled();
    expect(toggle(name)).toHaveAccessibleDescription(/couldn.t be loaded/i);
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(mcpRoute);
  resetMcp();
  (globalThis as unknown as Record<string, unknown>).__TAURI__ = {};
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI__;
});

describe("MCP-FIX-C1 load and refresh failures", () => {
  it("M3 a failed status re-fetch after a server toggle shows the inline error and no badge", async () => {
    const user = userEvent.setup();
    mcp.status = mcpStatus({ launch: "running", configured: "enabled" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());
    expect(await screen.findByRole("status")).toHaveTextContent("Running");

    mcp.status = new Error("status down");
    await user.click(toggle(SERVER));

    expect(await screen.findByText("status down")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Running/)).toBeNull();
    expect(screen.queryByText(/restart/i)).toBeNull();
    expect(callsFor("mcp_get_status")).toHaveLength(2);
    expect(toggle(SERVER)).not.toBeChecked();
    expect(toggle(SERVER)).toBeEnabled();
  });

  it("M4 get_preferences resolving without an mcp group is a failed load; nothing is written", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = null;
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    await expectFailedLoad();
    for (const name of MCP_TOGGLES) await user.click(toggle(name));
    expect(callsFor("set_preferences")).toHaveLength(0);
  });

  it("NE-1 a non-Error load rejection is a failed load and logs the string as the error", async () => {
    const user = userEvent.setup();
    useLoggingStore.setState({ enabled: true, level: "debug" });
    mcp.prefsError = "boom";
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    await expectFailedLoad();
    const fails = logged("ui.settings.mcp.load");
    expect(fails).toHaveLength(1);
    expect(fails[0].status).toBe("fail");
    expect(fails[0].error).toBe("boom");
    expect(callsFor("set_preferences")).toHaveLength(0);
  });
});
