import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// Concurrent Claude sessions and worktrees each run this suite; vitest's default
// (cores - 1 forks) per run overloads the machine. Cap at half the cores unless
// VITEST_MAX_WORKERS overrides it ("4" → 4 workers, "25%" → a percentage).
const rawMaxWorkers = process.env.VITEST_MAX_WORKERS ?? "50%";
const maxWorkers = /^\d+$/.test(rawMaxWorkers) ? Number(rawMaxWorkers) : rawMaxWorkers;

/**
 * The slow tier (ADR-0050): exhaustive / property / cost-enumeration tests that
 * take >= 2 s each under coverage. Named `*.slow.test.ts`, kept out of the
 * default run (and so out of the per-commit unit lane) by the exclude below,
 * and collected only by vitest.slow.config.ts (`pnpm test:slow`).
 */
export const SLOW_TEST_GLOB = "tests/**/*.slow.test.{ts,tsx}";

export default defineConfig({
  // Vitest picks the JSX transform from the nearest tsconfig.json, and that file
  // includes only `src` — a .tsx under tests/ would fall back to the classic
  // transform and fail on an undefined `React`. The plugin settles it explicitly.
  plugins: [react()],
  test: {
    // jsdom is the default. A file that never touches the DOM opts into the
    // cheaper node environment with a first-line `// @vitest-environment node`;
    // tests/setup.ts then guards it against DOM reads (ADR-0049).
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, SLOW_TEST_GLOB],
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    maxWorkers,
    coverage: {
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Without `include` + `all`, the denominator is whatever the tests happened
      // to import — node_modules included — which reported a meaningless 97898
      // lines. Scoping it to first-party source is what makes the thresholds below
      // mean anything. `scripts/control` is first-party build tooling with its own
      // unit tests (ADR-0047); its untested driver `smoke.mjs` counts as 0%, on purpose.
      // `scripts/release` (D76, plan D-6) is the release pipeline's pure modules and CLIs,
      // counted the same way.
      include: ["src/**/*.{ts,tsx}", "scripts/control/**/*.mjs", "scripts/release/**/*.mjs"],
      all: true,
      // Measured floor, rounded down (2026-10-02, WI-0.1 pre-run): 73.62 / 80.80 / 91.38 / 73.62.
      // With scripts/control included (2026-10-08): 76.92 / 82.90 / 91.56 / 76.92. These must
      // stay identical to coverageThresholds in .claude/tdd-guardian/config.json;
      // the guardian JSON alone cannot make this command fail.
      thresholds: { lines: 73, functions: 80, branches: 91, statements: 73 },
    },
  },
});
