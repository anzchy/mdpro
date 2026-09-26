/**
 * WI-5 (ADR-0039) — TS half of the `mcp_get_status` enum-domain contract.
 *
 * Case TS-01 of `.claude/tdd-guardian/tests-20260926-235500.md`.
 *
 * Both lanes read the same bytes, `tests/fixtures/mcp-status-contract.json`.
 * The Rust half is BS-04 / BS-05 in `src-tauri/src/services/mcp_launch_status_tests.rs`.
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
  MCP_LAUNCH_STATES,
  type McpConfigured,
  type McpLaunch,
  type McpStatus,
} from "../src/services/mcpService";

interface StatusContract {
  $statusKeys: string[];
  launch: string[];
  configured: string[];
}

function readStatusContract(): StatusContract {
  const testPath = expect.getState().testPath;
  expect(testPath).toBeTruthy();
  const fixturePath = resolve(dirname(testPath as string), "fixtures/mcp-status-contract.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as StatusContract;
}

const L: Record<McpLaunch, true> = { starting: true, running: true, failed: true, disabled: true };
const C: Record<McpConfigured, true> = { enabled: true, disabled: true, unreadable: true };
const K: Record<keyof Required<McpStatus>, true> = {
  running: true,
  port: true,
  binaryPath: true,
  launch: true,
  configured: true,
};

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("TS-01 McpStatus contract", () => {
  it("TS-01 the launch union equals the fixture's launch list", () => {
    const fx = readStatusContract();
    expect(sorted(Object.keys(L))).toEqual(sorted(fx.launch));
    expect(sorted(MCP_LAUNCH_STATES)).toEqual(sorted(fx.launch));
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
