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
import { vi } from "vitest";
import { afterAll } from "vitest";

// Each case spawns zsh, python3 and the stub herdr several times; a two-send case can pass 5 s on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });
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

let cache: string | null = null;
/**
 * One tree per run: the fake herdr, and the repo copy every harness resets and reuses. macOS scans an executable the
 * first time it runs at a new path (~0.45 s, even through a hard link), so the executables keep one path for the run.
 */
function exeCache(): string {
  if (cache) return cache;
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-exe-"));
  fs.mkdirSync(path.join(cache, "bin"));
  fs.writeFileSync(path.join(cache, "bin/herdr"), `#!/usr/bin/env node
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
  fs.chmodSync(path.join(cache, "bin/herdr"), 0o755);
  return cache;
}

/** The shared repo copy, reset to the checkout's scripts and rules: only an executable whose bytes changed is rewritten. */
function freshRepo(): string {
  const repo = path.join(exeCache(), "repo"), scripts = path.join(repo, SK);
  fs.mkdirSync(scripts, { recursive: true });
  for (const entry of fs.readdirSync(repo)) if (entry !== ".agents") fs.rmSync(path.join(repo, entry), { recursive: true, force: true });
  for (const entry of fs.readdirSync(scripts)) if (!COPIED.includes(entry)) fs.rmSync(path.join(scripts, entry), { recursive: true, force: true });
  for (const file of COPIED) {
    const source = path.join(SK, file), copy = path.join(scripts, file);
    if (!fs.existsSync(source)) { fs.rmSync(copy, { force: true }); continue; }
    // Untouched, not even chmod: a ctime change makes macOS scan the file again.
    if (fs.existsSync(copy) && (fs.statSync(copy).mode & 0o777) === 0o755 && fs.readFileSync(copy).equals(fs.readFileSync(source))) continue;
    fs.rmSync(copy, { force: true });
    fs.copyFileSync(source, copy);
    fs.chmodSync(copy, 0o755);
  }
  return repo;
}

function harness(opts: Opts = {}) {
  const name = opts.name ?? "gpt-imple-2", kind = opts.kind ?? "codex", role = opts.role ?? "implementor";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-"));
  dirs.push(root);
  const repo = freshRepo(), scripts = path.join(repo, SK), rules = path.join(repo, ".claude/rules");
  const target = path.join(root, "Documents/mac-app/mdpro-wt", name), bin = path.join(root, "bin"), main = path.join(root, "main");
  for (const dir of [scripts, rules, bin, path.join(target, ".codex/rules"), path.join(main, ".codex/rules")]) fs.mkdirSync(dir, { recursive: true });
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
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: root, PATH: `${bin}:${path.join(exeCache(), "bin")}:${process.env.PATH ?? ""}`, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: main,
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

/** Captured once from prompt.sh at base a3e9b7ec in this harness (<ROOT> is the harness root); never read from git. */
const PRE_CHANGE: Record<string, { stdout: string; stderr: string; calls: string[][] }> = {
  "claude auditor-request": {"stdout": "Herdr completion: gpt-auditor is idle. Read the gpt-auditor handoff or pane\n", "stderr": "", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "gpt-auditor"], ["agent", "prompt", "gpt-auditor", "herdr-delegator: read /Users/jack/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md, then the request <ROOT>/req.md. Do what it describes, write the report to the path it names, then stop.", "--wait", "--timeout", "1000"], ["agent", "get", "gpt-auditor"], ["agent", "get", "herdr-delegator"]]},
  "claude device-brief": {"stdout": "Herdr completion: gpt-auditor is idle. Read the gpt-auditor handoff or pane\n", "stderr": "", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "gpt-auditor"], ["agent", "prompt", "gpt-auditor", "herdr-delegator: read <ROOT>/.mdpro-redesign/device/b-brief.md and everything it names, then do it with $tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop.", "--wait", "--timeout", "1000"], ["agent", "get", "gpt-auditor"], ["agent", "get", "herdr-delegator"]]},
  "claude claude-brief": {"stdout": "Herdr completion: opus-imple-1 is idle. Read the opus-imple-1 handoff or pane\n", "stderr": "", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "opus-imple-1"], ["agent", "prompt", "opus-imple-1", "herdr-delegator: read <ROOT>/brief.md and everything it names, then do it by rule 71 § Briefs for Claude: design the test matrix yourself, have a fresh independent subagent attack it with .agents/skills/mdpro-delegator/references/templates/matrix-attack-prompt.md (ATTACK-NOT-RUN if it cannot run), and record each RED with the rule 10 receipt CLI, node scripts/tdd/red-receipt.mjs. Write the handoff it names and stop.", "--wait", "--timeout", "1000"], ["agent", "get", "opus-imple-1"], ["agent", "get", "herdr-delegator"]]},
  "claude codex-impl-report": {"stdout": "Herdr completion: gpt-imple-2 is idle. Report missing: /var/folders/x/report.md; inspect the gpt-imple-2 pane\n", "stderr": "", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "gpt-imple-2"], ["agent", "prompt", "gpt-imple-2", "herdr-delegator: read <ROOT>/brief.md and everything it names, then do it with $tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop.", "--wait", "--timeout", "1000"], ["agent", "get", "gpt-imple-2"], ["agent", "get", "herdr-delegator"]]},
  "codex auditor-request": {"stdout": "", "stderr": "WARN: Codex completion route skipped delegator overlay check\nWARN: Codex completion route skipped delegator overlay check\n", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "gpt-auditor"], ["agent", "prompt", "gpt-auditor", "herdr-delegator: read /Users/jack/.mdpro-redesign/herdr-spike/gpt-auditor/BRIEF.md, then the request <ROOT>/req.md. Do what it describes, write the report to the path it names, then stop.", "--wait", "--timeout", "1000"], ["agent", "get", "gpt-auditor"], ["agent", "get", "herdr-delegator"], ["notification", "show", "mdpro: gpt-auditor idle", "--body", "Read the gpt-auditor handoff or pane", "--sound", "done"], ["agent", "get", "herdr-delegator"], ["agent", "get", "herdr-delegator"], ["agent", "prompt", "herdr-delegator", "Herdr completion: gpt-auditor is idle. Read the gpt-auditor handoff or pane Read its handoff or pane, update heartbeat, and continue the delegator queue."]]},
  "codex device-brief": {"stdout": "", "stderr": "WARN: Codex completion route skipped delegator overlay check\nWARN: Codex completion route skipped delegator overlay check\n", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "gpt-auditor"], ["agent", "prompt", "gpt-auditor", "herdr-delegator: read <ROOT>/.mdpro-redesign/device/b-brief.md and everything it names, then do it with $tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop.", "--wait", "--timeout", "1000"], ["agent", "get", "gpt-auditor"], ["agent", "get", "herdr-delegator"], ["notification", "show", "mdpro: gpt-auditor idle", "--body", "Read the gpt-auditor handoff or pane", "--sound", "done"], ["agent", "get", "herdr-delegator"], ["agent", "get", "herdr-delegator"], ["agent", "prompt", "herdr-delegator", "Herdr completion: gpt-auditor is idle. Read the gpt-auditor handoff or pane Read its handoff or pane, update heartbeat, and continue the delegator queue."]]},
  "codex claude-brief": {"stdout": "", "stderr": "WARN: Codex completion route skipped delegator overlay check\nWARN: Codex completion route skipped delegator overlay check\n", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "opus-imple-1"], ["agent", "prompt", "opus-imple-1", "herdr-delegator: read <ROOT>/brief.md and everything it names, then do it by rule 71 § Briefs for Claude: design the test matrix yourself, have a fresh independent subagent attack it with .agents/skills/mdpro-delegator/references/templates/matrix-attack-prompt.md (ATTACK-NOT-RUN if it cannot run), and record each RED with the rule 10 receipt CLI, node scripts/tdd/red-receipt.mjs. Write the handoff it names and stop.", "--wait", "--timeout", "1000"], ["agent", "get", "opus-imple-1"], ["agent", "get", "herdr-delegator"], ["notification", "show", "mdpro: opus-imple-1 idle", "--body", "Read the opus-imple-1 handoff or pane", "--sound", "done"], ["agent", "get", "herdr-delegator"], ["agent", "get", "herdr-delegator"], ["agent", "prompt", "herdr-delegator", "Herdr completion: opus-imple-1 is idle. Read the opus-imple-1 handoff or pane Read its handoff or pane, update heartbeat, and continue the delegator queue."]]},
  "codex codex-impl-report": {"stdout": "", "stderr": "WARN: Codex completion route skipped delegator overlay check\nWARN: Codex completion route skipped delegator overlay check\n", "calls": [["agent", "get", "herdr-delegator"], ["agent", "get", "gpt-imple-2"], ["agent", "prompt", "gpt-imple-2", "herdr-delegator: read <ROOT>/brief.md and everything it names, then do it with $tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop.", "--wait", "--timeout", "1000"], ["agent", "get", "gpt-imple-2"], ["agent", "get", "herdr-delegator"], ["notification", "show", "mdpro: gpt-imple-2 idle", "--body", "Report missing: /var/folders/x/report.md; inspect the gpt-imple-2 pane", "--sound", "done"], ["agent", "get", "herdr-delegator"], ["agent", "get", "herdr-delegator"], ["agent", "prompt", "herdr-delegator", "Herdr completion: gpt-imple-2 is idle. Report missing: /var/folders/x/report.md; inspect the gpt-imple-2 pane Read its handoff or pane, update heartbeat, and continue the delegator queue."]]},
};

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
afterAll(() => { if (cache) fs.rmSync(cache, { recursive: true, force: true }); cache = null; });

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
  it("C63 AC-2: a src path granted only under May create still needs rule 50", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `docs/x.md`.\n- **May create:** `src/components/New.tsx`.", "rule 22"));
    h.expectRefused(await h.send(brief), /REFUSED:.*rule 50 .*src\/components\/New\.tsx/);
  });

  it("C64 AC-3: a brief whose only scope is May create is a valid scope", async () => {
    const h = harness();
    const brief = h.write(grant("- **May create:** `scripts/new.mjs`.", "rule 22"));
    h.expectSent(await h.send(brief), brief);
  });
  const BAD_TOKENS = ["/Users/x/src/a.ts", "~/src/a.ts", "docs/../src/a.ts", "{src,docs}/**", "src/{a,b}.tsx", "node scripts/x.mjs"];
  it.each(BAD_TOKENS.flatMap((token) => [["May edit", token], ["May create", token]]))("C16/C45/C55/C72 AC-5: a %s token %s refuses even beside a valid one and with both rules named", async (label, token) => {
    const h = harness();
    const scope = label === "May edit" ? `- **May edit:** \`docs/a.md\`, \`${token}\`.` : `- **May edit:** \`docs/a.md\`.\n- **May create:** \`${token}\`.`;
    const brief = h.write(grant(scope, "rule 22, rule 50"));
    const result = await h.send(brief);
    h.expectRefused(result, /REFUSED:.*scope path/);
    expect(result.stderr).toContain(token);
  });
  const UNRESOLVABLE = ["tooling/x.test.ts", "tooling/", "hooks/", "components", "stores", "tool*/x.test.ts", "references/codex-panes.md"];
  it.each(UNRESOLVABLE.flatMap((token) => [["May edit", token], ["May create", token]]))("C60/C62/C68/C69/C73a AC-5: a %s token %s whose first segment is no top-level entry refuses as unresolvable", async (label, token) => {
    const h = harness();
    const scope = label === "May edit" ? `- **May edit:** \`src/a.ts\`, \`${token}\`.` : `- **May edit:** \`src/a.ts\`.\n- **May create:** \`${token}\`.`;
    const result = await h.send(h.write(grant(scope, "rule 22, rule 50")));
    h.expectRefused(result, /REFUSED:.*unresolvable/);
    expect(result.stderr).toContain(`'${token}'`);
    expect(result.stderr).not.toContain("'src/a.ts'");
  });

  it("C66a AC-5: top-level entries come from the script's own tree, not a fixed list", async () => {
    const h = harness();
    fs.rmSync(path.join(h.repo, "docs"), { recursive: true });
    fs.mkdirSync(path.join(h.repo, "zz-extra"));
    const extra = h.write(grant("- **May edit:** `zz-extra/a.md`.", "none"), "extra.md");
    h.expectSent(await h.send(extra), extra);
    h.reset();
    const result = await h.send(h.write(grant("- **May edit:** `docs/x.md`.", "none")));
    h.expectRefused(result, /REFUSED:.*unresolvable.*'docs\/x\.md'/);
  });

  it("C66b AC-5: a top-level entry that exists only in the cwd, the target worktree or the test main is still unresolvable", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-cwd-"));
    dirs.push(cwd);
    const h = harness({ cwd });
    for (const dir of [cwd, h.target, String(h.env.MDPRO_GUARD_TEST_MAIN)]) fs.mkdirSync(path.join(dir, "yy-decoy"));
    const result = await h.send(h.write(grant("- **May edit:** `yy-decoy/a.md`.", "none")));
    h.expectRefused(result, /REFUSED:.*unresolvable.*'yy-decoy\/a\.md'/);
  });
  const LABELS = ["**May create or edit:** `src/components/New.tsx`.", "- **May create, newly granted:** `src/components/New.tsx`.", "- **May create** tests: `src/components/New.tsx`.",
    "May create: `src/components/New.tsx`.", "- May create or edit: `src/components/New.tsx`.", "**May extend** `src/components/New.tsx`."];
  it.each(LABELS)("C74a-f AC-5: the label in %s is not one of the two scope labels and refuses as unrecognised", async (line) => {
    const h = harness();
    const result = await h.send(h.write(grant(`- **May edit:** \`docs/x.md\`.\n${line}`, "rule 22, rule 50")));
    h.expectRefused(result, /REFUSED:.*unrecognised scope label/);
    expect(result.stderr).toContain(line.replace(/^- /, "").split(/[:`]/)[0].replace(/\*\*/g, "").trim());
  });
  const NAMED: Array<[string, string]> = [["the stem, any case", "22-Comment-Maintenance, 50-CODEBASE-conventions"],
    ["the rule path", "`.claude/rules/22-comment-maintenance.md` and `.claude/rules/50-codebase-conventions.md`"],
    ["a mix of forms", "Rule 22 and `.claude/rules/50-codebase-conventions.md`"]];
  it.each(NAMED)("C20 AC-3: the field may name a rule by %s", async (_label, field) => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `src/a.ts`, `scripts/b.mjs`.", field));
    h.expectSent(await h.send(brief), brief);
  });

  it("C47 AC-3: after a rename the stem is read from the matched rule file", async () => {
    const h = harness();
    fs.renameSync(h.rule(22), path.join(h.rules, "22-comment-upkeep.md"));
    const brief = h.write(grant("- **May edit:** `scripts/b.mjs`.", "22-comment-upkeep"));
    h.expectSent(await h.send(brief), brief);
  });
  const SAME: Array<[string, string]> = [["alone", "- Same paths as the grant."],
    ["with only a May create", "- Same paths as the grant.\n- **May create:** `docs/new.md`."]];
  it.each(SAME)("C29/C36 AC-5: a fix brief saying \"Same paths as the grant\" %s refuses until it copies the grant's May edit", async (_label, scope) => {
    const h = harness();
    const result = await h.send(h.write(grant(scope, "rule 22, rule 50")));
    h.expectRefused(result, /REFUSED:.*copy the grant's \*\*May edit:\*\*/);
  });

  it("C75b AC-5: \"Same paths as the grant\" beside a copied May edit is sent", async () => {
    const h = harness();
    const brief = h.write(grant("- Same paths as the grant.\n- **May edit:** `src/a.ts`.", "rule 22, rule 50"));
    h.expectSent(await h.send(brief), brief);
  });
  const EMPTY: Array<[string, string, string]> = [
    ["C37 a May edit with no backticked path", "- **May edit:** the files you need.", "May edit"],
    ["C65 a May create with no backticked path", "- **May create:** whatever the tests need.", "May create"],
    ["C71 an empty May create beside a valid May edit", "- **May edit:** `docs/x.md`.\n- **May create:** new tests as needed.", "May create"],
    ["C71 an empty May edit beside a valid May create", "- **May edit:** what you touch.\n- **May create:** `docs/new.md`.", "May edit"]];
  it.each(EMPTY)("C37/C65/C71 AC-5: %s refuses, naming its label", async (_label, scope, label) => {
    const h = harness();
    const result = await h.send(h.write(grant(scope, "rule 22, rule 50")));
    h.expectRefused(result, new RegExp(`REFUSED:.*\\*\\*${label}:\\*\\* paragraph names no backticked path`));
  });
  const PROSE: Array<[string, string]> = [["May edit", "- **May edit:** `docs/x.md` and src/a.ts."],
    ["May create", "- **May edit:** `docs/x.md`.\n- **May create:** `docs/y.md`, scripts/new.mjs."]];
  it.each(PROSE)("C38/C72d AC-5: a path without backticks in a %s paragraph refuses as not backticked", async (_label, scope) => {
    const h = harness();
    const result = await h.send(h.write(grant(scope, "rule 22, rule 50")));
    h.expectRefused(result, /REFUSED:.*scope path not backticked: '(src\/a\.ts|scripts\/new\.mjs)'/);
  });
  // ---- AC-4: exempt targets keep the pre-change sequence (raw-green by design: they pin what must not change) ----
  type Exempt = "auditor-request" | "device-brief" | "claude-brief";
  const EXEMPT: Record<Exempt, { opts: Opts; verb: string; file: string }> = {
    "auditor-request": { opts: { name: "gpt-auditor", role: "auditor" }, verb: "request", file: "req.md" },
    "device-brief": { opts: { name: "gpt-auditor", role: "auditor" }, verb: "brief", file: ".mdpro-redesign/device/b-brief.md" },
    "claude-brief": { opts: { name: "opus-imple-1", kind: "claude" }, verb: "brief", file: "brief.md" },
  };
  const exemptHarness = (label: Exempt, delegator: "claude" | "codex") => {
    const h = harness({ ...EXEMPT[label].opts, delegator });
    if (label === "device-brief") {
      fs.writeFileSync(path.join(h.target, ".codex/rules/.started-at"), "w1:p7 mode=device\n");
      fs.mkdirSync(path.join(h.root, ".mdpro-redesign/device"), { recursive: true });
    }
    return h;
  };
  const expectPreChange = (h: ReturnType<typeof harness>, result: Result, key: string) => {
    const strip = (text: string) => text.split(h.root).join("<ROOT>");
    expect(result.code, result.stderr).toBe(0);
    expect({ stdout: strip(result.stdout), stderr: strip(result.stderr), calls: h.calls().map((call) => call.map(strip)) }).toEqual(PRE_CHANGE[key]);
  };
  const SEQUENCES: Array<["claude" | "codex", Exempt | "codex-impl-report"]> = [];
  for (const delegator of ["claude", "codex"] as const) for (const label of ["auditor-request", "device-brief", "claude-brief", "codex-impl-report"] as const) SEQUENCES.push([delegator, label]);
  it.each(SEQUENCES)("C57/C18/C23-C26 AC-4: under a %s delegator, %s keeps the full pre-change herdr sequence and output", async (delegator, label) => {
    const h = label === "codex-impl-report" ? harness({ delegator }) : exemptHarness(label, delegator);
    const spec = label === "codex-impl-report" ? { verb: "brief", file: "brief.md" } : EXEMPT[label];
    const brief = h.write(grant("- **May edit:** `docs/x.md`.", "rule 22, rule 50"), spec.file);
    const more = label === "codex-impl-report" ? ["/var/folders/x/report.md"] : [];
    expectPreChange(h, await h.send(brief, spec.verb, more), `${delegator} ${label}`);
  });

  it.each(Object.keys(EXEMPT) as Exempt[])("C48/C74h AC-4: %s ignores a broken rule, an unreadable file, bad tokens and an unknown label", async (label) => {
    const variants: Array<[string, (h: ReturnType<typeof harness>, f: string) => void, string]> = [
      ["no rule 22 file", (h) => fs.rmSync(h.rule(22)), grant("- **May edit:** `src/a.ts`.", null)],
      ["unreadable file", (_h, f) => fs.chmodSync(f, 0o000), grant("- **May edit:** `src/a.ts`.", null)],
      ["bad tokens", () => undefined, grant("- **May edit:** `tooling/x.test.ts`.\n- **May create:** `components/New.tsx`.", null)],
      ["unknown label", () => undefined, grant("- **May edit:** `docs/x.md`.\n**May create or edit:** `src/components/New.tsx`.", "rule 22, rule 50")],
    ];
    for (const [name, breakIt, text] of variants) {
      const h = exemptHarness(label, "claude");
      const brief = h.write(text, EXEMPT[label].file);
      breakIt(h, brief);
      const result = await h.send(brief, EXEMPT[label].verb);
      expect(name && result.code, result.stderr).toBe(0);
      expectPreChange(h, result, `claude ${label}`);
    }
  });

  it("C27 AC-4: the pre-existing implementor refusals keep their message and come first", async () => {
    const h = harness();
    const bad = grant("- **May edit:** `src/a.ts`.", null);
    h.expectRefused(await h.send(h.write(bad), "request"), /^REFUSED: implementor cannot take device or audit request\n$/);
    fs.mkdirSync(path.join(h.root, ".mdpro-redesign/device"), { recursive: true });
    h.expectRefused(await h.send(h.write(bad, ".mdpro-redesign/device/x-brief.md")), /^REFUSED: implementor cannot take device or audit request\n$/);
  });

  // ---- AC-5: fail closed ----
  it("C28 AC-5: an unreadable brief to a Codex implementor refuses", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `docs/x.md`.", "rule 22, rule 50"));
    fs.chmodSync(brief, 0o000);
    h.expectRefused(await h.send(brief), /REFUSED: cannot read brief .*brief\.md[\s\S]*REFUSED: brief rules check failed for gpt-imple-2/);
  });

  it("C32 AC-5: a missing or crashing helper refuses", async () => {
    const h = harness();
    const helper = path.join(h.repo, SK, "brief-rules-check.py");
    const brief = h.write(grant("- **May edit:** `docs/x.md`.", "rule 22, rule 50"));
    fs.unlinkSync(helper);
    h.expectRefused(await h.send(brief), /REFUSED: brief rules check failed for gpt-imple-2/);
    fs.writeFileSync(helper, "raise RuntimeError('boom')\n");
    h.expectRefused(await h.send(brief), /REFUSED: brief rules check failed for gpt-imple-2/);
  });

  it("C34 AC-5: the helper reads no environment, and prompt.sh reads no variable beyond its pre-change set", () => {
    const helper = fs.readFileSync(path.join(SK, "brief-rules-check.py"), "utf8");
    expect(helper).not.toMatch(/os\.environ|getenv|environ\b/);
    const vars = new Set([...fs.readFileSync(path.join(SK, "prompt.sh"), "utf8").matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    const PRE = ["tdd", "a", "mode", "f", "target_record", "target_kind", "target_cwd", "actual_wt", "expected_wt", "MDPRO_WORKTREE_OVERRIDE", "HOME",
      "is_device", "verb", "overlay", "first", "expected", "target_pane", "pane_mode", "marker", "marker_expected", "pre", "text", "to", "report"];
    expect([...vars].filter((name) => !PRE.includes(name))).toEqual([]);
  });

  it("C35 AC-5: bypass-looking variables do not open the check", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `src/a.ts`.", "rule 22"));
    h.expectRefused(await h.send(brief, "brief", [], { MDPRO_SKIP_BRIEF_RULES: "1", MDPRO_BRIEF_RULES: "off", MDPRO_GUARD_TEST: "1" }), /REFUSED:.*rule 50/);
  });

  it.each(["gpt-imple-1", "opus-imple-1", "opus-imple-2", "gpt-imple-3"])("C17 AC-2: Codex implementor %s is checked by role, not by a name list", async (name) => {
    const h = harness({ name });
    h.expectRefused(await h.send(h.write(grant("- **May edit:** `src/a.ts`.", "rule 22"))), /REFUSED:.*rule 50/);
  });

  it("C54 AC-2: a target record that carries its runtime in agent_session is still checked", async () => {
    const h = harness({ shape: "session" });
    h.expectRefused(await h.send(h.write(grant("- **May edit:** `src/a.ts`.", "rule 22"))), /REFUSED:.*rule 50/);
    expect(h.calls().filter((call) => call[1] === "get" && call[2] === h.name)).toHaveLength(1);
  });

  it("C14/C52 AC-2: lookalike and plural rule names do not count", async () => {
    const h = harness();
    for (const field of ["rule 220, rule 2, rule 502", "rules 22 and 50", "22-comment-maintenancex, 50-codebase"]) {
      h.reset();
      const result = await h.send(h.write(grant("- **May edit:** `src/a.ts`.", field)));
      h.expectRefused(result, /needs rule 22 [\s\S]*needs rule 50 /);
    }
  });

  it("C43 AC-5: two field paragraphs refuse", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `src/a.ts`.", "rule 22, rule 50", "**Rules for paths in scope.** rule 22, rule 50.\n"));
    h.expectRefused(await h.send(brief), /exactly one \*\*Rules for paths in scope\.\*\* field, found 2/);
  });

  const BROKEN: Array<[string, (text: string) => string]> = [
    ["no frontmatter block", (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "")],
    ["no paths: key", (text) => text.replace(/^paths:\n(?:  - .*\n)+/m, "")],
    ["an empty list", (text) => text.replace(/^paths:\n(?:  - .*\n)+/m, "paths: []\n")],
    ["a flow list", (text) => text.replace(/^paths:\n(?:  - .*\n)+/m, "paths: [\"src/**\"]\n")],
    ["an unterminated block", (text) => text.replace(/^(---\n[\s\S]*?)\n---\n/, "$1\n")],
    ["an unquoted item", (text) => text.replace(/^(paths:\n)/m, "$1  - src/**\n")],
    ["a comment inside the list", (text) => text.replace(/^(paths:\n)/m, "$1  # note\n")],
  ];
  it.each([22, 50] as const)("C31a/C31b/C46 AC-5: broken rule %s frontmatter refuses naming the file, even with both rules named", async (n) => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `docs/x.md`.", "rule 22, rule 50"));
    const original = fs.readFileSync(h.rule(n), "utf8");
    for (const [label, edit] of BROKEN) {
      h.reset();
      fs.writeFileSync(h.rule(n), edit(original));
      const result = await h.send(brief);
      h.expectRefused(result, new RegExp(`REFUSED: rule ${n}: .*${n}-[a-z-]+\\.md`));
      expect(label && edit(original)).not.toBe(original);
    }
    fs.writeFileSync(h.rule(n), original);
    h.reset();
    fs.rmSync(h.rule(n));
    h.expectRefused(await h.send(brief), new RegExp(`REFUSED: rule ${n}: expected one .claude/rules/${n}-\\*\\.md, found 0`));
    fs.writeFileSync(h.rule(n), original);
    fs.writeFileSync(path.join(h.rules, `${n}-copy.md`), original);
    h.reset();
    h.expectRefused(await h.send(brief), new RegExp(`REFUSED: rule ${n}: expected one .claude/rules/${n}-\\*\\.md, found 2`));
  });

  it("C53a/C53b AC-1: only the script's own rules count, not decoys in the cwd, the test main or the target", async () => {
    const spawnCwd = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-cwd-")); dirs.push(dir); return dir; };
    const decoys = (h: ReturnType<typeof harness>, cwd: string, globs: string[]) => {
      for (const base of [cwd, path.join(h.root, "main"), h.target]) {
        fs.mkdirSync(path.join(base, ".claude/rules"), { recursive: true });
        for (const file of RULES) fs.writeFileSync(path.join(base, ".claude/rules", file), `---\npaths:\n${globs.map((g) => `  - "${g}"`).join("\n")}\n---\n`);
      }
    };
    const strictCwd = spawnCwd(), strict = harness({ cwd: strictCwd });
    decoys(strict, strictCwd, ["nothing/**"]);
    strict.expectRefused(await strict.send(strict.write(grant("- **May edit:** `src/a.ts`.", "rule 22"))), /REFUSED:.*rule 50/);
    const lenientCwd = spawnCwd(), lenient = harness({ cwd: lenientCwd });
    lenient.setPaths(22, ["nothing/**"]);
    lenient.setPaths(50, ["nothing/**"]);
    decoys(lenient, lenientCwd, ["src/**"]);
    const brief = lenient.write(grant("- **May edit:** `src/a.ts`.", "none"));
    lenient.expectSent(await lenient.send(brief), brief);
  });
  // ---- AC-2 / AC-3 / AC-5 controls (raw-green: they pin semantics the earlier cycles built) ----
  const needs = (result: Result, rules: Array<22 | 50>) => {
    expect(result.code, result.stderr).toBe(2);
    for (const n of [22, 50] as const) {
      if (rules.includes(n)) expect(result.stderr).toMatch(new RegExp(`needs rule ${n} `));
      else expect(result.stderr).not.toMatch(new RegExp(`needs rule ${n} `));
    }
    expect(result.stderr).not.toMatch(/unresolvable|not backticked|not a plain/);
  };
  it("C9/C44/C45 AC-2: glob, folder and case-variant scopes require the rules their globs overlap", async () => {
    const h = harness();
    const cases: Array<[string, Array<22 | 50>]> = [
      ["src/**/*.tsx", [22, 50]], ["tests/", [22, 50]], ["src", [22, 50]], ["./src/a.ts", [22, 50]], ["**/*.tsx", [22, 50]],
      ["*/a.ts", [22, 50]], ["SRC/A.ts", [22, 50]], ["src/**/deep/a.ts", [22, 50]],
      [".agents/skills/*/scripts/**", [22]], [".agents/**", [22]], [".agents/skills/scripts/x.sh", [22]],
      [".agents/skills/a/b/scripts/x.sh", [22]], [".claude/hooks/x.sh", [22]], ["scripts/b.sh", [22]],
    ];
    for (const [token, rules] of cases) {
      h.reset();
      needs(await h.send(h.write(grant(`- **May edit:** \`${token}\`.`, "none"))), rules);
      expect(h.prompts()).toEqual([]);
    }
  });

  it("C10/C11 AC-2: near-miss prefixes require nothing, and a mixed scope takes the union", async () => {
    const h = harness();
    for (const dir of ["srcfoo", "my-scripts"]) fs.mkdirSync(path.join(h.repo, dir));
    for (const token of ["srcfoo/a.ts", "my-scripts/x", ".agents/skills/x/SKILL.md", "tests.md", ".claude/hooksx/a"]) {
      h.reset();
      const brief = h.write(grant(`- **May edit:** \`${token}\`.`, "none"));
      h.expectSent(await h.send(brief), brief);
    }
    h.reset();
    needs(await h.send(h.write(grant("- **May edit:** `docs/a.md`, `scripts/b.sh`.", "none"))), [22]);
  });

  it("C40/C41/C42/C70 AC-3: paragraph extent for May edit, May create and the field", async () => {
    const h = harness();
    const cases: Array<[string, string, Array<22 | 50>]> = [
      ["- **May edit:** `docs/x.md`,\n  `src/a.ts`.", "rule 22", [50]],
      ["- **May edit:** `docs/x.md`.\n- **May edit:** `src/a.ts`.", "none", [22, 50]],
      ["- **May edit:** `docs/x.md`.\n- **May create:**\n  - `src/a.ts`;", "rule 22", [50]],
      ["- **May edit:** `docs/x.md`.\n- **May create:** `docs/y.md`,\n  `src/a.ts`.", "rule 22", [50]],
      ["- **May edit:** `docs/x.md`.\n- **May create:** `docs/y.md`.\n- **May create:** `src/a.ts`.", "rule 22", [50]],
      ["- **May edit:** `src/a.ts`.", "rule 22.\n\nrule 50", [50]],
      ["- **May edit:** `src/a.ts`.", "rule 22.\n- rule 50", [50]],
    ];
    for (const [scope, field, rules] of cases) {
      h.reset();
      needs(await h.send(h.write(grant(scope, field))), rules);
    }
  });

  it("C21/C56a AC-3: the GH592 brief's own shape: nested bullets, ended by the Anything else bullet", async () => {
    const h = harness();
    const scope = ["- **May edit:**", "  - `.agents/skills/mdpro-delegator/scripts/prompt.sh`;",
      "  - a new helper `.agents/skills/mdpro-delegator/scripts/brief-rules-check.mjs` (or `.py`, matching the scripts' idiom), if",
      "    the check outgrows prompt.sh's 300-line ceiling;", "  - `tests/tooling/gh592-brief-rules-check.test.ts`;",
      "  - the two brief templates (only to document the refusal);",
      "  - `.agents/skills/mdpro-delegator/SKILL.md` or `.agents/skills/mdpro-delegator/references/codex-panes.md` (one line on the refusal).",
      "- **Anything else:** stop and ask; never `src/a.ts`."].join("\n");
    const extra = "## 2a. Open questions, with defaults\n- **Q2. How are \"May edit\" paths found?** Default: the brief's `**May edit:**` paragraph in § 2.\n";
    const brief = h.write(grant(scope, "rule 22, rule 50", extra));
    h.expectSent(await h.send(brief), brief);
    h.reset();
    needs(await h.send(h.write(grant(scope, "rule 22", extra))), [50]);
  });

  it("C49a/C49b AC-2: the template's May edit wording; the fixture allowance is not scope", async () => {
    const h = harness();
    const lines = fs.readFileSync(".agents/skills/mdpro-delegator/references/templates/brief-template.md", "utf8").split("\n").slice(21, 25).join("\n");
    expect(lines).toMatch(/^- \*\*May edit:\*\* <paths>, their tests/);
    needs(await h.send(h.write(grant(lines.replace("<paths>", "`docs/x.md`").replace(/<ID>/g, "X1"), "none"))), [22, 50]);
    h.reset();
    const brief = h.write(grant(lines.replace("<paths>", "`docs/x.md`").replace(", their tests", "").replace(/<ID>/g, "X1"), "none"));
    h.expectSent(await h.send(brief), brief);
  });

  it("C58 AC-5: a standalone May edit line followed by column-0 bullets is a missing scope (known limit, fail closed)", async () => {
    const h = harness();
    h.expectRefused(await h.send(h.write(grant("**May edit:**\n- `docs/x.md`", "rule 22, rule 50"))), /\*\*May edit:\*\* paragraph names no backticked path/);
  });

  it("C59 AC-2: known limit (ruling 2 gap 10): an unbackticked bare word is not scope", async () => {
    const h = harness();
    const brief = h.write(grant("- **May edit:** `docs/a.md` and anything under src.", "none"));
    h.expectSent(await h.send(brief), brief);
  });

  it("C61/C68/C73b/C73c AC-5: resolvable tokens and exempt single words are not called unresolvable", async () => {
    const h = harness();
    const sent: Array<[string, string]> = [["`tests/tooling/x.test.ts`", "rule 22, rule 50"], ["`[Unreleased]`", "none"], ["`CHANGELOG.md`", "none"],
      ["`.py`", "none"], ["`*.md`", "none"], ["`src`", "rule 22, rule 50"], ["`nofile.md`", "none"]];
    for (const [token, field] of sent) {
      h.reset();
      const brief = h.write(grant(`- **May edit:** \`docs/x.md\`, ${token}.`, field));
      h.expectSent(await h.send(brief), brief);
    }
    h.reset();
    needs(await h.send(h.write(grant("- **May edit:** `te*/x.test.ts`.", "none"))), [22, 50]);
  });

  it("C74g AC-5: prose May, a date and a quoted label are not scope labels", async () => {
    const h = harness();
    const extra = "## 3. Notes\nThe implementor may edit tests later.\nMay 3 notes: none.\nThe label `**May extend**` is not used.\n";
    const brief = h.write(grant("- **May edit:** `docs/x.md`.", "none", extra));
    h.expectSent(await h.send(brief), brief);
  });

  it("C20 AC-3: a CRLF, BOM and CJK brief is read like any other", async () => {
    const h = harness();
    const text = "﻿" + grant("- **May edit:** `src/a.ts`（中文说明）.", "规则：rule 22、rule 50").replace(/\n/g, "\r\n");
    const brief = h.write(text);
    h.expectSent(await h.send(brief), brief);
    h.reset();
    needs(await h.send(h.write("﻿" + grant("- **May edit:** `src/a.ts`.", "规则：rule 22").replace(/\n/g, "\r\n"))), [50]);
  });
  // next-case
});
