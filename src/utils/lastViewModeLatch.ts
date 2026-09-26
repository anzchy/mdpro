/**
 * Purpose: the pure latch that decides when a view-mode change may be written
 * back as `lastViewMode` (ADR-0031 step 5a, WI-2, Amendment A1: "the saved view
 * mode is read before any write can replace it").
 *
 * Pipeline: `holding` —settled(m)→ armed(lastSeen m) —observed(x≠lastSeen)→
 *   write x, lastSeen x.
 *
 * Key decisions:
 * - While `holding`, nothing is written: startup has not yet read the stored
 *   value, so any view mode seen now is a default, not the user's choice.
 * - `settled` never writes. Reading or applying the stored value is not a
 *   change to persist (same principle as `applyThemeMode`).
 * - A `settled` while armed re-baselines instead of being ignored, so closing
 *   the last document can re-apply the stored mode without writing it back.
 * - Generic over the mode type, so the module imports nothing.
 *
 * @coordinates-with src/hooks/useLastViewModePersistence.ts
 */

/** The latch before startup has settled. */
export const HOLDING = "holding" as const;

export type LatchState<M extends string> = typeof HOLDING | { kind: "armed"; lastSeen: M };

export type LatchEvent<M extends string> =
  | { kind: "settled"; mode: M }
  | { kind: "observed"; mode: M };

export interface LatchResult<M extends string> {
  state: LatchState<M>;
  /** The mode to persist, or null when this event must not write. */
  write: M | null;
}

export function isHolding<M extends string>(state: LatchState<M>): state is typeof HOLDING {
  return state === HOLDING;
}

/** Advance the latch by one event. Pure: no I/O, no mutation of `state`. */
export function reduce<M extends string>(
  state: LatchState<M>,
  event: LatchEvent<M>,
): LatchResult<M> {
  if (event.kind === "settled") {
    return { state: { kind: "armed", lastSeen: event.mode }, write: null };
  }
  if (isHolding(state) || state.lastSeen === event.mode) {
    return { state, write: null };
  }
  return { state: { kind: "armed", lastSeen: event.mode }, write: event.mode };
}
