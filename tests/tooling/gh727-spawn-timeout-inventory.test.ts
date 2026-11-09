// @vitest-environment node
/**
 * GH727 AC-2 on the real repository: the committed baseline is exactly the lint's per-file count (C25), and an
 * independent text oracle finds no spawning test file the lint misses (C41).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM repository script has no declaration file
import { checkSpawnTimeouts, reachesSpawn } from "../../scripts/lint/spawn-timeouts.mjs";

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const toolingTests = walk("tests/tooling").filter((file) => /\.test\.tsx?$/.test(file)).sort();
/** The files AC-1 treats in full; none of them may be baselined. */
const AC1_FILES = [
  "tests/tooling/adr141-ci-inventory.test.ts",
  "tests/tooling/adr0141-wi2-route-guard.test.ts",
  "tests/tooling/load-guard-build-only.test.ts",
  "tests/tooling/d183-build-mac-product-checks.test.ts",
];

describe("GH727 spawn-timeout inventory (real repository)", () => {
  it("the baseline lists exactly the lint's count per file, and no AC-1 file", () => {
    const cache = new Map();
    const counts: Record<string, number> = {};
    for (const file of toolingTests) {
      const hits = (checkSpawnTimeouts(fs.readFileSync(file, "utf8"), file, cache) as string[]).length;
      if (hits) counts[file] = hits;
    }
    const baseline = JSON.parse(fs.readFileSync("scripts/lint/gh727-spawn-timeout-baseline.json", "utf8")) as { files: Record<string, number> };
    expect([baseline.files, AC1_FILES.filter((file) => file in baseline.files)]).toEqual([counts, []]);
  });

  /**
   * The oracle is module-level: a test file whose relative-import closure holds a module that names child_process
   * outside a string literal's contents (comments stripped), unless the test mocks child_process. It is coarser than
   * the lint, which follows imports export by export, so the files below are oracle-only by design: each imports
   * only exports that do not reach a child process from a module that has others that do.
   */
  const PURE_EXPORT_IMPORTS = [
    "tests/tooling/adr0149e-classify.test.ts",
    "tests/tooling/adr0149e-failures.test.ts",
    "tests/tooling/adr0149e-splice.test.ts",
    "tests/tooling/adr128-conditional-alias.test.ts",
    "tests/tooling/adr128-verifier-comparator.test.ts",
    "tests/tooling/d177-h1-lock-reclaim.test.ts",
    "tests/tooling/d177-no-secrets-scan.test.ts",
    "tests/tooling/d177-orphans-push.test.ts",
    "tests/tooling/d177-push-core-epoch.test.ts",
    "tests/tooling/d177-push-core-race.test.ts",
    "tests/tooling/d177-push-core.test.ts",
    "tests/tooling/d355-fix5-history.test.ts",
    // These two GH727 files: the lint module names child_process only as the modules it looks for.
    "tests/tooling/gh727-ac1-budgets.test.ts",
    "tests/tooling/gh727-spawn-timeout-inventory.test.ts",
    "tests/tooling/journeys-manifest.test.ts",
    "tests/tooling/journeys-schema.test.ts",
  ];
  it("an independent text oracle finds no spawning test file the lint misses, beyond the pure-export imports", () => {
    const literal = /`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
    const namesChild = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
        .replace(literal, (token) => (/^["'](node:)?child_process["']$/.test(token) ? "CHILD" : '""')).includes("CHILD");
    const resolve = (owner: string, specifier: string) => {
      const base = path.resolve(path.dirname(owner), specifier);
      return [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, base.replace(/\.m?js$/, ".ts"), path.join(base, "index.ts")]
        .find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
    };
    const oracle = (file: string) => {
      if (/vi\.mock\(\s*["'](node:)?child_process["']/.test(fs.readFileSync(file, "utf8"))) return false;
      const seen = new Set<string>(), queue = [path.resolve(file)];
      while (queue.length) {
        const next = queue.pop()!;
        if (seen.has(next)) continue;
        seen.add(next);
        const text = fs.readFileSync(next, "utf8");
        if (namesChild(text)) return true;
        for (const match of text.matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/g)) {
          const target = resolve(next, match[1]);
          if (target) queue.push(target);
        }
      }
      return false;
    };
    const cache = new Map();
    const missed = toolingTests.filter((file) => oracle(file) && !reachesSpawn(fs.readFileSync(file, "utf8"), file, cache));
    expect(missed).toEqual(PURE_EXPORT_IMPORTS);
  });
});
