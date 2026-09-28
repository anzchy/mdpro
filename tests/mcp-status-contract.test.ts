/**
 * ADR-0040 WI-4 (originally ADR-0039 WI-5) — TS half of the `mcp_get_status`
 * enum-domain contract, plus the `mcp_set_server_enabled` error strings.
 *
 * Case TS-01 of `.claude/tdd-guardian/tests-20260926-235500.md`, extended as
 * W-5 (TS-01′) of `.claude/tdd-guardian/tests-20260927-185126.md`: `launch`
 * became `phase` + `error` (ADR-0040 decision 5), and `switchError` is new.
 *
 * Both lanes read the same bytes, `tests/fixtures/mcp-status-contract.json`.
 * The Rust half is W-2 / W-3 in `src-tauri/src/services/mcp_launch_status_tests.rs`.
 *
 * Two layers:
 * - compile time: the `Record<Union, true>` literals below fail
 *   `pnpm typecheck:tests` if a union member is added or removed without the
 *   literal following;
 * - run time: the exported domain lists (which the unions are derived from)
 *   must equal the fixture, so the TS domain cannot drift from Rust silently.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MCP_CONFIGURED_STATES,
  MCP_PHASES,
  MCP_SERVER_ERRORS,
  MCP_SWITCH_ERRORS,
  type McpConfigured,
  type McpPhase,
  type McpServerError,
  type McpStatus,
  type McpSwitchError,
} from "../src/services/mcpService";

interface StatusContract {
  $statusKeys: string[];
  phase: string[];
  error: string[];
  configured: string[];
  switchError: string[];
}

function readStatusContract(): StatusContract {
  const testPath = expect.getState().testPath;
  expect(testPath).toBeTruthy();
  const fixturePath = resolve(dirname(testPath as string), "fixtures/mcp-status-contract.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as StatusContract;
}

const P: Record<McpPhase, true> = {
  disabled: true,
  starting: true,
  running: true,
  stopping: true,
  failed: true,
};
const E: Record<McpServerError, true> = {
  bind_in_use: true,
  bind_failed: true,
  publish_failed: true,
  serve_failed: true,
};
const S: Record<McpSwitchError, true> = {
  config_unreadable: true,
  exiting: true,
  persist_failed: true,
  status_unavailable: true,
};
const C: Record<McpConfigured, true> = { enabled: true, disabled: true, unreadable: true };
const K: Record<keyof Required<McpStatus>, true> = {
  running: true,
  port: true,
  binaryPath: true,
  phase: true,
  error: true,
  configured: true,
};

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("TS-01 McpStatus contract", () => {
  it("TS-01 the phase union equals the fixture's phase list", () => {
    const fx = readStatusContract();
    expect(sorted(Object.keys(P))).toEqual(sorted(fx.phase));
    expect(sorted(MCP_PHASES)).toEqual(sorted(fx.phase));
  });

  it("TS-01 the server-error union equals the fixture's error list", () => {
    const fx = readStatusContract();
    expect(sorted(Object.keys(E))).toEqual(sorted(fx.error));
    expect(sorted(MCP_SERVER_ERRORS)).toEqual(sorted(fx.error));
  });

  it("TS-01 the switch-error union equals the fixture's switchError list (PC-4)", () => {
    const fx = readStatusContract();
    expect(sorted(fx.switchError)).toEqual([
      "config_unreadable",
      "exiting",
      "persist_failed",
      "status_unavailable",
    ]);
    expect(sorted(Object.keys(S))).toEqual(sorted(fx.switchError));
    expect(sorted(MCP_SWITCH_ERRORS)).toEqual(sorted(fx.switchError));
  });

  it("TS-01 the configured union equals the fixture's configured list", () => {
    const fx = readStatusContract();
    expect(sorted(Object.keys(C))).toEqual(sorted(fx.configured));
    expect(sorted(MCP_CONFIGURED_STATES)).toEqual(sorted(fx.configured));
  });

  it("TS-01 McpStatus has exactly the Rust key set", () => {
    const fx = readStatusContract();
    expect(sorted(Object.keys(K))).toEqual(sorted(fx.$statusKeys));
    expect(fx.$statusKeys.some((k) => k.toLowerCase().includes("token"))).toBe(false);
  });
});
