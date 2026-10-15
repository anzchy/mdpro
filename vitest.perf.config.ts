import { defineConfig } from "vitest/config";

/**
 * D12 WI-7 retained-heap record (non-gating). `pnpm perf:d12`.
 *
 * `tests/perf/**\/*.perf.ts` (ADR-0098) does not match `vitest.config.ts`'s
 * `tests/**\/*.test.{ts,tsx}`, so neither `pnpm test:run` nor the
 * tdd-guardian lanes collect it. One file per size + forks + isolate =
 * a fresh child process per size; `fileParallelism: false` runs them
 * one at a time so they do not compete for memory. `--no-flush-bytecode`
 * stops V8 freeing aged bytecode inside a window (see tests/perf/d12Heap.ts).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/perf/**/*.perf.ts"],
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--expose-gc", "--no-flush-bytecode"], isolate: true, singleFork: false } },
    fileParallelism: false,
    testTimeout: 600_000,
  },
});
