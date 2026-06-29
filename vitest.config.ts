import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Keep the phantom Rust build artifacts (src-tauri/target/** Rustdoc
      // search-index shards), config files, and spec docs out of the coverage
      // denominator. The first group alone is ~86k uncovered lines that are not
      // source. Defaults are overridden once `exclude` is set, so the standard
      // node_modules/dist/test excludes are restated here.
      exclude: [
        "**/target/**",
        "**/*.config.{js,ts}",
        "specs/**",
        // Stray agent worktrees under .claude/ duplicate the entire src/ tree
        // and double-count into the denominator like the Rust target/ shards do.
        ".claude/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "tests/**",
        "**/*.d.ts",
      ],
    },
  },
});
