/**
 * D42 WI-4 — slow tier (ADR-0050) for App-level dialog open order.
 *
 * Specification: `.claude/tdd-guardian/tests-20261008-131500.md` § WI-4, Case 4.10 (ordered
 * triples, 120 runs), Case 4.17 (seeded random walk over real dialogs vs the oracle, seeds
 * 0..39 × 10 events) and Case 4.8 (iii) (the removal invariant inside that walk). The pair
 * runs and every per-commit anchor live in `d42-app-dialog-open-order.test.tsx`.
 *
 * Law: after every snapshot, (a) the DOM order of the open dialogs equals the event-log
 * oracle; (b) no open dialog's card is removed from the DOM except MCP on a `requestId`
 * change; (d) the `ui.dialog.stack` lines added equal the projection of that step; and the
 * MCP request listener count stays 1. The domain (event expansion, oracle, projections) is
 * shared through `tests/support/d42DialogDriver.ts` and `dialogOpenOrderOracle.ts`.
 *
 * Mock boundaries (MB-T) and paired real paths (PAIR-T, G-D42-1/2/3) are as in the unit file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, render } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;
type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { bus, logs } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  logs: [] as Array<{ event?: string; context?: Record<string, unknown>; [key: string]: unknown }>,
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
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") {
      logs.push((args.payload as LogPayload | undefined) ?? {});
      return null;
    }
    switch (cmd) {
      case "mcp_confirm_reply":
        return "resolved";
      case "get_preferences":
        return (await import("./support/preferenceFixtures")).makePreferences();
      case "mcp_get_status":
        return { running: false, port: null, binaryPath: "b", phase: "disabled", error: null, configured: "disabled" };
      case "mcp_get_installations":
        return [];
      default:
        return null;
    }
  },
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import {
  HARNESS_DIALOG_IDS,
  createAppDialogsHarness,
  domDialogOrder,
  type AppDialogsHarness,
} from "./support/appDialogsHarness";
import {
  applyDomainEvent,
  offendingRemovals,
  removedDialogIds,
  stackProjection,
  watchRemovals,
  type DriverStep,
} from "./support/d42DialogDriver";
import {
  EVENTS,
  eventLabel,
  mulberry32,
  type DomainEvent,
  type OracleDialogId,
} from "./support/dialogOpenOrderOracle";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });
const stackContexts = () => logs.filter((p) => p.event === "ui.dialog.stack").map((p) => p.context);

const SLOW_BUDGET_MS = 120_000;
const WALK_SEEDS = 40;
const WALK_LENGTH = 10;
const WALK_SEED_BASE = 0xd42;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
  });
}

/**
 * Mount a fresh harness and run `events` through it, checking every snapshot
 * against the oracle. `label` names the run in every failure message.
 */
async function runEvents(label: string, events: readonly DomainEvent[]): Promise<OracleDialogId[]> {
  bus.window.clear();
  logs.length = 0;
  const h: AppDialogsHarness = createAppDialogsHarness({ deliver, events: fx.events, request: req });
  const view = render(<h.Harness />);
  await settle();
  const watcher = watchRemovals(document.body);
  let order: OracleDialogId[] = [];
  let k = stackContexts().length;
  for (const [index, event] of events.entries()) {
    const where = `${label} step ${index} ${eventLabel(event)}`;
    const check = async ({ oracle, before, mcpTokenChanged }: DriverStep) => {
      await settle();
      expect(domDialogOrder(), where).toEqual(oracle);
      const removed = watcher.drain();
      // Every removed card must resolve to a known dialog, or law (b) passes vacuously.
      expect(removedDialogIds(removed).filter((id) => id.startsWith("unknown:")), where).toEqual([]);
      expect(offendingRemovals(removed, oracle, mcpTokenChanged), where).toEqual([]);
      expect(stackContexts().slice(k), where).toStrictEqual(stackProjection(before, oracle));
      expect(bus.window.get(fx.events.request)?.size, where).toBe(1);
      k = stackContexts().length;
    };
    order = await applyDomainEvent(h, order, event, check);
  }
  watcher.stop();
  view.unmount();
  await settle();
  return order;
}

beforeEach(() => {
  bus.window.clear();
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("D42 slow: open order over real dialogs", () => {
  it(
    "4.10 triples: open X, Y, Z, close X, reopen X — DOM order is the oracle at every step (120 runs)",
    async () => {
      let runs = 0;
      for (const x of HARNESS_DIALOG_IDS) {
        for (const y of HARNESS_DIALOG_IDS) {
          for (const z of HARNESS_DIALOG_IDS) {
            if (x === y || y === z || x === z) continue;
            const end = await runEvents(`triple ${x},${y},${z}`, [
              { kind: "open", id: x },
              { kind: "open", id: y },
              { kind: "open", id: z },
              { kind: "close", id: x },
              { kind: "open", id: x },
            ]);
            expect(end).toEqual([y, z, x]);
            runs += 1;
          }
        }
      }
      expect(runs).toBe(120);
    },
    SLOW_BUDGET_MS,
  );

  it(
    "4.17 / 4.8 (iii): seeded random walks over E (40 seeds × 10 events) match the oracle",
    async () => {
      for (let seed = 0; seed < WALK_SEEDS; seed += 1) {
        const rng = mulberry32(WALK_SEED_BASE + seed);
        const walk = Array.from(
          { length: WALK_LENGTH },
          () => EVENTS[Math.floor(rng() * EVENTS.length)],
        );
        await runEvents(`seed ${seed}`, walk);
      }
    },
    SLOW_BUDGET_MS,
  );
});
