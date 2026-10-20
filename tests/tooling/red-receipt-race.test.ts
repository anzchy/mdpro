// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, watch, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
const roots: string[] = [];

function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [entry, ...args, "--cwd", cwd], { cwd, encoding: "utf8", timeout: 30_000 });
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mdpro-race-fix1-"));
  roots.push(root);
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default {test:{include:["tests/**/*.test.ts"],maxWorkers:2}};\n');
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  git(root, ["init", "-q", "-b", "master"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "package.json", "vitest.config.mjs", ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"]);
  git(root, ["commit", "-qm", "fixture"]);
  git(root, ["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), 'import { it, expect } from "vitest"; it("case",()=>{if(process.env.BODY_FAIL!=="0") expect(1).toBe(2); else expect(1).toBe(1)});\n');
  expect(run(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]).status).toBe(0);
  return root;
}

function receiptBytes(root: string) { return readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"); }

function child(root: string, args: string[], barrierDir?: string, env: Record<string, string> = {}) {
  const proc = spawn(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, env: { ...process.env, ...env, MDPRO_UNIT_RED_BARRIER_DIR: barrierDir || "" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  proc.stdout.on("data", chunk => { output += chunk; });
  proc.stderr.on("data", chunk => { output += chunk; });
  const done = new Promise<{ code: number | null; output: string }>(resolveDone => proc.on("close", code => resolveDone({ code, output })));
  return { proc, done };
}

function marker(root: string) {
  const directory = join(root, "barrier");
  mkdirSync(directory);
  writeFileSync(join(directory, "runner-created.go"), "go");
  return directory;
}

function waitMarker(directory: string, name: string) {
  const path = join(directory, `${name}.ready`);
  if (existsSync(path)) return Promise.resolve();
  return new Promise<void>((resolveReady, rejectReady) => {
    const watcher = watch(directory, () => {
      if (existsSync(path)) { clearTimeout(timeout); watcher.close(); resolveReady(); }
    });
    const timeout = setTimeout(() => { watcher.close(); rejectReady(Error(`missing ${name} marker`)); }, 10_000);
    if (existsSync(path)) { clearTimeout(timeout); watcher.close(); resolveReady(); }
  });
}

function release(directory: string, name: string) { writeFileSync(join(directory, `${name}.go`), "go"); }

afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

describe.skipIf(!plugin)("fix1 WI-2 receipt mutation races", () => {
  it("serializes a second same-id record until the first operation releases", async () => {
    const root = fixture();
    const before = receiptBytes(root);
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: Date.now() }));
    const gate = marker(root);
    const pending = child(root, ["record", "--id", "A", "--test", "tests/case.test.ts"], gate);
    await waitMarker(gate, "operation-wait");
    expect(pending.proc.exitCode).toBeNull();
    rmSync(lock, { recursive: true });
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(result.output).toContain("already has valid or settled evidence");
    expect(receiptBytes(root)).toBe(before);
  });

  it("recovers a dead operation owner and removes the lock after refusal", () => {
    const root = fixture();
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 99999999, started: 1 }));
    utimesSync(lock, new Date(0), new Date(0));
    const before = receiptBytes(root);
    const result = run(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]);
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("already has valid or settled evidence");
    expect(existsSync(lock)).toBe(false);
    expect(receiptBytes(root)).toBe(before);
  });
  it("keeps a recorded RED when the assertion changes during a plugin-lock wait", async () => {
    const root = fixture();
    const before = receiptBytes(root);
    const lock = join(root, ".claude/tdd-guardian/.receipts.lock");
    mkdirSync(lock);
    const gate = marker(root);
    const pending = child(root, ["discard", "--id", "A"], gate);
    await waitMarker(gate, "discard-preflight");
    expect(pending.proc.exitCode).toBeNull();
    writeFileSync(join(root, "tests/case.test.ts"), 'import { it, expect } from "vitest"; it("case",()=>expect(1).toBe(3));\n');
    release(gate, "discard-preflight");
    rmSync(lock, { recursive: true });
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(receiptBytes(root)).toBe(before);
  });

  it("keeps a replacement incarnation during discard's plugin-lock wait", async () => {
    const root = fixture();
    const lock = join(root, ".claude/tdd-guardian/.receipts.lock");
    mkdirSync(lock);
    const gate = marker(root);
    const pending = child(root, ["discard", "--id", "A"], gate);
    await waitMarker(gate, "discard-preflight");
    expect(pending.proc.exitCode).toBeNull();
    const file = join(root, ".claude/tdd-guardian/receipts.json");
    const store = JSON.parse(receiptBytes(root));
    store.receipts[0].recorded_at = "2030-01-01T00:00:00.000Z";
    writeFileSync(file, JSON.stringify(store));
    const replacement = receiptBytes(root);
    release(gate, "discard-preflight");
    rmSync(lock, { recursive: true });
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(receiptBytes(root)).toBe(replacement);
  });

  it("does not overwrite a new verify incarnation after the lane child's final store read", async () => {
    const root = fixture();
    const gate = marker(root);
    const pending = child(root, ["verify", "--id", "A"], gate, { BODY_FAIL: "0" });
    await waitMarker(gate, "verify-preflight");
    release(gate, "verify-preflight");
    await waitMarker(gate, "lane-after-read");
    const file = join(root, ".claude/tdd-guardian/receipts.json");
    const store = JSON.parse(receiptBytes(root));
    store.receipts[0].recorded_at = "2030-01-01T00:00:00.000Z";
    writeFileSync(file, JSON.stringify(store));
    const replacement = store.receipts[0];
    release(gate, "lane-after-read");
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(JSON.parse(receiptBytes(root)).receipts[0]).toEqual(replacement);
  });

  it("rechecks a settled receipt after waiting for the same-id operation lock", async () => {
    const root = fixture();
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: Date.now() }));
    const gate = marker(root);
    const pending = child(root, ["discard", "--id", "A"], gate);
    await waitMarker(gate, "operation-wait");
    const file = join(root, ".claude/tdd-guardian/receipts.json");
    const store = JSON.parse(receiptBytes(root));
    store.receipts[0].verdict = "SEPARATION-HELD";
    writeFileSync(file, JSON.stringify(store));
    const settled = receiptBytes(root);
    rmSync(lock, { recursive: true });
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(receiptBytes(root)).toBe(settled);
  });

  it("uses the same lock through a symlinked workspace path", async () => {
    const root = fixture();
    const alias = `${root}-alias`;
    symlinkSync(root, alias);
    roots.push(alias);
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: Date.now() }));
    const gate = marker(root);
    const pending = child(alias, ["record", "--id", "A", "--test", "tests/case.test.ts"], gate);
    await waitMarker(gate, "operation-wait");
    expect(pending.proc.exitCode).toBeNull();
    rmSync(lock, { recursive: true });
    expect((await pending.done).code).toBe(64);
  });

  it("recovers the operation lock after its owning process is killed", async () => {
    const root = fixture();
    const gate = marker(root);
    const pending = child(root, ["discard", "--id", "A"], gate);
    await waitMarker(gate, "discard-preflight");
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    expect(existsSync(lock)).toBe(true);
    pending.proc.kill("SIGKILL");
    await pending.done;
    utimesSync(lock, new Date(0), new Date(0));
    const result = run(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]);
    expect(result.status).toBe(64);
    expect(existsSync(lock)).toBe(false);
  });

  it("rechecks the fingerprint after reaching the plugin lock", async () => {
    const root = fixture();
    const lock = join(root, ".claude/tdd-guardian/.receipts.lock");
    mkdirSync(lock);
    const gate = marker(root);
    const pending = child(root, ["discard", "--id", "A"], gate);
    await waitMarker(gate, "discard-preflight");
    release(gate, "discard-preflight");
    await waitMarker(gate, "discard-lock-entry");
    const before = receiptBytes(root);
    writeFileSync(join(root, "tests/case.test.ts"), 'import { it, expect } from "vitest"; it("case",()=>expect(2).toBe(3));\n');
    rmSync(lock, { recursive: true });
    expect((await pending.done).code).toBe(64);
    expect(receiptBytes(root)).toBe(before);
  });

  it("does not reap a new live owner after observing an old dead owner", async () => {
    const root = fixture();
    const before = receiptBytes(root);
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 99999999, started: 1 }));
    utimesSync(lock, new Date(0), new Date(0));
    const gate = marker(root);
    const pending = child(root, ["record", "--id", "A", "--test", "tests/case.test.ts"], gate);
    await waitMarker(gate, "stale-observed");
    rmSync(lock, { recursive: true });
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: Date.now() }));
    release(gate, "stale-observed");
    await waitMarker(gate, "stale-reap-done");
    expect(existsSync(join(lock, "owner.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).pid).toBe(process.pid);
    rmSync(lock, { recursive: true });
    expect((await pending.done).code).toBe(64);
    expect(receiptBytes(root)).toBe(before);
  });

  it("recovers a fresh dead owner and an old empty lock", async () => {
    for (const empty of [false, true]) {
      const root = fixture();
      const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
      mkdirSync(lock);
      if (!empty) writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 99999999, started: Date.now() }));
      if (empty) utimesSync(lock, new Date(0), new Date(0));
      const pending = child(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]);
      const result = await pending.done;
      expect(result.code).toBe(64);
      expect(result.output).toContain("already has valid or settled evidence");
      expect(existsSync(lock)).toBe(false);
    }
  });

  it("does not steal an aged live owner and times out without changing receipts", async () => {
    const root = fixture();
    const before = receiptBytes(root);
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: 1 }));
    utimesSync(lock, new Date(0), new Date(0));
    const pending = child(root, ["discard", "--id", "A"], undefined, { MDPRO_UNIT_RED_LOCK_WAIT_MS: "500" });
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(result.output).toContain("still locked");
    expect(existsSync(lock)).toBe(true);
    expect(receiptBytes(root)).toBe(before);
  });
});
