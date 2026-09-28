/**
 * ADR-0040 WI-10 — outcomes across more than one switch call, and the
 * `status_unavailable` contract. Cases T-4b, T-9 and T-9b of
 * `.claude/tdd-guardian/tests-20260927-185126.md` (T-9 / T-9b from r2).
 *
 * Laws:
 * - The latest outcome replaces earlier ones: a refusal's note or toast does
 *   not outlive a later successful toggle in the same open (T-4b).
 * - `status_unavailable` means the setting saved but the status could not be
 *   read: keep the requested value, toast once, and re-read the status (T-9).
 *
 * The only mock is `@tauri-apps/api/core` — `invoke` routed through
 * `tests/support/mcpSettingsHarness.ts`, and `isTauri` set true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import { mcp, mcpRoute, mcpStatus, resetMcp } from "./support/mcpSettingsHarness";
import {
  UNREADABLE_NOTE, callsFor, flush, recordToasts, region, renderIntegrations, server,
} from "./support/mcpSwitchUi";

const OFF = mcpStatus({ phase: "disabled", configured: "disabled", running: false, port: null, error: null });

const stops: Array<() => void> = [];
function toasts() {
  const t = recordToasts();
  stops.push(t.stop);
  return t.seen;
}

const calls = (command: string) => callsFor(invokeMock, command);

async function settled(n: number) {
  await waitFor(() => expect(calls("mcp_set_server_enabled")).toHaveLength(n));
  await waitFor(() => expect(server()).toBeEnabled());
  await flush();
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(mcpRoute);
  resetMcp();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

afterEach(() => {
  while (stops.length) stops.pop()?.();
});

describe("T-4b a later successful toggle clears an earlier refusal", () => {
  it("T-4b(a) config_unreadable then ok: the unreadable note is gone and Off shows", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    mcp.switchReplies = [{ reject: "config_unreadable" }, OFF];
    await renderIntegrations(user);

    await user.click(server());
    await settled(1);
    expect(region()).toHaveTextContent(UNREADABLE_NOTE);
    expect(server()).toBeChecked();

    await user.click(server());
    await settled(2);
    expect(region()).toHaveTextContent("Off");
    expect(region()).not.toHaveTextContent("Settings file unreadable");
    expect(server()).not.toBeChecked();
  });

  it("T-4b(b) persist_failed then ok: one toast in total, and the badge alone after the second click", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    mcp.switchReplies = [{ reject: "persist_failed" }, OFF];
    await renderIntegrations(user);
    const seen = toasts();

    await user.click(server());
    await settled(1);
    expect(server()).toBeChecked();

    await user.click(server());
    await settled(2);
    expect(seen).toHaveLength(1);
    expect(region().textContent).toBe("Off");
    expect(server()).not.toBeChecked();
  });
});

describe("T-9 status_unavailable keeps the toggle, toasts once, and re-reads the status", () => {
  it("T-9 the refetched status shows, the requested value stays, one toast", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "disabled", configured: "disabled", running: false, port: null });
    mcp.switchReplies = [{ reject: "status_unavailable" }];
    await renderIntegrations(user);
    const seen = toasts();

    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    await user.click(server());
    await settled(1);
    await waitFor(() => expect(region()).toHaveTextContent("Running"));

    expect(server()).toBeChecked();
    expect(seen).toHaveLength(1);
    const order = invokeMock.mock.calls.map(([c]) => c);
    const switchAt = order.indexOf("mcp_set_server_enabled");
    expect(order.slice(switchAt + 1)).toContain("mcp_get_status");
    expect(region()).not.toHaveTextContent("Settings file unreadable");
  });

  it("T-9b the refetch itself rejects: still checked, still one toast, nothing throws", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "disabled", configured: "disabled", running: false, port: null });
    mcp.switchReplies = [{ reject: "status_unavailable" }];
    await renderIntegrations(user);
    const seen = toasts();

    mcp.status = new Error("status down");
    await user.click(server());
    await settled(1);

    const order = invokeMock.mock.calls.map(([c]) => c);
    expect(order.slice(order.indexOf("mcp_set_server_enabled") + 1)).toContain("mcp_get_status");
    expect(server()).toBeChecked();
    expect(seen).toHaveLength(1);
  });
});
