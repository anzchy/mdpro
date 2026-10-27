// @vitest-environment node
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no declaration file
import { runIdentity } from "../../scripts/device/identity.mjs";

const releaseId = `0.3.5-dev@${"a".repeat(40)}`;
type IdentityResult = { exit: number; report: string };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d326-测试 space-"));
  dirs.push(dir);
  const bundle = path.join(dir, "mdpro.app");
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  const file = path.join(dir, "示例 file.md");
  fs.writeFileSync(file, "# Fixture\n");
  const out = path.join(dir, "report.txt");
  const process = { pid: 42, exe: path.join(bundle, "Contents", "MacOS", "tauri-app"), birthMs: 100 };
  const records = [
    { event: "window.open", status: "success", context: { pid: 42 }, ts: 101 },
    { event: "app.ready", status: "success", context: { pid: 42, releaseId }, ts: 102 },
  ];
  const ops: string[] = [];
  let scans = 0;
  const deps = {
    resolveDefault: async () => releaseId,
    scanProcesses: async () => (++scans === 1 ? [] : [process]),
    logCursor: async () => 0,
    readLog: async () => records,
    launch: async (args: string[]) => { ops.push(`open:${args.join("|")}`); },
    now: () => 200,
    sleep: async () => {},
    timeoutMs: 0,
  };
  return { bundle, file, out, process, records, deps, ops };
}

