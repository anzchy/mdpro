/**
 * D241-WI-1 — `useMcpConfirm`'s MCP-pending ref, deadline timer and Recovery
 * slot hold (ADR-0116 Decisions 1, 2 and 4).
 *
 * Laws:
 * 1. `link.pending.current` is true exactly while the hook's queue holds a
 *    received request, and it is written before React renders.
 * 2. Every received request leaves by its deadline, without a reply, so the
 *    flag cannot outlast the latest deadline received (g2).
 * 3. While `link.recoverySlot.current` is true no head mounts; `republish`
 *    shows it once the slot clears.
 *
 * Mock boundary: webviewWindow `listen` (a fake bus), core `invoke`, and
 * `loggingService`. The real hook, `mcpConfirmService` and model run.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { bus, core } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  core: {
    calls: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    hang: { value: false },
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.window.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.window.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.calls.push({ cmd, args: { ...args } });
    if (core.hang.value) return new Promise(() => {});
    return "resolved";
  }),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import { loggingService } from "../src/services/loggingService";
import { createMcpRecoveryLink, useMcpConfirm, type McpRecoveryLink } from "../src/hooks/useMcpConfirm";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };

const REQUEST = fx.events.request;
const RESOLVED = fx.events.resolved;
const req = (requestId: string, expiresInMs = 60_000) => ({ ...fx.samples[0], requestId, expiresInMs });
const replies = () => core.calls.filter((c) => c.cmd === "mcp_confirm_reply");

function fire(name: string, payload: unknown): void {
  for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    fire(name, payload);
    await Promise.resolve();
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function mount(link: McpRecoveryLink) {
  const hook = renderHook(() => useMcpConfirm(link));
  await settle();
  return hook;
}

function trackedLink(): { link: McpRecoveryLink; changes: boolean[] } {
  const changes: boolean[] = [];
  const link = createMcpRecoveryLink();
  link.onPendingChange = () => changes.push(link.pending.current);
  return { link, changes };
}

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
  core.hang.value = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("D241-WI-1 MCP-pending ref (ADR-0116 Decision 2)", () => {
  it("P1 pending is true exactly while a received request is queued, and flips report once each", async () => {
    const { link, changes } = trackedLink();
    await mount(link);
    expect(link.pending.current).toBe(false);

    await deliver(REQUEST, req("a"));
    await deliver(REQUEST, req("b"));
    expect(link.pending.current).toBe(true);
    await deliver(RESOLVED, { requestId: "a", outcome: "approved" });
    expect(link.pending.current).toBe(true);
    await deliver(RESOLVED, { requestId: "b", outcome: "approved" });
    expect(link.pending.current).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("P2 the ref is written in the event handler, before React renders", async () => {
    const { link } = trackedLink();
    const { result } = await mount(link);
    let seen: boolean | null = null;
    let promptAtThatMoment: unknown = "unset";
    act(() => {
      fire(REQUEST, req("a"));
      seen = link.pending.current;
      promptAtThatMoment = result.current.prompt;
    });
    expect(seen).toBe(true);
    expect(promptAtThatMoment).toBeNull();
  });

  it("P3 answering the last head clears pending at once, and a reply that never settles holds nothing", async () => {
    core.hang.value = true;
    const { link, changes } = trackedLink();
    const { result } = await mount(link);
    await deliver(REQUEST, req("a"));
    act(() => result.current.approve());
    await settle();
    expect(replies()).toHaveLength(1);
    expect(link.pending.current).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("P4 a late confirm_resolved for an entry that already left changes nothing", async () => {
    const { link, changes } = trackedLink();
    const { result } = await mount(link);
    await deliver(REQUEST, req("a"));
    act(() => result.current.reject());
    await deliver(RESOLVED, { requestId: "a", outcome: "rejected" });
    expect(link.pending.current).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(result.current.prompt).toBeNull();
  });
});

describe("D241-WI-1 deadline timer (ADR-0116 Decision 2)", () => {
  it("T1 a shown head leaves at its deadline with no reply; pending clears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { link, changes } = trackedLink();
    const { result } = await mount(link);
    await deliver(REQUEST, req("a", 1_000));
    expect(result.current.prompt?.requestId).toBe("a");

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(link.pending.current).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.prompt).toBeNull();
    expect(link.pending.current).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(replies()).toHaveLength(0);
    const expired = vi
      .mocked(loggingService.logEventSync)
      .mock.calls.filter(([p]) => (p as { event?: string }).event === "ui.mcp_confirm.expired");
    expect(expired).toHaveLength(1);
  });

  it("T2 a held head behind a modal also leaves at its deadline", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    const { link } = trackedLink();
    const { result } = await mount(link);
    await deliver(REQUEST, req("a", 500));
    expect(result.current.prompt).toBeNull();
    expect(link.pending.current).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(link.pending.current).toBe(false);
    expect(replies()).toHaveLength(0);
  });

  it("T3 a queued entry with an earlier deadline leaves while the head stays", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { link } = trackedLink();
    const { result } = await mount(link);
    await deliver(REQUEST, req("a", 60_000));
    await deliver(REQUEST, req("b", 2_000));
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.prompt?.requestId).toBe("a");
    expect(link.pending.current).toBe(true);
    await deliver(RESOLVED, { requestId: "a", outcome: "approved" });
    expect(result.current.prompt).toBeNull();
    expect(link.pending.current).toBe(false);
  });

  it("T4 the flag never outlasts the latest deadline received, with every event lost", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { link } = trackedLink();
    await mount(link);
    await deliver(REQUEST, req("a", 3_000));
    await deliver(REQUEST, req("b", 7_000));
    await act(async () => {
      vi.advanceTimersByTime(6_999);
    });
    expect(link.pending.current).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(link.pending.current).toBe(false);
  });
});

describe("D241-WI-1 Recovery slot hold (ADR-0116 Decision 4)", () => {
  it("S1 while Recovery holds the slot a request is held, not shown; republish shows it once cleared", async () => {
    const { link } = trackedLink();
    const { result } = await mount(link);
    link.recoverySlot.current = true;
    await deliver(REQUEST, req("a"));
    expect(result.current.prompt).toBeNull();
    expect(link.pending.current).toBe(true);

    link.recoverySlot.current = false;
    act(() => link.republish.current?.());
    expect(result.current.prompt?.requestId).toBe("a");
  });

  it("S2 with the slot clear a fresh request shows at once", async () => {
    const { link } = trackedLink();
    const { result } = await mount(link);
    link.recoverySlot.current = true;
    link.recoverySlot.current = false;
    await deliver(REQUEST, req("a"));
    expect(result.current.prompt?.requestId).toBe("a");
  });

  it("S3 republish with nothing queued shows nothing and changes no flag", async () => {
    const { link, changes } = trackedLink();
    const { result } = await mount(link);
    act(() => link.republish.current?.());
    expect(result.current.prompt).toBeNull();
    expect(changes).toEqual([]);
  });

  it("S4 unmount empties republish", async () => {
    const { link } = trackedLink();
    const hook = await mount(link);
    expect(typeof link.republish.current).toBe("function");
    hook.unmount();
    expect(link.republish.current).toBeNull();
  });
});
