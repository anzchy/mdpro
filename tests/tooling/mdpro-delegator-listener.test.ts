import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "../../.agents/skills/mdpro-delegator/scripts");

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
    (process.env.FAKE_DELEGATOR_BUSY_ONCE === "1" && delegatorSeen === 1 ? "working" : "idle") :
    (process.env.FAKE_INITIAL_STATE === "idle" || seen ? "idle" : "working");
  const kind = agent === "herdr-delegator" ?
    (process.env.FAKE_CLAUDE_AFTER_WAIT === "1" && delegatorSeen >= 3 ? "claude" : (process.env.FAKE_DELEGATOR_KIND || "codex")) : "codex";
  process.stdout.write(JSON.stringify({result:{agent:{agent_status:state, agent:kind}}}));
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
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ""}`,
    FAKE_HERDR_LOG: log,
    FAKE_HERDR_SEEN: seen,
    FAKE_DELEGATOR_SEEN: delegatorSeen,
  };
  const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
  const cleanup = () => {
    for (const name of ["herdr", "calls.jsonl", "seen", "delegator-seen", "heartbeat.json", "heartbeat.json.lock"]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
  };
  return { dir, log, env, calls, cleanup };
}

describe("mdpro delegator completion listener", () => {
  it("dispatches implementor briefs with the installed TDD Guardian workflow", () => {
    const h = harness();
    const brief = path.join(h.dir, "brief.md");
    fs.writeFileSync(brief, "# fix brief\n");
    try {
      const result = spawnSync(path.join(scripts, "prompt.sh"), ["gpt-imple-1", brief, "brief", "1000"], {
        env: { ...h.env, FAKE_INITIAL_STATE: "idle" }, encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const prompt = h.calls().find(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "gpt-imple-1");
      expect(prompt?.[5]).toContain("$tdd-guardian:tdd-guardian-workflow");
      expect(prompt?.[5]).not.toContain("$mdpro-tdd-workflow");
    } finally {
      fs.unlinkSync(brief);
      h.cleanup();
    }
  });

  it("refuses an already idle agent without a duplicate notification", () => {
    const h = harness();
    try {
      const result = spawnSync(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", "/tmp/report"], {
        env: { ...h.env, FAKE_INITIAL_STATE: "idle" }, encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no new completion to watch");
      expect(h.calls().filter(args => args[2] === "notification" || args[3] === "prompt")).toEqual([]);
    } finally { h.cleanup(); }
  });

  it("waits in mdpro, notifies once, then wakes the idle delegator", () => {
    const h = harness();
    const report = path.join(h.dir, "report.md");
    fs.writeFileSync(report, "ready\n");
    try {
      const result = spawnSync(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", report], {
        env: h.env, encoding: "utf8",
      });
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

  it("rechecks delegator state after a wait that misses the idle transition", () => {
    const h = harness();
    try {
      const result = spawnSync(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", "/tmp/report"], {
        env: { ...h.env, FAKE_DELEGATOR_BUSY_ONCE: "1" }, encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const calls = h.calls();
      expect(calls.filter(args => args[2] === "agent" && args[3] === "get" && args[4] === "herdr-delegator")).toHaveLength(4);
      expect(calls.some(args => args[2] === "agent" && args[3] === "wait" && args[4] === "herdr-delegator")).toBe(true);
      expect(calls.filter(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "herdr-delegator")).toHaveLength(1);
    } finally { h.cleanup(); }
  });

  it("does not prompt Claude after a Codex listener spans a delegator handover", () => {
    const h = harness();
    try {
      const result = spawnSync(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", "/tmp/report"], {
        env: { ...h.env, FAKE_DELEGATOR_BUSY_ONCE: "1", FAKE_CLAUDE_AFTER_WAIT: "1" }, encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const calls = h.calls();
      expect(calls.filter(args => args[2] === "notification" && args[3] === "show")).toHaveLength(1);
      expect(calls.some(args => args[2] === "agent" && args[3] === "wait" && args[4] === "herdr-delegator")).toBe(true);
      expect(calls.some(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "herdr-delegator")).toBe(false);
      expect(result.stdout).toContain("Herdr completion: gpt-auditor is idle");
    } finally { h.cleanup(); }
  });

  it("returns a Claude completion through Bash without a second prompt or routine notification", () => {
    const h = harness();
    const report = path.join(h.dir, "claude-report.md");
    fs.writeFileSync(report, "ready\n");
    try {
      const result = spawnSync(path.join(scripts, "watch-agent.sh"), ["gpt-auditor", report], {
        env: { ...h.env, FAKE_DELEGATOR_KIND: "claude" }, encoding: "utf8",
      });
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

  it("refuses an unknown delegator runtime before dispatch", () => {
    const h = harness();
    const brief = path.join(h.dir, "brief.md");
    fs.writeFileSync(brief, "# brief\n");
    try {
      const result = spawnSync(path.join(scripts, "prompt.sh"), ["gpt-imple-1", brief, "brief", "1000"], {
        env: { ...h.env, FAKE_DELEGATOR_KIND: "unknown" }, encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("unknown herdr-delegator runtime");
      expect(h.calls().some(args => args[2] === "agent" && args[3] === "prompt")).toBe(false);
    } finally {
      fs.unlinkSync(brief);
      h.cleanup();
    }
  });

  it("allows optional Opus only on Claude with a recorded user request and usage check", () => {
    const h = harness();
    const brief = path.join(h.dir, "opus-request.md");
    fs.writeFileSync(brief, "User request: Add an Opus audit for this item.\nClaude usage: Sufficient for one request.\n");
    try {
      const codex = spawnSync(path.join(scripts, "prompt.sh"), ["opus-auditor", brief, "request", "1000"], {
        env: h.env, encoding: "utf8",
      });
      expect(codex.status).toBe(2);
      fs.writeFileSync(brief, "User request: Add an Opus audit for this item.\nClaude usage: insufficient.\n");
      const insufficient = spawnSync(path.join(scripts, "prompt.sh"), ["opus-auditor", brief, "request", "1000"], {
        env: { ...h.env, FAKE_DELEGATOR_KIND: "claude" }, encoding: "utf8",
      });
      expect(insufficient.status).toBe(2);
      fs.writeFileSync(brief, "User request: Add an Opus audit for this item.\nClaude usage: Sufficient for one request.\n");
      const claude = spawnSync(path.join(scripts, "prompt.sh"), ["opus-auditor", brief, "request", "1000"], {
        env: { ...h.env, FAKE_DELEGATOR_KIND: "claude" }, encoding: "utf8",
      });
      expect(claude.status).toBe(0);
      const calls = h.calls();
      expect(calls.filter(args => args[2] === "agent" && args[3] === "prompt" && args[4] === "opus-auditor")).toHaveLength(1);
      expect(calls.filter(args => args[2] === "notification" || (args[3] === "prompt" && args[4] === "herdr-delegator"))).toEqual([]);
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
