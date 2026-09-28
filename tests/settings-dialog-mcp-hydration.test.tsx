/**
 * WI-7 (F3, ADR-0039) — SettingsDialog must not write a default `mcp` group.
 *
 * Cases F3-01 … F3-06 of `.claude/tdd-guardian/tests-20260926-235500.md`.
 *
 * Laws:
 * 1. Ordering — no `set_preferences` carrying `mcp` before this open's
 *    `get_preferences` resolved, from any of the three MCP checkboxes.
 * 2. Conservation — every `mcp` payload is the group loaded in this open with
 *    exactly the user's changes applied.
 *
 * ADR-0040 migration (WI-10): the server toggle calls `mcp_set_server_enabled`
 * instead of writing the group, so F3-03 / F3-04 / F3-05 observe that call for
 * the server flip and read the group conservation off the next
 * `set_preferences` write (from another toggle). The route gains the switch.
 *
 * The only mock is `@tauri-apps/api/core` (`invoke`, plus the `isTauri` spy from
 * `tests/support/tauriCoreMock.ts`, set true so `preferencesService` takes the
 * Tauri branch); otherwise "zero writes" would be
 * vacuous. Replaces the source-bytes DEFAULT_MCP_CONFIG assertion formerly in
 * `tests/settings-dialog.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import type { McpConfig, UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";
import { assertGroupsComplete, foldWrites } from "./support/preferenceFold";
import { deferred, type Deferred } from "./support/windowSaveHarness";

const MCP_TOGGLES = [/Enable MCP Server/i, /Start on launch/i, /Auto-approve/i] as const;
const [SERVER, LAUNCH, APPROVE] = MCP_TOGGLES;
const noop = () => {};

// Per-phase `get_preferences` behaviour. Every settings page loads preferences
// on mount (GeneralSettings is the default page), so the reply is a phase-wide
// state rather than a per-call queue.
let prefsMcp: McpConfig;
let prefsGate: Deferred | null;
let prefsError: Error | null;
let setReplies: Array<"ok" | "reject">;
/** ADR-0040 migration: replies of `mcp_set_server_enabled`; "reject" throws `persist_failed`. */
let switchReplies: Array<"ok" | "reject">;

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

function sentPayloads(): Array<Partial<UserPreferences>> {
  return callsFor("set_preferences").map(
    ([, a]) => (a as { preferences: Partial<UserPreferences> }).preferences,
  );
}

async function route(cmd: unknown, args: unknown): Promise<unknown> {
  switch (cmd) {
    case "mcp_get_status":
      return { running: true, port: 55045, binaryPath: "b", phase: "running", error: null, configured: "enabled" };
    case "mcp_get_installations":
      return [];
    case "get_preferences": {
      const gate = prefsGate;
      if (prefsError) throw prefsError;
      if (gate) await gate.promise;
      return makePreferences({ mcp: prefsMcp });
    }
    case "set_preferences": {
      if ((setReplies.shift() ?? "ok") === "reject") throw new Error("disk full");
      return makePreferences((args as { preferences: Partial<UserPreferences> }).preferences);
    }
    case "mcp_set_server_enabled": {
      if ((switchReplies.shift() ?? "ok") === "reject") throw "persist_failed";
      const on = (args as { enabled: boolean }).enabled;
      const phase = on ? "running" : "disabled";
      return { running: on, port: on ? 55045 : null, binaryPath: "b", phase, error: null, configured: on ? "enabled" : "disabled" };
    }
    default:
      return null;
  }
}

async function openIntegrations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  await screen.findByRole("checkbox", { name: SERVER });
}

