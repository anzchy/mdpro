// @vitest-environment node
/**
 * GH592 ruling 7 (cycle F1-4): percent-encoded link paths, the lookalike fold in the "Same paths as the grant" and
 * "their tests" phrases, and `ɑ` / `ı` in scope labels. Each case runs the real prompt.sh and brief-rules-check.py
 * copied into a temp tree, with only `herdr` stubbed on PATH.
 *
 * This file holds a minimal copy of the harness in `gh592-brief-rules-check.test.ts`, which is the source of truth
 * (ruling 8). The big file has 157 tests, and the receipt lane's 120 s vitest cap (#622) kills its record under load,
 * so the case cannot live there. Its receipts are settled, so its harness is not moved to a shared module either.
 * Matrix: ~/.mdpro-redesign/herdr-spike/opus-imple-1/GH592-test-matrix.md.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Each case spawns zsh, python3 and the stub herdr several times; on a loaded machine a case can pass 5 s.
vi.setConfig({ testTimeout: 30_000 });
const SK = ".agents/skills/mdpro-delegator/scripts";
const COPIED = ["prompt.sh", "delegator-route.sh", "agent-role.sh", "notify-settled.sh", "brief-rules-check.py", "brief_render.py"];
const RULES = ["22-comment-maintenance.md", "50-codebase-conventions.md"];
const TOP = ["src", "src-tauri", "tests", "scripts", "docs"];
const NAME = "gpt-imple-2";
const dirs: string[] = [];

type Result = { code: number; stdout: string; stderr: string };

function exec(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
    child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

let cache: string | null = null;
/** One tree per run: the fake herdr and the repo copy, kept at one path (macOS scans a new executable path once). */
function exeCache(): string {
  if (cache) return cache;
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-fold-exe-"));
  fs.mkdirSync(path.join(cache, "bin"));
  fs.writeFileSync(path.join(cache, "bin/herdr"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), op = args.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(op) + "\\n");
if (args[0] !== "--session" || args[1] !== "mdpro") process.exit(41);
if (op[0] === "agent" && op[1] === "get") {
  const delegator = op[2] === "herdr-delegator";
  const kind = delegator ? process.env.FAKE_DELEGATOR_KIND : process.env.FAKE_TARGET_KIND;
  const agent = { agent_status: "idle", cwd: delegator ? process.env.FAKE_MAIN : process.env.FAKE_TARGET, pane_id: "w1:p7", agent: kind };
  process.stdout.write(JSON.stringify({ result: { agent } }));
}
`);
  fs.chmodSync(path.join(cache, "bin/herdr"), 0o755);
  const repo = path.join(cache, "repo"), scripts = path.join(repo, SK);
  fs.mkdirSync(scripts, { recursive: true });
  for (const file of COPIED) {
    fs.copyFileSync(path.join(SK, file), path.join(scripts, file));
    fs.chmodSync(path.join(scripts, file), 0o755);
  }
  fs.mkdirSync(path.join(repo, ".claude/rules"), { recursive: true });
  for (const file of RULES) fs.copyFileSync(path.join(".claude/rules", file), path.join(repo, ".claude/rules", file));
  for (const dir of TOP) fs.mkdirSync(path.join(repo, dir), { recursive: true });
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "# Changelog\n");
  return cache;
}

/** A Codex implementor target and a Claude delegator; the copied repo never changes, so cases share it. */
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-fold-"));
  dirs.push(root);
  const scripts = path.join(exeCache(), "repo", SK);
  const target = path.join(root, "Documents/mac-app/mdpro-wt", NAME), main = path.join(root, "main");
  for (const dir of [path.join(target, ".codex/rules"), path.join(main, ".codex/rules")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  const overlay = path.join(target, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(overlay, "# Local mdpro role: implementor\n");
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(overlay, old, old);
  fs.writeFileSync(path.join(target, ".codex/rules/.started-at"), "w1:p7\n");
  const log = path.join(root, "calls.jsonl");
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: root, PATH: `${path.join(exeCache(), "bin")}:${process.env.PATH ?? ""}`, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: main,
    FAKE_DELEGATOR_KIND: "claude", FAKE_TARGET_KIND: "codex", FAKE_MAIN: main, FAKE_TARGET: target, FAKE_HERDR_LOG: log,
  };
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
  const prompts = () => calls().filter((call) => call[0] === "agent" && call[1] === "prompt" && call[2] === NAME);
  const reset = () => fs.rmSync(log, { force: true });
  const write = (text: string) => { const p = path.join(root, "brief.md"); fs.writeFileSync(p, text); return p; };
  const send = (brief: string) => exec(path.join(scripts, "prompt.sh"), [NAME, brief, "brief", "1000"], env);
  const codexText = (f: string) => `herdr-delegator: read ${f} and everything it names, then do it with $tdd-guardian:tdd-guardian-workflow. Write the handoff it names and stop.`;
  const expectSent = (result: Result, f: string) => {
    expect(result.code, result.stderr).toBe(0);
    expect(prompts()).toEqual([["agent", "prompt", NAME, codexText(f), "--wait", "--timeout", "1000"]]);
  };
  const expectRefused = (result: Result, pattern: RegExp) => {
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(pattern);
    expect(prompts()).toEqual([]);
  };
  return { prompts, reset, write, send, expectSent, expectRefused };
}

/** A grant in brief-template shape: the field paragraph, then § 2 with the scope lines. */
function grant(scope: string, field: string, extra = ""): string {
  const fieldText = `**Rules for paths in scope.** ${field}. Before editing any matching path, open each rule\nnamed for that path in AGENTS.md. Issue 592 checks it.\n\n`;
  return `# X1: a test item (2026-11-03, herdr-delegator)\n\n**Tier: Low** (test). **Difficulty: routine** (test).\n\n${fieldText}## 1. Background\n- **The issue.** none.\n\n## 2. Scope\n- Worktree \`mdpro-wt/gpt-imple-2\`; branch \`chore/x1-test\` from \`origin/master\` (\`abc1234\`).\n${scope}\n- Anything else: stop and ask.\n\n${extra}`;
}

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
afterAll(() => { if (cache) fs.rmSync(cache, { recursive: true, force: true }); cache = null; });

