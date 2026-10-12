/**
 * Purpose: this window's ledger of watch holds (D173, ADR-0086 decision 3). Rust keys a
 * hold by (window, raw path) and a generation, and every acquisition reply carries it
 * as `holdGen`. The ledger keeps the latest gen per path, the paths an in-flight open
 * or Save As has reserved, and the paths due a release check. Pure state with no
 * imports, so `fileService` can write gens into it without a cycle; `watchHolds.ts`
 * decides and calls `release_watch_hold`.
 *
 * Key decisions:
 * - **The latest gen wins** (`Math.max`): Rust's gens are global and increasing, and
 *   its current hold is the last one reserved, so a release carrying anything older is
 *   `stale` there. A late reply can never lower the gen.
 * - **Gen 0 (or none) is no hold** and is ignored.
 * - **A reservation defers every check on its path**; a `null` reservation (the Open and
 *   Save As dialogs pick the path in Rust) defers them all. A gen noted while its path
 *   is reserved becomes a candidate, so an acquisition that never became a document is
 *   still released once its capture settles.
 * - **A gen noted with no reservation is not a candidate** (recovery: the document is
 *   upserted later). It is checked when a document on that path goes away.
 *
 * @coordinates-with src/utils/watchHolds.ts — the subscription that drains it
 * @coordinates-with src/services/fileService.ts — notes the open / Save As gens
 * @coordinates-with src/services/draftService.ts — notes the recover gen
 * @module utils/watchHoldLedger
 */

const gens = new Map<string, number>();
const reserved = new Map<string, number>();
let reservedAll = 0;
const candidates = new Set<string>();

function isReserved(path: string): boolean {
  return reservedAll > 0 || (reserved.get(path) ?? 0) > 0;
}

/** Record the `holdGen` an acquisition reply carried for `path`. */
export function noteHold(path: string | null | undefined, gen: number | null | undefined): void {
  if (!path || typeof gen !== "number" || gen <= 0) return;
  gens.set(path, Math.max(gens.get(path) ?? 0, gen));
  if (isReserved(path)) candidates.add(path);
}

/** An open or Save As of `path` (null: not known yet) is in flight. */
export function reservePath(path: string | null): void {
  if (path === null) reservedAll += 1;
  else reserved.set(path, (reserved.get(path) ?? 0) + 1);
}

/** That open or Save As settled; its path is due a check. */
export function unreservePath(path: string | null): void {
  if (path === null) {
    reservedAll = Math.max(0, reservedAll - 1);
    return;
  }
  const left = (reserved.get(path) ?? 0) - 1;
  if (left > 0) reserved.set(path, left);
  else reserved.delete(path);
  candidates.add(path);
}

/** A document on `path` went away (closed, or moved to another path). */
export function markCandidate(path: string): void {
  candidates.add(path);
}

/**
 * Take every candidate that is not reserved: drop it, and hand back the ones with a
 * gen that no document holds (`isHeld`), forgetting their gen. Each is released once.
 */
export function takeReleasable(isHeld: (path: string) => boolean): Array<{ path: string; gen: number }> {
  const out: Array<{ path: string; gen: number }> = [];
  for (const path of [...candidates]) {
    if (isReserved(path)) continue;
    candidates.delete(path);
    const gen = gens.get(path);
    if (gen === undefined || isHeld(path)) continue;
    gens.delete(path);
    out.push({ path, gen });
  }
  return out;
}
