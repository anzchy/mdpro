/**
 * Shared IPC fake for the SettingsDialog MCP write-race and load-failure suites
 * (MCP-FIX-C1): `tests/settings-dialog-mcp-write-races.test.tsx` and
 * `tests/settings-dialog-mcp-load-failures.test.tsx`.
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
};

export function mcpStatus(partial: Partial<McpStatus> = {}): McpStatus {
  return { running: true, port: 55045, binaryPath: "b", launch: "running", configured: "enabled", ...partial };
}

export function resetMcp(): void {
  mcp.prefsMcp = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
  mcp.prefsGate = null;
  mcp.prefsError = null;
  mcp.setGate = null;
  mcp.setReplies = [];
  mcp.status = mcpStatus();
}

export async function mcpRoute(cmd: unknown, args: unknown): Promise<unknown> {
  switch (cmd) {
    case "mcp_get_status": {
      const reply = mcp.status;
      if (reply instanceof Error) throw reply;
      return reply ? { ...reply } : null;
    }
    case "mcp_get_installations":
      return [];
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
