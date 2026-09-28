/**
 * ADR-0040 WI-10 — the Settings server toggle calls `mcp_set_server_enabled`.
 * Cases T-1 … T-5 of `.claude/tdd-guardian/tests-20260927-185126.md`.
 *
 * Law (rule 30.5, one signal per event): an ok reply is shown by the badge it
 * returns (plus the saved-on note for a failed start); a refused save is
 * shown by one toast and no note; an unreadable config by its note and no
 * toast. The other two toggles still write the whole group through
 * `set_preferences`.
 *
 * The only mock is `@tauri-apps/api/core` — `invoke` routed through
 * `tests/support/mcpSettingsHarness.ts`, and `isTauri` set true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { screen, waitFor } from "@testing-library/react";
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
  LAUNCH, SAVED_ON_NOTE, SAVE_FAILED_TOAST, UNREADABLE_NOTE,
  callsFor, flush, recordToasts, region, renderIntegrations, server,
} from "./support/mcpSwitchUi";

const stops: Array<() => void> = [];
function toasts() {
  const t = recordToasts();
  stops.push(t.stop);
  return t.seen;
}

const calls = (command: string) => callsFor(invokeMock, command);

/** Wait until the switch call count reached `n` and the toggle is unlocked again. */
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

describe("WI-10 the server toggle goes through mcp_set_server_enabled", () => {
  it("T-1 clicking off shows Off from the returned status, with no restart note and no refetch", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    mcp.switchReplies = [mcpStatus({ phase: "disabled", configured: "disabled", running: false, port: null })];
    await renderIntegrations(user);
    expect(region()).toHaveTextContent("Running");
    const statusBefore = calls("mcp_get_status").length;

    await user.click(server());
    await settled(1);

    expect(invokeMock).toHaveBeenCalledWith("mcp_set_server_enabled", { enabled: false });
    expect(region().textContent).toBe("Off");
    expect(region()).not.toHaveTextContent("Running");
    expect(screen.queryByText(/restart/i)).toBeNull();
    expect(server()).not.toBeChecked();
    expect(calls("mcp_get_status")).toHaveLength(statusBefore);
    expect(calls("set_preferences")).toHaveLength(0);
  });

  it("T-2 a bind failure keeps the toggle on and shows Failed plus the saved-on note, with no toast", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "disabled", configured: "disabled", running: false, port: null });
    mcp.switchReplies = [
      mcpStatus({ phase: "failed", error: "bind_in_use", configured: "enabled", running: false, port: null }),
    ];
    await renderIntegrations(user);
    const seen = toasts();

    await user.click(server());
    await settled(1);

    expect(server()).toBeChecked();
    expect(region()).toHaveTextContent("Failed to start");
    expect(region()).toHaveTextContent(SAVED_ON_NOTE);
    expect(seen).toEqual([]);
    expect(useToastStore.getState().message).toBeNull();
  });

  it.each([
    { name: "(a) persist_failed", reject: "persist_failed" as unknown },
    { name: "(b) unknown, carrying a path", reject: new Error("boom /Users/x") as unknown },
  ])("T-3 $name reverts the toggle, with exactly one toast and no note", async ({ reject }) => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    mcp.switchReplies = [{ reject }];
    await renderIntegrations(user);
    const seen = toasts();

    await user.click(server());
    await settled(1);

    expect(server()).toBeChecked();
    expect(seen).toEqual([SAVE_FAILED_TOAST]);
    expect(region().textContent).toBe("Running");
    expect(document.body.textContent ?? "").not.toContain("/Users");
  });

  it("T-4 config_unreadable reverts the toggle and shows the unreadable note, with no toast", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    mcp.switchReplies = [{ reject: "config_unreadable" }];
    await renderIntegrations(user);
    const seen = toasts();

    await user.click(server());
    await settled(1);

    expect(server()).toBeChecked();
    expect(region()).toHaveTextContent(UNREADABLE_NOTE);
    expect(seen).toEqual([]);
  });

  it("T-5 startOnLaunch still writes the whole group through set_preferences, not the switch", async () => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    await renderIntegrations(user);

    await user.click(screen.getByRole("checkbox", { name: LAUNCH }));
    await waitFor(() => expect(calls("set_preferences")).toHaveLength(1));
    await flush();

    expect(calls("set_preferences")[0][1]).toEqual({
      preferences: { mcp: { serverEnabled: true, startOnLaunch: true, autoApproveEdits: false } },
    });
    expect(calls("mcp_set_server_enabled")).toHaveLength(0);
  });
});
