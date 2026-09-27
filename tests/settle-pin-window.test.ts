/**
 * D22 WI-2 — `pinDuringLayoutSettle`: the bounded window (measured from arm, final re-pin
 * at the deadline, `windowMs` honoured) and the one log event per window with exact counts.
 * Cases P-10, P-10b, P-20, P-21, P-22 of `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * Boundaries: growable geometry fixture, `ResizeObserverDouble`, fake timers, and
 * `@tauri-apps/api/core` (the real logger runs; payloads are read off `invoke("log_event")`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import type { SettlePinSource } from "../src/utils/scrollAnchor/settlePin";
import type { GrowableSurface } from "./helpers/growableScrollGeometry";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import {
  armAt,
  disposeAllPins,
  g12,
  loadOn,
  peekRel,
  SETTLE_EVENT,
  settleLogs,
  userScroll,
  W,
} from "./helpers/settlePinHarness";

let ro: ResizeObserverRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  ro = installResizeObserverDouble();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  disposeAllPins();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("pinDuringLayoutSettle — the window (WI-2)", () => {
  it("P-10 the deadline does one final re-pin, then nothing", () => {
    const s = g12(100);
    armAt(s, 5);
    s.growBody(1, 400); // no trigger
    vi.advanceTimersByTime(W - 1);
    expect(s.scroller.scrollTop).toBe(720);
    vi.advanceTimersByTime(1);
    expect(s.scroller.scrollTop).toBe(1120);
    expect(peekRel(s, 5)).toBe(40);

    s.growBody(2, 300);
    ro.fire();
    loadOn(s.addImage(0));
    vi.advanceTimersByTime(10 * W);
    expect(s.scroller.scrollTop).toBe(1120);
    expect(peekRel(s, 5)).toBe(340);
    expect(vi.getTimerCount()).toBe(0);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "expired", repins: 1, triggers: 0 });
  });

  it("P-10b the window is measured from arm, not from the last trigger", () => {
    const s = g12(100);
    armAt(s, 5);
    vi.advanceTimersByTime(W - 10);
    s.growBody(1, 400);
    ro.fire();
    expect(s.scroller.scrollTop).toBe(1120);
    vi.advanceTimersByTime(10); // exactly W since arm
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "expired", triggers: 1, repins: 2 });
    expect(vi.getTimerCount()).toBe(0);

    s.growBody(2, 300);
    ro.fire();
    expect(s.scroller.scrollTop).toBe(1120);
    expect(peekRel(s, 5)).toBe(340);
    expect(settleLogs(invokeMock)).toHaveLength(1);
  });

  it("P-21 `windowMs` is honoured", () => {
    const s = g12(100);
    armAt(s, 5, { windowMs: 200 });
    s.growBody(1, 400); // no trigger
    vi.advanceTimersByTime(199);
    expect(s.scroller.scrollTop).toBe(720);
    expect(settleLogs(invokeMock)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(s.scroller.scrollTop).toBe(1120);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "expired", repins: 1, triggers: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("P-22 count edges — a no-op fire counts, a filtered load does not", () => {
    const s = g12(100);
    const a = s.addImage(1);
    const b = s.addImage(9);
    armAt(s, 5, { loadFilter: (img) => img === a });
    ro.fire(); // handled, no-op reapply
    loadOn(b); // rejected by the filter
    s.growBody(1, 400);
    ro.fire();
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(1120);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "expired", triggers: 2, repins: 3 });
  });
});

interface OutcomeRow {
  outcome: string;
  source: SettlePinSource;
  script: (s: GrowableSurface, source: SettlePinSource) => void;
  repins: number;
  triggers: number;
}

const growAndFire = (s: GrowableSurface, i: number) => {
  s.growBody(i, 400);
  ro.fire();
};

const OUTCOMES: OutcomeRow[] = [
  {
    outcome: "expired",
    source: "toc",
    script: (s, source) => {
      armAt(s, 5, { source });
      growAndFire(s, 1);
      growAndFire(s, 2);
      vi.advanceTimersByTime(W);
    },
    repins: 3,
    triggers: 2,
  },
  {
    outcome: "user-scroll",
    source: "toc",
    script: (s, source) => {
      armAt(s, 5, { source });
      growAndFire(s, 1);
      userScroll(s, 500);
    },
    repins: 1,
    triggers: 1,
  },
  {
    outcome: "replaced",
    source: "restore",
    script: (s, source) => {
      armAt(s, 5, { source });
      growAndFire(s, 1);
      armAt(s, 5, { source }); // landing unchanged: a same-value write, no scroll event
    },
    repins: 1,
    triggers: 1,
  },
  {
    outcome: "detached",
    source: "restore",
    script: (s, source) => {
      armAt(s, 5, { source });
      s.wrapper.remove();
      ro.fire();
    },
    repins: 0,
    triggers: 0,
  },
  {
    outcome: "disposed",
    source: "restore",
    script: (s, source) => {
      armAt(s, 5, { source }).dispose();
    },
    repins: 0,
    triggers: 0,
  },
];

describe("pinDuringLayoutSettle — the log event (WI-2)", () => {
  it.each(OUTCOMES)(
    "P-20 outcome $outcome: enums and integers only, exact counts",
    ({ outcome, source, script, repins, triggers }) => {
      const s = g12(100);
      script(s, source);
      const logs = settleLogs(invokeMock);
      expect(logs).toHaveLength(1);
      const [log] = logs;
      expect(log.event).toBe(SETTLE_EVENT);
      expect(["success", "cancel"]).toContain(log.status);
      const ctx = log.context;
      expect(Object.keys(ctx).sort()).toEqual(["outcome", "repins", "source", "surface", "triggers"]);
      expect(ctx.surface).toBe("wysiwyg");
      expect(ctx.source).toBe(source);
      expect(ctx.outcome).toBe(outcome);
      expect(Number.isInteger(ctx.repins)).toBe(true);
      expect(Number.isInteger(ctx.triggers)).toBe(true);
      expect(ctx).toMatchObject({ repins, triggers });
    },
  );
});
