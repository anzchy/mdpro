import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";

// Shared harness for the ADR0162-WI4 reset-codex PATH tests (one file per AC, so each AC has its own RED receipt).
// ADR-0162 decision 4: reset-codex.sh puts the rustup toolchain on the new pane's PATH and refuses an implementor or
// device pane without cargo and rustfmt. The fake herdr below simulates the pane's shell: `pane run` echoes the typed
// command, then runs it under the PATH the split gave that pane, so the in-pane check is decided by real lookups.

const script = path.resolve(".agents/skills/mdpro-delegator/scripts/reset-codex.sh");
const installer = path.resolve("scripts/codex-rules/install-role.mjs");
export const tempDirs: string[] = [];
export const MAX_WAIT_MS = 30000;
const cleanPath = (process.env.PATH ?? "").split(":").filter((dir) => dir && !dir.includes(".rustup") && !dir.includes(".cargo")).join(":");

export type Call = string[];
export type Tool = "exec" | "noexec" | "dir" | "absent";

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function makeTool(dir: string, name: string, kind: Tool) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (kind === "absent") return;
  if (kind === "dir") { fs.mkdirSync(file, { mode: 0o755 }); return; }
  fs.writeFileSync(file, `#!/bin/sh\necho ${name}\n`);
  fs.chmodSync(file, kind === "exec" ? 0o755 : 0o644);
}

export function makeToolchain(dir: string, cargo: Tool = "exec", rustfmt: Tool = "exec") {
  makeTool(dir, "cargo", cargo);
  makeTool(dir, "rustfmt", rustfmt);
  return dir;
}

const fakeHerdr = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2), op = args.slice(2);
const log = (entry) => fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(entry) + "\\n");
log(op);
if (args[0] !== "--session" || args[1] !== "mdpro") process.exit(41);
const state = process.env.FAKE_STATE;
const paneFile = (pane, kind) => path.join(state, pane.replace(/[^A-Za-z0-9]/g, "_") + "." + kind);
const flag = (name) => { const i = op.indexOf(name); return i >= 0 ? op[i + 1] : undefined; };
if (op[0] === "agent" && op[1] === "get") {
  if (op[2] === "herdr-delegator") {
    process.stdout.write(JSON.stringify({result:{agent:{agent:process.env.FAKE_DELEGATOR_KIND || "codex",agent_status:"idle",cwd:process.env.FAKE_MAIN,pane_id:"w1:p1"}}}));
  } else {
    const started = fs.existsSync(process.env.FAKE_STARTED);
    const agent = {agent:"codex",agent_status:"idle",cwd:process.env.FAKE_WT};
    if (started) agent.pane_id = "w1:p8"; else if (process.env.FAKE_NO_OLD !== "1") agent.pane_id = "w1:p7";
    process.stdout.write(JSON.stringify({result:{agent}}));
  }
} else if (op[0] === "pane" && op[1] === "split") {
  const envs = op.flatMap((value, i) => op[i - 1] === "--env" ? [value] : []);
  const pathEnv = envs.find((value) => value.startsWith("PATH="));
  fs.writeFileSync(paneFile("w1:p8", "path"), pathEnv === undefined ? "" : pathEnv.slice(5));
  fs.writeFileSync(paneFile("w1:p8", "out"), "");
  process.stdout.write("w1:p8\\n");
} else if (op[0] === "pane" && op[1] === "run") {
  const pane = op[2], command = op.slice(3).join(" ");
  if (!fs.existsSync(paneFile(pane, "path"))) process.exit(1);
  const tries = paneFile(pane, "tries");
  const attempt = (fs.existsSync(tries) ? Number(fs.readFileSync(tries, "utf8")) : 0) + 1;
  fs.writeFileSync(tries, String(attempt));
  if (process.env.FAKE_PANE_BUSY === "always" || (process.env.FAKE_PANE_BUSY === "once" && attempt === 1)) {
    process.stderr.write("agent_pane_busy\\n");
    process.exit(1);
  }
  const panePath = process.env.FAKE_PANE_PATH_OVERRIDE ?? fs.readFileSync(paneFile(pane, "path"), "utf8");
  const result = spawnSync("/bin/sh", ["-c", command], { env: { PATH: panePath }, encoding: "utf8" });
  fs.appendFileSync(paneFile(pane, "out"), "% " + command + "\\n" + (result.stdout || "") + (result.stderr || "") + "% \\n");
} else if (op[0] === "pane" && op[1] === "wait-output") {
  // herdr semantics at their least forgiving: one joined snapshot, --lines keeps the last N lines, a Rust regex has
  // no implicit multiline ((?m) is translated to the JS m flag), --match is a literal substring.
  const pane = op[op.length - 1];
  const raw = flag("--regex"), literal = flag("--match"), lines = flag("--lines");
  let snapshot = fs.existsSync(paneFile(pane, "out")) ? fs.readFileSync(paneFile(pane, "out"), "utf8") : "";
  if (lines !== undefined) snapshot = snapshot.replace(/\\n$/, "").split("\\n").slice(-Number(lines)).join("\\n");
  let matched = false;
  if (raw !== undefined) {
    const multi = raw.startsWith("(?m)");
    matched = new RegExp(multi ? raw.slice(4) : raw, multi ? "m" : "").test(snapshot);
  } else if (literal !== undefined) matched = snapshot.includes(literal);
  if (matched) process.exit(0);
  if (flag("--timeout") === undefined) { log(["WOULD_HANG"]); process.exit(99); }
  process.exit(1);
} else if (op[0] === "agent" && op[1] === "start") {
  fs.writeFileSync(process.env.FAKE_STARTED, "yes");
  process.stdout.write(JSON.stringify({argv: op.slice(op.indexOf("--") + 1)}));
} else if (op[0] === "pane" && op[1] === "read") {
  process.stdout.write("gpt-6-sol high · Context 0% used\\n");
}
`;

export function harness(name = "gpt-imple-2") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr0162-wi4-"));
  tempDirs.push(root);
  const main = path.join(root, "main"), wt = path.join(root, "Documents/mac-app/mdpro-wt", name), bin = path.join(root, "bin"), state = path.join(root, "state");
  for (const dir of [main, wt, bin, state, path.join(main, ".codex/rules"), path.join(wt, ".codex/rules"), path.join(main, "scripts/codex-rules")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.writeFileSync(path.join(wt, ".codex/rules/mdpro.rules"), "# shared rules\n");
  const log = path.join(root, "calls.jsonl");
  fs.writeFileSync(path.join(bin, "herdr"), fakeHerdr);
  fs.chmodSync(path.join(bin, "herdr"), 0o755);
  fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(bin, "sleep"), 0o755);
  fs.writeFileSync(path.join(main, "scripts/codex-rules/install-role.mjs"), `import fs from "node:fs";
