/**
 * MCP-FIX-C1 (ADR-0039) — how the Settings MCP section degrades when a read fails.
 *
 * Cases:
 * - M3: the status re-fetch after a server toggle fails → no badge, the inline
 *   error, and the toggle keeps the value that was written. ADR-0040
 *   migration (WI-10): a switch reply carries its own status, so the only
 *   toggle that re-fetches is one refused with `status_unavailable` (T-9);
 *   M3 now drives that refusal. Its assertions are unchanged.
 * - M4: `get_preferences` resolves without an `mcp` group → failed-load state.
 * - Non-Error rejection: the load rejects with a plain string → failed-load
 *   state, and the `ui.settings.mcp.load` fail log carries an enum-only reason.
 * - E1 (ADR-0031 step 5b, matrix `tests-20260927-031000.md`): over every
 *   rejection shape, exactly one enum-only fail entry and no rejection text in
 *   any log payload of the row; a successful load logs nothing.
 *
 * The only mock is `@tauri-apps/api/core` — `invoke` (route in
 * `tests/support/mcpSettingsHarness.ts`) and the `isTauri` spy, set true so the
 * real `preferencesService` takes the Tauri branch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
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

/** Every `log_event` payload recorded since the last clear (whole-row capture). */
function logCalls(): LogEntryPayload[] {
  return callsFor("log_event").map(([, a]) => (a as { payload: LogEntryPayload }).payload);
}

function toggle(name: RegExp) {
  return screen.getByRole("switch", { name });
}

async function openIntegrations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  await screen.findByRole("switch", { name: SERVER });
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
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("MCP-FIX-C1 load and refresh failures", () => {
  it("M3 a failed status re-fetch after a server toggle shows the inline error and no badge", async () => {
    const user = userEvent.setup();
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());
    expect(await screen.findByRole("status")).toHaveTextContent("Running");

    mcp.status = new Error("status down");
    // ADR-0040 migration: only a status_unavailable refusal re-fetches the status now.
    mcp.switchReplies = [{ reject: "status_unavailable" }];
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

  // SPEC INVERSION (ADR-0031 step 5b, RB-X item 5): the fail entry used to carry
  // the rejection text as `error`; it now carries only an enum reason.
  it("NE-1 a non-Error load rejection is a failed load and logs an enum-only reason", async () => {
    const user = userEvent.setup();
    useLoggingStore.setState({ enabled: true, level: "debug" });
    mcp.prefsError = "boom";
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    await expectFailedLoad();
    const fails = logged("ui.settings.mcp.load");
    expect(fails).toHaveLength(1);
    expect(fails[0].status).toBe("fail");
    expect(fails[0]).not.toHaveProperty("error");
    expect(fails[0].context).toEqual({ reason: "invoke_rejected" });
    expect(JSON.stringify(logCalls())).not.toContain("boom");
    expect(callsFor("set_preferences")).toHaveLength(0);
  });

  it("E1 every load rejection shape logs one enum-only fail entry; a successful load logs none", async () => {
    expect(isTauri()).toBe(true);
    useLoggingStore.setState({ enabled: true, level: "debug" });
    expect(useLoggingStore.getState()).toMatchObject({ enabled: true, level: "debug" });
    const rows: Array<{ name: string; error: unknown }> = [
      { name: "Error", error: new Error("EACCES /Users/x/.mdpro/config.json") },
      { name: "string", error: "boom /Users/x" },
      { name: "object", error: { ParseError: { message: "expected value at line 1 column 3 /Users/x" } } },
      { name: "success", error: null },
    ];
    expect(rows).toHaveLength(4);

    for (const row of rows) {
      resetMcp();
      invokeMock.mockClear();
      mcp.prefsError = row.error;
      const user = userEvent.setup();
      const view = render(<SettingsDialog open onClose={noop} />);
      await openIntegrations(user);

      if (row.error === null) {
        await waitFor(() => expect(toggle(SERVER)).toBeEnabled());
        // Two loads: the MCP load and GeneralSettings' own mount load (GeneralSettings.tsx), which the old window-global detector hid.
        expect(callsFor("get_preferences")).toHaveLength(2);
        expect(logged("ui.settings.mcp.load")).toHaveLength(0);
      } else {
        await expectFailedLoad();
        // Two loads: the MCP load and GeneralSettings' own mount load (GeneralSettings.tsx), which the old window-global detector hid.
        expect(callsFor("get_preferences")).toHaveLength(2);
        for (const name of MCP_TOGGLES) await user.click(toggle(name));
        expect(callsFor("set_preferences")).toHaveLength(0);

        const fails = logged("ui.settings.mcp.load");
        expect(fails).toHaveLength(1);
        expect(fails[0].status).toBe("fail");
        expect(fails[0]).not.toHaveProperty("error");
        expect(fails[0].context).toEqual({ reason: "invoke_rejected" });

        const whole = JSON.stringify(logCalls());
        for (const forbidden of ["/Users", "EACCES", "boom", "line 1", "message"]) {
          expect(whole).not.toContain(forbidden);
        }
      }
      view.unmount();
    }
  });
});
