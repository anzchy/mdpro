import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "../../.agents/skills/mdpro-delegator/scripts");

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

function fakeHerdr(dir: string): string {
  const bin = path.join(dir, "herdr");
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n");
if (args[0] !== "--session" || args[1] !== "mdpro") process.exit(41);
if (args[2] === "agent" && args[3] === "get") {
  const agent = args[4];
  const seen = fs.existsSync(process.env.FAKE_HERDR_SEEN);
  fs.writeFileSync(process.env.FAKE_HERDR_SEEN, "1");
  const delegatorSeen = agent === "herdr-delegator" && fs.existsSync(process.env.FAKE_DELEGATOR_SEEN) ? Number(fs.readFileSync(process.env.FAKE_DELEGATOR_SEEN, "utf8")) : 0;
  if (agent === "herdr-delegator") fs.writeFileSync(process.env.FAKE_DELEGATOR_SEEN, String(delegatorSeen + 1));
  const state = agent === "herdr-delegator" ?
    (process.env.FAKE_DELEGATOR_BUSY_ONCE === "1" && delegatorSeen === 2 ? "working" : "idle") :
    (process.env.FAKE_INITIAL_STATE === "idle" || seen ? "idle" : "working");
  const kind = agent === "herdr-delegator" ?
    (process.env.FAKE_CLAUDE_AFTER_WAIT === "1" && delegatorSeen >= 4 ? "claude" : (process.env.FAKE_DELEGATOR_KIND || "codex")) : (process.env.FAKE_TARGET_KIND || "codex");
  process.stdout.write(JSON.stringify({result:{agent:{agent_status:state, agent:kind, cwd:agent === "herdr-delegator" ? process.env.MDPRO_GUARD_TEST_MAIN : process.env.FAKE_TARGET_CWD, pane_id:"w1:p7"}}}));
}
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-listener-"));
  fakeHerdr(dir);
  const log = path.join(dir, "calls.jsonl");
  const seen = path.join(dir, "seen");
  const delegatorSeen = path.join(dir, "delegator-seen");
  const mainRules = path.join(dir, ".codex/rules");
  const target = path.join(dir, "target");
  fs.mkdirSync(mainRules, { recursive: true });
  fs.mkdirSync(path.join(target, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(mainRules, "mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.writeFileSync(path.join(target, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: implementor\n");
  fs.writeFileSync(path.join(target, ".codex/rules/.started-at"), "w1:p7\n");
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ""}`,
    FAKE_HERDR_LOG: log,
    FAKE_HERDR_SEEN: seen,
    FAKE_DELEGATOR_SEEN: delegatorSeen,
    FAKE_TARGET_CWD: target,
    MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: dir,
  };
  const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
  const cleanup = () => {
    for (const name of ["herdr", "calls.jsonl", "seen", "delegator-seen", "heartbeat.json", "heartbeat.json.lock"]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.unlinkSync(path.join(mainRules, "mdpro-role.rules"));
    fs.rmdirSync(mainRules);
    fs.rmdirSync(path.join(dir, ".codex"));
    fs.unlinkSync(path.join(target, ".codex/rules/mdpro-role.rules"));
    fs.unlinkSync(path.join(target, ".codex/rules/.started-at"));
    fs.rmdirSync(path.join(target, ".codex/rules"));
    fs.rmdirSync(path.join(target, ".codex"));
    fs.rmdirSync(target);
    fs.rmdirSync(dir);
  };
  return { dir, log, env, calls, cleanup };
}

describe.skipIf(process.platform !== "darwin")("mdpro delegator completion listener (requires macos zsh)", () => {
  it("dispatches implementor briefs with the installed TDD Guardian workflow", async () => {
    const h = harness();
    const brief = path.join(h.dir, "brief.md");
    fs.writeFileSync(brief, "# fix brief\n");
    try {
      const result = await run(path.join(scripts, "prompt.sh"), ["gpt-imple-1", brief, "brief", "1000"], { ...h.env, FAKE_INITIAL_STATE: "idle" });
      expect(result.status).toBe(0);
      const prompt = h.calls().find(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "gpt-imple-1");
      expect(prompt?.[5]).toContain("$tdd-guardian:tdd-guardian-workflow");
      expect(prompt?.[5]).not.toContain("$mdpro-tdd-workflow");
    } finally {
      fs.unlinkSync(brief);
      h.cleanup();
    }
  });

  it("refuses an already idle agent without a duplicate notification", async () => {
    const h = harness();
    try {
      const result = await run(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", "/tmp/report"], { ...h.env, FAKE_INITIAL_STATE: "idle" });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no new completion to watch");
      expect(h.calls().filter(args => args[2] === "notification" || args[3] === "prompt")).toEqual([]);
    } finally { h.cleanup(); }
  });

  it("waits in mdpro, notifies once, then wakes the idle delegator", async () => {
    const h = harness();
    const report = path.join(h.dir, "report.md");
    fs.writeFileSync(report, "ready\n");
    try {
      const result = await run(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", report], h.env);
      expect(result.status).toBe(0);
      const calls = h.calls();
      expect(calls.every(args => args[0] === "--session" && args[1] === "mdpro")).toBe(true);
      expect(calls.filter(args => args[2] === "notification" && args[3] === "show")).toHaveLength(1);
      expect(calls.some(args => args[2] === "agent" && args[3] === "wait" && args[4] === "gpt-auditor")).toBe(true);
      expect(calls.some(args => args[2] === "agent" && args[3] === "get" && args[4] === "herdr-delegator")).toBe(true);
      const wake = calls.find(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "herdr-delegator");
      expect(wake?.[5]).toContain(report);
    } finally {
      fs.unlinkSync(report);
      h.cleanup();
    }
  });

  it("rechecks delegator state after a wait that misses the idle transition", async () => {
    const h = harness();
    try {
      const result = await run(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", "/tmp/report"], { ...h.env, FAKE_DELEGATOR_BUSY_ONCE: "1" });
      expect(result.status).toBe(0);
      const calls = h.calls();
      expect(calls.filter(args => args[2] === "agent" && args[3] === "get" && args[4] === "herdr-delegator")).toHaveLength(5);
      expect(calls.some(args => args[2] === "agent" && args[3] === "wait" && args[4] === "herdr-delegator")).toBe(true);
      expect(calls.filter(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "herdr-delegator")).toHaveLength(1);
    } finally { h.cleanup(); }
  });

  it("does not prompt Claude after a Codex listener spans a delegator handover", async () => {
    const h = harness();
    try {
      const result = await run(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", "/tmp/report"], { ...h.env, FAKE_DELEGATOR_BUSY_ONCE: "1", FAKE_CLAUDE_AFTER_WAIT: "1" });
      expect(result.status).toBe(0);
      const calls = h.calls();
      expect(calls.filter(args => args[2] === "notification" && args[3] === "show")).toHaveLength(1);
      expect(calls.some(args => args[2] === "agent" && args[3] === "wait" && args[4] === "herdr-delegator")).toBe(true);
      expect(calls.some(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "herdr-delegator")).toBe(false);
      expect(result.stdout).toContain("Herdr completion: gpt-auditor is idle");
    } finally { h.cleanup(); }
  });

  it("returns a Claude completion through Bash without a second prompt or routine notification", async () => {
    const h = harness();
    const report = path.join(h.dir, "claude-report.md");
    fs.writeFileSync(report, "ready\n");
    try {
      const result = await run(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", report], { ...h.env, FAKE_DELEGATOR_KIND: "claude" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Report ready: ${report}`);
      const calls = h.calls();
      expect(calls.some(args => args[2] === "agent" && args[3] === "wait" && args[4] === "gpt-auditor")).toBe(true);
      expect(calls.filter(args => args[2] === "notification" || args[3] === "prompt")).toEqual([]);
    } finally {
      fs.unlinkSync(report);
      h.cleanup();
    }
  });

  it("refuses an unknown delegator runtime before dispatch", async () => {
    const h = harness();
    const brief = path.join(h.dir, "brief.md");
    fs.writeFileSync(brief, "# brief\n");
    try {
      const result = await run(path.join(scripts, "prompt.sh"), ["gpt-imple-1", brief, "brief", "1000"], { ...h.env, FAKE_DELEGATOR_KIND: "unknown" });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("unknown herdr-delegator runtime");
      expect(h.calls().some(args => args[2] === "agent" && args[3] === "prompt")).toBe(false);
    } finally {
      fs.unlinkSync(brief);
      h.cleanup();
    }
  });

  it("sends an Opus request on Claude when its brief records the user request and sufficient usage", async () => {
    const h = harness();
    const brief = path.join(h.dir, "opus-request.md");
    fs.writeFileSync(brief, "User request: Audit this item.\nClaude usage: sufficient\n");
    try {
      const claude = await run(path.join(scripts, "prompt.sh"), ["opus-auditor", brief, "request", "1000"], { ...h.env, FAKE_TARGET_KIND: "claude", FAKE_DELEGATOR_KIND: "claude", FAKE_INITIAL_STATE: "idle" });
      expect(claude.status).toBe(0);
      const calls = h.calls();
      expect(calls.filter(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "opus-auditor")).toHaveLength(1);
    } finally {
      fs.unlinkSync(brief);
      h.cleanup();
    }
  });

  it("serializes simultaneous heartbeat notes without losing or truncating one", async () => {
    const h = harness();
    const heartbeat = path.join(h.dir, "heartbeat.json");
    fs.writeFileSync(heartbeat, JSON.stringify({ assignments: {}, notes: [] }));
    try {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise<number>((resolve, reject) => {
        const child = spawn("python3", [path.join(scripts, "heartbeat.py"), "note", `note-${i}`], {
          env: { ...h.env, MDPRO_HEARTBEAT_PATH: heartbeat }, stdio: "ignore",
        });
        child.on("error", reject);
        child.on("exit", code => resolve(code ?? -1));
      })));
      expect(results).toEqual(Array(12).fill(0));
      const saved = JSON.parse(fs.readFileSync(heartbeat, "utf8")) as { notes: string[] };
      expect(new Set(saved.notes)).toEqual(new Set(Array.from({ length: 12 }, (_, i) => `note-${i}`)));
    } finally { h.cleanup(); }
  });
});
