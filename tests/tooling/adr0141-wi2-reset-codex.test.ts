// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(".agents/skills/mdpro-delegator/scripts/reset-codex.sh");
const installer = path.resolve("scripts/codex-rules/install-role.mjs");
const tempDirs: string[] = [];

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

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-reset-"));
  tempDirs.push(root);
  const main = path.join(root, "main"), wt = path.join(root, "wt"), bin = path.join(root, "bin");
  for (const dir of [main, wt, bin, path.join(main, ".codex/rules"), path.join(wt, ".codex/rules"), path.join(main, "scripts/codex-rules")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.writeFileSync(path.join(wt, ".codex/rules/mdpro.rules"), "# shared rules\n");
  const log = path.join(root, "calls.jsonl");
  const fake = path.join(bin, "herdr");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), op = args.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(op) + "\\n");
if (args[0] !== "--session" || args[1] !== "mdpro") process.exit(41);
if (op[0] === "agent" && op[1] === "get") {
  if (op[2] === "herdr-delegator") process.stdout.write(JSON.stringify({result:{agent:{agent:"codex",agent_status:"idle",cwd:process.env.FAKE_MAIN,pane_id:"w1:p1"}}}));
  else process.stdout.write(JSON.stringify({result:{agent:{agent:"codex",agent_status:"idle",cwd:process.env.FAKE_WT,pane_id:fs.existsSync(process.env.FAKE_STARTED)?"w1:p8":"w1:p7"}}}));
} else if (op[0] === "pane" && op[1] === "split") {
  process.stdout.write("w1:p8\\n");
} else if (op[0] === "agent" && op[1] === "start") {
  fs.writeFileSync(process.env.FAKE_STARTED, "yes");
  const argv = op.slice(op.indexOf("--") + 1);
  process.stdout.write(JSON.stringify({argv}));
} else if (op[0] === "pane" && op[1] === "read") {
  process.stdout.write("gpt-6-sol high · Context 0% used\\n");
}
`);
  fs.chmodSync(fake, 0o755);
  const sleep = path.join(bin, "sleep");
  fs.writeFileSync(sleep, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(sleep, 0o755);
  const wrapper = path.join(main, "scripts/codex-rules/install-role.mjs");
  fs.writeFileSync(wrapper, `import fs from "node:fs";
import { install } from ${JSON.stringify(installer)};
if (process.env.FAKE_INSTALL_FAIL === "1") process.exit(7);
install(process.argv.slice(2));
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(["install"]) + "\\n");
const target = process.env.FAKE_WT + "/.codex/rules/mdpro-role.rules";
if (process.env.FAKE_INSTALL_BAD_HEADER === "1") fs.writeFileSync(target, "# Local mdpro role: delegator\\n");
if (process.env.FAKE_INSTALL_SYMLINK === "1") { fs.unlinkSync(target); fs.symlinkSync(process.env.FAKE_MAIN + "/.codex/rules/mdpro-role.rules", target); }
`);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main,
    MDPRO_GUARD_TEST_SLEEP: "0",
    FAKE_MAIN: main,
    FAKE_WT: wt,
    FAKE_HERDR_LOG: log,
    FAKE_STARTED: path.join(root, "started"),
  };
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
  const reset = (role?: string, moreEnv: NodeJS.ProcessEnv = {}) => run(script, ["gpt-imple-2", wt, "gpt-6-sol", "high", ...(role === undefined ? [] : [role])], { ...env, ...moreEnv });
  return { root, main, wt, env, calls, reset };
}

afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 reset-codex role provisioning (requires macos zsh)", () => {
  it.each(["implementor", "auditor"])("installs %s before pane split, close and start", async (role) => {
    const h = harness();
    const result = await h.reset(role);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const overlay = path.join(h.wt, ".codex/rules/mdpro-role.rules");
    expect(fs.lstatSync(overlay).isFile()).toBe(true);
    expect(fs.readFileSync(overlay, "utf8").split("\n")[0]).toBe(`# Local mdpro role: ${role}`);
    const calls = h.calls();
    expect(calls.map((call) => call[0] === "install" ? "install" : `${call[0]} ${call[1]}`).filter((op) => ["install", "pane split", "pane close", "agent start"].includes(op))).toEqual(["install", "pane split", "pane close", "agent start"]);
    const split = calls.find((call) => call[0] === "pane" && call[1] === "split")!;
    const start = calls.find((call) => call[0] === "agent" && call[1] === "start")!;
    expect(split.includes("MDPRO_ROLE=implementor")).toBe(role === "implementor");
    expect(start.includes("danger-full-access")).toBe(role === "implementor");
  });

  it.each(["missing", "delegator"])("refuses %s role before a pane action", async (variant) => {
    const h = harness();
    const result = await h.reset(variant === "missing" ? undefined : variant);
    expect(result.code).not.toBe(0);
    expect(h.calls().filter((call) => call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && call[1] === "start")).toEqual([]);
  });

  it.each(["FAKE_INSTALL_FAIL", "FAKE_INSTALL_BAD_HEADER", "FAKE_INSTALL_SYMLINK"])("keeps old pane when %s occurs", async (flag) => {
    const h = harness();
    const result = await h.reset("implementor", { [flag]: "1" });
    expect(result.code).not.toBe(0);
    expect(h.calls().filter((call) => call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && call[1] === "start")).toEqual([]);
    expect(h.calls().some((call) => call[0] === "agent" && call[1] === "get" && call[2] === "gpt-imple-2")).toBe(true);
  });

  it.each(["missing", "wrong", "symlink"])("refuses a %s delegator overlay before installing", async (variant) => {
    const h = harness();
    const mainOverlay = path.join(h.main, ".codex/rules/mdpro-role.rules");
    if (variant === "missing") fs.unlinkSync(mainOverlay);
    if (variant === "wrong") fs.writeFileSync(mainOverlay, "# Local mdpro role: implementor\n");
    if (variant === "symlink") { fs.unlinkSync(mainOverlay); fs.symlinkSync(path.join(h.wt, ".codex/rules/mdpro.rules"), mainOverlay); }
    const result = await h.reset("implementor");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("delegator overlay");
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && call[1] === "start")).toEqual([]);
  });
});
