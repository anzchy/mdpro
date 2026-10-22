// @vitest-environment node
/**
 * ADR-0040 WI-9 — `mcpService.setServerEnabled` and `isMcpSwitchError`.
 *
 * Cases U-1 and U-2 of `.claude/tdd-guardian/tests-20260927-185126.md`.
 *
 * Law: `isMcpSwitchError(x)` is true iff `x` is one of the fixture's
 * `switchError` strings, and narrowing is total — every rejection of
 * `mcp_set_server_enabled` becomes a list member or `"unknown"`.
 *
 * API shape pinned here: a rejection surfaces as an `McpSwitchFailure` whose
 * `.error` is the narrowed value.
 *
 * Mocked: only `@tauri-apps/api/core` `invoke` (no Tauri runtime in jsdom). The
 * Rust side of the command is paired by S-1 / S-7; the IPC hop is deferred to
 * the plan's GUI acceptance run.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  isMcpSwitchError,
  McpSwitchFailure,
  mcpService,
  setServerEnabled,
  type McpStatus,
} from "../src/services/mcpService";
import { collectionCases } from "./support/collectionCases";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-status-contract.json"), "utf8"),
) as { switchError: string[] };

const JUNK: unknown[] = [
  "PERSIST_FAILED",
  "persist_failed ",
  new Error("persist_failed"),
  { error: "exiting" },
  null,
  undefined,
  42,
  "",
];

beforeEach(() => {
  invokeMock.mockReset();
});

describe("U-1 setServerEnabled resolves to exactly the status invoke returned", () => {
  it("U-1 both argument values: the reply and the command + args", async () => {
    const off: McpStatus = {
      phase: "disabled", running: false, port: null, error: null, configured: "disabled", binaryPath: "b",
    };
    const on: McpStatus = {
      phase: "running", running: true, port: 55045, error: null, configured: "enabled", binaryPath: "b",
    };
    invokeMock.mockImplementation(async (_cmd, args) =>
      (args as { enabled: boolean }).enabled ? { ...on } : { ...off },
    );

    await expect(setServerEnabled(false)).resolves.toEqual(off);
    await expect(setServerEnabled(true)).resolves.toEqual(on);

    expect(invokeMock.mock.calls).toEqual([
      ["mcp_set_server_enabled", { enabled: false }],
      ["mcp_set_server_enabled", { enabled: true }],
    ]);
  });

  it("U-1 the service object exposes the same function", () => {
    expect(mcpService.setServerEnabled).toBe(setServerEnabled);
  });
});

describe("U-2 rejections narrow over the fixture domain plus junk", () => {
  it("U-2 the fixture switchError domain has the four strings", () => {
    expect(fixture.switchError).toHaveLength(4);
    expect(fixture.switchError).toContain("status_unavailable");
  });

  it.each(collectionCases("tests/mcp-service-switch.test.ts:90", fixture.switchError.map((e) => [e])))("U-2 %s narrows to itself", async (member) => {
    invokeMock.mockRejectedValue(member);
    const caught = await setServerEnabled(true).then(
      () => null,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(McpSwitchFailure);
    expect((caught as McpSwitchFailure).error).toBe(member);
  });

  it.each(JUNK.map((j) => [j]))("U-2 junk %o narrows to unknown", async (junk) => {
    invokeMock.mockRejectedValue(junk);
    const caught = await setServerEnabled(false).then(
      () => null,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(McpSwitchFailure);
    expect((caught as McpSwitchFailure).error).toBe("unknown");
  });

  it("U-2 isMcpSwitchError is true for exactly the fixture strings", () => {
    for (const member of fixture.switchError) expect(isMcpSwitchError(member), member).toBe(true);
    for (const junk of [...JUNK, "unknown"]) expect(isMcpSwitchError(junk), String(junk)).toBe(false);
  });
});
