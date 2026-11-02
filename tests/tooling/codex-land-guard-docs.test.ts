// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const made: string[] = [];
function cmd(cwd: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(resolve => {
    execFile(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ status: error ? 1 : 0, stdout, stderr });
    });
  });
}
async function git(dir: string, ...args: string[]) {
  const r = await cmd(dir, "git", args);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-docs-"));
  made.push(dir);
  const main = path.join(dir, "main"), bare = path.join(dir, "origin.git"), bin = path.join(dir, "bin");
  fs.mkdirSync(main); fs.mkdirSync(bin);
  (await git(dir, "init", "-q", "--bare", bare));
  (await git(main, "init", "-q", "-b", "master"));
  (await git(main, "config", "user.name", "Test")); (await git(main, "config", "user.email", "t@t"));
  fs.writeFileSync(path.join(main, "base.txt"), "A\n");
  (await git(main, "add", "base.txt")); (await git(main, "commit", "-qm", "A"));
  const a = (await git(main, "rev-parse", "HEAD"));
  (await git(main, "remote", "add", "origin", bare));
  (await git(main, "push", "-q", bare, "HEAD:refs/heads/master"));
  fs.mkdirSync(path.join(main, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro.rules"), "# shared\n");
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(main, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs", "land-guard.mjs"]) {
    const src = path.join(root, "scripts/codex-rules", name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(main, "scripts/codex-rules", name));
  }
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, "#!/bin/sh\necho 'gh must not run' >&2\nexit 99\n"); fs.chmodSync(gh, 0o755);
  // D355 L9: a stub for the rule-test runner records its argv, its cwd and the exported CLAUDE.md, and fails when
  // STUB_STATUS says so or when the exported CLAUDE.md holds RED.
  const stub = path.join(bin, "rule-tests"), stubLog = path.join(dir, "rule-tests.log");
  fs.writeFileSync(stub, `#!/bin/sh
{ echo "cwd=$(pwd -P)"; for a in "$@"; do echo "arg=$a"; done; [ -f CLAUDE.md ] && sed 's/^/claude=/' CLAUDE.md; } >> "$STUB_LOG"
if [ "\${STUB_STATUS:-0}" != 0 ] || grep -q RED CLAUDE.md 2>/dev/null; then echo "FAIL tests/tooling/always-on-budget.test.ts"; exit 1; fi
echo "Tests 2 passed"
`); fs.chmodSync(stub, 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main, MDPRO_GUARD_TEST_ORIGIN: bare, MDPRO_GUARD_RULE_TEST_RUNNER: stub, STUB_LOG: stubLog };
  const add = async (name: string, value = "content\n") => {
    const target = path.join(main, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    (await git(main, "add", name)); (await git(main, "commit", "-qm", `add ${name}`));
    return (await git(main, "rev-parse", "HEAD"));
  };
  const run = async (args: string[] = ["--docs-only"], extra: NodeJS.ProcessEnv = {}) =>
    (await cmd(main, process.execPath, ["scripts/codex-rules/land-guard.mjs", ...args], { ...env, ...extra }));
  const remote = async () => (await git(dir, "--git-dir", bare, "rev-parse", "refs/heads/master"));
  const log = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, "utf8") : "");
  return { dir, main, bare, a, env, add, run, remote, log };
}
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("pushes each allowed docs-only path and a mixed allowed range without gh", { timeout: 30_000 }, async () => {
  for (const name of ["docs/a.md", "docs/agents/other.md", "design/a.md", "design/nested/a.md", "CHANGELOG.md", "CLAUDE.md",
    "AGENTS.md", ".claude/rules/a.md", ".claude/agents/a.md"]) {
    const f = (await fixture());
    const head = (await f.add(name));
    const result = (await f.run());
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    expect((await f.remote())).toBe(head);
  }
  const mixed = (await fixture());
  (await mixed.add("docs/a.md")); (await mixed.add(".claude/rules/a.md")); const head = (await mixed.add("design/deep/a.md"));
  expect((await mixed.run()).status).toBe(0);
  expect((await mixed.remote())).toBe(head);
});

