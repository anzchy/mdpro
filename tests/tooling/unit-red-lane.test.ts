// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOwnerChildRunner } from "./d302Child";
import { createRequire } from "node:module";
import { receiptSuites, vendorDir } from "../support/t566Engine";
import { vi } from "vitest";
vi.setConfig({ testTimeout: 90_000 });

const repo = resolve(import.meta.dirname, "../..");
const lane = join(repo, "scripts/tdd/unit-red-lane.mjs");
const guardian = join(vendorDir, "lib");
const require = createRequire(import.meta.url);
const exec = receiptSuites ? require(join(guardian, "exec.js")) : null;
const classifyRedRun = receiptSuites ? require(join(guardian, "verification.js")).classifyRedRun : null;
let root: string;
let owner: ReturnType<typeof createOwnerChildRunner> | null = null;

function fixture(name: string, body: string) {
  const file = `tests/${name}.test.ts`;
  writeFileSync(join(root, file), `import { it, expect } from "vitest"; ${body}`);
  return file;
}

function runCommand(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number; encoding?: "utf8" }) {
  return owner?.run(command, args, options) ?? Promise.reject(Error("D302 owner closed"));
}

async function run(files?: string[], extra: Record<string, string> = {}) {
  if (!owner || owner.closed) throw Error("D302 owner closed");
  const nonce = "fixture-nonce";
  const marker = join(root, "run-marker.json");
  if (files) writeFileSync(marker, JSON.stringify({ nonce, files }));
  const inherited = { ...process.env };
  delete inherited.MDPRO_UNIT_RED_FILES;
  delete inherited.MDPRO_UNIT_RED_MARKER;
  delete inherited.MDPRO_UNIT_RED_NONCE;
  const result = await runCommand(process.execPath, [lane], {
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

async function scenario(name: string) {
  if (!owner || owner.closed) throw Error("D302 owner closed");
  const script = join(repo, "tests/tooling/fixtures/unit-red/scenarios.mjs");
  const result = await runCommand(process.execPath, [script, name, repo, join(vendorDir, "receipt.js")], { cwd: repo, timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

beforeEach((context) => {
  owner = createOwnerChildRunner(context.signal);
  root = mkdtempSync(join(tmpdir(), "mdpro-unit-red-child-"));
  mkdirSync(join(root, "tests"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default { test: { include: ["tests/**/*.test.ts"], maxWorkers: 2 } };\n');
});

afterEach(async () => {
  await owner?.close();
  rmSync(root, { recursive: true, force: true }); owner = null;
});

describe("unit-red lane child", () => {
  it("refuses a bare or leaked-selection run without a matching marker", async () => {
    fixture("a", 'it("a", () => {});');
    const bare = (await run());
    expect(bare.status).toBe(64);
    expect(bare.output).toContain("red-receipt.mjs");
    expect((await run(undefined, { MDPRO_UNIT_RED_FILES: JSON.stringify(["tests/a.test.ts"]) })).status).toBe(64);
    expect((await run(["tests/a.test.ts"], { MDPRO_UNIT_RED_NONCE: "wrong" })).status).toBe(64);
  });

  it.skipIf(!receiptSuites)("uses JSON counts and hides fake summaries from both output streams", async () => {
    const failing = fixture("fail", 'it("fails", () => { console.error("Tests 999 passed (999)"); throw Error("red"); });');
    const red = (await run([failing]));
    expect(red.status).toBe(1);
    expect(red.stdout).toMatch(/Tests\s+1 failed \| 0 passed \(1\)/);
    expect(red.output).not.toContain("999 passed");
    const counts = exec.parseCounts(red.stdout, red.stderr);
    expect(counts).toMatchObject({ failed: 1, passed: 0, total: 1 });
    expect(classifyRedRun({ status: exec.classify(1, red.stdout, red.stderr), testCounts: counts }).kind).toBe("assertion-failure");
    const passing = fixture("pass", 'it("passes", () => { console.log("Tests 7 failed | 0 passed (7)"); });');
    const green = (await run([passing]));
    expect(green.status).toBe(0);
    expect(green.stdout).toMatch(/Tests\s+0 failed \| 1 passed \(1\)/);
    expect(green.output).not.toContain("7 failed");
  });

  it("counts skip and todo while requiring an executed assertion in every file", async () => {
    const a = fixture("a", 'it("fails", () => { throw Error("red"); }); it.skip("skip", () => {});');
    const b = fixture("b", 'it("passes", () => {}); it.todo("later");');
    expect((await run([a])).status).toBe(1);
    expect((await run([a, b])).status).toBe(1);
    const skipped = fixture("skipped", 'it.skip("skip", () => {});');
    expect((await run([a, skipped])).status).toBe(64);
    const todo = fixture("todo", 'it.todo("later");'); expect((await run([a, todo])).status).toBe(64);
  });

  it("rejects zero tests, setup errors and extra substring-matched suites", async () => {
    const empty = fixture("empty", "");
    const setup = fixture("setup", 'throw Error("setup broke");');
    expect((await run([empty])).status).toBe(64);
    expect((await run([setup])).status).toBe(64);
    const a = fixture("a", 'it("a", () => {});');
    fixture("a.test", 'it("tsx-like", () => {});');
    expect((await run([a])).status).toBe(0);
  });

  it.skipIf(!receiptSuites)("captures error-looking assertion failures in its log", async () => {
    const file = fixture("enoent", 'it("ENOENT assertion", () => { expect(() => { throw Error(["No such", "file or directory"].join(" ")); }).not.toThrow(); });');
    const result = (await run([file]));
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(["No such", "file or directory"].join(" "));
    expect(exec.classify(1, result.stdout, result.stderr)).toBe("fail");
  });

  it("clamps workers even when a locked parent or override requests more", async () => {
    const file = fixture("a", 'it("a", () => {});');
    const bin = join(root, "bin");
    mkdirSync(bin);
    const capture = join(root, "argv.txt");
    const fake = join(bin, "pnpm");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${capture}'\nexit 1\n`);
    chmodSync(fake, 0o755);
    (await run([file], { PATH: `${bin}:${process.env.PATH || ""}`, MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: "8" }));
    expect(existsSync(capture)).toBe(true);
    expect(readFileSync(capture, "utf8")).toMatch(/--maxWorkers(?:=|\n)2/);
  });

  it("refuses substring filter overlap unless exactly one suite is collected", async () => {
    const a = fixture("a", 'it("a", () => {});');
    mkdirSync(join(root, "tests/x/tests"), { recursive: true });
    writeFileSync(join(root, "tests/x/tests/a.test.ts"), 'import { it } from "vitest"; it("nested", () => {});');
    const result = (await run([a]));
    expect([0, 64]).toContain(result.status);
    if (result.status === 0) expect(result.stdout).toMatch(/0 failed \| 1 passed \(1\)/);
    const overlap = (await scenario("substring_overlap")); expect([0, 64]).toContain(overlap.status); if (overlap.status === 0) expect(overlap.summary).toMatch(/0 failed \| 1 passed \(1\)/);
  });

  it("rejects an unhandled error even when assertions pass", async () => {
    const file = fixture("unhandled", 'Promise.reject(Error("orphan")); it("passes", () => {});');
    expect((await run([file])).status).toBe(64);
  });

  it("clamps a percentage worker override", async () => {
    const file = fixture("a", 'it("a", () => {});');
    const bin = join(root, "bin");
    mkdirSync(bin);
    const capture = join(root, "argv.txt");
    const fake = join(bin, "pnpm");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${capture}'\nexit 1\n`);
    chmodSync(fake, 0o755);
    (await run([file], { PATH: `${bin}:${process.env.PATH || ""}`, VITEST_MAX_WORKERS: "50%" }));
    expect(existsSync(capture)).toBe(true);
    expect(readFileSync(capture, "utf8")).toMatch(/--maxWorkers(?:=|\n)2/);
  });

  it.skipIf(!receiptSuites)("configures unit-red as an unlocked manual-only lane without coverage", () => {
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

  it("leaves the coverage summary untouched in a focused run", async () => {
    const file = fixture("a", 'it("fails", () => { throw Error("red"); });');
    mkdirSync(join(root, "coverage"));
    const summary = join(root, "coverage/coverage-summary.json");
    writeFileSync(summary, "sentinel");
    expect((await run([file])).status).toBe(1);
    expect(readFileSync(summary, "utf8")).toBe("sentinel");
  });

  it("maps unreadable JSON and a failed runner to environment exit 64", async () => {
    const file = fixture("a", 'it("a", () => {});');
    const bin = join(root, "bin");
    mkdirSync(bin);
    const fake = join(bin, "pnpm");
    writeFileSync(fake, '#!/bin/sh\nexit 127\n');
    chmodSync(fake, 0o755);
    expect((await run([file], { PATH: `${bin}:${process.env.PATH || ""}` })).status).toBe(64);
    writeFileSync(fake, '#!/bin/sh\nfor arg in "$@"; do case "$arg" in --outputFile.json=*) report=${arg#*=};; esac; done\nprintf broken > "$report"\nexit 1\n');
    expect((await run([file], { PATH: `${bin}:${process.env.PATH || ""}` })).status).toBe(64);
  });

  it("rejects an unhandled error alongside a failed assertion", async () => {
    const file = fixture("unhandled", 'Promise.reject(Error("orphan")); it("fails", () => { throw Error("red"); });');
    expect((await run([file])).status).toBe(64);
  });

  it("reads a master receipt store larger than Node's default subprocess buffer", async () => {
    const file = join(root, ".claude/tdd-guardian/receipts.json");
    mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ schemaVersion: 2, receipts: [] })}${" ".repeat(2 * 1024 * 1024)}`);
    const git = async (args: string[]) => (await runCommand("git", args, { cwd: root, encoding: "utf8" }));
    (await git(["init", "-q", "-b", "master"]));
    (await git(["config", "user.email", "test@example.com"]));
    (await git(["config", "user.name", "Test"]));
    (await git(["add", "."]));
    expect((await git(["commit", "-qm", "large store"])).status).toBe(0);
    (await git(["switch", "-qc", "feature"]));
    const result = (await runCommand(process.execPath, [join(repo, "scripts/tdd/red-receipt.mjs"), "check-pending", "--cwd", root], { cwd: root, encoding: "utf8" }));
    expect(result.status).toBe(0);
  });

  it("rejects failed hooks even when Vitest counts a failed test", async () => {
    const before = fixture("before", 'import { beforeEach } from "vitest"; beforeEach(() => { throw Error("setup broke"); }); it("never runs", () => { throw Error("body ran"); });');
    const after = fixture("after", 'import { afterAll } from "vitest"; afterAll(() => { throw Error("teardown broke"); }); it("fails", () => { throw Error("red"); });');
    expect((await run([before])).status).toBe(64);
    expect((await run([after])).status).toBe(64);
  });

  it("does not mistake ordinary output mentioning an unhandled rejection for a runner error", async () => {
    const file = fixture("handled", 'it("passes", () => { console.error("handled an unhandled rejection example"); });');
    expect((await run([file])).status).toBe(0);
  });

  it.skipIf(!receiptSuites)("refuses a receipt selection changed inside the plugin lane", async () => {
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
    const git = async (args: string[]) => (await runCommand("git", args, { cwd: root, encoding: "utf8" }));
    (await git(["init", "-q", "-b", "master"])); (await git(["config", "user.email", "test@example.com"])); (await git(["config", "user.name", "Test"]));
    (await git(["add", "."])); expect((await git(["commit", "-qm", "specs"])).status).toBe(0); (await git(["switch", "-qc", "feature"]));
    const entry = join(repo, "scripts/tdd/red-receipt.mjs");
    const invoke = async (...args: string[]) => (await runCommand(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, encoding: "utf8" }));
    expect((await invoke("record", "--id", "A", "--test", spec)).status).toBe(0);
    writeFileSync(join(root, "tests/state.txt"), "green");
    const wrapper = 'import { readFileSync, writeFileSync } from "node:fs"; import { spawnSync } from "node:child_process"; const p = ".claude/tdd-guardian/receipts.json"; const s = JSON.parse(readFileSync(p, "utf8")); s.receipts[0].test_files["tests/b.test.ts"] = s.receipts[0].test_files["tests/a.test.ts"]; writeFileSync(p, JSON.stringify(s)); const r = spawnSync(process.execPath, ["scripts/tdd/unit-red-lane.mjs"], { stdio: "inherit", env: process.env }); process.exit(r.status ?? 64);';
    writeFileSync(join(root, "scripts/tdd/verify-wrapper.mjs"), wrapper);
    config.lanes.find((item: { name: string }) => item.name === "unit-red").command = "node scripts/tdd/verify-wrapper.mjs";
    writeFileSync(configPath, JSON.stringify(config));
    expect((await invoke("verify", "--id", "A")).status).toBe(64);
  });

  it.skipIf(!receiptSuites)("binds a successful two-file RED and GREEN", async () => {
    expect((await scenario("multi_cycle"))).toMatchObject({ red: 0, green: 0, repeat: 64, verdict: "SEPARATION-HELD", files: ["tests/a.test.ts", "tests/b.test.ts"] });
  });
  it.skipIf(!receiptSuites)("refuses absolute, traversal, comma, duplicate and empty selectors before running", async () => { expect((await scenario("invalid_paths"))).toMatchObject({ statuses: [64, 64, 64, 64, 64, 64, 64, 64, 64], unchanged: true, ran: false }); });
  it.skipIf(!receiptSuites)("refuses wrong lanes, master discard and invalid retry", async () => {
    expect((await scenario("wrong_lane"))).toMatchObject({ first: 0, second: 0, verify: 64, discard: 64, other: null });
    expect((await scenario("master_discard"))).toMatchObject({ discard: 64 });
    expect((await scenario("existing_bad_retry"))).toMatchObject({ first: 0, retry: 64, unchanged: true });
    expect((await scenario("settled_record"))).toMatchObject({ red: 0, green: 0, retry: 64, unchanged: true }); expect((await scenario("pending_store"))).toMatchObject({ discard: 64, unchanged: true });
  });
  it.skipIf(!receiptSuites)("ignores inherited pending receipts but refuses malformed stores", async () => {
    expect((await scenario("inherited_pending"))).toMatchObject({ recorded: 0, inherited: 0, malformed: 64 });
  });
  it.skipIf(!receiptSuites)("stores an assertion RED despite module-like assertion text", async () => {
    expect((await scenario("module_message"))).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
  it.skipIf(!receiptSuites)("leaves bare plugin record bound to the existing unit lane", async () => {
    expect((await scenario("bare_record"))).toMatchObject({ status: 0, lane: "unit" });
  });
  it.skipIf(!receiptSuites)("keeps parallel record logs and receipts independent", async () => {
    const result = (await scenario("concurrent_records"));
    expect(result.one.status).toBe(0); expect(result.two.status).toBe(64);
    expect(result.one.log).not.toBe(result.two.log);
    expect(result.receipts.sort()).toEqual([["A", "assertion-failure"], ["B", "green"]]);
  });
  it.skipIf(!receiptSuites)("preserves B recorded while A verification waits", async () => {
    expect((await scenario("concurrent_verify"))).toMatchObject({ red: 0, other: 0, verify: 0, receipts: [["A", "SEPARATION-HELD"], ["B", null]] });
  });
  it.skipIf(!receiptSuites)("preserves concurrent B while discarding A under the receipt lock", async () => {
    expect((await scenario("concurrent_discard"))).toMatchObject({ first: 0, blocked: true, discard: 0, recordB: 0, ids: ["B"] });
  });
  it("refuses contradictory JSON, absent suite and interrupted runner", async () => {
    for (const name of ["bad_report", "absent_suite", "interrupt", "bad_tmp"]) expect((await scenario(name)).status).toBe(64);
    expect(readdirSync(join(repo, "tests/tooling/fixtures/unit-red")).every((name) => !/\.tsx?$/.test(name))).toBe(true);
  });
  it("rejects preconstructed, non-Error and async hook failures", async () => { expect((await scenario("precreated_hooks")).statuses).toEqual([64, 64, 64]); });
  it("rejects a colored real unhandled error alongside a failed test", async () => { expect((await scenario("colored_unhandled"))).toMatchObject({ status: 64, colored: true, unhandled: true }); });
});
