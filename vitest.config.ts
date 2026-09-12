import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
    coverage: {
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Without `include` + `all`, the denominator is whatever the tests happened
      // to import — node_modules included — which reported a meaningless 97898
      // lines. Scoping it to first-party source is what makes the thresholds below
      // mean anything.
      include: ["src/**/*.{ts,tsx}"],
      all: true,
      // Measured floor, rounded down: 31.18 / 61.57 / 82.15 / 31.18. These must
      // stay identical to coverageThresholds in .claude/tdd-guardian/config.json;
      // the guardian JSON alone cannot make this command fail.
      thresholds: { lines: 31, functions: 61, branches: 82, statements: 31 },
    },
  },
});
