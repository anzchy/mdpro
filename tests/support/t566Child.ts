/**
 * Purpose: Run vitest on repository test files in a child process for the #566 fix-2 tests, with this process's
 * vitest variables and `RUNNER_OS` removed, and return each test's status by inventory id.
 * @coordinates-with tests/tooling/t566-fix2-cache-free.test.ts, tests/tooling/t566-fix2-ci-shape.test.ts
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createOwnerChildRunner } from "../tooling/d302Child";
import { repoRoot } from "./t566Engine";

export interface ChildRun { status: number | null; output: string; statuses: Map<string, string>; failed: Array<{ id: string; messages: string[] }>; report: string; dir: string }

/** `dir` holds the JSON report; the caller removes it. A child past `timeout` is killed and reports nothing. */
export async function childVitest(signal: AbortSignal, files: string[], env: Record<string, string>, timeout = 540_000): Promise<ChildRun> {
  const dir = mkdtempSync(join(tmpdir(), "mdpro-t566f2-report-"));
  const report = join(dir, "vitest.json");
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST") && key !== "RUNNER_OS" && !key.startsWith("MDPRO_UNIT_RED")));
  const owner = createOwnerChildRunner(signal);
  try {
    const result = await owner.run(process.execPath, [join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", ...files, "--coverage.enabled=false", "--reporter=json", `--outputFile=${report}`], {
      cwd: repoRoot, env: { ...base, VITEST_MAX_WORKERS: "2", ...env } as NodeJS.ProcessEnv, timeout,
    });
    const parsed = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : { testResults: [] };
    const statuses = new Map<string, string>();
    const failed: ChildRun["failed"] = [];
    for (const file of parsed.testResults) for (const test of file.assertionResults) {
      const id = JSON.stringify([relative(repoRoot, file.name), ...test.ancestorTitles, test.title]);
      statuses.set(id, test.status);
      if (test.status === "failed") failed.push({ id, messages: test.failureMessages });
    }
    return { status: result.status, output: `${result.stdout}\n${result.stderr}`, statuses, failed, report, dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally { await owner.close(); }
}

/** How many tests reported each status. */
export const statusCounts = (statuses: Map<string, string>) =>
  [...statuses.values()].reduce<Record<string, number>>((all, status) => ({ ...all, [status]: (all[status] ?? 0) + 1 }), {});
