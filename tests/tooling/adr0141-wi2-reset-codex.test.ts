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

function harness(name = "gpt-imple-2") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-reset-"));
  tempDirs.push(root);
  const main = path.join(root, "main"), wt = path.join(root, "Documents/mac-app/mdpro-wt", name), bin = path.join(root, "bin");
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
  else {
    const started = fs.existsSync(process.env.FAKE_STARTED);
    const escaped = fs.existsSync(process.env.FAKE_ESCAPED);
    process.stdout.write(JSON.stringify({id:"cli:agent:get",result:{agent:{agent:"codex",agent_status:"idle",cwd:process.env.FAKE_WT,pane_id:started?"w1:p8":"w1:p7",interactive_ready:escaped}}}));
  }
} else if (op[0] === "pane" && op[1] === "split") {
  process.stdout.write("w1:p8\\n");
} else if (op[0] === "agent" && op[1] === "start") {
  if (process.env.FAKE_START_FAIL_ONCE === "1" && !fs.existsSync(process.env.FAKE_START_TRIED)) {
    fs.writeFileSync(process.env.FAKE_START_TRIED, "yes");
    process.exit(1);
  }
  fs.writeFileSync(process.env.FAKE_STARTED, "yes");
  if (process.env.FAKE_NO_ARGV === "1") process.exit(0);
  const argv = op.slice(op.indexOf("--") + 1);
  if (process.env.FAKE_UPDATE_PROMPT !== "1") process.stdout.write(JSON.stringify({argv}));
} else if (op[0] === "pane" && op[1] === "read") {
  if (process.env.FAKE_START_FAIL_ONCE === "1" && !fs.existsSync(process.env.FAKE_STARTED)) {
    process.stdout.write("account/read failed\\n");
    process.exit(0);
  }
  process.stdout.write(process.env.FAKE_UPDATE_PROMPT === "1" && !fs.existsSync(process.env.FAKE_ESCAPED) ? "Update available ... esc skip\\n" : process.env.FAKE_BAD_STATUS === "1" ? "gpt-6-sol low · Context 0% used\\n" : "gpt-6-sol high · Context 0% used\\n");
} else if (op[0] === "pane" && op[1] === "send-keys") {
  if (op[3] === "Escape") fs.writeFileSync(process.env.FAKE_ESCAPED, "yes");
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
    HOME: root,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main,
    MDPRO_GUARD_TEST_SLEEP: "0",
    FAKE_MAIN: main,
    FAKE_WT: wt,
    FAKE_HERDR_LOG: log,
    FAKE_STARTED: path.join(root, "started"),
    FAKE_ESCAPED: path.join(root, "escaped"),
    FAKE_START_TRIED: path.join(root, "start-tried"),
  };
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
  const reset = (role?: string, moreEnv: NodeJS.ProcessEnv = {}, targetName = name, targetWt = wt) => run(script, [targetName, targetWt, "gpt-6-sol", "high", ...(role === undefined ? [] : [role])], { ...env, ...moreEnv });
  return { root, main, wt, env, calls, reset };
}

afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 reset-codex role provisioning (requires macos zsh)", () => {
  it.each([["gpt-imple-2", "implementor"], ["opus-imple-1", "implementor"], ["gpt-auditor", "auditor"]])("installs %s as %s before pane split, close and start", async (name, role) => {
    const h = harness(name);
    const result = await h.reset(role, {}, name);
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
    const marker = path.join(h.wt, ".codex/rules/.started-at");
    expect(fs.readFileSync(marker, "utf8").trim()).toBe("w1:p8");
    expect(fs.statSync(marker).mtimeMs).toBeGreaterThanOrEqual(fs.statSync(overlay).mtimeMs);
  }, 10000);

  it.each([["gpt-auditor", "implementor"], ["gpt-imple-2", "auditor"], ["opus-imple-1", "auditor"], ["gpt-stranger", "implementor"], ["gpt-auditor-2", "auditor"]])("refuses %s with requested %s before install or pane action", async (name, role) => {
    const h = harness(name);
    const result = await h.reset(role, {}, name);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("REFUSED");
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && call[1] === "start")).toEqual([]);
    expect(h.calls().flat().includes("danger-full-access")).toBe(false);
  });

  it.each(["missing", "delegator"])("refuses %s role before a pane action", async (variant) => {
    const h = harness();
    const result = await h.reset(variant === "missing" ? undefined : variant);
    expect(result.code).not.toBe(0);
    expect(h.calls().filter((call) => call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && call[1] === "start")).toEqual([]);
  });

  it.each([["gpt-auditor", "auditor", "gpt-imple-1"], ["gpt-imple-1", "implementor", "gpt-auditor"]])("refuses %s in %s worktree before install or pane action", async (name, role, wrongName) => {
    const h = harness(name);
    const wrong = path.join(h.root, "Documents/mac-app/mdpro-wt", wrongName);
    fs.mkdirSync(path.join(wrong, ".codex/rules"), { recursive: true });
    const wrongOverlay = path.join(wrong, ".codex/rules/mdpro-role.rules");
    fs.writeFileSync(wrongOverlay, "# Local mdpro role: untouched\n");
    const result = await h.reset(role, {}, name, wrong);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("REFUSED");
    expect(fs.readFileSync(wrongOverlay, "utf8")).toBe("# Local mdpro role: untouched\n");
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && ["start", "prompt"].includes(call[1]))).toEqual([]);
  });

  it.each(["gpt-imple-1", "gpt-imple-2", "gpt-imple-3", "gpt-imple-10", "opus-imple-1"])("binds %s to its own canonical worktree", async (name) => {
    const h = harness(name);
    const ok = await h.reset("implementor");
    expect(ok.code, ok.stderr + ok.stdout).toBe(0);
    const foreign = path.join(h.root, "Documents/mac-app/mdpro-wt/foreign");
    fs.mkdirSync(foreign, { recursive: true });
    const bad = await h.reset("implementor", {}, name, foreign);
    expect(bad.code).toBe(2);
    expect(h.calls().filter((call) => call[0] === "install")).toHaveLength(1);
  }, 10000);

  it("accepts a symlink to the named worktree", async () => {
    const h = harness("gpt-imple-1");
    const alias = path.join(h.root, "alias");
    fs.symlinkSync(h.wt, alias);
    const result = await h.reset("implementor", {}, "gpt-imple-1", alias);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(h.calls().find((call) => call[0] === "pane" && call[1] === "split")).toContain(alias);
  }, 10000);

  it("requires and echoes an explicit opus-imple-1 worktree override", async () => {
    const h = harness("opus-imple-1");
    const other = path.join(h.root, "other-item");
    fs.mkdirSync(path.join(other, ".codex/rules"), { recursive: true });
    fs.writeFileSync(path.join(other, ".codex/rules/mdpro.rules"), "# shared rules\n");
    const denied = await h.reset("implementor", { FAKE_WT: other }, "opus-imple-1", other);
    expect(denied.code).toBe(2);
    const accepted = await h.reset("implementor", { FAKE_WT: other, MDPRO_WORKTREE_OVERRIDE: other }, "opus-imple-1", other);
    expect(accepted.code, accepted.stderr + accepted.stdout).toBe(0);
    expect(accepted.stderr + accepted.stdout).toContain(other);
    expect(fs.readFileSync(path.join(other, ".codex/rules/mdpro-role.rules"), "utf8")).toContain("implementor");
  }, 10000);

  it("refuses an override for a different name or nonexistent path", async () => {
    const h = harness("gpt-imple-1");
    const other = path.join(h.root, "other-item");
    fs.mkdirSync(other);
    const unauthorized = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: other });
    expect(unauthorized.code).toBe(2);
    const missing = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: path.join(h.root, "missing") }, "opus-imple-1");
    expect(missing.code).toBe(2);
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" && call[1] === "split")).toEqual([]);
  });

  it("skips an update prompt before pane verification and writes the marker", async () => {
    const h = harness();
    const result = await h.reset("implementor", { FAKE_UPDATE_PROMPT: "1" });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const calls = h.calls();
    const escape = calls.findIndex((call) => call[0] === "pane" && call[1] === "send-keys" && call[3] === "Escape");
    const firstStatusRead = calls.findIndex((call, index) => index > escape && call[0] === "pane" && call[1] === "read");
    expect(escape).toBeGreaterThanOrEqual(0);
    expect(firstStatusRead).toBeGreaterThan(escape);
    expect(calls.filter((call) => call[0] === "pane" && call[1] === "send-keys" && call[3] === "Enter")).toEqual([]);
    expect(fs.readFileSync(path.join(h.wt, ".codex/rules/.started-at"), "utf8")).toBe("w1:p8\n");
  });

  it("verifies from the pane after a bootstrap retry when real get has no argv", async () => {
    const h = harness();
    const result = await h.reset("implementor", { FAKE_UPDATE_PROMPT: "1", FAKE_START_FAIL_ONCE: "1" });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(h.calls().filter((call) => call[0] === "agent" && call[1] === "start")).toHaveLength(2);
    expect(fs.readFileSync(path.join(h.wt, ".codex/rules/.started-at"), "utf8")).toBe("w1:p8\n");
  });

  it("names the unwritten marker when argv verification fails after start", async () => {
    const h = harness();
    const result = await h.reset("implementor", { FAKE_NO_ARGV: "1", FAKE_BAD_STATUS: "1" });
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("marker not written");
    expect(fs.existsSync(path.join(h.wt, ".codex/rules/.started-at"))).toBe(false);
  });

  it("refuses Opus override into another roster worktree, including an alias", async () => {
    const h = harness("opus-imple-1");
    for (const foreignName of ["gpt-auditor", "gpt-imple-2"]) {
      const foreign = path.join(h.root, "Documents/mac-app/mdpro-wt", foreignName);
      fs.mkdirSync(path.join(foreign, ".codex/rules"), { recursive: true });
      fs.writeFileSync(path.join(foreign, ".codex/rules/mdpro.rules"), "# shared rules\n");
      const alias = path.join(h.root, `${foreignName}-alias`);
      fs.symlinkSync(foreign, alias);
      for (const override of [foreign, alias]) {
        const result = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: override, FAKE_WT: override }, "opus-imple-1", override);
        expect(result.code, result.stderr + result.stdout).toBe(2);
      }
    }
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" || call[0] === "agent" && call[1] === "start")).toEqual([]);
  });

  it("refuses nested and aliased foreign roster overrides without touching panes", async () => {
    const h = harness("opus-imple-1");
    const foreign = path.join(h.root, "Documents/mac-app/mdpro-wt/gpt-imple-2");
    const nested = path.join(foreign, "nested");
    fs.mkdirSync(path.join(nested, ".codex/rules"), { recursive: true });
    fs.writeFileSync(path.join(nested, ".codex/rules/mdpro.rules"), "# shared rules\n");
    const alias = path.join(h.root, "nested-alias");
    fs.symlinkSync(nested, alias);
    for (const override of [nested, alias]) {
      const result = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: override, FAKE_WT: override }, "opus-imple-1", override);
      expect(result.code, result.stderr + result.stdout).toBe(2);
    }
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" || call[0] === "agent" && call[1] === "start")).toEqual([]);
  });

  it("refuses the delegator checkout and accepts a roster-like sibling prefix", async () => {
    const h = harness("opus-imple-1");
    const checkout = path.join(h.root, "Documents/mac-app/mdpro");
    const sibling = path.join(h.root, "Documents/mac-app/mdpro-wt/gpt-imple-2x");
    for (const dir of [checkout, sibling]) {
      fs.mkdirSync(path.join(dir, ".codex/rules"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".codex/rules/mdpro.rules"), "# shared rules\n");
    }
    const refused = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: checkout, FAKE_WT: checkout }, "opus-imple-1", checkout);
    expect(refused.code, refused.stderr + refused.stdout).toBe(2);
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane")).toEqual([]);
    const accepted = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: sibling, FAKE_WT: sibling }, "opus-imple-1", sibling);
    expect(accepted.code, accepted.stderr + accepted.stdout).toBe(0);
  });

  it("refuses a case-variant spelling of another roster worktree", async () => {
    const h = harness("opus-imple-1");
    const foreign = path.join(h.root, "Documents/mac-app/mdpro-wt/gpt-imple-2");
    fs.mkdirSync(foreign, { recursive: true });
    const variant = path.join(h.root, "Documents/mac-app/MDPRO-WT/GPT-IMPLE-2");
    if (!fs.existsSync(variant)) return;
    const result = await h.reset("implementor", { MDPRO_WORKTREE_OVERRIDE: variant, FAKE_WT: variant }, "opus-imple-1", variant);
    expect(result.code, result.stderr + result.stdout).toBe(2);
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane")).toEqual([]);
  });

  it.each([["gpt-auditor", "auditor"], ["gpt-imple-2", "implementor"]])("refuses a symlinked expected %s directory", async (name, role) => {
    const h = harness(name);
    const foreign = path.join(h.root, "foreign-roster");
    fs.renameSync(h.wt, foreign);
    fs.symlinkSync(foreign, h.wt);
    const result = await h.reset(role);
    expect(result.code, result.stderr + result.stdout).toBe(2);
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" || call[0] === "agent" && call[1] === "start")).toEqual([]);
  });

  it("starts gpt-auditor device mode with auditor overlay, full access, and a mode marker", async () => {
    const h = harness("gpt-auditor");
    const result = await h.reset("device");
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(fs.readFileSync(path.join(h.wt, ".codex/rules/mdpro-role.rules"), "utf8").split("\n")[0]).toBe("# Local mdpro role: auditor");
    expect(fs.readFileSync(path.join(h.wt, ".codex/rules/.started-at"), "utf8")).toContain("mode=device");
    const start = h.calls().find((call) => call[0] === "agent" && call[1] === "start")!;
    expect(start).toContain("danger-full-access");
  }, 10000);

  it("a later auditor reset removes device privilege and mode", async () => {
    const h = harness("gpt-auditor");
    const device = await h.reset("device");
    expect(device.code, device.stderr + device.stdout).toBe(0);
    const audit = await h.reset("auditor");
    expect(audit.code, audit.stderr + audit.stdout).toBe(0);
    const starts = h.calls().filter((call) => call[0] === "agent" && call[1] === "start");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toContain("danger-full-access");
    expect(starts[1]).not.toContain("danger-full-access");
    expect(fs.readFileSync(path.join(h.wt, ".codex/rules/.started-at"), "utf8")).toBe("w1:p8\n");
  }, 15000);

  it.each(["gpt-imple-1", "gpt-imple-10", "opus-imple-1", "opus-auditor", "gpt-auditor-2"])("refuses device mode for %s before install or pane action", async (name) => {
    const h = harness(name);
    const result = await h.reset("device");
    expect(result.code).toBe(2);
    expect(h.calls().filter((call) => call[0] === "install" || call[0] === "pane" && ["split", "close"].includes(call[1]) || call[0] === "agent" && call[1] === "start")).toEqual([]);
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
