/**
 * Purpose: shared setup for the D22 WI-2 settle-pin suites (`tests/settle-pin*.test.ts`),
 * per §0 of `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * - `g12(bodies)` mounts the standard growth fixture G12: 12 × `##` headings, height 40,
 *   gap 12, rootTop 90, viewHeight 660, on the growable sibling fixture.
 * - `landing(s, k)` = `clamp(ceil(contentOffset(k) − 40), 0, maxScrollTop())`, against the
 *   CURRENT layout.
 * - `landOn(s, k)` is the caller's reapply contract (not a mock of the pin): one instant
 *   `scrollTo` to `landing(s, k)`, return true; counted.
 * - `armAt(s, k)` writes `landing(s, k)` first (the caller's first write), THEN arms.
 * - `settleLogs(invokeMock)` reads `editor.scroll_anchor.settle` payloads where they cross
 *   the Tauri boundary (`invoke("log_event", { payload })`); the real logger runs.
 */
import { act } from "@testing-library/react";
import {
  pinDuringLayoutSettle,
  SETTLE_PIN_WINDOW_MS,
  type SettlePinOptions,
} from "../../src/utils/scrollAnchor/settlePin";
import { mountGrowableSurface, type GrowableSurface } from "./growableScrollGeometry";

export const W = SETTLE_PIN_WINDOW_MS;
export const ANCHOR_PX = 40;
export const SETTLE_EVENT = "editor.scroll_anchor.settle";

export function g12(bodies: number | ((i: number) => number) = 100): GrowableSurface {
  const body = typeof bodies === "number" ? () => bodies : bodies;
  const container = document.createElement("div");
  document.body.appendChild(container);
  return mountGrowableSurface(container, {
    headings: Array.from({ length: 12 }, (_, i) => ({
      level: 2 as const,
      text: `H${String(i).padStart(2, "0")}`,
      height: 40,
      bodyHeight: body(i),
    })),
  });
}

export const landing = (s: GrowableSurface, k: number): number =>
  Math.max(0, Math.min(Math.ceil(s.contentOffset(k) - ANCHOR_PX), s.maxScrollTop()));

/** Heading k's top relative to the scroller top, read through `peekRect`. */
export const peekRel = (s: GrowableSurface, k: number): number => {
  const r = s.peekRect(s.headings[k]);
  if (!r) throw new Error(`peekRel: no rect for heading ${k}`);
  return r.top - s.rootTop;
};

export interface CountedReapply {
  fn: () => boolean;
  calls: () => number;
}

export function counted(inner: () => boolean): CountedReapply {
  let n = 0;
  return {
    fn: () => {
      n += 1;
      return inner();
    },
    calls: () => n,
  };
}

export const landOn = (s: GrowableSurface, k: number): CountedReapply =>
  counted(() => {
    s.scroller.scrollTo({ top: landing(s, k), behavior: "auto" });
    return true;
  });

const live: Array<() => void> = [];

export interface Armed {
  dispose: () => void;
  reapply: CountedReapply;
}

/** The caller's first write, then arm. `reapply` defaults to `landOn(s, k)`. */
export function armAt(
  s: GrowableSurface,
  k: number,
  extra: Partial<Omit<SettlePinOptions, "reapply">> & { reapply?: CountedReapply } = {},
): Armed {
  const { reapply = landOn(s, k), ...rest } = extra;
  s.scroller.scrollTop = landing(s, k);
  const dispose = pinDuringLayoutSettle({
    scroller: s.scroller,
    observed: s.proseMirror,
    reapply: reapply.fn,
    source: "toc",
    ...rest,
  });
  live.push(dispose);
  return { dispose, reapply };
}

/** afterEach: stop every pin a case left armed, so none leaks into the next case. */
export function disposeAllPins(): void {
  while (live.length > 0) live.pop()?.();
}

export const loadOn = (img: Element): void => {
  act(() => {
    img.dispatchEvent(new Event("load"));
  });
};

export const userScroll = (s: GrowableSurface, value: number): void => {
  act(() => {
    s.scroller.scrollTop = value;
  });
};

export interface SettlePayload {
  event: string;
  level: string;
  status: string;
  context: Record<string, unknown>;
}

interface InvokeLike {
  mock: { calls: unknown[][] };
}

export function settleLogs(invokeMock: InvokeLike): SettlePayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: SettlePayload }).payload)
    .filter((p) => p.event === SETTLE_EVENT);
}
