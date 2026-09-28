/**
 * MCP-FIX-C1 (ADR-0039) — SettingsDialog MCP writes and loads that settle late.
 *
 * Laws:
 * 1. Session isolation — a write or load issued in one dialog open never
 *    changes what a later open shows (the load generation guards both).
 * 2. No overlapping writes — while an `mcp` write is in flight all three MCP
 *    toggles are disabled with an inline "Saving…" reason (rule 30.4), so a
 *    rejected earlier write can never roll the UI back under a later one.
 * 3. (ADR-0031 5b, WI-6, C1-c) `pendingToggle` changes only within the open
 *    that issued the write — a late success from a closed open marks nothing.
 *
 * ADR-0040 migration (WI-10): the server toggle no longer writes through
 * `set_preferences`; it calls `mcp_set_server_enabled`. C1-a / C1-a2 now drive
 * their `set_preferences` write with "Start on launch" (the rollback law is
 * unchanged), and C1-b / C1-c gate the switch call instead of the write.
 *
 * The only mock is `@tauri-apps/api/core`: `invoke` (route in
 * `tests/support/mcpSettingsHarness.ts`) and the `isTauri` spy from
 * `tests/support/tauriCoreMock.ts`, set true so `preferencesService` reaches
 * `invoke`.
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
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import { mcp, mcpRoute, mcpStatus, resetMcp } from "./support/mcpSettingsHarness";
import { deferred } from "./support/windowSaveHarness";

const MCP_TOGGLES = [/Enable MCP Server/i, /Start on launch/i, /Auto-approve/i] as const;
const [SERVER, LAUNCH, APPROVE] = MCP_TOGGLES;
const SAVE_FAILED_TOAST = "Failed to save preferences";
/** Any notSaved copy, old or new (RB-X item 8). */
const NOT_SAVED_NOTE = /Not saved|Changed elsewhere/i;
const noop = () => {};

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

function toggle(name: RegExp) {
  return screen.getByRole("checkbox", { name });
}

async function openIntegrations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  await screen.findByRole("checkbox", { name: SERVER });
}

async function waitHydrated() {
  await waitFor(() => expect(toggle(SERVER)).toBeEnabled());
}

/** Let every queued promise callback (a settled write, a late load) run. */
async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(mcpRoute);
  resetMcp();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("MCP-FIX-C1 write rollback respects the load generation", () => {
  it("C1-a a write from a closed open that rejects leaves the reopened failed-load state intact", async () => {
    const user = userEvent.setup();
    const write = deferred();
    mcp.setGate = write;
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitHydrated();
    // ADR-0040 migration: the server toggle no longer calls set_preferences.
    await user.click(toggle(LAUNCH));
    await waitFor(() => expect(callsFor("set_preferences")).toHaveLength(1));

    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    mcp.prefsError = new Error("parse");
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await screen.findByText(/couldn.t be loaded/i);

    mcp.setReplies = ["reject"];
    write.resolve();
    await waitFor(() => expect(useToastStore.getState().message).toBe(SAVE_FAILED_TOAST));
    await flush();

    expect(screen.getByText(/couldn.t be loaded/i)).toBeInTheDocument();
    for (const name of MCP_TOGGLES) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/couldn.t be loaded/i);
    }
    expect(screen.queryByText(NOT_SAVED_NOTE)).toBeNull();
    for (const name of MCP_TOGGLES) await user.click(toggle(name));
    expect(callsFor("set_preferences")).toHaveLength(1);
  });

  it("C1-a2 a write from a closed open that rejects does not overwrite the reopened loaded values", async () => {
    const user = userEvent.setup();
    const write = deferred();
    mcp.setGate = write;
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitHydrated();
    // ADR-0040 migration: the server toggle no longer calls set_preferences.
    await user.click(toggle(LAUNCH));
    await waitFor(() => expect(callsFor("set_preferences")).toHaveLength(1));

    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    mcp.prefsMcp = { serverEnabled: false, startOnLaunch: true, autoApproveEdits: true };
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitFor(() => expect(toggle(LAUNCH)).toBeChecked());

    mcp.setReplies = ["reject"];
    write.resolve();
    await waitFor(() => expect(useToastStore.getState().message).toBe(SAVE_FAILED_TOAST));
    await flush();

    expect(toggle(SERVER)).not.toBeChecked();
    expect(toggle(LAUNCH)).toBeChecked();
    expect(toggle(APPROVE)).toBeChecked();
    expect(screen.queryByText(NOT_SAVED_NOTE)).toBeNull();
  });

  it("C1-b while a write is in flight all three toggles are disabled with a Saving reason; only one write is issued", async () => {
    const user = userEvent.setup();
    const write = deferred();
    // ADR-0040 migration: the server toggle's write is the switch call, so its gate is held.
    mcp.switchGate = write;
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitHydrated();

    await user.click(toggle(SERVER));
    await waitFor(() => expect(callsFor("mcp_set_server_enabled")).toHaveLength(1));
    for (const name of MCP_TOGGLES) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Saving/);
    }
    expect(screen.getByText(/Saving/)).toBeInTheDocument();
    await user.click(toggle(LAUNCH));
    await user.click(toggle(APPROVE));
    // ADR-0040 migration: was set_preferences × 1 (the server write itself).
    expect(callsFor("set_preferences")).toHaveLength(0);
    expect(callsFor("mcp_set_server_enabled")).toHaveLength(1);

    write.resolve();
    await waitHydrated();
    for (const name of MCP_TOGGLES) {
      expect(toggle(name)).toBeEnabled();
      expect(toggle(name)).not.toHaveAccessibleDescription(/Saving/);
    }
    expect(toggle(SERVER)).not.toBeChecked();
    expect(toggle(LAUNCH)).not.toBeChecked();
    // ADR-0040 migration: was set_preferences × 1 (the server write itself).
    expect(callsFor("set_preferences")).toHaveLength(0);
    expect(callsFor("mcp_set_server_enabled")).toHaveLength(1);
  });
});

