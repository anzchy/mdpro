// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = path.resolve(".agents/skills/mdpro-delegator/scripts");
const dirs: string[] = [];

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function harness(kind: "codex" | "claude" = "codex") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-route-"));
  dirs.push(root);
  const main = path.join(root, "main"), target = path.join(root, "target"), bin = path.join(root, "bin");
  for (const dir of [path.join(main, ".codex/rules"), path.join(target, ".codex/rules"), bin]) fs.mkdirSync(dir, { recursive: true });
  const overlay = path.join(main, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(overlay, "# Local mdpro role: delegator\n");
  const targetOverlay = path.join(target, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(targetOverlay, "# Local mdpro role: implementor\n");
  const log = path.join(root, "calls.jsonl");
  const fake = path.join(bin, "herdr");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), op = args.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(op) + "\\n");
if (args[0] !== "--session" || args[1] !== "mdpro") process.exit(41);
if (op[0] === "agent" && op[1] === "get") {
  const delegator = op[2] === "herdr-delegator";
  process.stdout.write(JSON.stringify({result:{agent:{agent:delegator?process.env.FAKE_DELEGATOR_KIND:process.env.FAKE_TARGET_KIND,agent_status:"idle",cwd:delegator?process.env.FAKE_MAIN:process.env.FAKE_TARGET,pane_id:"w1:p7"}}}));
}
`);
  fs.chmodSync(fake, 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main,
    FAKE_DELEGATOR_KIND: kind,
    FAKE_TARGET_KIND: "codex",
    FAKE_MAIN: main,
    FAKE_TARGET: target,
    FAKE_HERDR_LOG: log,
  };
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
  const markStarted = (pane = "w1:p7") => {
    const marker = path.join(target, ".codex/rules/.started-at");
    fs.writeFileSync(marker, `${pane}\n`);
    const old = new Date(Date.now() - 2000);
    fs.utimesSync(targetOverlay, old, old);
    return marker;
  };
  const route = (args: string[] = [], moreEnv: NodeJS.ProcessEnv = {}) => run(path.join(scripts, "delegator-route.sh"), args, { ...env, ...moreEnv });
  const notify = (moreEnv: NodeJS.ProcessEnv = {}) => run(path.join(scripts, "notify-settled.sh"), ["gpt-imple-2"], { ...env, ...moreEnv });
  return { root, main, target, overlay, targetOverlay, env, calls, route, notify, markStarted };
}

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 delegator route (requires macos zsh)", () => {
  it("accepts a regular delegator overlay on Codex", async () => {
    const h = harness();
    const result = await h.route();
    expect(result).toEqual({ code: 0, stdout: "codex\n", stderr: "" });
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt")).toEqual([]);
  });

  it.each(["missing", "implementor", "symlink"])("refuses a %s delegator overlay", async (variant) => {
    const h = harness();
    if (variant === "missing") fs.unlinkSync(h.overlay);
    if (variant === "implementor") fs.writeFileSync(h.overlay, "# Local mdpro role: implementor\n");
    if (variant === "symlink") { fs.unlinkSync(h.overlay); fs.symlinkSync(h.targetOverlay, h.overlay); }
    const result = await h.route();
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/REFUSED:.*delegator overlay/);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt")).toEqual([]);
  });

  it("does not require a Codex overlay on Claude", async () => {
    const h = harness("claude");
    fs.unlinkSync(h.overlay);
    expect(await h.route()).toEqual({ code: 0, stdout: "claude\n", stderr: "" });
  });

  it("refuses a test main override outside the resolved temp directory", async () => {
    const h = harness();
    const result = await h.route([], { MDPRO_GUARD_TEST_MAIN: process.cwd() });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/REFUSED:.*test main override/);
    expect(fs.readFileSync(h.overlay, "utf8")).toBe("# Local mdpro role: delegator\n");
  });

  it("refuses a symlinked test main path that escapes tempdir", async () => {
    const h = harness();
    const outside = path.join(h.root, "escape");
    fs.symlinkSync(process.cwd(), outside);
    const result = await h.route([], { MDPRO_GUARD_TEST_MAIN: outside });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/REFUSED:.*test main override/);
  });

  it("keeps completion wake available through narrow mode without an overlay", async () => {
    const h = harness();
    fs.unlinkSync(h.overlay);
    const strict = await h.route();
    expect(strict.code).toBe(2);
    const narrow = await h.route(["--kind-only"]);
    expect(narrow.code).toBe(0);
    expect(narrow.stdout).toBe("codex\n");
    expect(narrow.stderr).toContain("WARN");
    const settled = await h.notify();
    expect(settled.code, settled.stderr).toBe(0);
    const calls = h.calls();
    expect(calls.filter((call) => call[0] === "notification" && call[1] === "show")).toHaveLength(1);
    expect(calls.filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "herdr-delegator")).toHaveLength(1);
  });
});

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 target prompt guard (requires macos zsh)", () => {
  it.each([["gpt-imple-2", "implementor"], ["opus-imple-1", "implementor"], ["gpt-auditor", "auditor"]])("prompts %s with its %s overlay and fresh pane", async (name, role) => {
    const h = harness();
    fs.writeFileSync(h.targetOverlay, `# Local mdpro role: ${role}\n`);
    h.markStarted();
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const result = await run(path.join(scripts, "prompt.sh"), [name, brief, "brief", "1000"], h.env);
    expect(result.code, result.stderr).toBe(0);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === name)).toEqual([expect.arrayContaining(["agent", "prompt", name])]);
  });

  it.each([["gpt-auditor", "implementor"], ["gpt-imple-2", "auditor"], ["opus-imple-1", "auditor"], ["gpt-stranger", "implementor"], ["gpt-auditor-2", "auditor"]])("refuses %s with %s overlay without a prompt", async (name, role) => {
    const h = harness();
    fs.writeFileSync(h.targetOverlay, `# Local mdpro role: ${role}\n`);
    h.markStarted();
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const result = await run(path.join(scripts, "prompt.sh"), [name, brief, "brief", "1000"], h.env);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("REFUSED");
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt")).toEqual([]);
  });

  it.each(["missing", "older", "wrong-pane", "malformed"])("refuses a %s start marker with zero prompts", async (variant) => {
    const h = harness();
    const marker = h.markStarted(variant === "wrong-pane" ? "w1:p8" : variant === "malformed" ? "not-a-pane" : "w1:p7");
    if (variant === "missing") fs.unlinkSync(marker);
    if (variant === "older") {
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(h.targetOverlay, future, future);
    }
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const result = await run(path.join(scripts, "prompt.sh"), ["gpt-imple-2", brief, "brief", "1000"], h.env);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("REFUSED");
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt")).toEqual([]);
  });

  it.each(["missing", "delegator", "symlink", "empty-cwd"])("refuses a Codex target with %s overlay state", async (variant) => {
    const h = harness();
    if (variant === "missing") fs.unlinkSync(h.targetOverlay);
    if (variant === "delegator") fs.writeFileSync(h.targetOverlay, "# Local mdpro role: delegator\n");
    if (variant === "symlink") { fs.unlinkSync(h.targetOverlay); fs.symlinkSync(h.overlay, h.targetOverlay); }
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const env = variant === "empty-cwd" ? { ...h.env, FAKE_TARGET: "" } : h.env;
    const result = await run(path.join(scripts, "prompt.sh"), ["gpt-imple-2", brief, "brief", "1000"], env);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/REFUSED:.*overlay|REFUSED:.*cwd/);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "gpt-imple-2")).toEqual([]);
  });

  it("prompts a Claude target without a Codex target overlay", async () => {
    const h = harness();
    fs.unlinkSync(h.targetOverlay);
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const result = await run(path.join(scripts, "prompt.sh"), ["claude-peer", brief, "request", "1000"], { ...h.env, FAKE_TARGET_KIND: "claude" });
    expect(result.code, result.stderr).toBe(0);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "claude-peer")).toHaveLength(1);
  });

  it.each(["missing", "implementor", "symlink"])("refuses prompt dispatch under a %s Codex delegator overlay", async (variant) => {
    const h = harness();
    if (variant === "missing") fs.unlinkSync(h.overlay);
    if (variant === "implementor") fs.writeFileSync(h.overlay, "# Local mdpro role: implementor\n");
    if (variant === "symlink") { fs.unlinkSync(h.overlay); fs.symlinkSync(h.targetOverlay, h.overlay); }
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const result = await run(path.join(scripts, "prompt.sh"), ["gpt-imple-2", brief, "brief", "1000"], h.env);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("delegator overlay");
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "gpt-imple-2")).toEqual([]);
  });

  it("permits a Claude delegator to prompt without its Codex overlay", async () => {
    const h = harness("claude");
    fs.unlinkSync(h.overlay);
    h.markStarted();
    const brief = path.join(h.root, "brief.md");
    fs.writeFileSync(brief, "# test brief\n");
    const result = await run(path.join(scripts, "prompt.sh"), ["gpt-imple-2", brief, "brief", "1000"], h.env);
    expect(result.code, result.stderr).toBe(0);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "gpt-imple-2")).toHaveLength(1);
  });

  it.each([
    ["missing user request", "Claude usage: sufficient\n"],
    ["missing usage", "User request: Audit this item\n"],
  ])("refuses an Opus brief with %s before prompting", async (_name, contents) => {
    const h = harness("claude");
    const brief = path.join(h.root, "opus-brief.md");
    fs.writeFileSync(brief, contents);
    const result = await run(path.join(scripts, "prompt.sh"), ["opus-auditor", brief, "request", "1000"], { ...h.env, FAKE_TARGET_KIND: "claude" });
    expect(result.code).toBe(2);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "opus-auditor")).toEqual([]);
  });

  it.each(["claude", "codex"])("applies the Opus route gate on %s", async (kind) => {
    const h = harness(kind as "claude" | "codex");
    const brief = path.join(h.root, "opus-brief.md");
    fs.writeFileSync(brief, "User request: Audit this item\nClaude usage: sufficient\n");
    const result = await run(path.join(scripts, "prompt.sh"), ["opus-auditor", brief, "request", "1000"], { ...h.env, FAKE_TARGET_KIND: "claude" });
    const prompts = h.calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === "opus-auditor");
    if (kind === "claude") {
      expect(result.code, result.stderr).toBe(0);
      expect(prompts).toHaveLength(1);
    } else {
      expect(result.code).toBe(2);
      expect(prompts).toEqual([]);
    }
  });
});
