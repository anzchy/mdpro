// @vitest-environment node
/**
 * D105-WI-1 MX-11: mutual exclusion of `withLockMutex`
 * (`scripts/control/lockMutex.mjs`) across real processes. Slow lane
 * (ADR-0050); no spies, no timing assertion (E39).
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`, D105-WI-1 MX-11.
 *
 * Six children share one runs parent and a busy-wait start barrier. Each runs
 * `ROUNDS` sections; a section `wx`-creates a critical-section marker in a
 * separate logs dir and unlinks it. Two children inside at once make the
 * second `wx` fail with EEXIST, which the child counts as a violation.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const MUTEX_URL = pathToFileURL(path.resolve(__dirname, "../scripts/control/lockMutex.mjs")).href;
const CHILDREN = 6;
const ROUNDS = 200;
const START_DELAY_MS = 1000;
/** Generous: a section holds the mutex for two syscalls; this bounds a hang only. */
const CHILD_WAIT_MS = 30_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const scratch = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
};

type Report = { rounds: number; violations: number; busy: number; other: string[] };

function runChild(parent: string, cs: string, startAt: number): Promise<Report> {
  const J = JSON.stringify;
  const src =
    `import { withLockMutex } from ${J(MUTEX_URL)};` +
    `import { writeFileSync, unlinkSync } from "node:fs";` +
    `const r = { rounds: 0, violations: 0, busy: 0, other: [] };` +
    `while (Date.now() < ${startAt}) {}` +
    `for (let i = 0; i < ${ROUNDS}; i++) {` +
    `  try {` +
    `    withLockMutex(${J(parent)}, () => {` +
    `      try { writeFileSync(${J(cs)}, "", { flag: "wx" }); } catch (e) { if (e.code === "EEXIST") { r.violations++; return; } throw e; }` +
    `      unlinkSync(${J(cs)});` +
    `    }, { waitMs: ${CHILD_WAIT_MS} });` +
    `  } catch (e) { const m = e instanceof Error ? e.message : String(e); if (m.startsWith("lock busy: ")) r.busy++; else r.other.push(m); }` +
    `  r.rounds++;` +
    `}` +
    `process.stdout.write(JSON.stringify(r));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`child exit ${code}: ${err}`))));
  });
}

describe("D105-WI-1 MX-11 cross-process mutual exclusion", () => {
  it("MX-11 six children × 200 sections: no section ever overlaps another, every child finishes", async () => {
    const parent = scratch("lkm-");
    const logs = scratch("lkm-log-");
    const cs = path.join(logs, "cs");
    const startAt = Date.now() + START_DELAY_MS;
    const reports = await Promise.all(Array.from({ length: CHILDREN }, () => runChild(parent, cs, startAt)));
    const summary = JSON.stringify(reports);
    expect(reports.map((r) => r.violations), summary).toEqual(Array(CHILDREN).fill(0));
    expect(reports.map((r) => r.rounds), summary).toEqual(Array(CHILDREN).fill(ROUNDS));
    expect(reports.flatMap((r) => r.other), summary).toEqual([]);
    expect(fs.readdirSync(parent), summary).toEqual([]);
  }, 120_000);
});