describe.skipIf(process.platform !== "darwin")("GH592 brief rules check, ruling 7 fold (requires macos zsh)", () => {
  const needs = (result: Result, rules: Array<22 | 50>) => {
    expect(result.code, result.stderr).toBe(2);
    for (const n of [22, 50] as const) {
      if (rules.includes(n)) expect(result.stderr).toMatch(new RegExp(`needs rule ${n} `));
      else expect(result.stderr).not.toMatch(new RegExp(`needs rule ${n} `));
    }
    expect(result.stderr).not.toMatch(/unresolvable|not backticked|not a plain/);
  };
  const lineOf = (text: string, needle: string) => text.split(/\r\n|\r|\n/).findIndex((line) => line.includes(needle)) + 1;
  const refusedAt = async (h: ReturnType<typeof harness>, text: string, pattern: RegExp, needle?: string) => {
    h.reset();
    const result = await h.send(h.write(text));
    h.expectRefused(result, pattern);
    if (needle !== undefined) expect(result.stderr).toContain(`(line ${lineOf(text, needle)})`);
    return result;
  };
  const sentAs = async (h: ReturnType<typeof harness>, text: string) => {
    h.reset();
    const brief = h.write(text);
    h.expectSent(await h.send(brief), brief);
  };

  it("F1v/F3p/F2m AC-F1..F3 (ruling 7): a percent-encoded link path, a lookalike in either phrase, and ɑ or ı in a label refuse", async () => {
    const h = harness();
    for (const word of ["[the panel](src%2Fa.ts)", "[the panel](src%2fa.ts)", "[the panel](src%5Ca.ts)"]) {
      await refusedAt(h, grant(`- **May edit:** \`docs/x.md\`, ${word}.`, "none"), /not backticked: 'src\/a\.ts'/);
    }
    for (const form of ["- Same paths as the grаnt.", "- Sаme paths as the grant.", "- Same pаths аs the grаnt."]) {
      await refusedAt(h, grant(`${form}\n- **May create:** \`scripts/new.mjs\`.`, "rule 22, rule 50"), /copy the grant's \*\*May edit:\*\*/);
    }
    for (const scope of ["- **May edit:** `scripts/x.mjs`, thеir tests.", "- **May edit:** `scripts/x.mjs`, their tеsts."]) {
      h.reset();
      const result = await h.send(h.write(grant(scope, "rule 22")));
      needs(result, [50]);
      expect(result.stderr).toContain("tests/** (their tests)");
      expect(h.prompts()).toEqual([]);
    }
    for (const word of ["Mɑy edit", "May edıt", "Mɑy creɑte"]) {
      const label = `- **${word}:** \`src/a.ts\`.`;
      await refusedAt(h, grant("- **May edit:** `docs/x.md`.", "rule 22, rule 50", `## 3. Notes\n${label}\n`), /unrecognised scope label/, label);
    }
    await sentAs(h, grant("- **May edit:** `docs/x.md`, 100% of it (50%2 of the lines).", "none"));
  });

  it("F3r AC-F3 (code review, added in cycle F1-5): a lookalike of a phrase-only letter (s, S, h, g) is folded too", async () => {
    const h = harness();
    for (const form of ["- Ѕame paths as the grant.", "- Same pathѕ as the grant.", "- Same patһs as the grant.", "- Same paths as the ɡrant."]) {
      await refusedAt(h, grant(`${form}\n- **May create:** \`scripts/new.mjs\`.`, "rule 22, rule 50"), /copy the grant's \*\*May edit:\*\*/);
    }
    for (const scope of ["- **May edit:** `scripts/x.mjs`, their teѕts.", "- **May edit:** `scripts/x.mjs`, tһeir tests."]) {
      h.reset();
      const result = await h.send(h.write(grant(scope, "rule 22")));
      needs(result, [50]);
      expect(result.stderr).toContain("tests/** (their tests)");
      expect(h.prompts()).toEqual([]);
    }
  });
});
