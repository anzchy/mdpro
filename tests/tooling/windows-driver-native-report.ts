/**
 * Purpose: read the native driver's out.json for runNative, and when it is missing or unreadable, fail with what
 * the run left behind (#728): the exit code, the signal, the stderr and stdout tails, the temp dir, and the
 * absolute paths of the artifacts still in it.
 *
 * @coordinates-with windows-driver-native-harness.ts — runNative passes each run's outcome and paths here.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** How much of each output stream a failure keeps: the end, where the driver's last words are. */
export const TAIL_CHARS = 2_000;
const ARTIFACTS = ["ui-test.ps1", "steps.json", "out.json", "trace.txt"];

export type NativeRun = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

const tail = (text: string) => (text.length > TAIL_CHARS ? text.slice(-TAIL_CHARS) : text);

export async function readNativeReport(run: NativeRun, dir: string, outPath: string): Promise<string | string[]> {
  let text: string;
  try {
    text = await readFile(outPath, "utf8");
  } catch (error) {
    throw new Error(describe(run, dir, `no report at ${outPath} (${error instanceof Error ? error.message : String(error)})`));
  }
  try {
    return JSON.parse(text) as string | string[];
  } catch (error) {
    throw new Error(describe(run, dir, `unreadable report at ${outPath} (${error instanceof Error ? error.message : String(error)})`));
  }
}

function describe(run: NativeRun, dir: string, what: string): string {
  const kept = ARTIFACTS.map((name) => path.join(dir, name)).filter((file) => existsSync(file));
  return [
    `native driver left ${what}: exit code ${run.status}, signal ${run.signal}`,
    `temp dir: ${dir}`,
    `artifacts: ${kept.length ? kept.join(", ") : "none"}`,
    `stderr tail:\n${tail(run.stderr)}`,
    `stdout tail:\n${tail(run.stdout)}`,
  ].join("\n");
}
