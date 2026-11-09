/**
 * Purpose: explicit, measured per-test budgets for tooling tests that spawn processes (#727).
 *
 * A spawning test's budget is ten times the worst duration measured when its file ran alone, rounded up to whole 5 s
 * steps and never below 15 s. Ten covers the load inflation seen in contended full lanes (0.76 s alone became 5.095 s,
 * 6.7×, in the GH674 verification). Call sites pass the measured worst alone-run duration as a literal, so each budget
 * shows where it came from.
 */
export const SPAWN_LOAD_FACTOR = 10;
export const SPAWN_BUDGET_FLOOR_MS = 15_000;
const STEP_MS = 5_000;

export function spawnBudget(worstAloneMs: number): number {
  if (!Number.isFinite(worstAloneMs) || worstAloneMs < 0) throw new RangeError(`spawnBudget needs a measured duration in ms, got ${worstAloneMs}`);
  return Math.max(SPAWN_BUDGET_FLOOR_MS, Math.ceil((worstAloneMs * SPAWN_LOAD_FACTOR) / STEP_MS) * STEP_MS);
}
