import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const [scenario, repo] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "mdpro-unit-red-scenario-"));
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const lane = join(repo, "scripts/tdd/unit-red-lane.mjs");
const receiptsPath = join(root, ".claude/tdd-guardian/receipts.json");
const configPath = join(root, ".claude/tdd-guardian/config.json");

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.MDPRO_UNIT_RED_FILES;
  delete env.MDPRO_UNIT_RED_MARKER;
  delete env.MDPRO_UNIT_RED_NONCE;
  if (extra.FORCE_COLOR) delete env.NO_COLOR;
  return { ...env, ...extra };
}

function command(args, extra = {}) {
  const result = spawnSync(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, encoding: "utf8", timeout: 60000, env: cleanEnv(extra) });
  return { status: result.status, output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function asyncCommand(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args, "--cwd", root], { cwd: root, env: cleanEnv() });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (status) => resolve({ status, output }));
  });
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 15000 });
  if (result.status !== 0) throw Error(result.stderr);
}

function setup({ feature = true } = {}) {
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(lane, join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default {test:{include:["tests/**/*.test.{ts,tsx}"],maxWorkers:2}};\n');
  writeFileSync(configPath, readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(receiptsPath, JSON.stringify({ schemaVersion: 2, receipts: [] }));
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["add", "."]);
  git(["commit", "-qm", "base"]);
  if (feature) git(["switch", "-qc", "feature"]);
}

function spec(name, source = 'import { it } from "vitest"; it("fails", () => { throw Error("red"); });') {
  const file = `tests/${name}.test.ts`;
  writeFileSync(join(root, file), source);
  return file;
}

function stateSpec(name) {
  return spec(name, 'import { it, expect } from "vitest"; import { readFileSync } from "node:fs"; it("state", () => { console.log("Tests 7 failed | 0 passed (7)"); expect(readFileSync(new URL("./state.txt", import.meta.url), "utf8")).toBe("green"); });');
}

function store() {
  return JSON.parse(readFileSync(receiptsPath, "utf8"));
}

function setLane(commandText) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.lanes.find((item) => item.name === "unit-red").command = commandText;
  writeFileSync(configPath, JSON.stringify(config));
}

function summary(run) {
  return { status: run.status, log: run.output.match(/\[red-receipt\] log: ([^\n]+)/)?.[1] || null };
}

