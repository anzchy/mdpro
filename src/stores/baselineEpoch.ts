/**
 * Purpose: the baseline-generation bookkeeping documentStore keeps for D214 (WI-5/6/7):
 * when did a document's saved-content baseline last stop being trustworthy?
 *
 * Pipeline: `dropBaseline` / `closeDocument` (documentStore) → `stampBaseline` → a new
 *   generation on the document's id and, when it has one, its path · a save, reload or
 *   open captures `baselineGeneration` before its IPC → `movedSince(stamps, key, start)`
 *   when the reply lands → a moved key demotes the reply (dirty, no baseline).
 *
 * Key decisions:
 * - One window-wide generation that only grows, so a stamp never repeats across a
 *   document's lifetimes (WI-6, audit H-A). Stamps are never deleted: a close stamps.
 * - Two maps, never mixed (WI-7, audit H-B partial): by id (`baselineEpoch`) and by path
 *   (`baselinePathEpoch`). The path map covers a reply whose tab is gone or whose id is
 *   a UUID matched only by path (D145). A null path stamps nothing.
 * - Pure: no store import. documentStore owns the state and applies the result.
 *
 * @coordinates-with src/stores/documentStore.ts — holds the state, stamps, and wraps
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
}

export const INITIAL_BASELINE_EPOCHS: BaselineEpochs = {
  baselineGeneration: 0,
  baselineEpoch: {},
  baselinePathEpoch: {},
};

/** Stamp `id` (and `path`, when non-null) with the next generation. */
export function stampBaseline(state: BaselineEpochs, id: string, path: string | null): BaselineEpochs {
  const baselineGeneration = state.baselineGeneration + 1;
  return {
    baselineGeneration,
    baselineEpoch: { ...state.baselineEpoch, [id]: baselineGeneration },
    baselinePathEpoch:
      path === null ? state.baselinePathEpoch : { ...state.baselinePathEpoch, [path]: baselineGeneration },
  };
}

/** Was `key` stamped after the generation `start`? `false` with no key or no `start`. */
export function movedSince(
  stamps: Record<string, number>,
  key: string | null,
  start: number | undefined,
): boolean {
  return start !== undefined && key !== null && (stamps[key] ?? 0) > start;
}
