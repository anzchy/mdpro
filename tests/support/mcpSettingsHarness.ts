/**
 * Shared IPC fake for the SettingsDialog MCP write-race and load-failure suites
 * (MCP-FIX-C1): `tests/settings-dialog-mcp-write-races.test.tsx`,
 * `tests/settings-dialog-mcp-load-failures.test.tsx`, the ADR-0031 5b N5
 * timing suite `tests/mcp-not-saved-timing.test.tsx`, and the ADR-0040 WI-10
 * live-switch suites `tests/settings-mcp-server-switch*.test.tsx`.
 *
 * ADR-0040 WI-10 adds the `mcp_set_server_enabled` route: its reply is the next
 * `switchReplies` entry (a status, or `{ reject }` to throw that value), or —
 * when the queue is empty — the status the switch would plausibly return. It
 * also records every `log_event` payload into `mcp.logs`.
 *
 * The test files own `vi.hoisted` + `vi.mock("@tauri-apps/api/core")`; this
 * module only supplies the `invoke` route and the per-case state it reads.
 *
 * Every reply is decided from the state **at call time**, then awaits its gate.
 * So a call issued in one dialog open keeps that open's behaviour even if the
 * next open changes the state — which is what lets a late reply from an earlier
 * open be delivered after a later open started.
 *
 * Imports no application code (type-only), matching `windowSaveHarness.ts`.
 */
import type { McpStatus } from "../../src/services/mcpService";
import type { LogEntryPayload } from "../../src/types/logging";
import type { McpConfig, UserPreferences } from "../../src/types/preferences";
import { makePreferences } from "./preferenceFixtures";
import type { Deferred } from "./windowSaveHarness";

export const mcp = {
  /** `mcp` group returned by `get_preferences`; `null` omits the group. */
  prefsMcp: null as McpConfig | null,
  prefsGate: null as Deferred | null,
  /** Thrown (after the gate) by `get_preferences`; may be a non-Error. */
  prefsError: null as unknown,
  setGate: null as Deferred | null,
  /** Consumed per `set_preferences` call **after** its gate opens. */
  setReplies: [] as Array<"ok" | "reject">,
  status: null as McpStatus | Error | null,
  /** Awaited by `mcp_get_status` after its reply is chosen (ADR-0031 5b, N5). */
  statusGate: null as Deferred | null,
  /** Awaited by `mcp_set_server_enabled` after its reply is chosen. */
  switchGate: null as Deferred | null,
  /** Consumed per `mcp_set_server_enabled` call, **at call time**. */
  switchReplies: [] as SwitchReply[],
  /** Every `log_event` payload, in call order. */
  logs: [] as LogEntryPayload[],
};

/** A switch reply: the status Rust returns, or a rejection value. */
export type SwitchReply = McpStatus | { reject: unknown };

export function mcpStatus(partial: Partial<McpStatus> = {}): McpStatus {
  return { running: true, port: 55045, binaryPath: "b", phase: "running", error: null, configured: "enabled", ...partial };
}

export function resetMcp(): void {
  mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
  mcp.prefsGate = null;
  mcp.prefsError = null;
  mcp.setGate = null;
  mcp.setReplies = [];
  mcp.status = mcpStatus();
  mcp.statusGate = null;
  mcp.switchGate = null;
  mcp.switchReplies = [];
  mcp.logs = [];
}

/** The status a successful switch to `enabled` returns when no reply is queued. */
export function switchedStatus(enabled: boolean): McpStatus {
  return mcpStatus({
    running: enabled,
    port: enabled ? 55045 : null,
    phase: enabled ? "running" : "disabled",
    configured: enabled ? "enabled" : "disabled",
  });
}

export async function mcpRoute(cmd: unknown, args: unknown): Promise<unknown> {
  switch (cmd) {
    case "mcp_get_status": {
      const { status: reply, statusGate: gate } = mcp;
      if (gate) await gate.promise;
      if (reply instanceof Error) throw reply;
      return reply ? { ...reply } : null;
    }
    case "mcp_get_installations":
      return [];
    case "mcp_set_server_enabled": {
      const { enabled } = args as { enabled: boolean };
      const reply = mcp.switchReplies.shift() ?? switchedStatus(enabled);
      const gate = mcp.switchGate;
      if (gate) await gate.promise;
      if ("reject" in reply) throw reply.reject;
      return { ...reply };
    }
    case "log_event":
      mcp.logs.push((args as { payload: LogEntryPayload }).payload);
      return null;
    case "get_preferences": {
      const { prefsGate: gate, prefsError: error, prefsMcp: group } = mcp;
      if (gate) await gate.promise;
      if (error !== null) throw error;
      const prefs = makePreferences(group ? { mcp: group } : {});
      if (!group) delete (prefs as Partial<UserPreferences>).mcp;
      return prefs;
    }
    case "set_preferences": {
      const gate = mcp.setGate;
      if (gate) await gate.promise;
      if ((mcp.setReplies.shift() ?? "ok") === "reject") throw new Error("disk full");
      return makePreferences((args as { preferences: Partial<UserPreferences> }).preferences);
    }
    default:
      return null;
  }
}