async function runScenario() {
  if (scenario === "master_discard") {
    setup({ feature: false });
    const a = spec("a");
    return { discard: command(["discard", "--id", "A"]).status, master: command(["check-pending"]).status, file: a };
  }
  setup();
  if (scenario === "invalid_paths") {
    const a = spec("a");
    const before = readFileSync(receiptsPath, "utf8");
    writeFileSync(join(root, "scripts/tdd/mark.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("ran", "yes");');
    setLane("node scripts/tdd/mark.mjs");
    mkdirSync(join(root, "tests/support")); mkdirSync(join(root, "tests/fixtures"));
    writeFileSync(join(root, "tests/setup.ts"), ""); writeFileSync(join(root, "tests/support/x.ts"), ""); writeFileSync(join(root, "tests/fixtures/x.json"), "{}"); writeFileSync(join(root, "tests/x.perf.ts"), "");
    const bad = [["--test", ""], ["--test", "/tmp/a.test.ts"], ["--test", "tests/../tests/a.test.ts"], ["--test", `${a},${a}`], ["--test", a, "--test", a], ...["tests/setup.ts", "tests/support/x.ts", "tests/fixtures/x.json", "tests/x.perf.ts"].map((file) => ["--test", file])];
    const statuses = bad.map((args) => command(["record", "--id", "A", ...args]).status);
    return { statuses, unchanged: readFileSync(receiptsPath, "utf8") === before, ran: existsSync(join(root, "ran")) };
  }
  if (scenario === "multi_cycle") {
    const a = stateSpec("a"); const b = stateSpec("b");
    writeFileSync(join(root, "tests/state.txt"), "red");
    const red = command(["record", "--id", "A", "--test", a, "--test", b]);
    writeFileSync(join(root, "tests/state.txt"), "green");
    const green = command(["verify", "--id", "A"]);
    const repeat = command(["verify", "--id", "A"]);
    return { red: red.status, green: green.status, repeat: repeat.status, verdict: store().receipts[0]?.verdict, files: Object.keys(store().receipts[0]?.test_files || {}) };
  }
  if (scenario === "wrong_lane") {
    const a = spec("a"); const b = spec("b");
    const first = command(["record", "--id", "A", "--test", a]);
    const second = command(["record", "--id", "B", "--test", b]);
    const saved = store(); saved.receipts[0].lane = "slow"; writeFileSync(receiptsPath, JSON.stringify(saved));
    return { first: first.status, second: second.status, verify: command(["verify", "--id", "A"]).status, discard: command(["discard", "--id", "A"]).status, other: store().receipts.find((r) => r.id === "B")?.verdict };
  }
  if (scenario === "existing_bad_retry") {
    const a = spec("a");
    const first = command(["record", "--id", "A", "--test", a]);
    const before = readFileSync(receiptsPath, "utf8");
    setLane("sh -c 'echo failed; exit 1'");
    const retry = command(["record", "--id", "A", "--test", a]);
    return { first: first.status, retry: retry.status, unchanged: readFileSync(receiptsPath, "utf8") === before };
  }
  if (scenario === "settled_record") {
    const a = stateSpec("a"); writeFileSync(join(root, "tests/state.txt"), "red");
    const red = command(["record", "--id", "A", "--test", a]);
    writeFileSync(join(root, "tests/state.txt"), "green");
    const green = command(["verify", "--id", "A"]);
    const before = readFileSync(receiptsPath, "utf8");
    const retry = command(["record", "--id", "A", "--test", a]);
    return { red: red.status, green: green.status, retry: retry.status, unchanged: readFileSync(receiptsPath, "utf8") === before };
  }
  if (scenario === "pending_store") {
    const a = spec("a"); const b = spec("b");
    command(["record", "--id", "A", "--test", a]); command(["record", "--id", "B", "--test", b]);
    const saved = store(); saved.receipts.find((r) => r.id === "B").verdict = "PENDING"; writeFileSync(receiptsPath, JSON.stringify(saved));
    const before = readFileSync(receiptsPath, "utf8");
    const discarded = command(["discard", "--id", "A"]);
    return { discard: discarded.status, unchanged: readFileSync(receiptsPath, "utf8") === before };
  }
  if (scenario === "bare_record") {
    const a = spec("a");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.lanes.find((item) => item.name === "unit").command = "sh -c 'echo failure; exit 1'";
    writeFileSync(configPath, JSON.stringify(config));
    const cache = join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
    const version = readdirSync(cache).filter((name) => existsSync(join(cache, name, "scripts/tdd-guardian/receipt.js"))).sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0];
    const plugin = join(cache, version, "scripts/tdd-guardian/receipt.js");
    const result = spawnSync(process.execPath, [plugin, "record", "--id", "A", "--files", a, "--cwd", root], { cwd: root, encoding: "utf8", env: cleanEnv() });
    return { status: result.status, lane: store().receipts[0]?.lane };
  }
  if (scenario === "module_message") {
    const a = spec("a", 'import { it, expect } from "vitest"; it("fails", () => { expect(() => { throw Error("Cannot find module x"); }).not.toThrow(); });');
    const recorded = command(["record", "--id", "A", "--test", a]);
    return { status: recorded.status, kind: store().receipts[0]?.red.kind };
  }
  if (scenario === "inherited_pending") {
    const a = spec("a");
    const recorded = command(["record", "--id", "A", "--test", a]);
    git(["add", ".claude/tdd-guardian/receipts.json"]); git(["commit", "-qm", "receipt"]); git(["branch", "-f", "master", "HEAD"]);
    const inherited = command(["check-pending"]);
    writeFileSync(receiptsPath, "{bad");
    return { recorded: recorded.status, inherited: inherited.status, malformed: command(["check-pending"]).status };
  }
  if (scenario === "concurrent_records") {
    const a = spec("a"); const b = spec("b", 'import { it } from "vitest"; it("passes", () => {});');
    const [one, two] = await Promise.all([asyncCommand(["record", "--id", "A", "--test", a]), asyncCommand(["record", "--id", "B", "--test", b])]);
    return { one: summary(one), two: summary(two), receipts: store().receipts.map((r) => [r.id, r.red.kind]) };
  }
  if (scenario === "concurrent_verify") {
    const a = stateSpec("a"); const b = spec("b");
    writeFileSync(join(root, "tests/state.txt"), "red");
    const red = command(["record", "--id", "A", "--test", a]);
    writeFileSync(join(root, "tests/state.txt"), "green");
    const ready = join(root, "ready"); const go = join(root, "go");
    const wrapper = `import { existsSync, writeFileSync, readFileSync } from "node:fs"; import { spawnSync } from "node:child_process"; const m=JSON.parse(readFileSync(process.env.MDPRO_UNIT_RED_MARKER,"utf8")); if(m.receipt?.id==="A"){writeFileSync(${JSON.stringify(ready)},""); const end=Date.now()+10000; while(!existsSync(${JSON.stringify(go)})&&Date.now()<end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);} const r=spawnSync(process.execPath,["scripts/tdd/unit-red-lane.mjs"],{stdio:"inherit",env:process.env});process.exit(r.status??64);`;
    writeFileSync(join(root, "scripts/tdd/wrapper.mjs"), wrapper);
    setLane("node scripts/tdd/wrapper.mjs");
    const verify = asyncCommand(["verify", "--id", "A"]);
    const end = Date.now() + 10000;
    while (!existsSync(ready) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
    const other = command(["record", "--id", "B", "--test", b]);
    writeFileSync(go, "");
    const settled = await verify;
    if (!existsSync(ready)) throw Error("verify A never reached the lane boundary");
    return { red: red.status, other: other.status, verify: settled.status, receipts: store().receipts.map((r) => [r.id, r.verdict]).sort() };
  }
  if (scenario === "concurrent_discard") {
    const a = spec("a"); const b = spec("b");
    const first = command(["record", "--id", "A", "--test", a]);
    const lock = join(root, ".claude/tdd-guardian/.receipts.lock"); mkdirSync(lock);
    let discardDone = false;
    const discard = asyncCommand(["discard", "--id", "A"]).then((result) => { discardDone = true; return result; });
    const recordB = asyncCommand(["record", "--id", "B", "--test", b]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const blocked = !discardDone;
    rmdirSync(lock);
    const [removed, added] = await Promise.all([discard, recordB]);
    return { first: first.status, blocked, discard: removed.status, recordB: added.status, ids: store().receipts.map((r) => r.id) };
  }
  if (scenario === "substring_overlap") {
    const a = spec("a", 'import { it } from "vitest"; it("a", () => {});');
    writeFileSync(join(root, "tests/a.test.tsx"), 'import { it } from "vitest"; it("tsx", () => {});');
    mkdirSync(join(root, "tests/x/tests"), { recursive: true });
    writeFileSync(join(root, "tests/x/tests/a.test.ts"), 'import { it } from "vitest"; it("nested", () => {});');
    const marker = join(root, "marker.json"); writeFileSync(marker, JSON.stringify({ nonce: "fixture", files: [a] }));
    const child = spawnSync(process.execPath, [lane], { cwd: root, encoding: "utf8", env: cleanEnv({ MDPRO_UNIT_RED_FILES: JSON.stringify([a]), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: "fixture" }) });
    if (!child.stderr?.includes("[unit-red] log:")) throw Error("overlap did not reach the Vitest runner");
    if (child.status === 64 && !/unexpected|did not report exactly/.test(child.stderr)) throw Error(`wrong overlap refusal: ${child.stderr}`);
    return { status: child.status, summary: child.stdout?.trim() || "" };
  }
  if (scenario === "precreated_hooks") {
    const sources = [
      'import { beforeEach, it } from "vitest"; const error = new Error("setup broke"); beforeEach(() => { throw error; }); it("never runs", () => { throw Error("body ran"); });',
      'import { beforeEach, it } from "vitest"; beforeEach(() => { throw "setup broke"; }); it("never runs", () => { throw Error("body ran"); });',
      'import { beforeEach, it } from "vitest"; beforeEach(async () => { await Promise.resolve(); throw Error("setup broke"); }); it("never runs", () => { throw Error("body ran"); });',
    ];
    const statuses = [];
    for (const [index, source] of sources.entries()) {
      const file = spec(`hook${index}`, source);
      const marker = join(root, `marker${index}.json`); writeFileSync(marker, JSON.stringify({ nonce: "fixture", files: [file] }));
      const result = spawnSync(process.execPath, [lane], { cwd: root, encoding: "utf8", env: cleanEnv({ MDPRO_UNIT_RED_FILES: JSON.stringify([file]), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: "fixture" }) });
      statuses.push(result.status);
    }
    return { statuses };
  }
  if (scenario === "colored_unhandled") {
    const file = spec("orphan", 'import { it } from "vitest"; Promise.reject(Error("orphan")); it("fails", () => { throw Error("red"); });');
    const marker = join(root, "marker.json"); writeFileSync(marker, JSON.stringify({ nonce: "fixture", files: [file] }));
    const result = spawnSync(process.execPath, [lane], { cwd: root, encoding: "utf8", env: cleanEnv({ FORCE_COLOR: "1", MDPRO_UNIT_RED_FILES: JSON.stringify([file]), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: "fixture" }) });
    const logPath = result.stderr?.match(/\[unit-red\] log: ([^\n]+)/)?.[1];
    const log = logPath ? readFileSync(logPath, "utf8") : "";
    return { status: result.status, colored: /\u001b\[/.test(log), unhandled: log.includes("Unhandled Errors"), summary: result.stdout?.trim() || "" };
  }
  if (scenario === "bad_tmp") {
    const a = spec("a"); const notDir = join(root, "not-a-directory"); writeFileSync(notDir, "x");
    const marker = join(root, "marker.json"); writeFileSync(marker, JSON.stringify({ nonce: "fixture", files: [a] }));
    const child = spawnSync(process.execPath, [lane], { cwd: root, encoding: "utf8", env: cleanEnv({ TMPDIR: notDir, MDPRO_UNIT_RED_FILES: JSON.stringify([a]), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: "fixture" }) });
    if (!/ENOTDIR|EACCES/.test(child.stderr || "")) throw Error(`adapter exception not reached: ${child.stderr}`);
    return { status: child.status };
  }
  if (scenario === "bad_report" || scenario === "absent_suite" || scenario === "interrupt") {
    const a = spec("a");
    const bin = join(root, "bin"); mkdirSync(bin);
    const fake = join(bin, "pnpm");
    const trace = join(root, "runner-trace");
    if (scenario === "interrupt") writeFileSync(fake, `#!/bin/sh\nprintf called > '${trace}'\nkill -TERM $$\n`);
    else {
      const name = scenario === "absent_suite" ? "b.test.ts" : "a.test.ts";
      const passed = scenario === "bad_report" ? 1 : 0;
      const failed = scenario === "bad_report" ? 0 : 1;
      const report = { numTotalTests: 1, numPassedTests: passed, numFailedTests: failed, testResults: [{ name: join(realpathSync.native(root), "tests", name), message: "", assertionResults: [{ status: "failed" }] }] };
      writeFileSync(fake, `#!/bin/sh\nprintf called > '${trace}'\nfor arg in "$@"; do case "$arg" in --outputFile.json=*) report=\${arg#*=};; esac; done\nprintf '%s' '${JSON.stringify(report)}' > "$report"\nprintf '%s' '{"activeHooks":[],"unhandledErrors":0}' > "$MDPRO_UNIT_RED_META_PATH"\nexit 1\n`);
    }
    chmodSync(fake, 0o755);
    const marker = join(root, "marker.json"); writeFileSync(marker, JSON.stringify({ nonce: "fixture", files: [a] }));
    const child = spawnSync(process.execPath, [lane], { cwd: root, encoding: "utf8", timeout: 15000, env: cleanEnv({ PATH: `${bin}:${process.env.PATH || ""}`, MDPRO_UNIT_RED_FILES: JSON.stringify([a]), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: "fixture" }) });
    if (!existsSync(trace)) throw Error(`fake runner was not invoked for ${scenario}: ${child.stderr}`);
    if (scenario === "bad_report" && !child.stderr?.includes("JSON counts disagree")) throw Error(`counts check not reached: ${child.stderr}`);
    if (scenario === "absent_suite" && !child.stderr?.includes("unexpected or duplicate suite")) throw Error(`suite check not reached: ${child.stderr}`);
    return { status: child.status, signal: child.signal };
  }
  throw Error(`unknown scenario ${scenario}`);
}

try {
  const result = await runScenario();
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(String(error.stack || error));
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
