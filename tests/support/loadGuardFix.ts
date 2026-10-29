/** Real private process groups and OS-boundary fixtures for ADR0150 fix 1. */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { runChild, waitForExit } from "./loadGuardChild";

export const guardDir = path.resolve("scripts/load-guard");
export const wrapper = path.resolve("scripts/heavy-lock.sh");
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(check: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await delay(20);
  expect(check()).toBe(true);
}
export function fixture(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sampler = path.join(dir, "sampler");
  fs.writeFileSync(sampler, "#!/bin/sh\necho '1 0 16'\n", { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_HEAVY_LOCK_HELD: undefined,
    MDPRO_VITEST_WORKER_HEAP_MIB: undefined, MDPRO_LOAD_GUARD_PROCESSES: undefined,
    MDPRO_LOAD_GUARD_TEST_ROOT: dir, MDPRO_HEAVY_LOCK: path.join(dir, "lock"),
    MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"), MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"),
    MDPRO_LOAD_GUARD_STATE: path.join(dir, "state"), MDPRO_LOAD_GUARD_SAMPLER: sampler,
    MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.05", MDPRO_HEAVY_LOCK_KILL_GRACE_SECS: "1",
    MDPRO_LOAD_GUARD_KILL_GRACE_SECS: "0.2" };
  return { dir, env, sampler };
}
export function records(dir: string): Array<Record<string, any>> {
  const file = path.join(dir, "log");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export async function python(code: string, env: NodeJS.ProcessEnv) {
  const result = await runChild("python3", ["-c", `import sys,json,os,pathlib;sys.path.insert(0,${JSON.stringify(guardDir)});import guard,backstop\n${code}`], { env, timeout: 30000 });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}
export async function cleanup(child: ChildProcess) {
  try { process.kill(-child.pid!, "SIGKILL"); } catch { /* private group already drained */ }
  await waitForExit(child);
}
export function sleeper() {
  return spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
}
export function singleDayPs(dir: string) {
  fs.writeFileSync(path.join(dir, "ps"), `#!/usr/bin/env python3
import subprocess,sys,re
r=subprocess.run(['/bin/ps',*sys.argv[1:]],capture_output=True,text=True)
sys.stdout.write(re.sub(r'(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\d{4}', 'Tue Nov  3 09:05:07 2026',r.stdout))
sys.exit(r.returncode)
`, { mode: 0o700 });
}

/** Contain real inventory stop fixtures to their own live process group.
 * Only the global inventory ps boundary is scoped; every row, membership
 * refresh, lsof lookup, identity check and signal still uses the actual OS.
 */
export async function scopeInventory(dir: string, env: NodeJS.ProcessEnv, pgid: number) {
  const python = (await runChild("/usr/bin/which", ["python3"])).stdout.trim();
  const group = path.join(dir, "owned-pgid");
  fs.writeFileSync(group, String(pgid));
  fs.writeFileSync(path.join(dir, "ps"), `#!${python}
import os,pathlib,subprocess,sys
args=sys.argv[1:]
if args==['-axo','pid=,ppid=,pgid=,uid=,command=']:
 group=pathlib.Path(${JSON.stringify(group)}).read_text().strip()
 rows=subprocess.run(['/bin/ps',*args],capture_output=True,text=True,check=True).stdout.splitlines()
 for row in rows:
  parts=row.split(None,4)
  if len(parts)==5 and parts[2]==group: print(row)
else: os.execv('/bin/ps',['/bin/ps',*args])
`, { mode: 0o700 });
  env.PATH = `${dir}:${process.env.PATH}`;
}
