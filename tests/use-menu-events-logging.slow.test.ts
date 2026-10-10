/**
 * D31 WI-2, slow tier (ADR-0050, D124) of `use-menu-events-logging.test.ts`:
 * D3, the per-outcome listen conservation law (L-D) and log-neutral re-render
 * over 200 seeded random lifecycles (seed via D31_SEED). About 8–9 s under
 * coverage, so it runs in `pnpm test:slow`. The fixture-level lifecycle cases
 * (D2) stay in the unit file.
 *
 * D4 in the unit file asserts its line-shape invariants over every line that
 * file captures; D3's lines used to be part of that domain. So this file runs
 * the same invariants (`expectMenuLineShape`) over every line D3 captured,
 * after D3.
 *
 * The Tauri fakes and hook-side helpers are shared with the unit file through
 * `tests/support/menuEventsHarness.ts` and `tests/support/menuEventsDomain.ts`;
 * only the hoisted `vi.mock` declarations are per file.
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
  collectAndClearLogs,
  collected,
  EVT,
  expectMenuLineShape,
  FOCI,
  flush,
  LABELS,
  macrotask,
  makeHandlers,
  menuLogs,
  mountHook,
  mulberry32,
  payloadOf,
  resetMenuHarness,
  ROWS,
  statuses,
  uiMenuLines,
} from "./support/menuEventsDomain";

beforeEach(() => {
  resetMenuHarness();
});

afterEach(() => {
  collectAndClearLogs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// D3 — property: per-outcome listen conservation and log-neutral re-render
// ---------------------------------------------------------------------------

const EMIT_POOL: Array<{ action: string; value?: string }> = [
  ...ROWS.map(payloadOf),
  { action: "x.unknown" },
];
const OPS = ["rerender", "settleOne", "setAutoResolve", "setFailure", "emit", "unmount", "mount"] as const;

async function runLoggingSequence(seed: number, seq: number): Promise<void> {
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
  let mountId = 0;
  let expectedFocusFails = 0;
  const registered = () => hook !== null && bus.state.settledTags.has(mountId);

  const mount = async () => {
    mountId += 1;
    bus.state.tag = mountId;
    bus.state.liveTags.add(mountId);
    win.label = pick(LABELS);
    hook = mountHook(makeHandlers(++gen));
    await flush();
  };

  const emit = async (payload: { action: string; value?: string }, focus: (typeof FOCI)[number]) => {
    win.focus = focus;
    if (registered() && focus === "reject") expectedFocusFails += 1;
    bus.emit(EVT, payload);
    await flush();
  };

  ops.push("mount");
  bus.state.autoResolve = rand() < 0.5;
  await mount();

  const steps = 1 + Math.floor(rand() * 30);
  for (let s = 0; s < steps; s++) {
    const op = pick(OPS);
    if (op === "rerender" && hook) {
      ops.push("rerender");
      const before = uiMenuLines().length;
      (hook as ReturnType<typeof mountHook>).rerender({ h: makeHandlers(++gen) });
      await flush();
      expect(uiMenuLines().length - before, `invariant 6 (re-render is log-neutral): ${where()}`).toBe(0);
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
    } else if (op === "setFailure") {
      const v = rand() < 0.5;
      ops.push(`fail(${v})`);
      bus.state.failure = v ? new Error(`/Users/x/secret-${seq} boom`) : null;
    } else if (op === "emit") {
      const payload = pick(EMIT_POOL);
      const focus = pick(FOCI);
      ops.push(`emit(${payload.action},${focus})`);
      await emit(payload, focus);
    } else if (op === "unmount" && hook) {
      ops.push("unmount");
      bus.state.liveTags.delete(mountId);
      (hook as ReturnType<typeof mountHook>).unmount();
      hook = null;
      await flush();
    } else if (op === "mount" && !hook) {
      ops.push("mount");
      await mount();
    } else {
      ops.push(`skip(${op})`);
    }
  }

  ops.push("drain");
  bus.drain();
  await flush();
  await macrotask();

  ops.push("final-emit");
  await emit({ action: "file.new" }, "true");

  const listenStatuses = statuses("ui.menu.listen");
  const n = (status: string) => listenStatuses.filter((s) => s === status).length;
  expect(n("success"), `invariant 1 (#success === resolvedWhileLive): ${where()}`).toBe(
    bus.state.resolvedWhileLive,
  );
  expect(n("cancel"), `invariant 2 (#cancel === resolvedAfterCleanup): ${where()}`).toBe(
    bus.state.resolvedAfterCleanup,
  );
  expect(n("fail"), `invariant 3 (#fail === rejected): ${where()}`).toBe(bus.state.rejected);
  expect(listenStatuses.length, `invariant 4 (one outcome per attempt): ${where()}`).toBe(
    bus.state.subscribeCount,
  );
  const focusFails = menuLogs("ui.menu.focus_check").filter((l) => l.payload.status === "fail");
  expect(focusFails.length, `invariant 5 (#focus_check fail): ${where()}`).toBe(expectedFocusFails);

  if (hook) (hook as ReturnType<typeof mountHook>).unmount();
  await flush();
  collectAndClearLogs();
}

describe("useMenuEvents — D3 property: listen outcome conservation", () => {
  it("D3: holds over 200 seeded random lifecycles (seed via D31_SEED)", async () => {
    const baseSeed = Number(process.env.D31_SEED ?? 0xd31);
    for (let i = 0; i < 200; i++) {
      await runLoggingSequence((baseSeed + i * 0x9e3779b1) >>> 0, i);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// D4 invariants over D3's lines (runs last)
// ---------------------------------------------------------------------------

describe("useMenuEvents — D4 invariants over the D3 lifecycles (runs last)", () => {
  it("D4 (slow): every ui.menu.* line D3 captured obeys invariants 1-5", () => {
    const lines = collected.filter((l) => String(l.payload.event).startsWith("ui.menu."));

    // Non-vacuity: the random lifecycles produce every listen outcome and both
    // select and focus_check lines.
    const kinds = new Set(lines.map((l) => `${l.payload.event}/${l.payload.status}`));
    for (const kind of [
      "ui.menu.select/success",
      "ui.menu.listen/success",
      "ui.menu.listen/cancel",
      "ui.menu.listen/fail",
      "ui.menu.focus_check/fail",
    ]) {
      expect(kinds.has(kind), `collected lines include ${kind}`).toBe(true);
    }

    expectMenuLineShape(lines);
  });
});
