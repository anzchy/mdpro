/**
 * Purpose: decide how many workers a vitest run may use (D147). Several Claude
 * sessions and worktrees run vitest on one machine, so the default must leave
 * room for the others.
 *
 * Key decisions:
 *   - A run under `scripts/heavy-lock.sh` (which exports `MDPRO_HEAVY_LOCK_HELD=1`
 *     to its child) is the only heavy run on the machine, so it keeps half the
 *     cores ("50%").
 *   - A run outside the lock is a RED → GREEN partial run that may overlap other
 *     sessions' partial runs and one locked lane. It defaults to 2 workers, so
 *     three such runs cannot stack 15 workers on 10 cores (2026-10-11, load 45).
 *   - An explicit `VITEST_MAX_WORKERS` always wins: "4" → 4 workers, "25%" → a
 *     percentage of the cores.
 *
 * @coordinates-with vitest.config.ts — `test.maxWorkers` (vitest.slow.config.ts inherits it)
 * @coordinates-with scripts/heavy-lock.sh — exports MDPRO_HEAVY_LOCK_HELD=1
 */

/** Workers for a run outside heavy-lock when nothing overrides it. */
export const UNLOCKED_MAX_WORKERS = 2;

/** Workers for a run under heavy-lock when nothing overrides it. */
export const LOCKED_MAX_WORKERS = "50%";

/** Resolve vitest's `maxWorkers` from the environment. */
export function resolveMaxWorkers(env: Record<string, string | undefined>): number | string {
  const raw = env.VITEST_MAX_WORKERS;
  if (raw === undefined || raw === "") {
    return env.MDPRO_HEAVY_LOCK_HELD === "1" ? LOCKED_MAX_WORKERS : UNLOCKED_MAX_WORKERS;
  }
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}
