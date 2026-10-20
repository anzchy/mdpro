// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { vi } from "vitest";
vi.setConfig({ testTimeout: 30_000 });

const repo = resolve(import.meta.dirname, "../..");
const lane = join(repo, "scripts/tdd/unit-red-lane.mjs");
const cache = join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
const version = existsSync(cache) ? readdirSync(cache).filter((name) => existsSync(join(cache, name, "scripts/tdd-guardian/receipt.js"))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] : null;
const guardian = version ? join(cache, version, "scripts/tdd-guardian/lib") : "";
const require = createRequire(import.meta.url);
const exec = version ? require(join(guardian, "exec.js")) : null;
const classifyRedRun = version ? require(join(guardian, "verification.js")).classifyRedRun : null;
let root: string;

function fixture(name: string, body: string) {
  const file = `tests/${name}.test.ts`;
  writeFileSync(join(root, file), `import { it, expect } from "vitest"; ${body}`);
  return file;
}

function run(files?: string[], extra: Record<string, string> = {}) {
  const nonce = "fixture-nonce";
  const marker = join(root, "run-marker.json");
  if (files) writeFileSync(marker, JSON.stringify({ nonce, files }));
  const inherited = { ...process.env };
  delete inherited.MDPRO_UNIT_RED_FILES;
  delete inherited.MDPRO_UNIT_RED_MARKER;
  delete inherited.MDPRO_UNIT_RED_NONCE;
  const result = spawnSync(process.execPath, [lane], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...inherited,
      ...(files ? { MDPRO_UNIT_RED_FILES: JSON.stringify(files), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: nonce } : {}),
      ...extra,
    },
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function scenario(name: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/scenarios.mjs");
  const result = spawnSync(process.execPath, [script, name, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mdpro-unit-red-child-"));
  mkdirSync(join(root, "tests"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default { test: { include: ["tests/**/*.test.ts"], maxWorkers: 2 } };\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("unit-red lane child", () => {
  it("refuses a bare or leaked-selection run without a matching marker", () => {
    fixture("a", 'it("a", () => {});');
    const bare = run();
    expect(bare.status).toBe(64);
    expect(bare.output).toContain("red-receipt.mjs");
    expect(run(undefined, { MDPRO_UNIT_RED_FILES: JSON.stringify(["tests/a.test.ts"]) }).status).toBe(64);
    expect(run(["tests/a.test.ts"], { MDPRO_UNIT_RED_NONCE: "wrong" }).status).toBe(64);
  });

  it.skipIf(!version)("uses JSON counts and hides fake summaries from both output streams", () => {
    const failing = fixture("fail", 'it("fails", () => { console.error("Tests 999 passed (999)"); throw Error("red"); });');
    const red = run([failing]);
    expect(red.status).toBe(1);
    expect(red.stdout).toMatch(/Tests\s+1 failed \| 0 passed \(1\)/);
    expect(red.output).not.toContain("999 passed");
    const counts = exec.parseCounts(red.stdout, red.stderr);
    expect(counts).toMatchObject({ failed: 1, passed: 0, total: 1 });
    expect(classifyRedRun({ status: exec.classify(1, red.stdout, red.stderr), testCounts: counts }).kind).toBe("assertion-failure");
    const passing = fixture("pass", 'it("passes", () => { console.log("Tests 7 failed | 0 passed (7)"); });');
    const green = run([passing]);
    expect(green.status).toBe(0);
    expect(green.stdout).toMatch(/Tests\s+0 failed \| 1 passed \(1\)/);
    expect(green.output).not.toContain("7 failed");
  });

  it("counts skip and todo while requiring an executed assertion in every file", () => {
    const a = fixture("a", 'it("fails", () => { throw Error("red"); }); it.skip("skip", () => {});');
    const b = fixture("b", 'it("passes", () => {}); it.todo("later");');
    expect(run([a]).status).toBe(1);
    expect(run([a, b]).status).toBe(1);
    const skipped = fixture("skipped", 'it.skip("skip", () => {});');
    expect(run([a, skipped]).status).toBe(64);
    const todo = fixture("todo", 'it.todo("later");'); expect(run([a, todo]).status).toBe(64);
  });

  it("rejects zero tests, setup errors and extra substring-matched suites", () => {
    const empty = fixture("empty", "");
    const setup = fixture("setup", 'throw Error("setup broke");');
    expect(run([empty]).status).toBe(64);
    expect(run([setup]).status).toBe(64);
    const a = fixture("a", 'it("a", () => {});');
    fixture("a.test", 'it("tsx-like", () => {});');
    expect(run([a]).status).toBe(0);
  });

  it.skipIf(!version)("captures error-looking assertion failures in its log", () => {
    const file = fixture("enoent", 'it("ENOENT assertion", () => { expect(() => { throw Error(["No such", "file or directory"].join(" ")); }).not.toThrow(); });');
    const result = run([file]);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(["No such", "file or directory"].join(" "));
    expect(exec.classify(1, result.stdout, result.stderr)).toBe("fail");
  });

  it("clamps workers even when a locked parent or override requests more", () => {
    const file = fixture("a", 'it("a", () => {});');
    const bin = join(root, "bin");
    mkdirSync(bin);
    const capture = join(root, "argv.txt");
    const fake = join(bin, "pnpm");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${capture}'\nexit 1\n`);
    chmodSync(fake, 0o755);
    run([file], { PATH: `${bin}:${process.env.PATH || ""}`, MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: "8" });
    expect(existsSync(capture)).toBe(true);
    expect(readFileSync(capture, "utf8")).toMatch(/--maxWorkers(?:=|\n)2/);
  });

  it("refuses substring filter overlap unless exactly one suite is collected", () => {
    const a = fixture("a", 'it("a", () => {});');
    mkdirSync(join(root, "tests/x/tests"), { recursive: true });
    writeFileSync(join(root, "tests/x/tests/a.test.ts"), 'import { it } from "vitest"; it("nested", () => {});');
    const result = run([a]);
    expect([0, 64]).toContain(result.status);
    if (result.status === 0) expect(result.stdout).toMatch(/0 failed \| 1 passed \(1\)/);
    const overlap = scenario("substring_overlap"); expect([0, 64]).toContain(overlap.status); if (overlap.status === 0) expect(overlap.summary).toMatch(/0 failed \| 1 passed \(1\)/);
  });

  it("rejects an unhandled error even when assertions pass", () => {
    const file = fixture("unhandled", 'Promise.reject(Error("orphan")); it("passes", () => {});');
    expect(run([file]).status).toBe(64);
  });

  it("clamps a percentage worker override", () => {
    const file = fixture("a", 'it("a", () => {});');
    const bin = join(root, "bin");
    mkdirSync(bin);
    const capture = join(root, "argv.txt");
    const fake = join(bin, "pnpm");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${capture}'\nexit 1\n`);
    chmodSync(fake, 0o755);
    run([file], { PATH: `${bin}:${process.env.PATH || ""}`, VITEST_MAX_WORKERS: "50%" });
    expect(existsSync(capture)).toBe(true);
    expect(readFileSync(capture, "utf8")).toMatch(/--maxWorkers(?:=|\n)2/);
  });

  it.skipIf(!version)("configures unit-red as an unlocked manual-only lane without coverage", () => {
    const configPath = join(repo, ".claude/tdd-guardian/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const laneConfig = config.lanes.find((item: { name: string }) => item.name === "unit-red");
    expect(laneConfig).toMatchObject({
      command: "node scripts/tdd/unit-red-lane.mjs",
      gateOn: ["manual"],
      coverage: "none",
    });
    expect(laneConfig.command).not.toContain("heavy-lock.sh");
    const loaded = require(join(guardian, "config.js")).load(repo).config;
    const lanes = require(join(guardian, "lanes.js"));
    expect(lanes.lanesForTrigger(loaded, "manual").map((item: { name: string }) => item.name)).toContain("unit-red");
    for (const trigger of ["commit", "push", "taskCompleted"]) {
      expect(lanes.lanesForTrigger(loaded, trigger).map((item: { name: string }) => item.name)).not.toContain("unit-red");
    }
  });

  it("exposes the sanctioned script as the package red command", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(pkg.scripts.red).toBe("node scripts/tdd/red-receipt.mjs");
  });

  it("leaves the coverage summary untouched in a focused run", () => {
    const file = fixture("a", 'it("fails", () => { throw Error("red"); });');
    mkdirSync(join(root, "coverage"));
    const summary = join(root, "coverage/coverage-summary.json");
    writeFileSync(summary, "sentinel");
    expect(run([file]).status).toBe(1);
    expect(readFileSync(summary, "utf8")).toBe("sentinel");
  });

  it("maps unreadable JSON and a failed runner to environment exit 64", () => {
    const file = fixture("a", 'it("a", () => {});');
    const bin = join(root, "bin");
    mkdirSync(bin);
    const fake = join(bin, "pnpm");
    writeFileSync(fake, '#!/bin/sh\nexit 127\n');
    chmodSync(fake, 0o755);
    expect(run([file], { PATH: `${bin}:${process.env.PATH || ""}` }).status).toBe(64);
    writeFileSync(fake, '#!/bin/sh\nfor arg in "$@"; do case "$arg" in --outputFile.json=*) report=${arg#*=};; esac; done\nprintf broken > "$report"\nexit 1\n');
    expect(run([file], { PATH: `${bin}:${process.env.PATH || ""}` }).status).toBe(64);
  });

  it("rejects an unhandled error alongside a failed assertion", () => {
    const file = fixture("unhandled", 'Promise.reject(Error("orphan")); it("fails", () => { throw Error("red"); });');
    expect(run([file]).status).toBe(64);
  });

  it("reads a master receipt store larger than Node's default subprocess buffer", () => {
    const file = join(root, ".claude/tdd-guardian/receipts.json");
    mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ schemaVersion: 2, receipts: [] })}${" ".repeat(2 * 1024 * 1024)}`);
    const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    git(["init", "-q", "-b", "master"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["add", "."]);
    expect(git(["commit", "-qm", "large store"]).status).toBe(0);
    git(["switch", "-qc", "feature"]);
    const result = spawnSync(process.execPath, [join(repo, "scripts/tdd/red-receipt.mjs"), "check-pending", "--cwd", root], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  it("rejects failed hooks even when Vitest counts a failed test", () => {
    const before = fixture("before", 'import { beforeEach } from "vitest"; beforeEach(() => { throw Error("setup broke"); }); it("never runs", () => { throw Error("body ran"); });');
    const after = fixture("after", 'import { afterAll } from "vitest"; afterAll(() => { throw Error("teardown broke"); }); it("fails", () => { throw Error("red"); });');
    expect(run([before]).status).toBe(64);
    expect(run([after]).status).toBe(64);
  });

  it("does not mistake ordinary output mentioning an unhandled rejection for a runner error", () => {
    const file = fixture("handled", 'it("passes", () => { console.error("handled an unhandled rejection example"); });');
    expect(run([file]).status).toBe(0);
  });

  it.skipIf(!version)("refuses a receipt selection changed inside the plugin lane", () => {
    mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
    mkdirSync(join(root, "scripts/tdd"), { recursive: true });
    symlinkSync(lane, join(root, "scripts/tdd/unit-red-lane.mjs"));
    const configPath = join(root, ".claude/tdd-guardian/config.json");
    const config = JSON.parse(readFileSync(join(repo, ".claude/tdd-guardian/config.json"), "utf8"));
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
    const spec = fixture("a", 'import { readFileSync } from "node:fs"; it("state", () => { expect(readFileSync(new URL("./state.txt", import.meta.url), "utf8")).toBe("green"); });');
    fixture("b", 'it("other", () => {});');
    writeFileSync(join(root, "tests/state.txt"), "red");
    const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    git(["init", "-q", "-b", "master"]); git(["config", "user.email", "test@example.com"]); git(["config", "user.name", "Test"]);
    git(["add", "."]); expect(git(["commit", "-qm", "specs"]).status).toBe(0); git(["switch", "-qc", "feature"]);
    const entry = join(repo, "scripts/tdd/red-receipt.mjs");
    const invoke = (...args: string[]) => spawnSync(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, encoding: "utf8" });
    expect(invoke("record", "--id", "A", "--test", spec).status).toBe(0);
    writeFileSync(join(root, "tests/state.txt"), "green");
    const wrapper = 'import { readFileSync, writeFileSync } from "node:fs"; import { spawnSync } from "node:child_process"; const p = ".claude/tdd-guardian/receipts.json"; const s = JSON.parse(readFileSync(p, "utf8")); s.receipts[0].test_files["tests/b.test.ts"] = s.receipts[0].test_files["tests/a.test.ts"]; writeFileSync(p, JSON.stringify(s)); const r = spawnSync(process.execPath, ["scripts/tdd/unit-red-lane.mjs"], { stdio: "inherit", env: process.env }); process.exit(r.status ?? 64);';
    writeFileSync(join(root, "scripts/tdd/verify-wrapper.mjs"), wrapper);
    config.lanes.find((item: { name: string }) => item.name === "unit-red").command = "node scripts/tdd/verify-wrapper.mjs";
    writeFileSync(configPath, JSON.stringify(config));
    expect(invoke("verify", "--id", "A").status).toBe(64);
  });

  it.skipIf(!version)("binds a successful two-file RED and GREEN", () => {
    expect(scenario("multi_cycle")).toMatchObject({ red: 0, green: 0, repeat: 64, verdict: "SEPARATION-HELD", files: ["tests/a.test.ts", "tests/b.test.ts"] });
  });
  it.skipIf(!version)("refuses absolute, traversal, comma, duplicate and empty selectors before running", () => { expect(scenario("invalid_paths")).toMatchObject({ statuses: [64, 64, 64, 64, 64, 64, 64, 64, 64], unchanged: true, ran: false }); });
  it.skipIf(!version)("refuses wrong lanes, master discard and invalid retry", () => {
    expect(scenario("wrong_lane")).toMatchObject({ first: 0, second: 0, verify: 64, discard: 64, other: null });
    expect(scenario("master_discard")).toMatchObject({ discard: 64 });
    expect(scenario("existing_bad_retry")).toMatchObject({ first: 0, retry: 64, unchanged: true });
    expect(scenario("settled_record")).toMatchObject({ red: 0, green: 0, retry: 64, unchanged: true }); expect(scenario("pending_store")).toMatchObject({ discard: 64, unchanged: true });
  });
  it.skipIf(!version)("ignores inherited pending receipts but refuses malformed stores", () => {
    expect(scenario("inherited_pending")).toMatchObject({ recorded: 0, inherited: 0, malformed: 64 });
  });
  it.skipIf(!version)("stores an assertion RED despite module-like assertion text", () => {
    expect(scenario("module_message")).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
  it.skipIf(!version)("leaves bare plugin record bound to the existing unit lane", () => {
    expect(scenario("bare_record")).toMatchObject({ status: 0, lane: "unit" });
  });
  it.skipIf(!version)("keeps parallel record logs and receipts independent", () => {
    const result = scenario("concurrent_records");
    expect(result.one.status).toBe(0); expect(result.two.status).toBe(64);
    expect(result.one.log).not.toBe(result.two.log);
    expect(result.receipts.sort()).toEqual([["A", "assertion-failure"], ["B", "green"]]);
  });
  it.skipIf(!version)("preserves B recorded while A verification waits", () => {
    expect(scenario("concurrent_verify")).toMatchObject({ red: 0, other: 0, verify: 0, receipts: [["A", "SEPARATION-HELD"], ["B", null]] });
  });
  it.skipIf(!version)("preserves concurrent B while discarding A under the receipt lock", () => {
    expect(scenario("concurrent_discard")).toMatchObject({ first: 0, blocked: true, discard: 0, recordB: 0, ids: ["B"] });
  });
  it("refuses contradictory JSON, absent suite and interrupted runner", () => {
    for (const name of ["bad_report", "absent_suite", "interrupt", "bad_tmp"]) expect(scenario(name).status).toBe(64);
    expect(readdirSync(join(repo, "tests/tooling/fixtures/unit-red")).every((name) => !/\.tsx?$/.test(name))).toBe(true);
  });
  it("rejects preconstructed, non-Error and async hook failures", () => { expect(scenario("precreated_hooks").statuses).toEqual([64, 64, 64]); });
  it("rejects a colored real unhandled error alongside a failed test", () => { expect(scenario("colored_unhandled")).toMatchObject({ status: 64, colored: true, unhandled: true }); });
});
