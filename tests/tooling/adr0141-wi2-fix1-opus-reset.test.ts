// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(".agents/skills/mdpro-delegator/scripts/reset-opus-auditor.sh");
const tempDirs: string[] = [];

function run(env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(script, [], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function harness(kind: "claude" | "codex" = "claude", status = "idle") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-opus-reset-"));
  tempDirs.push(root);
  const bin = path.join(root, "bin"), wt = path.join(root, "opus-auditor"), report = path.join(root, "reports");
  for (const dir of [bin, wt, report]) fs.mkdirSync(dir);
  const log = path.join(root, "events.jsonl");
  fs.writeFileSync(path.join(bin, "herdr"), `#!/usr/bin/env node
const fs = require("node:fs");
const op = process.argv.slice(4);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(["herdr", ...op]) + "\\n");
if (op[0] === "agent" && op[1] === "get") {
 const name = op[2], delegator = name === "herdr-delegator";
 process.stdout.write(JSON.stringify({result:{agent:{agent:delegator?process.env.FAKE_KIND:"claude",agent_status:delegator?"idle":process.env.FAKE_STATUS,pane_id:delegator?"w1:p1":(fs.existsSync(process.env.FAKE_STARTED)?"w1:p8":"w1:p7"),cwd:process.env.FAKE_WT}}}));
} else if (op[0] === "pane" && op[1] === "split") {
 if (process.env.FAKE_SPLIT_FAIL === "1") process.exit(1);
 process.stdout.write("w1:p8\\n");
} else if (op[0] === "agent" && op[1] === "start") {
 fs.writeFileSync(process.env.FAKE_STARTED, "yes");
}
`);
  fs.chmodSync(path.join(bin, "herdr"), 0o755);
  fs.writeFileSync(path.join(bin, "git"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(["git", ...process.argv.slice(2)]) + "\\n");
`);
  fs.chmodSync(path.join(bin, "git"), 0o755);
  fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(bin, "sleep"), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: root,
    MDPRO_GUARD_TEST_OPUS_WT: wt, MDPRO_GUARD_TEST_OPUS_REPORT: report, FAKE_WT: wt, FAKE_LOG: log,
    FAKE_KIND: kind, FAKE_STATUS: status, FAKE_STARTED: path.join(root, "started") };
  const events = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]) : [];
  return { wt, report, env, events };
}

afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 Fix 1 Opus reset (requires macos zsh)", () => {
  it("refreshes, splits, closes and starts a fresh Opus pane on the Claude route", async () => {
    const h = harness();
    const result = await run(h.env);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("NEW w1:p8");
    const events = h.events();
    expect(events.filter((e) => e[0] === "git")).toEqual([
      ["git", "-C", h.wt, "fetch", "-q", "origin"],
      ["git", "-C", h.wt, "checkout", "-q", "--detach", "origin/master"],
    ]);
    const actions = events.filter((e) => e[0] === "herdr" && (e[1] === "pane" && ["split", "close"].includes(e[2]) || e[1] === "agent" && e[2] === "start"));
    expect(actions).toEqual([
      ["herdr", "pane", "split", "w1:p7", "--direction", "down", "--cwd", h.wt, "--no-focus", "--env", "MDPRO_ROLE=real-device-tester", "--env", `MDPRO_REPORT_DIR=${h.report}`],
      ["herdr", "pane", "close", "w1:p7"],
      ["herdr", "agent", "start", "opus-auditor", "--kind", "claude", "--pane", "w1:p8", "--", "--model", "opus", "--dangerously-skip-permissions"],
    ]);
  }, 15000);

  it.each(["codex", "working"])("refuses %s before any pane action", async (variant) => {
    const h = harness(variant === "codex" ? "codex" : "claude", variant === "working" ? "working" : "idle");
    const result = await run(h.env);
    expect(result.code).not.toBe(0);
    expect(h.events().filter((e) => e[0] === "herdr" && e[1] === "pane" || e[0] === "herdr" && e[1] === "agent" && e[2] === "start")).toEqual([]);
  });

  it("leaves the old pane open when split fails", async () => {
    const h = harness();
    const result = await run({ ...h.env, FAKE_SPLIT_FAIL: "1" });
    expect(result.code).not.toBe(0);
    expect(h.events().filter((e) => e[0] === "herdr" && (e[1] === "pane" && e[2] === "close" || e[1] === "agent" && e[2] === "start"))).toEqual([]);
  });
});