describe("C1-c (ADR-0031 5b, WI-6) a late successful write stays in its own open", () => {
  it("C1-c a successful write from a closed open does not mark the reopened open", async () => {
    const user = userEvent.setup();
    const write = deferred();
    // ADR-0040 migration: the server toggle's write is the switch call, so its gate is held.
    mcp.switchGate = write;
    mcp.prefsMcp = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ running: false, port: null, phase: "disabled", configured: "disabled" });
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitHydrated();
    await user.click(toggle(SERVER));
    await waitFor(() => expect(callsFor("mcp_set_server_enabled")).toHaveLength(1));

    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitHydrated();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Off"));

    write.resolve();
    await flush();

    expect(within(screen.getByRole("status")).queryByText(NOT_SAVED_NOTE)).toBeNull();
    expect(toggle(SERVER)).not.toBeChecked();
    expect(useToastStore.getState().message).toBeNull();
  });
});

describe("MCP-FIX-C1 M1 load generation guard", () => {
  it("M1-a a first-open load resolving late does not hydrate a reopened open whose load is still pending", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    mcp.prefsGate = first;
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: true, autoApproveEdits: true };
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    mcp.prefsGate = second;
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    first.resolve();
    await flush();

    for (const name of MCP_TOGGLES) {
      expect(toggle(name)).toBeDisabled();
      expect(toggle(name)).toHaveAccessibleDescription(/Loading/);
    }
    for (const name of MCP_TOGGLES) await user.click(toggle(name));
    expect(callsFor("set_preferences")).toHaveLength(0);
    second.resolve();
    await waitHydrated();
  });

  it("M1-b a first-open load failing late does not mark a reopened, hydrated open as failed", async () => {
    const user = userEvent.setup();
    const first = deferred();
    mcp.prefsGate = first;
    mcp.prefsError = new Error("late parse");
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    mcp.prefsGate = null;
    mcp.prefsError = null;
    mcp.prefsMcp = { serverEnabled: false, startOnLaunch: true, autoApproveEdits: false };
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);
    await waitHydrated();

    first.resolve();
    await flush();

    expect(screen.queryByText(/couldn.t be loaded/i)).toBeNull();
    for (const name of MCP_TOGGLES) expect(toggle(name)).toBeEnabled();
    expect(toggle(SERVER)).not.toBeChecked();
    expect(toggle(LAUNCH)).toBeChecked();
  });

  it("M1-c a first-open load failing late does not mark a reopened open whose load is still pending as failed", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    mcp.prefsGate = first;
    mcp.prefsError = new Error("late parse");
    const view = render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    view.rerender(<SettingsDialog open={false} onClose={noop} />);
    mcp.prefsGate = second;
    mcp.prefsError = null;
    view.rerender(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    first.resolve();
    await flush();

    expect(screen.queryByText(/couldn.t be loaded/i)).toBeNull();
    for (const name of MCP_TOGGLES) expect(toggle(name)).toHaveAccessibleDescription(/Loading/);
    second.resolve();
    await waitHydrated();
    expect(screen.queryByText(/couldn.t be loaded/i)).toBeNull();
  });
});
