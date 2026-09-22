/**
 * Purpose: an inline-shaped `ResizeObserver` double (jsdom has none). Contract: §0 of
 * `.claude/tdd-guardian/tests-20260922-210708.md` — "records targets, fires on demand".
 *
 * It never fires on its own: jsdom has no layout, so a resize is whatever the test says
 * it is. `fire()` delivers one (empty) batch to every live, non-disconnected observer
 * that has at least one target — the D17 spy reads geometry itself and ignores the
 * records' contents, so the double does not fabricate them.
 *
 * Install in `beforeEach` (or in the case); `vi.unstubAllGlobals` — which
 * `vitest.config.ts`'s `unstubGlobals: true` runs after every test — removes it.
 */
import { act } from "@testing-library/react";
import { vi } from "vitest";

export class ResizeObserverDouble {
  readonly targets = new Set<Element>();
  disconnected = false;
  disconnectCalls = 0;

  constructor(readonly callback: ResizeObserverCallback) {
    registry.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    this.disconnected = true;
    this.disconnectCalls += 1;
  }
}

let registry: ResizeObserverDouble[] = [];

export interface ResizeObserverRegistry {
  /** Every double constructed since install, live or disconnected. */
  instances: () => readonly ResizeObserverDouble[];
  constructCount: () => number;
  /** Total `disconnect()` calls across every instance. */
  disconnectCount: () => number;
  /** Union of the targets of every live (not disconnected) instance. */
  observed: () => Set<Element>;
  /** Deliver one resize batch to every live observer with a target, inside `act`. */
  fire: () => void;
}

export function installResizeObserverDouble(): ResizeObserverRegistry {
  registry = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
  return {
    instances: () => registry,
    constructCount: () => registry.length,
    disconnectCount: () => registry.reduce((sum, ro) => sum + ro.disconnectCalls, 0),
    observed: () => {
      const all = new Set<Element>();
      for (const ro of registry) {
        if (ro.disconnected) continue;
        for (const t of ro.targets) all.add(t);
      }
      return all;
    },
    fire: () => {
      act(() => {
        for (const ro of registry) {
          if (ro.disconnected || ro.targets.size === 0) continue;
          ro.callback([], ro as unknown as ResizeObserver);
        }
      });
    },
  };
}