import { install } from ${JSON.stringify(installer)};
install(process.argv.slice(2));
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(["install"]) + "\\n");
`);
  const tc = path.join(root, "toolchain/bin");
  const defaultTc = path.join(root, ".rustup/toolchains/stable-aarch64-apple-darwin/bin");
  const scriptPath = `${bin}:${cleanPath}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    PATH: scriptPath,
    MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main,
    MDPRO_RUST_TOOLCHAIN_BIN: tc,
    FAKE_MAIN: main,
    FAKE_WT: wt,
    FAKE_STATE: state,
    FAKE_HERDR_LOG: log,
    FAKE_STARTED: path.join(root, "started"),
  };
  delete env.MDPRO_WORKTREE_OVERRIDE;
  const calls = (): Call[] => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Call) : [];
  const reset = (role: string, moreEnv: NodeJS.ProcessEnv = {}) => {
    const merged: NodeJS.ProcessEnv = { ...env, ...moreEnv };
    for (const [key, value] of Object.entries(moreEnv)) if (value === undefined) delete merged[key];
    return run(script, [name, wt, "gpt-6-sol", "high", role], merged);
  };
  return { root, main, wt, tc, defaultTc, scriptPath, env, calls, reset };
}

export const op = (call: Call) => call[0] === "install" ? "install" : `${call[0]} ${call[1]}`;
export const sideEffects = (calls: Call[]) => calls.filter((call) => ["install", "pane split", "pane close", "pane run", "pane wait-output", "agent start"].includes(op(call)));
export const split = (calls: Call[]) => calls.find((call) => op(call) === "pane split");
export const pathEnvs = (call: Call | undefined) => (call ?? []).filter((value, i) => call![i - 1] === "--env" && value.startsWith("PATH="));
export const marker = (wt: string) => path.join(wt, ".codex/rules/.started-at");
export const overlay = (wt: string) => path.join(wt, ".codex/rules/mdpro-role.rules");

export function expectPreSplitRefusal(h: ReturnType<typeof harness>, result: { code: number; stderr: string }, names?: string) {
  expect(result.code, result.stderr).toBe(2);
  expect(result.stderr).toContain("REFUSED");
  if (names) expect(result.stderr).toContain(names);
  expect(sideEffects(h.calls())).toEqual([]);
  expect(fs.existsSync(overlay(h.wt))).toBe(false);
  expect(fs.existsSync(marker(h.wt))).toBe(false);
  expect(h.calls().flat()).not.toContain("danger-full-access");
}

export function expectInPaneRefusal(h: ReturnType<typeof harness>, result: { code: number; stderr: string; stdout: string }, oldPane: string | null = "w1:p7") {
  expect(result.code, result.stderr + result.stdout).toBe(2);
  expect(result.stderr).toContain("REFUSED");
  expect(result.stderr).toContain("w1:p8");
  const calls = h.calls();
  const ops = sideEffects(calls).map(op);
  expect(ops).toEqual(["install", "pane split", "pane run", "pane wait-output", "pane close"]);
  expect(calls.filter((call) => op(call) === "pane close")).toEqual([["pane", "close", "w1:p8"]]);
  if (oldPane) expect(calls.some((call) => op(call) === "pane close" && call[2] === oldPane)).toBe(false);
  expect(calls.some((call) => op(call) === "pane close" && call[2] === "w1:p1")).toBe(false);
  expectPaneCheckShape(calls);
  expect(fs.existsSync(marker(h.wt))).toBe(false);
}

export function expectPaneCheckShape(calls: Call[]) {
  const runs = calls.filter((call) => op(call) === "pane run");
  const waits = calls.filter((call) => op(call) === "pane wait-output");
  expect(runs.length).toBeGreaterThan(0);
  expect(waits.length).toBeGreaterThan(0);
  for (const call of runs) {
    expect(call[2]).toBe("w1:p8");
    expect(call.slice(3).join(" ")).not.toContain("MDPRO_RUST_OK");
  }
  for (const call of waits) {
    expect(call[call.length - 1]).toBe("w1:p8");
    if (call.includes("--lines")) expect(Number(call[call.indexOf("--lines") + 1])).toBeGreaterThanOrEqual(3);
    const timeout = Number(call[call.indexOf("--timeout") + 1]);
    expect(call).toContain("--timeout");
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(MAX_WAIT_MS);
  }
  expect(calls.flat()).not.toContain("WOULD_HANG");
}

export function cleanup() { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); }
