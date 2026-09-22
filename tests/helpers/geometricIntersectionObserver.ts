/**
 * Purpose: a **geometric**, spec-shaped `IntersectionObserver` double (jsdom has none),
 * plus the shared `frame()` step. Contract: WI-3 of
 * `.claude/tdd-guardian/tests-20260922-210708.md`.
 *
 * Why it exists: the pre-D17 WYSIWYG spy constructs an IntersectionObserver. Without a
 * double, HEAD would fail the D17 cases on a `ReferenceError`, which proves nothing. With
 * this one, HEAD fails on the assertion (the wrong heading stays active). Once the spy is
 * geometric (WI-4) nothing constructs it, and `constructedObservers()` becomes a detector
 * proving that.
 *
 * Fidelity, by construction:
 * - Intersection is computed from layout, not scripted per case: the target's rect,
 *   clipped by every ancestor up to and including `root` that has a measured rect, then
 *   intersected with the root rect grown/shrunk by `rootMargin`. Vertical axis only.
 *   Edge-adjacent counts as intersecting (threshold 0, as the spec says).
 * - `rootMargin` percentages resolve against the root's HEIGHT for top/bottom (the D17
 *   seed's reading, matching ledger row 大纲侧栏's WebKit note; unmeasured, see plan
 *   Risks). Only `px` and `%` are parsed.
 * - A fresh registration yields an initial record at the next compute; afterwards a
 *   record is queued only when `isIntersecting` changes. Compute-then-deliver: all
 *   observers compute, then each disconnected-or-empty-queue observer is skipped and the
 *   others get their batch in one callback.
 *
 * Measurement goes through `measure` (default: `el.getBoundingClientRect()`), so tests can
 * pass `ScriptedSurface.peekRect` and keep the double out of the rect-read counters.
 */
import { act } from "@testing-library/react";
import { vi } from "vitest";

export interface GeometricRecord {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
}

type Measure = (el: Element) => DOMRect | null;

let measure: Measure = (el) => el.getBoundingClientRect();
let registry: GeometricIntersectionObserver[] = [];

function marginPx(token: string | undefined, basis: number): number {
  if (!token) return 0;
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return 0;
  return token.trim().endsWith("%") ? (n / 100) * basis : n;
}

/** Vertical span of `root` after `rootMargin` (CSS shorthand order: top right bottom left). */
function rootBand(root: Element | null, rootMargin: string): { top: number; bottom: number } {
  const base = root ? measure(root) : null;
  const top = base?.top ?? 0;
  const height = base?.height ?? window.innerHeight;
  const parts = rootMargin.trim().split(/\s+/);
  const mTop = marginPx(parts[0], height);
  const mBottom = marginPx(parts[2] ?? parts[0], height);
  return { top: top - mTop, bottom: top + height + mBottom };
}

export class GeometricIntersectionObserver {
  readonly registrations = new Map<Element, { prev: boolean | null }>();
  queue: GeometricRecord[] = [];
  disconnected = false;
  readonly root: Element | null;
  readonly rootMargin: string;

  constructor(
    readonly callback: (records: GeometricRecord[], observer: GeometricIntersectionObserver) => void,
    readonly options?: IntersectionObserverInit,
  ) {
    this.root = (options?.root as Element | null | undefined) ?? null;
    this.rootMargin = options?.rootMargin ?? "0px";
    registry.push(this);
  }

  observe(el: Element): void {
    if (!this.registrations.has(el)) this.registrations.set(el, { prev: null });
  }

  unobserve(el: Element): void {
    this.registrations.delete(el);
  }

  disconnect(): void {
    this.registrations.clear();
    this.queue = [];
    this.disconnected = true;
  }

  takeRecords(): GeometricRecord[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  intersects(el: Element): boolean {
    if (!el.isConnected) return false;
    if (this.root && !this.root.contains(el)) return false;
    const target = measure(el);
    if (!target) return false;
    let top = target.top;
    let bottom = target.bottom;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const r = measure(a);
      if (r && r.height > 0) {
        top = Math.max(top, r.top);
        bottom = Math.min(bottom, r.bottom);
      }
      if (a === this.root) break;
    }
    if (bottom < top) return false;
    const band = rootBand(this.root, this.rootMargin);
    return top <= band.bottom && bottom >= band.top;
  }

  compute(): void {
    if (this.disconnected) return;
    for (const [el, reg] of this.registrations) {
      const now = this.intersects(el);
      if (reg.prev !== now) {
        this.queue.push({ target: el, isIntersecting: now, intersectionRatio: now ? 1 : 0 });
        reg.prev = now;
      }
    }
  }

  deliver(): void {
    if (this.disconnected || this.queue.length === 0) return;
    const q = this.queue;
    this.queue = [];
    this.callback(q, this);
  }
}

/**
 * Stub the global with the geometric double. Call in `beforeEach`; `vi.unstubAllGlobals`
 * (or the next install) undoes it.
 */
export function installGeometricIntersectionObserver(opts: { measure?: Measure } = {}): void {
  registry = [];
  measure = opts.measure ?? ((el) => el.getBoundingClientRect());
  vi.stubGlobal("IntersectionObserver", GeometricIntersectionObserver);
}

/** Every double constructed since the last install, live or disconnected. */
export function constructedObservers(): readonly GeometricIntersectionObserver[] {
  return registry;
}

/** IO's slot in a rendering update: every observer computes, then every observer delivers. */
export function computeAndDeliver(): void {
  for (const io of registry) io.compute();
  for (const io of registry) io.deliver();
}

/**
 * One rendering update: `requestAnimationFrame` callbacks (fake timers), then IO's
 * compute-and-deliver. Valid for both the IO-driven spy and a geometric rAF spy, so no
 * assertion has to change between red and green. Requires `vi.useFakeTimers()`.
 */
export function frame(): void {
  act(() => {
    vi.advanceTimersToNextFrame();
    computeAndDeliver();
  });
}