function toggle(name: RegExp) {
  return screen.getByRole("checkbox", { name });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(route);
  prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
  prefsGate = null;
  prefsError = null;
  setReplies = [];
  switchReplies = [];
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("WI-7 SettingsDialog MCP hydration (F3)", () => {
  it("F3-01 pending load: all three disabled with Loading, clicks write nothing, resolve renders loaded values", async () => {
    const user = userEvent.setup();
    const gate = deferred();
    prefsMcp = { serverEnabled: false, startOnLaunch: true, autoApproveEdits: true };
    prefsGate = gate;
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    expect(callsFor("get_preferences").length).toBeGreaterThan(0);

    for (const name of MCP_TOGGLES) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Loading/);
    }
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    for (const name of MCP_TOGGLES) await user.click(toggle(name));
    expect(callsFor("set_preferences")).toHaveLength(0);

    gate.resolve();
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());
    for (const name of MCP_TOGGLES) expect(toggle(name)).toBeEnabled();
    expect(toggle(SERVER)).not.toBeChecked();
    expect(toggle(LAUNCH)).toBeChecked();
    expect(toggle(APPROVE)).toBeChecked();
    expect(callsFor("set_preferences")).toHaveLength(0);
  });

  it("F3-02 failed load: all three stay disabled with a couldn't-be-loaded reason; nothing is written", async () => {
    const user = userEvent.setup();
    prefsError = new Error("parse");
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    await screen.findByText(/couldn.t be loaded/i);
    for (const name of MCP_TOGGLES) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/couldn.t be loaded/i);
    }
    for (const name of MCP_TOGGLES) await user.click(toggle(name));
    for (const name of MCP_TOGGLES) expect(toggle(name)).toBeDisabled();
    expect(callsFor("set_preferences")).toHaveLength(0);
  });

  // ADR-0040 migration: the server flip is the switch call; the next group write
  // (Start on launch) carries the loaded group with exactly the two flips applied.
  it("F3-03 after hydration, flipping serverEnabled calls the switch, and the next group write builds on the loaded group", async () => {
    const user = userEvent.setup();
    prefsMcp = { serverEnabled: true, startOnLaunch: true, autoApproveEdits: true };
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(LAUNCH)).toBeChecked());
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());

    await user.click(toggle(SERVER));

    await waitFor(() => expect(callsFor("mcp_set_server_enabled")).toHaveLength(1));
    expect(callsFor("mcp_set_server_enabled")[0][1]).toEqual({ enabled: false });
    expect(callsFor("set_preferences")).toHaveLength(0);
    await waitFor(() => expect(toggle(LAUNCH)).toBeEnabled());
    await user.click(toggle(LAUNCH));
    await waitFor(() => expect(callsFor("set_preferences")).toHaveLength(1));
    expect(callsFor("set_preferences")[0][1]).toEqual({
      preferences: { mcp: { serverEnabled: false, startOnLaunch: false, autoApproveEdits: true } },
    });
  });

  it("F3-04 two consecutive toggles fold to both changes and conserve the third field", async () => {
    const user = userEvent.setup();
    const loaded: McpConfig = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: true };
    prefsMcp = loaded;
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(APPROVE)).toBeChecked());
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());

    // ADR-0040 migration: the server flip is the switch call, not a group write,
    // so the one group write (Start on launch) must carry both changes.
    await user.click(toggle(SERVER));
    await waitFor(() => expect(callsFor("mcp_set_server_enabled")).toHaveLength(1));
    await waitFor(() => expect(toggle(LAUNCH)).toBeEnabled());
    await user.click(toggle(LAUNCH));
    await waitFor(() => expect(callsFor("set_preferences")).toHaveLength(1));

    const writes = sentPayloads();
    assertGroupsComplete(writes);
    for (const w of writes) {
      expect(Object.keys(w.mcp ?? {}).sort()).toEqual(["autoApproveEdits", "serverEnabled", "startOnLaunch"]);
    }
    const folded = foldWrites(makePreferences({ mcp: loaded }), writes);
    expect(folded.mcp).toEqual({ serverEnabled: false, startOnLaunch: true, autoApproveEdits: true });
  });

  it("F3-05 a rejected write reverts the toggle and the next write builds on the loaded group", async () => {
    const user = userEvent.setup();
    prefsMcp = { serverEnabled: true, startOnLaunch: true, autoApproveEdits: false };
    // ADR-0040 migration: the rejected write is the switch call (persist_failed).
    switchReplies = ["reject"];
    let toasts = 0;
    const unsubscribe = useToastStore.subscribe((s, prev) => {
      if (s.message === "Failed to save preferences" && prev.message !== s.message) toasts += 1;
    });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(LAUNCH)).toBeChecked());
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());

    await user.click(toggle(SERVER));
    await waitFor(() => expect(callsFor("mcp_set_server_enabled")).toHaveLength(1));
    await waitFor(() => expect(toggle(SERVER)).toBeChecked());
    await waitFor(() => expect(toggle(APPROVE)).toBeEnabled());

    await user.click(toggle(APPROVE));
    // ADR-0040 migration: was set_preferences × 2 with the second payload checked.
    await waitFor(() => expect(callsFor("set_preferences")).toHaveLength(1));
    expect(sentPayloads()[0]).toEqual({
      mcp: { serverEnabled: true, startOnLaunch: true, autoApproveEdits: true },
    });
    expect(toasts).toBe(1);
    unsubscribe();
  });

  it("F3-06 reopening resets hydration: with the second load pending, all three are disabled and nothing is written", async () => {
    const user = userEvent.setup();
    const gate = deferred();
    prefsMcp = { serverEnabled: false, startOnLaunch: true, autoApproveEdits: true };
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(LAUNCH)).toBeChecked());
    await waitFor(() => expect(toggle(SERVER)).toBeEnabled());

    const loadsBefore = callsFor("get_preferences").length;
    prefsGate = gate;
    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    expect(callsFor("get_preferences").length).toBeGreaterThan(loadsBefore);

    for (const name of MCP_TOGGLES) expect(toggle(name)).toBeDisabled();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
    for (const name of MCP_TOGGLES) await user.click(toggle(name));
    for (const name of MCP_TOGGLES) expect(toggle(name)).toBeDisabled();
    expect(callsFor("set_preferences")).toHaveLength(0);
    gate.resolve();
  });
});
