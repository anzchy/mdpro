// @vitest-environment node
/**
 * ADR0149E-F2M3 (fix 2, gpt-auditor round one M3): two processes that both find the
 * evidence lock stale reap it once. The one that loses the race leaves the winner's fresh
 * lock alone and waits for it, so the two operations never overlap. Its barriers use their
 * own MDPRO_EVIDENCE_BARRIER_DIR, so the entry's race tests (MDPRO_UNIT_RED_BARRIER_DIR) never
 * pause inside the evidence lock.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
const evidence = resolve(import.meta.dirname, "../../scripts/tdd/receipt-evidence.mjs");
let scratch: string;
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), "mdpro-f2m3-")); });
afterEach(() => { writeFileSync(join(scratch, "p1-release"), "go"); rmSync(scratch, { recursive: true, force: true }); });
afterEach(() => { if (existsSync(scratch)) writeFileSync(join(scratch, "p2-release"), "go"); });

const until = async (check: () => boolean, ms: number) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); return check(); };
const log = () => (existsSync(join(scratch, "log")) ? readFileSync(join(scratch, "log"), "utf8").trim().split("\n") : []);

function driver(name: string) {
  const barrier = join(scratch, `barrier-${name}`);
  mkdirSync(barrier);
  const script = `import { appendFileSync, existsSync } from "node:fs";\nimport { withEvidenceLock } from ${JSON.stringify(evidence)};\nwithEvidenceLock(${JSON.stringify(scratch)}, () => {\n  appendFileSync(${JSON.stringify(join(scratch, "log"))}, "${name} in\\n");\n  const end = Date.now() + 30_000;\n  while (!existsSync(${JSON.stringify(join(scratch, `${name}-release`))}) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);\n  appendFileSync(${JSON.stringify(join(scratch, "log"))}, "${name} out\\n");\n});\n`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, MDPRO_EVIDENCE_BARRIER_DIR: barrier }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise<{ status: number | null; stderr: string }>((resolveDone) => child.once("close", (status) => resolveDone({ status, stderr })));
  return { pid: child.pid, barrier, done };
}

/** The pid of a process that has already exited. */
const deadPid = () => new Promise<number | undefined>((resolveDead) => { const child = spawn(process.execPath, ["-e", ""]); child.once("close", () => resolveDead(child.pid)); });
const lockDir = () => join(scratch, ".claude/tdd-guardian/.evidence.lock");

describe("ADR0149E-F2M3 the evidence lock's stale reap", () => {
  it.each([
    ["a dead owner", async () => writeFileSync(join(lockDir(), "owner.json"), JSON.stringify({ pid: await deadPid(), token: "old" }))],
    ["no owner file, older than a second", async () => { const past = new Date(Date.now() - 10_000); utimesSync(lockDir(), past, past); }],
  ])("stale with %s: the losing reaper leaves the winner's lock alone and the operations never overlap", async (_name, stale) => {
    const lock = lockDir();
    mkdirSync(lock, { recursive: true });
    await stale();
    writeFileSync(join(scratch, "p2-release"), "go");
    const p1 = driver("p1"), p2 = driver("p2");
    for (const p of [p1, p2]) writeFileSync(join(p.barrier, "evidence-before-owner.go"), "go"); // pauses only in F2M3b
    const observed = (p: { barrier: string }) => existsSync(join(p.barrier, "evidence-stale-observed.ready"));
    expect(await until(() => observed(p1) && observed(p2), 15_000)).toBe(true);
    writeFileSync(join(p1.barrier, "evidence-stale-observed.go"), "go");
    expect(await until(() => log().includes("p1 in"), 15_000)).toBe(true);
    writeFileSync(join(p2.barrier, "evidence-stale-observed.go"), "go");
    await new Promise((r) => setTimeout(r, 750));
    expect(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).pid).toBe(p1.pid);
    expect(log()).toEqual(["p1 in"]);
    writeFileSync(join(scratch, "p1-release"), "go");
    const [one, two] = await Promise.all([p1.done, p2.done]);
    expect(one.status, one.stderr).toBe(0);
    expect(two.status, two.stderr).toBe(0);
    expect(log()).toEqual(["p1 in", "p1 out", "p2 in", "p2 out"]);
  });
});

describe("ADR0149E-F2M3b a lock reaped while its taker stalls before the owner write", () => {
  it("the stalled taker does not enter while the reaper's fresh lock is held", async () => {
    const p1 = driver("p1");
    expect(await until(() => existsSync(join(p1.barrier, "evidence-before-owner.ready")), 15_000)).toBe(true);
    const past = new Date(Date.now() - 10_000);
    utimesSync(lockDir(), past, past);
    const p2 = driver("p2");
    writeFileSync(join(p2.barrier, "evidence-stale-observed.go"), "go");
    writeFileSync(join(p2.barrier, "evidence-before-owner.go"), "go");
    expect(await until(() => log().includes("p2 in"), 15_000)).toBe(true);
    writeFileSync(join(p1.barrier, "evidence-before-owner.go"), "go");
    await new Promise((r) => setTimeout(r, 750));
    expect(log()).toEqual(["p2 in"]);
    writeFileSync(join(scratch, "p2-release"), "go");
    writeFileSync(join(scratch, "p1-release"), "go");
    const [one, two] = await Promise.all([p1.done, p2.done]);
    expect(one.status, one.stderr).toBe(0);
    expect(two.status, two.stderr).toBe(0);
    expect(log()).toEqual(["p2 in", "p2 out", "p1 in", "p1 out"]);
  });
});
