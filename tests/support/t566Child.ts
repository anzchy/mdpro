/**
 * Purpose: Run vitest on repository test files in a child process for the #566 fix-2 tests, with this process's
 * vitest variables and `RUNNER_OS` removed, and return each test's status by inventory id. A child that does not exit 0
 * with a readable report rejects with one diagnostic naming its status, budget, report and output tail (#674).
 * @coordinates-with tests/tooling/t566-fix2-cache-free.test.ts, tests/tooling/t566-fix2-ci-shape.test.ts
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createOwnerChildRunner } from "../tooling/d302Child";
import { repoRoot } from "./t566Engine";

export interface ChildRun { status: number | null; budget: number; output: string; statuses: Map<string, string>; failed: Array<{ id: string; messages: string[] }>; report: string; dir: string }
type Outcome = Pick<ChildRun, "status" | "budget" | "output" | "report">;
type Report = { testResults: Array<{ name: string; assertionResults: Array<{ ancestorTitles: string[]; title: string; status: string; failureMessages: string[] }> }> };

/** How much of the child's output a diagnostic quotes, from the end. */
const OUTPUT_TAIL_CHARS = 2000;

/** One line naming the child's exit status, its budget, its report path (and whether the file exists), then the output's tail. */
export const childDiagnostic = (run: Outcome) =>
  `status ${run.status}, budget ${run.budget} ms, report ${run.report} (${existsSync(run.report) ? "exists" : "absent"}); output tail:\n${run.output.slice(-OUTPUT_TAIL_CHARS)}`;

/** The parsed report of a child that exited 0; anything else (killed at its budget, non-zero, no or unreadable report) throws the diagnostic. */
export function childOutcome(run: Outcome): Report {
  const fail = (reason = "") => Error(`child vitest failed: ${childDiagnostic(run)}${reason}`);
  if (run.status !== 0) throw fail();
  try { return JSON.parse(readFileSync(run.report, "utf8")) as Report; } catch (error) {
    throw fail(`\nreport unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * `dir` holds the JSON report; the caller removes it. A child past `timeout` is killed, and the call rejects with the
 * diagnostic; on any rejection `dir` is removed first, so the diagnostic's report path and its exists/absent mark say
 * what the child left at exit, not a file that can still be read.
 */
export async function childVitest(signal: AbortSignal, files: string[], env: Record<string, string>, timeout = 540_000): Promise<ChildRun> {
  const dir = mkdtempSync(join(tmpdir(), "mdpro-t566f2-report-"));
  const report = join(dir, "vitest.json");
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST") && key !== "RUNNER_OS" && !key.startsWith("MDPRO_UNIT_RED")));
  const owner = createOwnerChildRunner(signal);
  try {
    const result = await owner.run(process.execPath, [join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", ...files, "--coverage.enabled=false", "--reporter=json", `--outputFile=${report}`], {
      cwd: repoRoot, env: { ...base, VITEST_MAX_WORKERS: "2", ...env } as NodeJS.ProcessEnv, timeout,
    });
    const run = { status: result.status, budget: timeout, output: `${result.stdout}\n${result.stderr}`, report };
    const parsed = childOutcome(run);
    const statuses = new Map<string, string>();
    const failed: ChildRun["failed"] = [];
    for (const file of parsed.testResults) for (const test of file.assertionResults) {
      const id = JSON.stringify([relative(repoRoot, file.name), ...test.ancestorTitles, test.title]);
      statuses.set(id, test.status);
      if (test.status === "failed") failed.push({ id, messages: test.failureMessages });
    }
    return { ...run, statuses, failed, dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally { await owner.close(); }
}

/** How many tests reported each status. */
export const statusCounts = (statuses: Map<string, string>) =>
  [...statuses.values()].reduce<Record<string, number>>((all, status) => ({ ...all, [status]: (all[status] ?? 0) + 1 }), {});
