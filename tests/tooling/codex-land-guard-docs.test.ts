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
  const env = { PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main, MDPRO_GUARD_TEST_ORIGIN: bare };
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
  return { dir, main, bare, a, env, add, run, remote };
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
