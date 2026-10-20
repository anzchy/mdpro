// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mdpro-flock-fix1-")); roots.push(root);
  mkdirSync(join(root, "tests")); mkdirSync(join(root, "scripts/tdd"), { recursive: true }); mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
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
  writeFileSync(join(root, "tests/case.test.ts"), 'import { it, expect } from "vitest"; it("case",()=>expect(1).toBe(2));\n');
  const result = spawnSync(process.execPath, [entry, "record", "--id", "A", "--test", "tests/case.test.ts", "--cwd", root], { cwd: root, encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
  return root;
}
function waitMarker(directory: string, name: string) {
  const file = join(directory, name); if (existsSync(file)) return Promise.resolve();
  return new Promise<void>((done, fail) => {
    const watcher = watch(directory, () => { if (existsSync(file)) { clearTimeout(deadline); watcher.close(); done(); } });
    const deadline = setTimeout(() => { watcher.close(); fail(Error(`missing ${name}`)); }, 10_000);
  });
}
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });
describe.skipIf(!plugin)("fix1 OS receipt lock", () => {
  it("refuses a same-ID operation while an external process holds its OS lock", async () => {
    const root = fixture();
    const before = readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8");
    const lock = join(root, ".claude/tdd-guardian/.unit-red-A.flock"), ready = join(root, "holder.ready");
    const code = 'import fcntl,os,sys; f=open(sys.argv[1],"a+"); fcntl.flock(f,fcntl.LOCK_EX); open(sys.argv[2],"w").write("ready"); sys.stdin.buffer.read(1)';
    const holder = spawn("python3", ["-c", code, lock, ready], { cwd: root, stdio: ["pipe", "ignore", "pipe"] });
    const done = new Promise<number | null>(resolveDone => holder.on("close", resolveDone));
    await waitMarker(root, "holder.ready");
    const result = spawnSync(process.execPath, [entry, "record", "--id", "A", "--test", "tests/case.test.ts", "--cwd", root], {
      cwd: root, env: { ...process.env, MDPRO_UNIT_RED_FLOCK_WAIT_MS: "500" }, encoding: "utf8", timeout: 5_000,
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("OS receipt lock is still held");
    expect(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8")).toBe(before);
    holder.stdin.write("x"); holder.stdin.end();
    expect(await done).toBe(0);
  });
});
