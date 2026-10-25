// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const made: string[] = [];
function cmd(cwd: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}
function git(dir: string, ...args: string[]) {
  const r = cmd(dir, "git", args);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-docs-"));
  made.push(dir);
  const main = path.join(dir, "main"), bare = path.join(dir, "origin.git"), bin = path.join(dir, "bin");
  fs.mkdirSync(main); fs.mkdirSync(bin);
  git(dir, "init", "-q", "--bare", bare);
  git(main, "init", "-q", "-b", "master");
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "t@t");
  fs.writeFileSync(path.join(main, "base.txt"), "A\n");
  git(main, "add", "base.txt"); git(main, "commit", "-qm", "A");
  const a = git(main, "rev-parse", "HEAD");
  git(main, "remote", "add", "origin", bare);
  git(main, "push", "-q", bare, "HEAD:refs/heads/master");
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
  const add = (name: string, value = "content\n") => {
    const target = path.join(main, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    git(main, "add", name); git(main, "commit", "-qm", `add ${name}`);
    return git(main, "rev-parse", "HEAD");
  };
  const run = (args: string[] = ["--docs-only"], extra: NodeJS.ProcessEnv = {}) =>
    cmd(main, process.execPath, ["scripts/codex-rules/land-guard.mjs", ...args], { ...env, ...extra });
  const remote = () => git(dir, "--git-dir", bare, "rev-parse", "refs/heads/master");
  return { dir, main, bare, a, env, add, run, remote };
}
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("pushes each allowed docs-only path and a mixed allowed range without gh", { timeout: 30_000 }, () => {
  for (const name of ["docs/a.md", "design/a.md", "design/nested/a.md", "CHANGELOG.md", "CLAUDE.md",
    "AGENTS.md", ".claude/rules/a.md", ".claude/agents/a.md"]) {
    const f = fixture();
    const head = f.add(name);
    const result = f.run();
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    expect(f.remote()).toBe(head);
  }
  const mixed = fixture();
  mixed.add("docs/a.md"); mixed.add(".claude/rules/a.md"); const head = mixed.add("design/deep/a.md");
  expect(mixed.run().status).toBe(0);
  expect(mixed.remote()).toBe(head);
});

it("pushes only master when Git is configured to follow annotated tags", () => {
  const f = fixture();
  const head = f.add("docs/tagged.md");
  git(f.main, "tag", "-a", "release-candidate", "-m", "candidate tag", head);
  git(f.main, "config", "push.followTags", "true");
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(f.remote()).toBe(head);
  expect(git(f.dir, "--git-dir", f.bare, "for-each-ref", "--format=%(refname) %(objectname)"))
    .toBe(`refs/heads/master ${head}`);
});

it("refuses every excluded path and mixed docs/code changes", { timeout: 30_000 }, () => {
  for (const name of ["src/x.ts", "src-tauri/x.rs", "tests/x.ts", "scripts/x.mjs", ".codex/x",
    ".github/x", ".claude/hooks/x", ".claude/settings.json", "package.json", "pnpm-lock.yaml",
    "design/x.png", ".claude/rules/sub/x.md"]) {
    const f = fixture();
    f.add(name);
    expect(f.run().status, name).not.toBe(0);
    expect(f.remote()).toBe(f.a);
  }
  for (const first of ["docs/a.md", "src/x.ts"]) {
    const f = fixture();
    f.add(first); f.add(first === "docs/a.md" ? "src/x.ts" : "docs/a.md");
    expect(f.run().status).not.toBe(0);
    expect(f.remote()).toBe(f.a);
  }
});

it("checks net tree range, so a reverted source change does not block docs", () => {
  const f = fixture();
  f.add("src/x.ts");
  fs.unlinkSync(path.join(f.main, "src/x.ts"));
  git(f.main, "add", "-u", "src/x.ts"); git(f.main, "commit", "-qm", "revert source");
  const head = f.add("docs/a.md");
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(f.remote()).toBe(head);
});

