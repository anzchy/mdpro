// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { receiptSuites } from "../support/t566Engine";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mdpro-boundary-fix1-")); roots.push(root);
  mkdirSync(join(root, "tests")); mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default {test:{include:["tests/**/*.test.ts"],maxWorkers:2}};\n');
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  const git = (args: string[]) => { const result = spawnSync("git", args, { cwd: root, encoding: "utf8" }); expect(result.status, result.stderr).toBe(0); };
  git(["init", "-q", "-b", "master"]); git(["config", "user.email", "test@example.com"]); git(["config", "user.name", "Test"]);
  git(["add", "package.json", "vitest.config.mjs", ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"]);
  git(["commit", "-qm", "fixture"]); git(["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), 'import { it, expect } from "vitest"; it("case",()=>{if(process.env.BODY_FAIL!=="0") expect(1).toBe(2); else expect(1).toBe(1)});\n');
  return root;
}
function command(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30_000 });
}
function store(root: string) { return JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8")); }
function save(root: string, value: unknown) { writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify(value)); }
function start(root: string, args: string[], gate: string, env: Record<string, string> = {}) {
  const proc = spawn(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, env: { ...process.env, ...env, MDPRO_UNIT_RED_BARRIER_DIR: gate }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; proc.stdout.on("data", chunk => { output += chunk; }); proc.stderr.on("data", chunk => { output += chunk; });
  const done = new Promise<{ code: number | null; output: string }>(resolveDone => proc.on("close", code => resolveDone({ code, output })));
  return { proc, done };
}
function waitMarker(gate: string, name: string) {
  const path = join(gate, `${name}.ready`); if (existsSync(path)) return Promise.resolve();
  return new Promise<void>((done, fail) => {
    const watcher = watch(gate, () => { if (existsSync(path)) { clearTimeout(deadline); watcher.close(); done(); } });
    const deadline = setTimeout(() => { watcher.close(); fail(Error(`missing ${name}`)); }, 10_000);
  });
}
function release(gate: string, name: string) { writeFileSync(join(gate, `${name}.go`), "go"); }
function gate(root: string) { const path = join(root, "barrier"); mkdirSync(path); writeFileSync(join(path, "runner-created.go"), "go"); return path; }
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

describe.skipIf(!receiptSuites)("fix1 boundary regressions", () => {
  it("record reads a newly settled A only after its operation lock releases", async () => {
    const root = fixture();
    expect(command(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]).status).toBe(0);
    const file = join(root, ".claude/tdd-guardian/receipts.json");
    const settled = store(root).receipts[0]; settled.verdict = "SEPARATION-HELD";
    save(root, { schemaVersion: 2, receipts: [] });
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.lock"); mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: Date.now() }));
    const barrier = gate(root);
    const pending = start(root, ["record", "--id", "A", "--test", "tests/case.test.ts"], barrier);
    await waitMarker(barrier, "operation-wait");
    writeFileSync(file, JSON.stringify({ schemaVersion: 2, receipts: [settled] }));
    rmSync(lock, { recursive: true });
    const result = await pending.done;
    expect(result.code).toBe(64);
    expect(result.output).toContain("already has valid or settled evidence");
    expect(store(root).receipts).toEqual([settled]);
  });

  it("successfully discards unchanged A after a real plugin lock wait", async () => {
    const root = fixture(); expect(command(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]).status).toBe(0);
    const lock = join(root, ".claude/tdd-guardian/.receipts.lock"); mkdirSync(lock);
    const barrier = gate(root), pending = start(root, ["discard", "--id", "A"], barrier);
    await waitMarker(barrier, "discard-preflight"); release(barrier, "discard-preflight");
    await waitMarker(barrier, "discard-lock-entry");
    expect(pending.proc.exitCode).toBeNull();
    rmSync(lock, { recursive: true });
    expect((await pending.done).code).toBe(0);
    expect(store(root).receipts).toEqual([]);
  });

  it.each(["redKind", "headSha", "selection"])("preserves A replacement and unrelated B after %s changes in verify window", async change => {
    const root = fixture(); expect(command(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]).status).toBe(0);
    const initial = store(root); const b = structuredClone(initial.receipts[0]); b.id = "B";
    initial.receipts.push(b); save(root, initial);
    const barrier = gate(root), pending = start(root, ["verify", "--id", "A"], barrier, { BODY_FAIL: "0" });
    await waitMarker(barrier, "verify-preflight"); release(barrier, "verify-preflight");
    try { await waitMarker(barrier, "lane-after-read"); } catch { throw Error((await pending.done).output); }
    const replacement = store(root);
    if (change === "redKind") replacement.receipts[0].red.kind = "opaque-failure";
    if (change === "headSha") replacement.receipts[0].head_sha = "a".repeat(40);
    if (change === "selection") replacement.receipts[0].test_files = { ...replacement.receipts[0].test_files, "tests/other.test.ts": replacement.receipts[0].test_files["tests/case.test.ts"] };
    save(root, replacement); release(barrier, "lane-after-read");
    expect((await pending.done).code).toBe(64);
    expect(store(root).receipts).toEqual(replacement.receipts);
  });

  it("detects a stale upsert that clears a settled verdict", () => {
    const root = fixture(); expect(command(root, ["record", "--id", "A", "--test", "tests/case.test.ts"]).status).toBe(0);
    const initial = store(root); initial.receipts[0].verdict = "SEPARATION-HELD"; save(root, initial);
    initial.receipts[0].verdict = null; save(root, initial);
    const result = command(root, ["check-pending"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("A");
  });
});
