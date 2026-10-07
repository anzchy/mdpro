import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Concurrent Claude sessions and worktrees each run this suite; vitest's default
// (cores - 1 forks) per run overloads the machine. Cap at half the cores unless
// VITEST_MAX_WORKERS overrides it ("4" → 4 workers, "25%" → a percentage).
const rawMaxWorkers = process.env.VITEST_MAX_WORKERS ?? "50%";
const maxWorkers = /^\d+$/.test(rawMaxWorkers) ? Number(rawMaxWorkers) : rawMaxWorkers;

export default defineConfig({
  // Vitest picks the JSX transform from the nearest tsconfig.json, and that file
  // includes only `src` — a .tsx under tests/ would fall back to the classic
  // transform and fail on an undefined `React`. The plugin settles it explicitly.
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
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
      // mean anything.
      include: ["src/**/*.{ts,tsx}"],
      all: true,
      // Measured floor, rounded down (2026-10-02, WI-0.1 pre-run): 73.62 / 80.80 / 91.38 / 73.62. These must
      // stay identical to coverageThresholds in .claude/tdd-guardian/config.json;
      // the guardian JSON alone cannot make this command fail.
      thresholds: { lines: 73, functions: 80, branches: 91, statements: 73 },
    },
  },
});
