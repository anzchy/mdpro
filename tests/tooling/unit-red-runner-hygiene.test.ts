// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
const roots: string[] = [];

function project(config = true) {
  const root = mkdtempSync(join(tmpdir(), "mdpro-runner-hygiene-"));
  roots.push(root);
  mkdirSync(join(root, "tests")); mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  if (config) writeFileSync(join(root, "vitest.config.mjs"), 'export default {test:{include:["tests/**/*.test.ts"],maxWorkers:2}};\n');
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  git(["init", "-q", "-b", "master"]); git(["config", "user.email", "test@example.com"]); git(["config", "user.name", "Test"]);
  const files = ["package.json", ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"];
  if (config) files.push("vitest.config.mjs");
  git(["add", ...files]); git(["commit", "-qm", "fixture"]); git(["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), 'import { it, expect } from "vitest"; it("case",()=>expect(1).toBe(2));\n');
  return root;
}

function record(root: string, id: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [entry, "record", "--id", id, "--test", "tests/case.test.ts", "--cwd", root], {
    cwd: root, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30_000,
  });
}

function waitMarker(directory: string, name: string) {
  const path = join(directory, `${name}.ready`);
  if (existsSync(path)) return Promise.resolve();
  return new Promise<void>((done, fail) => {
    const watcher = watch(directory, () => { if (existsSync(path)) { clearTimeout(deadline); watcher.close(); done(); } });
    const deadline = setTimeout(() => { watcher.close(); fail(Error(`missing ${name}`)); }, 10_000);
  });
}

afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

describe.skipIf(!plugin)("fix1 runner artifacts", () => {
  it("does not add a concurrent runner's generated files to another RED's dirty source", async () => {
    const root = project();
    const gate = join(root, "barrier"); mkdirSync(gate);
    const proc = spawn(process.execPath, [entry, "record", "--id", "A", "--test", "tests/case.test.ts", "--cwd", root], {
      cwd: root, env: { ...process.env, MDPRO_UNIT_RED_BARRIER_DIR: gate }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout.on("data", chunk => { output += chunk; });
    proc.stderr.on("data", chunk => { output += chunk; });
    const completed = new Promise<number | null>(resolveDone => proc.on("close", resolveDone));
    await waitMarker(gate, "record-preflight");
    writeFileSync(join(gate, "record-preflight.go"), "go");
    try { await waitMarker(gate, "runner-created"); } catch { throw Error(output); }
    expect(record(root, "B").status).toBe(0);
    const store = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"));
    const b = store.receipts.find((item: { id: string }) => item.id === "B");
    expect(JSON.stringify(b.dirty_source)).not.toContain(".mdpro-unit-red-");
    writeFileSync(join(gate, "runner-created.go"), "go");
    await waitMarker(gate, "lane-after-read");
    writeFileSync(join(gate, "lane-after-read.go"), "go");
    expect(await completed).toBe(0);
  });

  it("removes the runner directory after configuration generation fails", () => {
    const root = project(false);
    expect(record(root, "A").status).toBe(64);
    expect(readdirSync(root).filter(name => name.startsWith(".mdpro-unit-red-"))).toEqual([]);
    expect(readdirSync(join(root, ".claude/tdd-guardian")).filter(name => name.startsWith(".mdpro-unit-red-"))).toEqual([]);
  });
});