it("refuses the audit dimensions file through the real docs-only guard", async () => {
  const f = (await fixture());
  (await f.add("docs/agents/audit-dimensions.md"));
  const result = (await f.run());
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ADR-0146 decision 1");
  expect((await f.remote())).toBe(f.a);
});

it("refuses alternate spellings, a rename, and a symlink alias of audit dimensions", { timeout: 30_000 }, async () => {
  for (const name of ["docs/agents/AUDIT-DIMENSIONS.md", "./docs/agents/audit-dimensions.md"]) {
    const f = (await fixture());
    (await f.add(name));
    const result = (await f.run());
    expect(result.status, name).not.toBe(0);
    expect(result.stderr, name).toContain("ADR-0146 decision 1");
    expect((await f.remote())).toBe(f.a);
  }
  const renamed = (await fixture());
  (await renamed.add("docs/agents/audit-dimensions.md"));
  (await git(renamed.main, "push", "-q", renamed.bare, "HEAD:refs/heads/master"));
  const base = (await renamed.remote());
  (await git(renamed.main, "mv", "docs/agents/audit-dimensions.md", "docs/agents/renamed.md"));
  (await git(renamed.main, "commit", "-qm", "rename dimensions"));
  const renameResult = (await renamed.run());
  expect(renameResult.status).not.toBe(0);
  expect(renameResult.stderr).toContain("ADR-0146 decision 1");
  expect((await renamed.remote())).toBe(base);

  const deleted = (await fixture());
  (await deleted.add("docs/agents/audit-dimensions.md"));
  (await git(deleted.main, "push", "-q", deleted.bare, "HEAD:refs/heads/master"));
  const deleteBase = (await deleted.remote());
  (await git(deleted.main, "rm", "docs/agents/audit-dimensions.md"));
  (await git(deleted.main, "commit", "-qm", "delete dimensions"));
  const deleteResult = (await deleted.run());
  expect(deleteResult.status).not.toBe(0);
  expect(deleteResult.stderr).toContain("ADR-0146 decision 1");
  expect((await deleted.remote())).toBe(deleteBase);

  const renamedInto = (await fixture());
  (await renamedInto.add("docs/agents/other.md"));
  (await git(renamedInto.main, "push", "-q", renamedInto.bare, "HEAD:refs/heads/master"));
  const intoBase = (await renamedInto.remote());
  (await git(renamedInto.main, "mv", "docs/agents/other.md", "docs/agents/audit-dimensions.md"));
  (await git(renamedInto.main, "commit", "-qm", "rename into dimensions"));
  const intoResult = (await renamedInto.run());
  expect(intoResult.status).not.toBe(0);
  expect(intoResult.stderr).toContain("ADR-0146 decision 1");
  expect((await renamedInto.remote())).toBe(intoBase);

  const linked = (await fixture());
  fs.mkdirSync(path.join(linked.main, "docs/agents"), { recursive: true });
  fs.symlinkSync("audit-dimensions.md", path.join(linked.main, "docs/agents/alias.md"));
  (await git(linked.main, "add", "docs/agents/alias.md"));
  (await git(linked.main, "commit", "-qm", "symlink dimensions"));
  const linkResult = (await linked.run());
  expect(linkResult.status).not.toBe(0);
  expect(linkResult.stderr).toContain("ADR-0146 decision 1");
  expect((await linked.remote())).toBe(linked.a);
});

it("GH586: refuses the policy set file, its spellings, a rename and a delete through the docs-only guard", { timeout: 30_000 }, async () => {
  const name = "docs/agents/audit-policy-set.md";
  for (const spelling of [name, "docs/agents/AUDIT-POLICY-SET.md", "./docs/agents/audit-policy-set.md"]) {
    const f = (await fixture());
    (await f.add(spelling));
    const result = (await f.run());
    expect(result.status, spelling).not.toBe(0);
    expect(result.stderr, spelling).toContain("ADR-0146 decision 1");
    expect((await f.remote()), spelling).toBe(f.a);
  }
  for (const change of ["rename away", "delete", "rename into"]) {
    const f = (await fixture());
    (await f.add(change === "rename into" ? "docs/agents/other.md" : name));
    (await git(f.main, "push", "-q", f.bare, "HEAD:refs/heads/master"));
    const base = (await f.remote());
    if (change === "rename away") (await git(f.main, "mv", name, "docs/agents/renamed.md"));
    if (change === "delete") (await git(f.main, "rm", "-q", name));
    if (change === "rename into") (await git(f.main, "mv", "docs/agents/other.md", name));
    (await git(f.main, "commit", "-qm", change));
    const result = (await f.run());
    expect(result.status, change).not.toBe(0);
    expect(result.stderr, change).toContain("ADR-0146 decision 1");
    expect((await f.remote()), change).toBe(base);
  }
});

