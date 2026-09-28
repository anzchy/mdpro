/**
 * ADR-0040 WI-10 — the live switch under concurrency, across dialog opens, and
 * in the log. Cases T-6, T-7 and T-8 of
 * `.claude/tdd-guardian/tests-20260927-185126.md`.
 *
 * Laws:
 * - Serialization at the UI: one switch call at a time; the toggle is locked
 *   with the "Saving…" reason while it is in flight (T-6).
 * - Session isolation: a reply to an earlier open never changes a later open
 *   (T-7). Toast behaviour for a stale failure is deliberately not asserted.
 * - One actionId per toggle, `start` then `success` | `fail`, with an
 *   enum-bounded context and no path or token anywhere (T-8).
 *
 * The only mock is `@tauri-apps/api/core` — `invoke` routed through
 * `tests/support/mcpSettingsHarness.ts` (which records `log_event` payloads),
 * and `isTauri` set true.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import contract from "./fixtures/mcp-status-contract.json";
import { mcp, mcpRoute, mcpStatus, resetMcp, type SwitchReply } from "./support/mcpSettingsHarness";
import {
  callsFor, dialog, flush, openIntegrations, region, renderIntegrations, server,
} from "./support/mcpSwitchUi";
import { deferred } from "./support/windowSaveHarness";

const EVENT = "ui.settings.mcp.serverToggle";
const calls = (command: string) => callsFor(invokeMock, command);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(mcpRoute);
  resetMcp();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("T-6 a double click while pending", () => {
  it("T-6 gives one invoke, a disabled toggle and the Saving reason; unlocks after the reply", async () => {
    const user = userEvent.setup();
    const gate = deferred();
    mcp.switchGate = gate;
    await renderIntegrations(user);

    await user.click(server());
    await waitFor(() => expect(calls("mcp_set_server_enabled")).toHaveLength(1));
    await user.click(server());

    expect(calls("mcp_set_server_enabled")).toHaveLength(1);
    expect(server()).toBeDisabled();
    const reasonId = server().getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId as string)?.textContent).toBe("Saving…");

    gate.resolve();
    await waitFor(() => expect(server()).toBeEnabled());
    expect(calls("mcp_set_server_enabled")).toHaveLength(1);
  });
});

describe("T-7 a reply from a previous open never changes the current open", () => {
  it.each([
    { name: "ok {phase: disabled}", reply: mcpStatus({ phase: "disabled", configured: "disabled", running: false, port: null }) as SwitchReply },
    { name: "persist_failed rejection", reply: { reject: "persist_failed" } as SwitchReply },
  ])("T-7 $name", async ({ reply }) => {
    const user = userEvent.setup();
    const gate = deferred();
    mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = mcpStatus({ phase: "running", configured: "enabled" });
    mcp.switchGate = gate;
    mcp.switchReplies = [reply];
    const view = await renderIntegrations(user);
    await user.click(server());
    await waitFor(() => expect(calls("mcp_set_server_enabled")).toHaveLength(1));

    view.rerender(dialog(false));
    mcp.switchGate = null;
    view.rerender(dialog(true));
    await openIntegrations(user);
    await waitFor(() => expect(region()).toHaveTextContent("Running"));

    gate.resolve();
    await flush();

    expect(server()).toBeChecked();
    expect(region()).toHaveTextContent("Running");
    expect(region()).not.toHaveTextContent("Off");
    expect(server()).toBeEnabled();
  });
});

describe("T-8 the toggle log", () => {
  it("T-8 one actionId per toggle, start then success|fail, enum-only context, no path or token", async () => {
    useLoggingStore.setState({ enabled: true, level: "debug" });
    const binaryPath = "/Applications/x";
    const secret = "/Users/jack/Library/Application Support/mdpro";
    const scenarios: Array<{ prefs: boolean; reply: SwitchReply }> = [
      { prefs: true, reply: mcpStatus({ binaryPath, phase: "disabled", configured: "disabled", running: false, port: null }) },
      { prefs: false, reply: mcpStatus({ binaryPath, phase: "failed", error: "bind_in_use", configured: "enabled", running: false, port: null }) },
      { prefs: true, reply: { reject: new Error(`persist_failed: EACCES ${secret}/config.json`) } },
      { prefs: true, reply: { reject: "config_unreadable" } },
    ];

    for (const [i, s] of scenarios.entries()) {
      const user = userEvent.setup();
      mcp.prefsMcp = { serverEnabled: s.prefs, startOnLaunch: false, autoApproveEdits: false };
      mcp.status = mcpStatus({ binaryPath, phase: s.prefs ? "running" : "disabled", configured: s.prefs ? "enabled" : "disabled" });
      mcp.switchReplies = [s.reply];
      const view = await renderIntegrations(user);
      await user.click(server());
      await waitFor(() => expect(calls("mcp_set_server_enabled")).toHaveLength(i + 1));
      await waitFor(() => expect(server()).toBeEnabled());
      await flush();
      view.unmount();
    }

    const payloads = mcp.logs.filter((p) => p.event === EVENT);
    const groups = new Map<string, string[]>();
    for (const p of payloads) {
      expect(typeof p.actionId).toBe("string");
      groups.set(p.actionId as string, [...(groups.get(p.actionId as string) ?? []), p.status]);
    }
    expect(groups.size).toBe(4);
    for (const statuses of groups.values()) {
      expect([["start", "success"], ["start", "fail"]]).toContainEqual(statuses);
    }

    const errorDomain = [...contract.switchError, ...contract.error, "unknown"];
    const keys = new Set(payloads.flatMap((p) => Object.keys(p.context ?? {})));
    for (const k of keys) expect(["direction", "phase", "error"]).toContain(k);
    for (const p of payloads) {
      if (p.error !== undefined && p.error !== null) expect(errorDomain).toContain(p.error);
      const ctx = (p.context ?? {}) as Record<string, unknown>;
      expect(["on", "off"]).toContain(ctx.direction);
      if (ctx.phase !== undefined) expect(contract.phase).toContain(ctx.phase);
      if (ctx.error !== undefined) expect(errorDomain).toContain(ctx.error);
    }

    expect(JSON.stringify(payloads)).not.toContain("/");
    const everything = JSON.stringify(mcp.logs);
    for (const forbidden of ["/Users", "/Applications", "EACCES", "token"]) {
      expect(everything.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
