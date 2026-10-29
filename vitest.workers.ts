/**
 * Purpose: decide how many workers a vitest run may use (D147). Several Claude
 * sessions and worktrees run vitest on one machine, so the default must leave
 * room for the others.
 *
 * Key decisions:
 *   - A run under `scripts/heavy-lock.sh` (which exports `MDPRO_HEAVY_LOCK_HELD=1`
 *     to its child) defaults to two workers. An explicit override can use
 *     three after the measured memory budget confirms it fits (ADR-0151).
 *   - A run outside the lock is a RED → GREEN partial run that may overlap other
 *     sessions' partial runs and one locked lane. It defaults to 2 workers, so
 *     three such runs cannot stack 15 workers on 10 cores (2026-10-11, load 45).
 *   - An explicit `VITEST_MAX_WORKERS` wins outside the lock. Under the lock,
 *     it is clamped to the measured cap.
 *
 * @coordinates-with vitest.config.ts — `test.maxWorkers` (vitest.slow.config.ts inherits it)
 * @coordinates-with scripts/heavy-lock.sh — exports MDPRO_HEAVY_LOCK_HELD=1
 */
import os from "node:os";

/** Workers for a run outside heavy-lock when nothing overrides it. */
export const UNLOCKED_MAX_WORKERS = 2;

/** Workers for a run under heavy-lock when nothing overrides it. */
export const LOCKED_MAX_WORKERS = 2;

/** Resolve vitest's `maxWorkers` from the environment. */
export function resolveMaxWorkers(env: Record<string, string | undefined>): number | string {
  const locked = env.MDPRO_HEAVY_LOCK_HELD === "1";
  const cap = Math.min(3, Math.max(1, os.availableParallelism() - 2));
  const raw = env.VITEST_MAX_WORKERS;
  if (raw === undefined || raw === "") {
    return locked ? Math.min(LOCKED_MAX_WORKERS, cap) : UNLOCKED_MAX_WORKERS;
  }
  if (/^\d+$/.test(raw)) return locked ? Math.min(Number(raw), cap) : Number(raw);
  const percentage = /^(\d+(?:\.\d+)?)%$/.exec(raw);
  if (locked && percentage) return Math.min(cap, Math.max(1, Math.floor(os.availableParallelism() * Number(percentage[1]) / 100)));
  return raw;
}