it("GH586: still pushes docs-only paths that only resemble the protected audit files", { timeout: 30_000 }, async () => {
  for (const name of ["docs/agents/decisions/20261102-audit-policy-set-split.md", "docs/audit/audit-log.md",
    "docs/agents/audit-policy-set-notes.md"]) {
    const f = (await fixture());
    const head = (await f.add(name));
    const result = (await f.run());
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    expect((await f.remote()), name).toBe(head);
  }
});

it("pushes only master when Git is configured to follow annotated tags", async () => {
  const f = (await fixture());
  const head = (await f.add("docs/tagged.md"));
  (await git(f.main, "tag", "-a", "release-candidate", "-m", "candidate tag", head));
  (await git(f.main, "config", "push.followTags", "true"));
  const result = (await f.run());
  expect(result.status, result.stderr).toBe(0);
  expect((await f.remote())).toBe(head);
  expect((await git(f.dir, "--git-dir", f.bare, "for-each-ref", "--format=%(refname) %(objectname)")))
    .toBe(`refs/heads/master ${head}`);
});

it("refuses every excluded path and mixed docs/code changes", { timeout: 30_000 }, async () => {
  for (const name of ["src/x.ts", "src-tauri/x.rs", "tests/x.ts", "scripts/x.mjs", ".codex/x",
    ".github/x", ".claude/hooks/x", ".claude/settings.json", "package.json", "pnpm-lock.yaml",
    "design/x.png", ".claude/rules/sub/x.md"]) {
    const f = (await fixture());
    (await f.add(name));
    expect((await f.run()).status, name).not.toBe(0);
    expect((await f.remote())).toBe(f.a);
  }
  for (const first of ["docs/a.md", "src/x.ts"]) {
    const f = (await fixture());
    (await f.add(first)); (await f.add(first === "docs/a.md" ? "src/x.ts" : "docs/a.md"));
    expect((await f.run()).status).not.toBe(0);
    expect((await f.remote())).toBe(f.a);
  }
});

it("checks net tree range, so a reverted source change does not block docs", async () => {
  const f = (await fixture());
  (await f.add("src/x.ts"));
  fs.unlinkSync(path.join(f.main, "src/x.ts"));
  (await git(f.main, "add", "-u", "src/x.ts")); (await git(f.main, "commit", "-qm", "revert source"));
  const head = (await f.add("docs/a.md"));
  const result = (await f.run());
  expect(result.status, result.stderr).toBe(0);
  expect((await f.remote())).toBe(head);
});

it("refuses no-ahead and extra options, leaving remote master unchanged", async () => {
  const f = (await fixture());
  expect((await f.run()).status).not.toBe(0);
  (await f.add("docs/a.md"));
  for (const args of [["--docs-only", "--force"], ["--docs-only", "--dry-run", "--dry-run"]]) {
    expect((await f.run(args)).status).not.toBe(0);
    expect((await f.remote())).toBe(f.a);
  }
  const dry = (await f.run(["--docs-only", "--dry-run"]));
  expect(dry.status, dry.stderr).toBe(0);
  expect((await f.remote())).toBe(f.a);
});

