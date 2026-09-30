/**
 * Purpose: the FC-10 reference model of the D37 focus-carry record
 * (`tests/milkdown-focus-carry.test.ts`), written from the specification, not from
 * `src/utils/milkdownFocusCarry.ts`: the plan's WI-3 consume table, coordinator
 * amendment O1 (mode change drops, TTL is a safety net), F7 (`superseded`), Gap 3 /
 * round-2 Gap 1 (guarded carry-forward) and Gap 5 (a consume hit counts as terminal).
 *
 * Why this file is NOT a `*.test.ts`: vitest collects `tests/**\/*.test.{ts,tsx}`.
 */
import type { Node } from "@milkdown/kit/prose/model";

export type Doc = "doc-a" | "doc-b";
export type Mode = "wysiwyg" | "source";

export type Op =
  | { k: "arm"; doc: Doc; gen: number }
  | { k: "consume"; doc: Doc; gen: number }
  | { k: "carry"; doc: Doc; gen: number }
  | { k: "advance"; ms: number }
  | { k: "mode"; mode: Mode }
  | { k: "touch" }
  | { k: "active"; doc: Doc };

export interface ModelRecord {
  doc: Doc;
  gen: number;
  oldDoc: Node;
  elapsed: number;
}

export class FocusCarryModel {
  live: ModelRecord | null = null;
  mode: Mode = "wysiwyg";
  active: Doc = "doc-a";
  arms = 0;
  /** Terminal events: logged skips plus consume hits (Gap 5). */
  terminals = 0;

  constructor(private readonly ttl: number) {}

  private end(): void {
    this.live = null;
    this.terminals += 1;
  }

  arm(doc: Doc, gen: number, oldDoc: Node): void {
    if (this.live) this.end(); // superseded
    this.live = { doc, gen, oldDoc, elapsed: 0 };
    this.arms += 1;
  }

  /** The record the real `consumeFocusCarry` must return, or null. */
  consume(doc: Doc, gen: number): ModelRecord | null {
    const rec = this.live;
    if (!rec) return null;
    if (rec.gen > gen && rec.doc === doc) return null; // newer record survives an older consumer
    // doc-changed, stale, or a hit (consume-once): all three end the record.
    this.end();
    return rec.doc === doc && rec.gen === gen ? rec : null;
  }

  carry(doc: Doc, gen: number): void {
    const rec = this.live;
    if (!rec || rec.doc !== doc || doc !== this.active || this.mode !== "wysiwyg") return;
    this.end(); // superseded
    this.live = { ...rec, gen, elapsed: 0 };
    this.arms += 1;
  }

  advance(ms: number): void {
    if (!this.live) return;
    this.live.elapsed += ms;
    if (this.live.elapsed >= this.ttl) this.end(); // expired
  }

  setMode(mode: Mode): void {
    if (mode !== this.mode && mode !== "wysiwyg" && this.live) this.end(); // mode-changed
    this.mode = mode;
  }
}

/** Draw one op from `next()` (an LCG). */
export function drawOp(next: () => number, ttl: number): Op {
  const docs: Doc[] = ["doc-a", "doc-b"];
  const doc = docs[next() % 2];
  const gen = next() % 4;
  switch (next() % 7) {
    case 0:
      return { k: "arm", doc, gen };
    case 1:
      return { k: "consume", doc, gen };
    case 2:
      return { k: "carry", doc, gen };
    case 3:
      return { k: "advance", ms: [0, 1500, ttl - 1, ttl][next() % 4] };
    case 4:
      return { k: "mode", mode: next() % 2 === 0 ? "wysiwyg" : "source" };
    case 5:
      return { k: "touch" };
    default:
      return { k: "active", doc };
  }
}
