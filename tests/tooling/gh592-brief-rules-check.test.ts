// @vitest-environment node
/**
 * Purpose: GH592. prompt.sh refuses a Codex implementor brief whose May edit / May create scope matches rule 22's or rule
 * 50's `paths:` frontmatter unless its `Rules for paths in scope` field names that rule. Each case runs the real scripts
 * copied into a temp tree, so fixture rules resolve exactly as in production (relative to the script), and only `herdr`
 * is stubbed on PATH. Matrix: ~/.mdpro-redesign/herdr-spike/opus-imple-1/GH592-test-matrix.md.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SK = ".agents/skills/mdpro-delegator/scripts";
const COPIED = ["prompt.sh", "delegator-route.sh", "agent-role.sh", "notify-settled.sh", "brief-rules-check.py"];
const RULES = ["22-comment-maintenance.md", "50-codebase-conventions.md"];
const TOP = ["src", "src-tauri", "tests", "scripts", "docs"];
const dirs: string[] = [];

type Result = { code: number; stdout: string; stderr: string };
type Opts = { name?: string; kind?: "codex" | "claude"; role?: string; delegator?: "codex" | "claude"; shape?: "top" | "session"; cwd?: string };

function exec(file: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function harness(opts: Opts = {}) {
  const name = opts.name ?? "gpt-imple-2", kind = opts.kind ?? "codex", role = opts.role ?? "implementor";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-"));
  dirs.push(root);
  const repo = path.join(root, "repo"), scripts = path.join(repo, SK), rules = path.join(repo, ".claude/rules");
  const target = path.join(root, "Documents/mac-app/mdpro-wt", name), bin = path.join(root, "bin"), main = path.join(root, "main");
  for (const dir of [scripts, rules, bin, path.join(target, ".codex/rules"), path.join(main, ".codex/rules")]) fs.mkdirSync(dir, { recursive: true });
  for (const file of COPIED) {
    const source = path.join(SK, file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(scripts, file));
    fs.chmodSync(path.join(scripts, file), 0o755);
  }
  for (const file of RULES) fs.copyFileSync(path.join(".claude/rules", file), path.join(rules, file));
  for (const dir of TOP) fs.mkdirSync(path.join(repo, dir), { recursive: true });
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "# Changelog\n");
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  const overlay = path.join(target, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(overlay, `# Local mdpro role: ${role}\n`);
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(overlay, old, old);
  fs.writeFileSync(path.join(target, ".codex/rules/.started-at"), "w1:p7\n");
  const log = path.join(root, "calls.jsonl");
  fs.writeFileSync(path.join(bin, "herdr"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), op = args.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(op) + "\\n");
if (args[0] !== "--session" || args[1] !== "mdpro") process.exit(41);
if (op[0] === "agent" && op[1] === "get") {
  const delegator = op[2] === "herdr-delegator";
  const kind = delegator ? process.env.FAKE_DELEGATOR_KIND : process.env.FAKE_TARGET_KIND;
  const agent = { agent_status: "idle", cwd: delegator ? process.env.FAKE_MAIN : process.env.FAKE_TARGET, pane_id: "w1:p7" };
  if (!delegator && process.env.FAKE_SHAPE === "session") agent.agent_session = { agent: kind }; else agent.agent = kind;
  process.stdout.write(JSON.stringify({ result: { agent } }));
}
`);
  fs.chmodSync(path.join(bin, "herdr"), 0o755);
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH ?? ""}`, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: main,
    FAKE_DELEGATOR_KIND: opts.delegator ?? "claude", FAKE_TARGET_KIND: kind, FAKE_MAIN: main, FAKE_TARGET: target,
    FAKE_HERDR_LOG: log, FAKE_SHAPE: opts.shape ?? "top",
  };
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
  const prompts = () => calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === name);
  const reset = () => fs.rmSync(log, { force: true });
  const write = (text: string, file = "brief.md") => { const p = path.join(root, file); fs.writeFileSync(p, text); return p; };
  const rule = (n: 22 | 50) => path.join(rules, RULES[n === 22 ? 0 : 1]);
  const setPaths = (n: 22 | 50, globs: string[]) => {
    const text = fs.readFileSync(rule(n), "utf8");
    fs.writeFileSync(rule(n), text.replace(/^paths:\n(?:  - .*\n)+/m, `paths:\n${globs.map((g) => `  - "${g}"`).join("\n")}\n`));
  };
  const send = (brief: string, verb = "brief", more: string[] = [], moreEnv: NodeJS.ProcessEnv = {}) =>
    exec(path.join(scripts, "prompt.sh"), [name, brief, verb, "1000", ...more], { ...env, ...moreEnv }, opts.cwd);
  const codexText = (f: string) => `herdr-delegator: read ${f} and everything it names, then do it with $tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop.`;
  const expectSent = (result: Result, f: string) => {
    expect(result.code, result.stderr).toBe(0);
    expect(prompts()).toEqual([["agent", "prompt", name, codexText(f), "--wait", "--timeout", "1000"]]);
  };
  const expectRefused = (result: Result, pattern: RegExp) => {
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(pattern);
    expect(prompts()).toEqual([]);
  };
  return { name, root, repo, rules, target, env, calls, prompts, reset, write, rule, setPaths, send, expectSent, expectRefused };
}

/** A grant in brief-template shape: the field paragraph (omitted when null), then § 2 with the scope lines. */
function grant(scope: string, field: string | null, extra = ""): string {
  const fieldText = field === null ? "" : `**Rules for paths in scope.** ${field}. Before editing any matching path, open each rule\nnamed for that path in AGENTS.md. Issue 592 checks it.\n\n`;
  return `# X1: a test item (2026-11-03, herdr-delegator)\n\n**Tier: Low** (test). **Difficulty: routine** (test).\n\n${fieldText}## 1. Background\n- **The issue.** none.\n\n## 2. Scope\n- Worktree \`mdpro-wt/gpt-imple-2\`; branch \`chore/x1-test\` from \`origin/master\` (\`abc1234\`).\n${scope}\n- Anything else: stop and ask.\n\n${extra}`;
}

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("GH592 brief rules check (requires macos zsh)", () => {
  it("C2 AC-1: adding docs/** to rule 50's paths: frontmatter makes a docs scope require rule 50", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `docs/x.md`.", "rule 22"));
    h.expectSent(await h.send(brief), brief);
    h.reset();
    h.setPaths(50, ["src/**", "src-tauri/**", "tests/**", "docs/**"]);
    h.expectRefused(await h.send(brief), /REFUSED:.*rule 50/);
  });

  it("C39 AC-2: the template's \"their tests\" adds tests/**, so a scripts grant in template wording needs rule 50 too", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `scripts/x.mjs`, their tests, the X1 row, `CHANGELOG.md` `[Unreleased]`.", "rule 22"));
    h.expectRefused(await h.send(brief), /REFUSED:.*rule 50 .*their tests/);
  });
  const FENCES: Array<[string, string, string]> = [["```", "```", "backtick"], ["~~~", "~~~", "tilde"], ["````", "````", "four-backtick around ```"]];
  it.each(FENCES)("C13 AC-2: a field inside a %s fence is not the field (closed by %s)", async (open, close, label) => {
    const h = harness();
    const inner = label.startsWith("four") ? "```\n" : "";
    const fenced = `${open}markdown\n${inner}**Rules for paths in scope.** rule 22, rule 50.\n${inner}${close}\n`;
    const brief = h.write(grant("- **May edit:** `src/a.ts`.", null, fenced));
    h.expectRefused(await h.send(brief), /REFUSED:.*exactly one \*\*Rules for paths in scope\.\*\* field, found 0/);
  });

  it.each(FENCES)("C13 AC-2: a May edit inside a %s fence is not scope (closed by %s)", async (open, close, label) => {
    const h = harness();
    const inner = label.startsWith("four") ? "```\n" : "";
    const fenced = `${open}markdown\n${inner}- **May edit:** \`docs/x.md\`.\n${inner}${close}\n`;
    const brief = h.write(grant("- Scope: as below.", "rule 22, rule 50", fenced));
    h.expectRefused(await h.send(brief), /REFUSED:.*no \*\*May edit:\*\* paragraph/);
  });
  it("C56b AC-2: a field marker quoted in a code span is a mention, not the field", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `src/a.ts`.", null, "The template's `**Rules for paths in scope.** rule 22, rule 50` line is new.\n"));
    h.expectRefused(await h.send(brief), /REFUSED:.*exactly one \*\*Rules for paths in scope\.\*\* field, found 0/);
  });

  it("C56b AC-5: a May edit marker quoted in a code span is a mention, not scope", async () => {
    const h = harness();
    const brief = h.write(grant("- Scope: the brief's `**May edit:** `docs/x.md`` line.", "rule 22, rule 50"));
    h.expectRefused(await h.send(brief), /REFUSED:.*no \*\*May edit:\*\* paragraph/);
  });
  // next-case
});
