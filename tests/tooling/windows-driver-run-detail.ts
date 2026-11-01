/**
 * D345: the text a native-supervisor assertion message carries. ui-run prints its log to stdout (decoded into
 * `lines`), so `stderr` alone is empty when a phase times out, which is how CI's P3 failure showed nothing.
 */
export type RunResult = { status: number | null; lines: string[]; stderr: string };

export function runDetail(r: RunResult): string {
  const output = [...r.lines, ...(r.stderr ? [`stderr: ${r.stderr}`] : [])];
  return [`status ${r.status}`, ...(output.length ? output : ["(no output)"])].join("\n");
}