it("refuses no-ahead and extra options, leaving remote master unchanged", () => {
  const f = fixture();
  expect(f.run().status).not.toBe(0);
  f.add("docs/a.md");
  for (const args of [["--docs-only", "--force"], ["--docs-only", "--dry-run", "--dry-run"]]) {
    expect(f.run(args).status).not.toBe(0);
    expect(f.remote()).toBe(f.a);
  }
  const dry = f.run(["--docs-only", "--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect(f.remote()).toBe(f.a);
});

it("refuses bad role, origin, URL rewriting and disabled test mode", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => fs.writeFileSync(path.join(f.main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: auditor\n"),
    (f: ReturnType<typeof fixture>) => git(f.main, "remote", "set-url", "origin", "https://github.com/anzchy/mdpro.git"),
    (f: ReturnType<typeof fixture>) => git(f.main, "config", "url.file:///decoy/.pushInsteadOf", f.bare),
  ]) {
    const f = fixture();
    f.add("docs/a.md");
    change(f);
    expect(f.run().status).not.toBe(0);
    expect(f.remote()).toBe(f.a);
  }
  const f = fixture();
  f.add("docs/a.md");
  for (const extra of [{ MDPRO_GUARD_TEST: "0" }, { GIT_CONFIG_COUNT: "0" }, { GIT_CONFIG_PARAMETERS: "'x.y=z'" }]) {
    expect(f.run(["--docs-only"], extra).status).not.toBe(0);
    expect(f.remote()).toBe(f.a);
  }
});

it("rejects a concurrent remote master update without forcing", () => {
  const f = fixture();
  f.add("docs/a.md");
  git(f.main, "switch", "-qc", "race", f.a);
  const concurrent = f.add("docs/race.md");
  git(f.main, "push", "-q", f.bare, `${concurrent}:refs/heads/race-holder`);
  git(f.main, "switch", "-q", "master");
  const gitBin = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const shim = path.join(f.dir, "bin/git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = push ]; then '${gitBin}' --git-dir '${f.bare}' update-ref refs/heads/master '${concurrent}'; fi\nexec '${gitBin}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
  const result = f.run();
  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toContain("non-fast-forward");
  expect(f.remote()).toBe(concurrent);
});

it("refuses a forged delegator overlay in a linked master worktree", () => {
  const f = fixture();
  f.add("docs/a.md");
  git(f.main, "switch", "-qc", "side");
  const linked = path.join(f.dir, "linked");
  git(f.main, "worktree", "add", "-q", linked, "master");
  fs.mkdirSync(path.join(linked, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(linked, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(linked, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs", "land-guard.mjs"]) {
    fs.copyFileSync(path.join(root, "scripts/codex-rules", name), path.join(linked, "scripts/codex-rules", name));
  }
  const result = cmd(linked, process.execPath, ["scripts/codex-rules/land-guard.mjs", "--docs-only"],
    { ...f.env, MDPRO_GUARD_TEST_MAIN: linked });
  expect(result.status).not.toBe(0);
  expect(f.remote()).toBe(f.a);
});

it("pushes the validated docs OID even if local HEAD moves before git push", () => {
  const f = fixture();
  const b = f.add("docs/a.md");
  git(f.main, "switch", "-qc", "candidate");
  const c = f.add("src/not-reviewed.ts");
  git(f.main, "switch", "-q", "master");
  const realGit = cmd(f.main, "which", ["git"]).stdout.trim();
  const shim = path.join(f.dir, "bin/git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = push ]; then '${realGit}' -C '${f.main}' update-ref refs/heads/master '${c}'; fi\nexec '${realGit}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(f.remote()).toBe(b);
  expect(git(f.main, "rev-parse", "master")).toBe(c);
});

it("accepts Unicode and newline docs names with Git's default quoting", () => {
  for (const name of ["docs/审计.md", "docs/line\nbreak.md"]) {
    const f = fixture();
    const b = f.add(name);
    const result = f.run();
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    expect(f.remote()).toBe(b);
  }
  const excluded = fixture();
  excluded.add("docs/审计.md"); excluded.add("src/错误.ts");
  expect(excluded.run().status).not.toBe(0);
  expect(excluded.remote()).toBe(excluded.a);
});

it("refuses a rename out of docs, wrong branch, staged work and nonancestor remote", () => {
  const rename = fixture();
  rename.add("docs/a.md");
  fs.mkdirSync(path.join(rename.main, "src"));
  git(rename.main, "mv", "docs/a.md", "src/a.md");
  git(rename.main, "commit", "-qm", "rename out of docs");
  expect(rename.run().status).not.toBe(0);
  expect(rename.remote()).toBe(rename.a);

  const branch = fixture(); branch.add("docs/a.md");
  git(branch.main, "switch", "-qc", "topic");
  expect(branch.run().status).not.toBe(0);
  expect(branch.remote()).toBe(branch.a);

  const staged = fixture(); staged.add("docs/a.md");
  fs.writeFileSync(path.join(staged.main, "staged.txt"), "staged\n");
  git(staged.main, "add", "staged.txt");
  expect(staged.run().status).not.toBe(0);
  expect(staged.remote()).toBe(staged.a);

  const diverged = fixture(); diverged.add("docs/a.md");
  git(diverged.main, "switch", "-qc", "concurrent", diverged.a);
  const c = diverged.add("docs/concurrent.md");
  git(diverged.main, "push", "-q", diverged.bare, `${c}:refs/heads/master`);
  git(diverged.main, "switch", "-q", "master");
  expect(diverged.run().status).not.toBe(0);
  expect(diverged.remote()).toBe(c);
});