async function waitForMarker(out: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (fs.existsSync(out)) {
      const marker = fs.readFileSync(out, "utf8");
      if (marker.startsWith("IN PROGRESS ")) return marker;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("marker did not appear");
}

async function waitForNewMarker(out: string, previous: string | null) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (fs.existsSync(out)) {
      const marker = fs.readFileSync(out, "utf8");
      if (marker.startsWith("IN PROGRESS ") && marker !== previous) return marker;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("new marker did not appear");
}

function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

describe("device identity driver", () => {
  it("refuses same-path contenders while A polls and preserves A's marker", async () => {
    const f = fixture();
    const hold = deferred();
    f.deps.readLog = async () => { await hold.wait; return f.records; };
    const a = runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps);
    const marker = await waitForMarker(f.out);
    const b = await Promise.race([
      runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("B did not refuse promptly")), 1000)),
    ]);
    expect(b.report).toContain("[FAIL] process");
    expect(b.exit).toBe(1);
    expect(fs.readFileSync(f.out, "utf8")).toBe(marker);
    const c = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps);
    expect(c.exit).toBe(1);
    expect(fs.readFileSync(f.out, "utf8")).toBe(marker);
    hold.release();
    const winner = await a;
    expect(winner.exit).toBe(0);
    expect(fs.readFileSync(f.out, "utf8")).toBe(winner.report);
  });

  it("allows exactly one simultaneous owner, including after a stale lock artifact", async () => {
    const f = fixture();
    for (const stale of [false, true]) {
      if (stale) fs.writeFileSync(`${f.out}.lock`, "old lock file\n");
      const previous = fs.existsSync(f.out) ? fs.readFileSync(f.out, "utf8") : null;
      const hold = deferred();
      let polling = 0;
      const makeDeps = () => {
        let scans = 0;
        return { ...f.deps, scanProcesses: async () => ++scans === 1 ? [] : [f.process],
          readLog: async () => { polling++; await hold.wait; return f.records; } };
      };
      const runs = [0, 1].map(() => runIdentity([
        "--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out,
      ], makeDeps()));
      const marker = await waitForNewMarker(f.out, previous);
      const first = await Promise.race([
        ...runs,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("loser did not refuse")), 1000)),
      ]);
      expect(first.exit).toBe(1);
      expect(first.report).toContain("[FAIL] process");
      expect(polling).toBe(1);
      expect(fs.readFileSync(f.out, "utf8")).toBe(marker);
      hold.release();
      const settled = await Promise.all(runs);
      const winner = settled.find((run: IdentityResult) => run.exit === 0);
      expect(winner).toBeDefined();
      expect(fs.readFileSync(f.out, "utf8")).toBe(winner?.report);
    }
  });

  it("never replaces a marker owned by another run", async () => {
    const f = fixture();
    const hold = deferred();
    f.deps.readLog = async () => { await hold.wait; return f.records; };
    const pending = runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps);
    await waitForMarker(f.out);
    fs.writeFileSync(f.out, "IN PROGRESS foreign\n");
    hold.release();
    const result = await pending;
    expect(result.exit).toBe(1);
    expect(fs.readFileSync(f.out, "utf8")).toBe("IN PROGRESS foreign\n");
  });

  it("recovers the report path after a killed owner leaves its lock file", async () => {
    const f = fixture();
    const child = spawn(process.execPath, [path.resolve("tests/support/d326-interrupted-run.mjs"), f.bundle, f.out, releaseId], { stdio: "ignore" });
    await waitForMarker(f.out);
    const lockPath = `${f.out}.lock`;
    expect(fs.existsSync(lockPath)).toBe(true);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    f.deps.scanProcesses = async () => [f.process];
    const next = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId,
      "--check-only", "--out", f.out], f.deps);
    expect(next.exit).toBe(0);
    expect(fs.readFileSync(f.out, "utf8")).toBe(next.report);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("admits one simultaneous owner after a killed owner leaves a lock artifact", async () => {
    const f = fixture();
    const prior = spawn(process.execPath, [path.resolve("tests/support/d326-interrupted-run.mjs"), f.bundle, f.out, releaseId], { stdio: "ignore" });
    await waitForMarker(f.out);
    const exited = new Promise((resolve) => prior.once("exit", resolve));
    prior.kill("SIGKILL");
    await exited;
    expect(fs.existsSync(`${f.out}.lock`)).toBe(true);
    const previous = fs.readFileSync(f.out, "utf8");
    const hold = deferred();
    let polling = 0;
    const makeDeps = () => {
      let scans = 0;
      return { ...f.deps, scanProcesses: async () => ++scans === 1 ? [] : [f.process],
        readLog: async () => { polling++; await hold.wait; return f.records; } };
    };
    const runs = [0, 1].map(() => runIdentity([
      "--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out,
    ], makeDeps()));
    const deadline = Date.now() + 3000;
    let marker = previous;
    while (marker === previous && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      marker = fs.readFileSync(f.out, "utf8");
    }
    expect(marker).not.toBe(previous);
    const loser = await Promise.race([...runs,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("loser did not refuse")), 1000))]);
    expect(loser.exit).toBe(1);
    expect(polling).toBe(1);
    expect(fs.readFileSync(f.out, "utf8")).toBe(marker);
    hold.release();
    const results = await Promise.all(runs);
    expect(results.map((result: IdentityResult) => result.exit).sort()).toEqual([0, 1]);
  });

  it("uses independent locks for different report paths", async () => {
    const f = fixture();
    const other = path.join(path.dirname(f.out), "other.txt");
    const hold = deferred();
    const deps = { ...f.deps, scanProcesses: async () => [f.process],
      readLog: async () => { await hold.wait; return f.records; } };
    const first = runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--check-only", "--out", f.out], deps);
    const second = runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--check-only", "--out", other], deps);
    await Promise.all([waitForMarker(f.out), waitForMarker(other)]);
    hold.release();
    const results = await Promise.all([first, second]);
    expect(results.map((result: IdentityResult) => result.exit)).toEqual([0, 0]);
    expect(fs.readFileSync(f.out, "utf8")).toBe(results[0].report);
    expect(fs.readFileSync(other, "utf8")).toBe(results[1].report);
  });

  it("releases ownership after success, failure, and invalid arguments", async () => {
    const f = fixture();
    f.deps.scanProcesses = async () => [f.process];
    const args = ["--bundle", f.bundle, "--expected-release-id", releaseId, "--check-only", "--out", f.out];
    const success = await runIdentity(args, f.deps);
    expect(success.exit).toBe(0);
    f.records[1].context.releaseId = "unknown";
    const failure = await runIdentity(args, f.deps);
    expect(failure.exit).toBe(1);
    expect(fs.readFileSync(f.out, "utf8")).toBe(failure.report);
    const invalid = await runIdentity([...args, "--bogus"], f.deps);
    expect(invalid.exit).toBe(1);
    expect(fs.readFileSync(f.out, "utf8")).toBe(invalid.report);
    f.records[1].context.releaseId = releaseId;
    const again = await runIdentity(args, f.deps);
    expect(again.exit).toBe(0);
    expect(fs.readFileSync(f.out, "utf8")).toBe(again.report);
  });
  it("CLI prints the same four-check FAIL report archived for invalid input", () => {
    const f = fixture();
    fs.writeFileSync(f.out, "[PASS] old run\n");
    const run = spawnSync(process.execPath, [path.resolve("scripts/device/identity.mjs"), "--bundle", f.bundle,
      "--expected-release-id", "unknown", "--out", f.out], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe(fs.readFileSync(f.out, "utf8"));
    expect(run.stdout.trim().split("\n")).toHaveLength(4);
    expect(run.stdout).not.toContain("[PASS] old run");
  });
  it("a killed run leaves IN PROGRESS instead of an older PASS", async () => {
    const f = fixture();
    fs.writeFileSync(f.out, "[PASS] old run\n");
    const child = spawn(process.execPath, [path.resolve("tests/support/d326-interrupted-run.mjs"), f.bundle, f.out, releaseId], { stdio: "ignore" });
    try {
      const deadline = Date.now() + 3000;
      while (!fs.readFileSync(f.out, "utf8").startsWith("IN PROGRESS ") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(fs.readFileSync(f.out, "utf8")).toMatch(/^IN PROGRESS [0-9a-f-]+\n$/);
    } finally {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    expect(fs.readFileSync(f.out, "utf8")).toMatch(/^IN PROGRESS [0-9a-f-]+\n$/);
  });
  it("passes a Unicode fixture path through open -n and reports four passes", async () => {
    const f = fixture();
    const result = await runIdentity(["--bundle", f.bundle, "--file", f.file, "--expected-release-id", releaseId], f.deps);
    expect(f.ops).toEqual([`open:-n|${f.bundle}|${f.file}`]);
    expect(result.lines).toEqual(["[PASS] bundle", "[PASS] process", "[PASS] releaseId", "[PASS] window"]);
    expect(result.exit).toBe(0);
  });

  it("refuses a missing bundle before launch", async () => {
    const f = fixture();
    const result = await runIdentity(["--bundle", path.join(path.dirname(f.bundle), "absent.app"), "--expected-release-id", releaseId], f.deps);
    expect(result.lines).toContain("[FAIL] bundle");
    expect(result.exit).toBe(1);
    expect(f.ops).toEqual([]);
  });

  it("times out without a fresh ready event", async () => {
    const f = fixture();
    f.deps.readLog = async () => [];
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId], f.deps);
    expect(result.lines).toContain("[FAIL] releaseId");
    expect(result.exit).toBe(1);
  });

  it("check-only accepts only this process's newer startup events", async () => {
    const f = fixture();
    f.deps.scanProcesses = async () => [f.process];
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--check-only"], f.deps);
    expect(result.lines).toEqual(["[PASS] bundle", "[PASS] process", "[PASS] releaseId", "[PASS] window"]);
    expect(f.ops).toEqual([]);
  });

  it("never launches or cleans when another mdpro process already exists", async () => {
    const f = fixture();
    f.deps.scanProcesses = async () => [{ pid: 9, exe: "/Applications/mdpro.app/Contents/MacOS/tauri-app", birthMs: 1 }];
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId], f.deps);
    expect(result.lines).toContain("[FAIL] process");
    expect(result.lines).toContain("[SKIPPED] window");
    expect(result.exit).toBe(1);
    expect(f.ops).toEqual([]);
  });

  it("replaces a previous PASS archive with the current FAIL report", async () => {
    const f = fixture();
    fs.writeFileSync(f.out, "[PASS] old run\n");
    f.records[1].context.releaseId = "unknown";
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps);
    expect(result.exit).toBe(1);
    expect(result.lines).toContain("[FAIL] releaseId");
    expect(fs.readFileSync(f.out, "utf8")).toBe(result.report);
    expect(result.report).not.toContain("[PASS] old run");
    expect(fs.readdirSync(path.dirname(f.out)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("never copies a control token or raw log content into stdout or archive", async () => {
    const f = fixture();
    const token = "secret-control-token-d326";
    (f.records[0].context as Record<string, unknown>).token = token;
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps);
    expect(result.report).not.toContain(token);
    expect(fs.readFileSync(f.out, "utf8")).not.toContain(token);
    expect(result.lines).toHaveLength(4);
  });

  it("puts IN PROGRESS in the archive before a blocked launch", async () => {
    const f = fixture();
    fs.writeFileSync(f.out, "[PASS] old run\n");
    f.deps.launch = async () => { expect(fs.readFileSync(f.out, "utf8")).toMatch(/^IN PROGRESS [0-9a-f-]+\n$/); await new Promise<never>(() => {}); };
    void runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--out", f.out], f.deps);
    await waitForMarker(f.out);
    expect(fs.readFileSync(f.out, "utf8")).toMatch(/^IN PROGRESS [0-9a-f-]+\n$/);
  });

  it("check-only refuses startup records older than the live process", async () => {
    const f = fixture();
    f.process.birthMs = 500;
    f.deps.scanProcesses = async () => [f.process];
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId, "--check-only"], f.deps);
    expect(f.ops).toEqual([]);
    expect(result.lines).toContain("[FAIL] releaseId");
    expect(result.lines).toContain("[FAIL] window");
  });

  it("rescans after polling and fails if an installed copy appeared", async () => {
    const f = fixture();
    let scans = 0;
    f.deps.scanProcesses = async () => ++scans === 1 ? [] : [f.process, { pid: 9, exe: "/Applications/mdpro.app/Contents/MacOS/tauri-app", birthMs: 150 }];
    const result = await runIdentity(["--bundle", f.bundle, "--expected-release-id", releaseId], f.deps);
    expect(result.lines).toContain("[FAIL] process");
    expect(result.lines).toContain("[SKIPPED] window");
    expect(result.exit).toBe(1);
  });
});
