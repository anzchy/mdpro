// @vitest-environment node
/**
 * WI-5 (ADR-0039) — `mcpService.getStatus` returns the typed status Rust sends.
 *
 * Case TS-02 of `.claude/tdd-guardian/tests-20260926-235500.md`.
 *
 * Self-check (recorded in the matrix): `getStatus` is a one-line `invoke`
 * passthrough, so a hard-coded return would also pass. TS-01 carries the real
 * contract weight; this case pins the command string and the typed shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getStatus, type McpStatus } from "../src/services/mcpService";

// Literal copied from BS-04's wire shape (camelCase keys, lowercase enum values).
const WIRE: McpStatus = {
  running: false,
  port: null,
  binaryPath: "b",
  phase: "disabled",
  error: null,
  configured: "disabled",
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: unknown) =>
    cmd === "mcp_get_status" ? { ...WIRE } : null,
  );
});

describe("TS-02 getStatus", () => {
  it("TS-02 returns the typed status produced by the Rust serialiser", async () => {
    const status = await getStatus();
    expect(status).toEqual(WIRE);
    expect(status.phase).toBe("disabled");
    expect(status.configured).toBe("disabled");
    expect(invokeMock.mock.calls[0][0]).toBe("mcp_get_status");
  });
});
