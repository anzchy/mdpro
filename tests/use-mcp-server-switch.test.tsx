/**
 * ADR-0040 WI-10 — `useMcpServerSwitch`, cases H-1 and H-2 of
 * `.claude/tdd-guardian/tests-20260927-185126.md`; H-3 closes the refused-lease
 * branch the 2026-09-28 coverage audit found uncovered.
 *
 * Laws:
 * - State machine: `idle → saving → idle` over every reply kind; `saving` is
 *   never left true once the call settles.
 * - Latest outcome replaces earlier ones: after a settled call, `outcome` is
 *   that call's outcome only (`exiting` applies nothing).
 * - Mutual exclusion: at most one switch call is in flight; a refused write
 *   lease (H-3) sends nothing and takes no lock.
 *
 * The only mock is the IPC boundary, `@tauri-apps/api/core` `invoke`: the real
 * `mcpService.setServerEnabled` narrows each rejection. The hook's owner is a
 * plain fake (`world`) that records the config and status it is handed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useMcpServerSwitch, type McpServerSwitchDeps, type McpSwitchOutcome } from "../src/hooks/useMcpServerSwitch";
import type { McpStatus } from "../src/services/mcpService";
import type { McpConfig } from "../src/types/preferences";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import type { McpSwitchResult } from "../src/utils/mcpStatusView";
import contract from "./fixtures/mcp-status-contract.json";
import { mcpStatus } from "./support/mcpSettingsHarness";
import { deferred, type Deferred } from "./support/windowSaveHarness";

type Reply = { ok: McpStatus } | { reject: unknown };

interface Row {
  name: string;
  request: boolean;
  reply: Reply;
  outcome: McpSwitchOutcome;
  switchResult: McpSwitchResult;
  /** `serverEnabled` the owner holds once the call settled. */
  finalEnabled: boolean;
  refreshes: number;
}

const RUNNING = mcpStatus({ phase: "running", configured: "enabled" });
const DISABLED = mcpStatus({ running: false, port: null, phase: "disabled", configured: "disabled" });
const BIND_FAILED = mcpStatus({ running: false, port: null, phase: "failed", error: "bind_in_use", configured: "enabled" });

function okRow(name: string, request: boolean, status: McpStatus): Row {
  return {
    name, request, reply: { ok: status },
    outcome: { kind: "ok", enabled: request, status },
    switchResult: { kind: "ok", enabled: request },
    finalEnabled: request, refreshes: 0,
  };
}

function refusedRow(error: string, reject: unknown = error): Row {
  const narrowed = error as "unknown";
  const exiting = error === "exiting";
  const keep = error === "status_unavailable";
  return {
    name: `reject ${error}`, request: false, reply: { reject },
    outcome: exiting ? null : { kind: "refused", error: narrowed },
    switchResult: exiting ? null : { kind: "refused", error: narrowed },
    finalEnabled: keep ? false : true,
    refreshes: keep ? 1 : 0,
  };
}

const ROWS: Row[] = [
  okRow("Ok(running)", true, RUNNING),
  okRow("Ok(disabled)", false, DISABLED),
  okRow("Ok(failed/bind_in_use)", true, BIND_FAILED),
  ...contract.switchError.map((e) => refusedRow(e)),
  refusedRow("unknown", new Error("boom /Users/x")),
];

/** A fake owner: holds the config and status the hook hands it. */
function makeWorld(initial: McpConfig) {
  const world = {
    config: initial,
    statuses: [] as McpStatus[],
    released: 0,
    deps: null as unknown as McpServerSwitchDeps,
  };
  world.deps = {
    beginWrite: vi.fn(() => ({
      previous: world.config,
      setConfig: (c: McpConfig) => {
        world.config = c;
      },
      isCurrent: () => true,
      release: () => {
        world.released += 1;
      },
    })),
    setStatus: vi.fn((s: McpStatus) => {
      world.statuses.push(s);
    }),
    refreshStatus: vi.fn(async () => {}),
  };
  return world;
}

function gatedSwitch(reply: Reply): Deferred {
  const gate = deferred();
  invokeMock.mockImplementation(async (cmd: unknown) => {
    if (cmd !== "mcp_set_server_enabled") return null;
    await gate.promise;
    if ("reject" in reply) throw reply.reject;
    return { ...reply.ok };
  });
  return gate;
}

