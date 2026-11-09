// @vitest-environment node
/**
 * GH592 fix 2, ruling 3 (cycle F2-2): an inline-HTML match is bounded by a blank line only (`HTML_END`), because a line
 * that opens like a list item, heading or quote does not always end a paragraph for a reader, while code spans keep the
 * block bound of ruling 1. Each case runs the real prompt.sh and brief-rules-check.py copied into a temp tree, with only
 * `herdr` stubbed on PATH.
 *
 * This file holds a minimal copy of the harness in `gh592-brief-rules-check.test.ts`, which is the source of truth
 * (ruling 8). It is a second fold file so that `GH592-F2-1`'s file stays settled (ruling 3) and the big file's #622
 * record timeout stays away. Matrix: ~/.mdpro-redesign/herdr-spike/opus-imple-1/GH592-test-matrix.md.
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
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-fold2-exe-"));
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
  // #677: prompt.sh runs this helper, resolved from the script's own directory.
  fs.mkdirSync(path.join(repo, "scripts/tdd"), { recursive: true });
  fs.copyFileSync("scripts/tdd/mattpocock-version.mjs", path.join(repo, "scripts/tdd/mattpocock-version.mjs"));
  return cache;
}

/** A Codex implementor target and a Claude delegator; the copied repo never changes, so cases share it. */
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh592-fold2-"));
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
  // #677: prompt.sh gates an implementor brief on the target runtime's Matt Pocock skills cache.
  for (const rel of [".codex/plugins/cache/mattpocock/mattpocock-skills", ".claude/plugins/cache/claude-plugins-official/mattpocock-skills"]) {
    fs.cpSync("tests/fixtures/t567/caches/ok-131", path.join(root, rel), { recursive: true });
  }
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
  const codexText = (f: string) => `herdr-delegator: read ${f} and everything it names, then do it with jack-tdd-workflow. Write the handoff it names and stop.`;
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

describe.skipIf(process.platform !== "darwin")("GH592 brief rules check, fix 2 ruling 3 fold (requires macos zsh)", () => {
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
  const NOTES = (body: string) => `## 3. Notes\n${body}\n`;
  const tagAt = async (h: ReturnType<typeof harness>, text: string, needle: string, quoted: string, kind = "HTML tag") => {
    const result = await refusedAt(h, text, new RegExp(`${kind} \\(line \\d+\\)`), needle);
    expect(result.stderr).toContain(`'${quoted}'`);
    expect(result.stderr).not.toMatch(/needs rule/);
  };

  it("G2a-e/G2j/G2l AC-G1 (ruling 3): a tag across a line that cannot interrupt its paragraph refuses, quoting all of it", async () => {
    const h = harness();
    for (const [marker, quoted] of [["2.", "<x a= 2. b='rule 50'>"], ["3)", "<x a= 3) b='rule 50'>"], ["10.", "<x a= 10. b='rule 50'>"]]) {
      await tagAt(h, grant("- **May edit:** `src/a.ts`.", `rule 22 <x a=\n${marker} b='rule 50'>`), "**Rules for paths", quoted);
    }
    await tagAt(h, grant("- **May edit:** `src/a.ts`.", "rule 22 <x a=\n+ \nb='rule 50'>"), "**Rules for paths", "<x a= + b='rule 50'>");
    await tagAt(h, grant("- **May edit:** `docs/x.md`.\n\n**May edit:** `docs/x.md`, src<x a=\n2. b>/a.ts.", "none"), "src<x", "<x a= 2. b>");
    await tagAt(h, grant("- **May edit:** `docs/x.md`.\n\n**May edit:** `docs/y.md`, src<x a=\n    # b>/a.ts.", "none"), "src<x", "<x a= # b>");
    await tagAt(h, grant("- **May edit:** `docs/x.md`, src<x a=\n  2. b>/a.ts.", "none"), "src<x", "<x a= 2. b>");
  });

  it("G2k AC-G1 (ruling 3): a tag over an indented heading line in prose refuses as a tag, not as a missing rule", async () => {
    const h = harness();
    await tagAt(h, grant("- **May edit:** `docs/x.md`.", "rule 22", NOTES("src<x a=\n    # b>/a.ts.\n- **May create:** `src/a.ts`.")), "src<x", "<x a= # b>");
  });

  it("G2f AC-G1 (ruling 3): inside a list, a tag across a new item is refused (a safe over-refusal)", async () => {
    const h = harness();
    await tagAt(h, grant("- **May edit:** `docs/x.md`.", "none", NOTES("- a <x y=\n2. b>")), "- a <x", "<x y= 2. b>");
  });

  it("G2m AC-G1 (ruling 3): a processing instruction, declaration or CDATA across such a line is quoted whole", async () => {
    const h = harness();
    for (const [construct, quoted] of [["<?x\n2. rule 50 ?>", "<?x 2. rule 50 ?>"], ["<!X\n2. y>", "<!X 2. y>"], ["<![CDATA[\n2. y]]>", "<![CDATA[ 2. y]]>"]]) {
      await tagAt(h, grant("- **May edit:** `src/a.ts`.", `rule 22 ${construct}`), "**Rules for paths", quoted, "inline HTML");
    }
  });

  it("G2g AC-G1 control (ruling 1 unchanged): a code span still does not pair across a new list item", async () => {
    const h = harness();
    h.reset();
    const result = await h.send(h.write(grant("- **May edit:** `docs/x.md`.", "rule 22", NOTES("- A lone ` backtick.\n2. **May create:** `src/a.ts`."))));
    needs(result, [50]);
    expect(result.stderr).toContain("src/a.ts");
    expect(h.prompts()).toEqual([]);
  });

  it("G2h/G2i AC-G1 controls: no match crosses a blank line, even one holding spaces", async () => {
    const h = harness();
    for (const blankLine of ["", "  "]) {
      await sentAs(h, grant("- **May edit:** `docs/x.md`.", "none", NOTES(`x <y a=\n${blankLine}\nb>`)));
      await sentAs(h, grant("- **May edit:** `docs/x.md`.", "none", NOTES(`pairs <x y="1> here\n${blankLine}\nLater a " quoted> word.`)));
    }
  });
});
