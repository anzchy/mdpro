/**
 * Purpose: the baseline-generation bookkeeping documentStore keeps for D214 (WI-5/6/7):
 * when did a document's saved-content baseline last stop being trustworthy?
 *
 * Pipeline: `dropBaseline` / `closeDocument` (documentStore) → `stampBaseline` → a new
 *   generation on the document's id and, when it has one, its path · a path change
 *   (`updateDocumentPath(s)`, a path-changing `upsertDocument`) → `stampPathMoves` → a
 *   new generation on the old and the new path (WI-8) · a save, reload or
 *   open captures `baselineGeneration` before its IPC → `movedSince(stamps, key, start)`
 *   when the reply lands → a moved key demotes the reply (dirty, no baseline).
 *
 * Key decisions:
 * - One window-wide generation that only grows, so a stamp never repeats across a
 *   document's lifetimes (WI-6, audit H-A). Stamps are never deleted: a close stamps.
 * - D290 keeps separate per-id lifetime and replacement counters. Open, close and
 *   in-place upsert advance lifetime; only upsert advances replacement. An
 *   external baseline drop advances neither, preserving the pending/Ignore guard.
 * - Two maps, never mixed (WI-7, audit H-B partial): by id (`baselineEpoch`) and by path
 *   (`baselinePathEpoch`). The path map covers a reply whose tab is gone or whose id is
 *   a UUID matched only by path (D145). A null path stamps nothing.
 * - A path move stamps both ends (WI-8, audit H-B partial): the old path closes a held
 *   open of it (the tab moved away, then maybe closed); the new path closes a held open
 *   of the path the tab moved onto. One generation per mutation. Accepted cost: a Save
 *   As or rename during an open of either path demotes that open (a false dirty).
 * - Pure: no store import. documentStore owns the state and applies the result.
 *
 * @coordinates-with src/stores/documentStore.ts — holds the state, stamps (drop, close,
 *   replacement, path moves), and wraps
 *   `movedSince` as `baselineMovedSince` / `baselinePathMovedSince`
 * @module stores/baselineEpoch
 */

/** The D214 generation state, part of documentStore's state. */
export interface BaselineEpochs {
  /** Window-wide counter; only grows. Captured by a save, reload or open before its IPC. */
  baselineGeneration: number;
  /** Per document id: the generation of its last baseline drop or close. */
  baselineEpoch: Record<string, number>;
  /** Per path: the generation of the last baseline drop or close of a document at it. */
  baselinePathEpoch: Record<string, number>;
  /** Per-id open/close/replacement counter, independent of baseline drops (D290). */
  lifetimeEpoch: Record<string, number>;
  /** Per-id in-place upsert counter; distinguishes replacement from close/reopen. */
  replacementEpoch: Record<string, number>;
}

export const INITIAL_BASELINE_EPOCHS: BaselineEpochs = {
  baselineGeneration: 0,
  baselineEpoch: {},
  baselinePathEpoch: {},
  lifetimeEpoch: {},
  replacementEpoch: {},
};

/** Advance one document's lifetime on open or close, without moving its baseline. */
export function stampLifetime(state: BaselineEpochs, id: string): Pick<BaselineEpochs, "lifetimeEpoch"> {
  return { lifetimeEpoch: { ...state.lifetimeEpoch, [id]: (state.lifetimeEpoch[id] ?? 0) + 1 } };
}

/** Every in-place upsert starts a replacement lifetime, even for identical text. */
export function stampReplacement(state: BaselineEpochs, id: string): Pick<BaselineEpochs, "lifetimeEpoch" | "replacementEpoch"> {
  return {
    ...stampLifetime(state, id),
    replacementEpoch: { ...state.replacementEpoch, [id]: (state.replacementEpoch[id] ?? 0) + 1 },
  };
}

/** Stamp `id` (and `path`, when non-null) with the next generation. */
export function stampBaseline(state: BaselineEpochs, id: string, path: string | null): BaselineEpochs {
  const baselineGeneration = state.baselineGeneration + 1;
  return {
    baselineGeneration,
    baselineEpoch: { ...state.baselineEpoch, [id]: baselineGeneration },
    lifetimeEpoch: state.lifetimeEpoch,
    replacementEpoch: state.replacementEpoch,
    baselinePathEpoch:
      path === null ? state.baselinePathEpoch : { ...state.baselinePathEpoch, [path]: baselineGeneration },
  };
}

/**
 * D214-WI-8: one new generation on every path a mutation moved a document off or onto.
 * Moves whose two paths are equal stamp nothing; with none left, returns `{}`.
 */
export function stampPathMoves(
  state: BaselineEpochs,
  moves: ReadonlyArray<{ from: string | null; to: string | null }>,
): Partial<BaselineEpochs> {
  const moved = moves.filter((move) => move.from !== move.to);
  if (moved.length === 0) return {};
  const baselineGeneration = state.baselineGeneration + 1;
  const baselinePathEpoch = { ...state.baselinePathEpoch };
  for (const path of moved.flatMap((move) => [move.from, move.to])) {
    if (path !== null) baselinePathEpoch[path] = baselineGeneration;
  }
  return { baselineGeneration, baselinePathEpoch };
}

/** Was `key` stamped after the generation `start`? `false` with no key or no `start`. */
export function movedSince(
  stamps: Record<string, number>,
  key: string | null,
  start: number | undefined,
): boolean {
  return start !== undefined && key !== null && (stamps[key] ?? 0) > start;
}