it("refuses bad role, origin, URL rewriting and disabled test mode", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => fs.writeFileSync(path.join(f.main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: auditor\n"),
    async (f: Awaited<ReturnType<typeof fixture>>) => (await git(f.main, "remote", "set-url", "origin", "https://github.com/anzchy/mdpro.git")),
    async (f: Awaited<ReturnType<typeof fixture>>) => (await git(f.main, "config", "url.file:///decoy/.pushInsteadOf", f.bare)),
  ]) {
    const f = (await fixture());
    (await f.add("docs/a.md"));
    await change(f);
    expect((await f.run()).status).not.toBe(0);
    expect((await f.remote())).toBe(f.a);
  }
  const f = (await fixture());
  (await f.add("docs/a.md"));
  for (const extra of [{ MDPRO_GUARD_TEST: "0" }, { GIT_CONFIG_COUNT: "0" }, { GIT_CONFIG_PARAMETERS: "'x.y=z'" }]) {
    expect((await f.run(["--docs-only"], extra)).status).not.toBe(0);
    expect((await f.remote())).toBe(f.a);
  }
});

it("rejects a concurrent remote master update without forcing", async () => {
  const f = (await fixture());
  (await f.add("docs/a.md"));
  (await git(f.main, "switch", "-qc", "race", f.a));
  const concurrent = (await f.add("docs/race.md"));
  (await git(f.main, "push", "-q", f.bare, `${concurrent}:refs/heads/race-holder`));
  (await git(f.main, "switch", "-q", "master"));
  const gitBin = (await cmd(f.main, "which", ["git"])).stdout.trim();
  const shim = path.join(f.dir, "bin/git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = push ]; then '${gitBin}' --git-dir '${f.bare}' update-ref refs/heads/master '${concurrent}'; fi\nexec '${gitBin}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
  const result = (await f.run());
  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toContain("non-fast-forward");
  expect((await f.remote())).toBe(concurrent);
});

it("refuses a forged delegator overlay in a linked master worktree", async () => {
  const f = (await fixture());
  (await f.add("docs/a.md"));
  (await git(f.main, "switch", "-qc", "side"));
  const linked = path.join(f.dir, "linked");
  (await git(f.main, "worktree", "add", "-q", linked, "master"));
  fs.mkdirSync(path.join(linked, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(linked, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(linked, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs", "land-guard.mjs"]) {
    fs.copyFileSync(path.join(root, "scripts/codex-rules", name), path.join(linked, "scripts/codex-rules", name));
  }
  const result = (await cmd(linked, process.execPath, ["scripts/codex-rules/land-guard.mjs", "--docs-only"],
    { ...f.env, MDPRO_GUARD_TEST_MAIN: linked }));
  expect(result.status).not.toBe(0);
  expect((await f.remote())).toBe(f.a);
});

it("pushes the validated docs OID even if local HEAD moves before git push", async () => {
  const f = (await fixture());
  const b = (await f.add("docs/a.md"));
  (await git(f.main, "switch", "-qc", "candidate"));
  const c = (await f.add("src/not-reviewed.ts"));
  (await git(f.main, "switch", "-q", "master"));
  const realGit = (await cmd(f.main, "which", ["git"])).stdout.trim();
  const shim = path.join(f.dir, "bin/git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = push ]; then '${realGit}' -C '${f.main}' update-ref refs/heads/master '${c}'; fi\nexec '${realGit}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
  const result = (await f.run());
  expect(result.status, result.stderr).toBe(0);
  expect((await f.remote())).toBe(b);
  expect((await git(f.main, "rev-parse", "master"))).toBe(c);
});

it("accepts Unicode and newline docs names with Git's default quoting", async () => {
  for (const name of ["docs/审计.md", "docs/line\nbreak.md"]) {
    const f = (await fixture());
    const b = (await f.add(name));
    const result = (await f.run());
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    expect((await f.remote())).toBe(b);
  }
  const excluded = (await fixture());
  (await excluded.add("docs/审计.md")); (await excluded.add("src/错误.ts"));
  expect((await excluded.run()).status).not.toBe(0);
  expect((await excluded.remote())).toBe(excluded.a);
});

it("refuses a rename out of docs, wrong branch, staged work and nonancestor remote", async () => {
  const rename = (await fixture());
  (await rename.add("docs/a.md"));
  fs.mkdirSync(path.join(rename.main, "src"));
  (await git(rename.main, "mv", "docs/a.md", "src/a.md"));
  (await git(rename.main, "commit", "-qm", "rename out of docs"));
  expect((await rename.run()).status).not.toBe(0);
  expect((await rename.remote())).toBe(rename.a);

  const branch = (await fixture()); (await branch.add("docs/a.md"));
  (await git(branch.main, "switch", "-qc", "topic"));
  expect((await branch.run()).status).not.toBe(0);
  expect((await branch.remote())).toBe(branch.a);

  const staged = (await fixture()); (await staged.add("docs/a.md"));
  fs.writeFileSync(path.join(staged.main, "staged.txt"), "staged\n");
  (await git(staged.main, "add", "staged.txt"));
  expect((await staged.run()).status).not.toBe(0);
  expect((await staged.remote())).toBe(staged.a);

  const diverged = (await fixture()); (await diverged.add("docs/a.md"));
  (await git(diverged.main, "switch", "-qc", "concurrent", diverged.a));
  const c = (await diverged.add("docs/concurrent.md"));
  (await git(diverged.main, "push", "-q", diverged.bare, `${c}:refs/heads/master`));
  (await git(diverged.main, "switch", "-q", "master"));
  expect((await diverged.run()).status).not.toBe(0);
  expect((await diverged.remote())).toBe(c);
});

// D355 (ADR-0147 WI-1 decision 3 and 5): references/*.md is docs-only, and a docs-only range that touches a counted
// file runs the budget and citation tests on the candidate's own tree before it pushes.
const REFS = ".agents/skills/mdpro-delegator/references";
const RULE_TESTS = ["tests/tooling/always-on-budget.test.ts", "tests/tooling/rule-citations.test.ts"];

it("L1: accepts a delegator references/*.md file as docs-only", { timeout: 30_000 }, async () => {
  for (const args of [["--docs-only", "--dry-run"], ["--docs-only"]]) {
    const f = (await fixture());
    const head = (await f.add(`${REFS}/x.md`));
    const result = (await f.run(args));
    expect(result.status, result.stderr).toBe(0);
    expect((await f.remote())).toBe(args.includes("--dry-run") ? f.a : head);
  }
});

it("L2, L6: refuses templates and every path next to references/*.md, leaving the remote unchanged", { timeout: 60_000 }, async () => {
  for (const name of [`${REFS}/templates/x.md`, `${REFS}/templates/sub/x.md`, `${REFS}/sub/x.md`, `${REFS}/x.mjs`,
    ".agents/skills/other/references/x.md", ".agents/skills/mdpro-delegator/SKILL.md",
    ".agents/skills/mdpro-delegator/scripts/x.sh"]) {
    const f = (await fixture());
    (await f.add(name));
    const result = (await f.run());
    expect(result.status, name).not.toBe(0);
    expect(result.stderr, name).toContain("disallowed path");
    expect((await f.remote()), name).toBe(f.a);
  }
});

it("L3: refuses a counted file whose rule tests are red, naming the test, in dry-run and real mode", { timeout: 60_000 }, async () => {
  for (const name of [".claude/rules/x.md", "AGENTS.md", "CLAUDE.md", "docs/agents/x.md"]) {
    for (const args of [["--docs-only", "--dry-run"], ["--docs-only"]]) {
      const f = (await fixture());
      (await f.add(name));
      const result = (await f.run(args, { STUB_STATUS: "1" }));
      expect(result.status, `${name} ${args}`).not.toBe(0);
      expect(result.stderr, name).toContain("always-on-budget.test.ts");
      expect((await f.remote()), name).toBe(f.a);
    }
  }
});

it("L4, L9, L10: runs exactly the two rule tests on an export of the candidate, then pushes", { timeout: 30_000 }, async () => {
  const f = (await fixture());
  const head = (await f.add("CLAUDE.md", "GREEN\n"));
  const result = (await f.run(["--docs-only"]));
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("rule tests passed");
  expect((await f.remote())).toBe(head);
  const log = f.log();
  expect(log.split("\n").filter((l) => l.startsWith("arg=")).map((l) => l.slice(4))).toEqual(RULE_TESTS);
  const cwd = log.split("\n").find((l) => l.startsWith("cwd="))!.slice(4);
  expect(cwd).not.toBe(fs.realpathSync(f.main));
  expect(cwd.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
  expect(log).toContain("claude=GREEN");
  expect(fs.existsSync(cwd), "the export is removed afterwards").toBe(false);
});

it("L5: a docs-only range with no Markdown and no section map does not run the rule tests", async () => {
  const f = (await fixture());
  const head = (await f.add("docs/images/x.png", "png\n"));
  const result = (await f.run(["--docs-only"], { STUB_STATUS: "1" }));
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("rule tests not run");
  expect(f.log()).toBe("");
  expect((await f.remote())).toBe(head);
});

it("L7, L10: references/guide.md, a docs/guide file, an agent file and the section map each trigger the rule tests", { timeout: 60_000 }, async () => {
  for (const name of [`${REFS}/guide.md`, "docs/guide/g.md", ".claude/agents/a.md", "docs/reference/adr-0147-rule-section-map.json"]) {
    const f = (await fixture());
    (await f.add(name));
    const result = (await f.run(["--docs-only"], { STUB_STATUS: "1" }));
    expect(result.status, name).not.toBe(0);
    expect(f.log(), name).toContain("arg=tests/tooling/rule-citations.test.ts");
    expect((await f.remote()), name).toBe(f.a);
  }
});

it("L8: tests the committed tree, so an unstaged green edit over a committed red file is refused", async () => {
  const f = (await fixture());
  (await f.add("CLAUDE.md", "RED\n"));
  fs.writeFileSync(path.join(f.main, "CLAUDE.md"), "GREEN\n");
  const result = (await f.run(["--docs-only"]));
  expect(result.status).not.toBe(0);
  expect(f.log()).toContain("claude=RED");
  expect(f.log()).not.toContain("claude=GREEN");
  expect((await f.remote())).toBe(f.a);
});

it("L9: the runner override is honoured only in guard test mode", async () => {
  const { ruleTestCommand } = await import("../../scripts/codex-rules/land-guard.mjs");
  const stubbed = ruleTestCommand({ MDPRO_GUARD_TEST: "1", MDPRO_GUARD_RULE_TEST_RUNNER: "/tmp/stub" });
  expect(stubbed).toEqual(["/tmp/stub", RULE_TESTS]);
  const real = ruleTestCommand({ MDPRO_GUARD_RULE_TEST_RUNNER: "/tmp/stub" });
  expect(real[0]).toBe(process.execPath);
  expect(real[1].slice(-3)).toEqual(["run", ...RULE_TESTS]);
});

it("L9: the real runner passes this tree and refuses it with a padded CLAUDE.md", { timeout: 240_000 }, async () => {
  const { runRuleTests } = await import("../../scripts/codex-rules/land-guard.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d355-tree-"));
  made.push(tmp);
  const genv = { GIT_INDEX_FILE: path.join(tmp, "index") };
  const g = async (args: string[], input?: string) => {
    const r = await new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...genv } },
        (error, stdout, stderr) => resolve({ status: error ? 1 : 0, stdout, stderr }));
      if (input !== undefined) { child.stdin!.end(input); }
    });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };
  // A tree of the working state, built in a private index so the repository's own index is untouched.
  await g(["read-tree", "HEAD"]);
  const names = await g(["ls-files", "-co", "--exclude-standard", "-z"]);
  await g(["update-index", "--add", "--remove", "-z", "--stdin"], names + "\0");
  const tree = await g(["write-tree"]);
  const green = runRuleTests(tree);
  expect(green.status, green.output.slice(-2000)).toBe(0);
  const padded = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8") + "x".repeat(2_000) + "\n";
  const blob = await g(["hash-object", "-w", "--stdin"], padded);
  await g(["update-index", "--cacheinfo", `100644,${blob},CLAUDE.md`]);
  const red = runRuleTests(await g(["write-tree"]));
  expect(red.status).not.toBe(0);
  expect(red.output).toContain("always-on-budget.test.ts");
});
