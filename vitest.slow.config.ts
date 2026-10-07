import { configDefaults, defineConfig } from "vitest/config";
import base, { SLOW_TEST_GLOB } from "./vitest.config";

/**
 * Purpose: the slow test tier (ADR-0050). `pnpm test:slow`, and the
 * tdd-guardian `slow` lane (gateOn push / manual).
 *
 * Collects only `tests/**\/*.slow.test.{ts,tsx}` — the exhaustive, property and
 * cost-enumeration tests that vitest.config.ts excludes from the default run.
 * Everything else (setup file, jsdom default, mock resets, worker cap) is the
 * unit config, so a slow test behaves exactly as it did in the unit run.
 *
 * Key decisions:
 * - **Explicit, generous timeout.** Each slow test also passes its own budget;
 *   180 s is the floor for any that does not.
 * - **No coverage thresholds.** The unit lane alone meets them (ADR-0050 records
 *   the measurement); a `--coverage` run here writes to coverage/slow so it can
 *   never overwrite the unit lane's coverage-summary.json.
 *
 * @coordinates-with vitest.config.ts — SLOW_TEST_GLOB and the base config.
 */
const SLOW_TEST_TIMEOUT_MS = 180_000;

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [SLOW_TEST_GLOB],
    exclude: [...configDefaults.exclude],
    testTimeout: SLOW_TEST_TIMEOUT_MS,
    coverage: {
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage/slow",
      include: ["src/**/*.{ts,tsx}"],
      all: true,
    },
  },
});