function switchCalls() {
  return invokeMock.mock.calls.filter(([c]) => c === "mcp_set_server_enabled");
}

beforeEach(() => {
  invokeMock.mockReset();
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("H-1 useMcpServerSwitch state over the whole reply domain", () => {
  it("H-1 domain: every fixture switchError, junk, and three Ok kinds are rows", () => {
    const refused = ROWS.filter((r) => "reject" in r.reply).map((r) => r.name);
    for (const e of contract.switchError) expect(refused).toContain(`reject ${e}`);
    expect(refused).toContain("reject unknown");
    expect(ROWS.filter((r) => "ok" in r.reply)).toHaveLength(3);
  });

  it.each(ROWS)("H-1 $name: idle → saving → idle, and the outcome is this reply's", async (row) => {
    const initial: McpConfig = { serverEnabled: !row.request, startOnLaunch: true, autoApproveEdits: false };
    const world = makeWorld(initial);
    const gate = gatedSwitch(row.reply);
    const { result } = renderHook(() => useMcpServerSwitch(world.deps));
    expect(result.current.saving).toBe(false);

    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.toggle(row.request);
    });
    expect(result.current.saving).toBe(true);
    expect(switchCalls()).toEqual([["mcp_set_server_enabled", { enabled: row.request }]]);

    await act(async () => {
      gate.resolve();
      await done;
    });

    expect(result.current.saving).toBe(false);
    expect(result.current.outcome).toEqual(row.outcome);
    expect(result.current.switchResult).toEqual(row.switchResult);
    expect(world.config).toEqual({ ...initial, serverEnabled: row.finalEnabled });
    expect(world.statuses).toEqual("ok" in row.reply ? [row.reply.ok] : []);
    expect(world.deps.refreshStatus).toHaveBeenCalledTimes(row.refreshes);
    expect(world.released).toBe(1);
  });
});

describe("H-2 a second toggle while saving is dropped", () => {
  it("H-2 toggle(false) pending, then toggle(true) and toggle(false): one invoke with {enabled:false}", async () => {
    const world = makeWorld({ serverEnabled: true, startOnLaunch: false, autoApproveEdits: false });
    const gate = gatedSwitch({ ok: DISABLED });
    const { result } = renderHook(() => useMcpServerSwitch(world.deps));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.toggle(false);
      void result.current.toggle(true);
      void result.current.toggle(false);
    });
    expect(switchCalls()).toEqual([["mcp_set_server_enabled", { enabled: false }]]);
    expect(result.current.saving).toBe(true);

    await act(async () => {
      gate.resolve();
      await first;
    });
    expect(switchCalls()).toHaveLength(1);
    expect(result.current.saving).toBe(false);
    expect(world.released).toBe(1);

    // Additive: the lock is released, so the next toggle goes through.
    await act(async () => {
      await result.current.toggle(true);
    });
    expect(switchCalls()).toHaveLength(2);
  });
});

describe("H-3 a refused write lease sends nothing and holds no lock", () => {
  it("H-3 beginWrite() → null: no invoke, config untouched, and the next toggle goes through", async () => {
    const initial: McpConfig = { serverEnabled: true, startOnLaunch: false, autoApproveEdits: false };
    const world = makeWorld(initial);
    const grant = world.deps.beginWrite;
    world.deps.beginWrite = vi.fn(() => null);
    gatedSwitch({ ok: DISABLED }).resolve();
    const { result } = renderHook(() => useMcpServerSwitch(world.deps));

    await act(async () => {
      await result.current.toggle(false);
    });
    expect(switchCalls()).toEqual([]);
    expect(result.current.saving).toBe(false);
    expect(result.current.outcome).toBeNull();
    expect(world.config).toEqual(initial);
    expect(world.released).toBe(0);

    // The refusal left no lock behind: once a lease is granted, the switch runs.
    world.deps.beginWrite = grant;
    await act(async () => {
      await result.current.toggle(false);
    });
    expect(switchCalls()).toEqual([["mcp_set_server_enabled", { enabled: false }]]);
    expect(world.released).toBe(1);
  });
});
