/**
 * D31, slow tier (ADR-0050, D124) of `use-menu-events-subscription.test.ts`:
 * A9, laws L-A1 (conservation of subscriptions) and L-A2 (exactly-once
 * dispatch on the newest identity) over 200 seeded random lifecycles (seed via
 * D31_SEED). About 8–9 s under coverage, so it runs in `pnpm test:slow`. The
 * fixture-level lifecycle cases (A1–A8) stay in the unit file.
 *
 * The Tauri fakes and hook-side helpers are shared with the unit file through
 * `tests/support/menuEventsHarness.ts` and `tests/support/menuEventsDomain.ts`;
 * only the hoisted `vi.mock` declarations are per file.
 *
 * D261-WI-1c replaced the `FOCI` pool with `TARGETS` (self, other, missing).
 * Rule-12 reason: the fail-open spec (act when isFocused() rejects) is the
 * defect D261 removes; the focus query no longer exists. An emit now produces
 * a call iff it is addressed to the registered mount's window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./support/menuEventsHarness")).eventModuleMock());
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { bus, logs, win } from "./support/menuEventsHarness";
import {
  calls,
  EVT,
  flush,
  LABELS,
  makeHandlers,
  menuLogs,
  mountHook,
  mulberry32,
  payloadOf,
  resetMenuHarness,
  ROWS,
  TARGETS,
} from "./support/menuEventsDomain";

beforeEach(() => {
  resetMenuHarness();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A9 — property over random lifecycles (L-A1, L-A2)
// ---------------------------------------------------------------------------

const EMIT_POOL: Array<{ payload: { action: string; value?: string }; known: boolean }> = [
  ...ROWS.map((row) => ({ payload: payloadOf(row), known: true })),
  { payload: { action: "x.unknown" }, known: false },
];
const OPS = ["rerender", "settleOne", "setAutoResolve", "emit", "unmount", "mount"] as const;

async function runLifecycleSequence(seed: number, seq: number): Promise<void> {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  bus.reset();
  win.reset();
  logs.length = 0;
  calls.length = 0;

  const ops: string[] = [];
  const where = () => `seed=${seed} seq=${seq} ops=${JSON.stringify(ops)}`;
  let hook: ReturnType<typeof mountHook> | null = null;
  let gen = 0;
  let currentGen = 0;
  let mountId = 0;
  let expectedTotal = 0;
  const registered = () => hook !== null && bus.state.settledTags.has(mountId);

  const mount = async () => {
    mountId += 1;
    bus.state.tag = mountId;
    currentGen = ++gen;
    win.label = pick(LABELS);
    hook = mountHook(makeHandlers(currentGen));
    await flush();
  };

  const emitAndCheck = async (payload: { action: string; value?: string }, known: boolean, target: (typeof TARGETS)[number]) => {
    const before = calls.length;
    const expected = registered() && target === "self" && known ? 1 : 0;
    if (target === "self") bus.emit(EVT, payload);
    else if (target === "other") bus.emitAny(EVT, { ...payload, target: `not-${win.label}` });
    else bus.emitAny(EVT, payload);
    await flush();
    const produced = calls.slice(before);
    expect(produced.length, `emit ${JSON.stringify(payload)} target=${target}: ${where()}`).toBe(expected);
    expect(produced.every((c) => c.gen === currentGen), `newest identity: ${where()}`).toBe(true);
    expectedTotal += expected;
  };

  ops.push("mount");
  bus.state.autoResolve = rand() < 0.5;
  await mount();

  const steps = 1 + Math.floor(rand() * 30);
  for (let s = 0; s < steps; s++) {
    const op = pick(OPS);
    if (op === "rerender" && hook) {
      ops.push("rerender");
      currentGen = ++gen;
      (hook as ReturnType<typeof mountHook>).rerender({ h: makeHandlers(currentGen) });
      await flush();
    } else if (op === "settleOne") {
      if (bus.state.pending.length > 0) {
        const idx = Math.floor(rand() * bus.state.pending.length);
        ops.push(`settle(${idx})`);
        bus.settleAt(idx);
        await flush();
      } else ops.push("settle(-)");
    } else if (op === "setAutoResolve") {
      const v = rand() < 0.5;
      ops.push(`auto(${v})`);
      bus.state.autoResolve = v;
    } else if (op === "emit") {
      const e = pick(EMIT_POOL);
      const target = pick(TARGETS);
      ops.push(`emit(${e.payload.action},${target})`);
      await emitAndCheck(e.payload, e.known, target);
    } else if (op === "unmount" && hook) {
      ops.push("unmount");
      (hook as ReturnType<typeof mountHook>).unmount();
      hook = null;
      await flush();
    } else if (op === "mount" && !hook) {
      ops.push("mount");
      await mount();
    } else {
      ops.push(`skip(${op})`);
    }
    expect(bus.count(EVT), `L-A1 bound: ${where()}`).toBeLessThanOrEqual(hook ? 1 : 0);
  }

  ops.push("drain");
  bus.drain();
  await flush();
  expect(bus.count(EVT), `L-A1 after settle-all: ${where()}`).toBe(hook ? 1 : 0);

  ops.push("final-emit");
  await emitAndCheck({ action: "file.new" }, true, "self");

  // Success lines only: a non-self emit now writes a wrong_target cancel select
  // line (D261), which dispatches nothing and so pairs with no call.
  const select = menuLogs("ui.menu.select").filter((l) => l.payload.status === "success");
  expect(calls.length, `total calls: ${where()}`).toBe(expectedTotal);
  expect(select.length, `total select logs: ${where()}`).toBe(expectedTotal);
  const callIds = calls.map((c) => c.args[c.args.length - 1] as string).sort();
  const logIds = select.map((l) => l.payload.actionId as string).sort();
  expect(logIds, `actionId multiset: ${where()}`).toEqual(callIds);

  if (hook) (hook as ReturnType<typeof mountHook>).unmount();
  await flush();
}

describe("useMenuEvents — A9 property: conservation and exactly-once dispatch", () => {
  it("A9: holds over 200 seeded random lifecycles (seed via D31_SEED)", async () => {
    const baseSeed = Number(process.env.D31_SEED ?? 0xd31);
    for (let i = 0; i < 200; i++) {
      await runLifecycleSequence((baseSeed + i * 0x9e3779b1) >>> 0, i);
    }
  }, 180_000);
});
