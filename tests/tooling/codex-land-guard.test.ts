// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const made: string[] = [];
function call(cwd: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}
function git(dir: string, ...args: string[]) {
  const r = call(dir, "git", args);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-land-"));
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
  git(main, "switch", "-qc", "feature");
  fs.writeFileSync(path.join(main, "feature.txt"), "B\n");
  git(main, "add", "feature.txt"); git(main, "commit", "-qm", "B");
  const b = git(main, "rev-parse", "HEAD");
  git(main, "switch", "-q", "master");
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase "$MDPRO_GH_MODE" in\nnone) echo '[]'; exit 0;;\ntwo) printf '[{"headRefOid":"%s","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]},{"headRefOid":"%s","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n' "$MDPRO_GH_HEAD" "$MDPRO_GH_HEAD"; exit 0;;\nmissingci) printf '[{"headRefOid":"%s","statusCheckRollup":[]}]\\n' "$MDPRO_GH_HEAD"; exit 0;;\nesac\nprintf '[{"headRefOid":"%s","statusCheckRollup":[{"name":"ci-gate","conclusion":"%s"}]}]\\n' "$MDPRO_GH_HEAD" "$MDPRO_GH_CI"\n`);
  fs.chmodSync(gh, 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main, MDPRO_GUARD_TEST_ORIGIN: bare, MDPRO_GH_HEAD: b,
    MDPRO_GH_CI: "SUCCESS", MDPRO_GH_MODE: "one" };
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => call(main, process.execPath,
    ["scripts/codex-rules/land-guard.mjs", ...args], { ...env, ...extra });
  const local = () => git(main, "rev-parse", "refs/heads/master");
  const remote = () => git(dir, "--git-dir", bare, "rev-parse", "refs/heads/master");
  return { dir, main, bare, a, b, run, local, remote, env };
}
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("dry runs without moving refs, then lands audited head by fast-forward", () => {
  const f = fixture();
  const dry = f.run([f.b, "--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  const landed = f.run([f.b]);
  expect(landed.status, landed.stderr).toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.b, f.b]);
  expect(landed.stdout).toContain("verifier");
  expect(landed.stdout).toContain("audit");
});

it("lands only master when Git is configured to follow annotated tags", () => {
  const f = fixture();
  git(f.main, "tag", "-a", "release-candidate", "-m", "candidate tag", f.b);
  git(f.main, "config", "push.followTags", "true");
  const result = f.run([f.b]);
  expect(result.status, result.stderr).toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.b, f.b]);
  expect(git(f.dir, "--git-dir", f.bare, "for-each-ref", "--format=%(refname) %(objectname)"))
    .toBe(`refs/heads/master ${f.b}`);
});

it("refuses bad role, staged work, wrong branch, stale PR and CI states", () => {
  const f = fixture();
  const overlay = path.join(f.main, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(overlay, "# Local mdpro role: implementor\n");
  expect(f.run([f.b]).status).not.toBe(0);
  fs.writeFileSync(overlay, "# Local mdpro role: delegator\n");
  fs.writeFileSync(path.join(f.main, "staged.txt"), "staged");
  git(f.main, "add", "staged.txt");
  expect(f.run([f.b]).status).not.toBe(0);
  git(f.main, "reset", "-q", "--", "staged.txt");
  git(f.main, "switch", "-q", "feature");
  expect(f.run([f.b]).status).not.toBe(0);
  git(f.main, "switch", "-q", "master");
  for (const extra of [
    { MDPRO_GH_MODE: "none" }, { MDPRO_GH_MODE: "two" }, { MDPRO_GH_MODE: "missingci" },
    { MDPRO_GH_HEAD: f.a }, { MDPRO_GH_CI: "PENDING" }, { MDPRO_GH_CI: "FAILURE" },
  ]) {
    expect(f.run([f.b], extra).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
});

it("refuses origin and Git rewrite overrides before landing", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => git(f.main, "remote", "set-url", "origin", "https://github.com/anzchy/mdpro.git"),
    (f: ReturnType<typeof fixture>) => git(f.main, "config", "url.file:///decoy/.insteadOf", f.bare),
  ]) {
    const f = fixture();
    change(f);
    expect(f.run([f.b]).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
  const f = fixture();
  for (const extra of [{ MDPRO_GUARD_TEST: "0" }, { GIT_CONFIG_COUNT: "0" }, { GIT_CONFIG_PARAMETERS: "'x.y=z'" }]) {
    expect(f.run([f.b], extra).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
});

it("allows unrelated unstaged and untracked work on a successful landing", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.main, "base.txt"), "dirty\n");
  fs.writeFileSync(path.join(f.main, "untracked.txt"), "private\n");
  const r = f.run([f.b]);
  expect(r.status, r.stderr).toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.b, f.b]);
  expect(fs.readFileSync(path.join(f.main, "base.txt"), "utf8")).toBe("dirty\n");
  expect(fs.readFileSync(path.join(f.main, "untracked.txt"), "utf8")).toBe("private\n");
});

it("refuses a remote race and restores local master without losing dirty files", () => {
  const f = fixture();
  git(f.main, "switch", "-qc", "race");
  fs.writeFileSync(path.join(f.main, "race.txt"), "C\n");
  git(f.main, "add", "race.txt"); git(f.main, "commit", "-qm", "C");
  const c = git(f.main, "rev-parse", "HEAD");
  git(f.main, "push", "-q", f.bare, `${c}:refs/heads/race-holder`);
  git(f.main, "switch", "-q", "master");
  fs.writeFileSync(path.join(f.main, "base.txt"), "dirty tracked\n");
  fs.writeFileSync(path.join(f.main, "untracked.txt"), "dirty untracked\n");
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, fs.readFileSync(gh, "utf8").replace("#!/bin/sh\n",
    `#!/bin/sh\ngit --git-dir '${f.bare}' update-ref refs/heads/master '${c}'\n`));
  const hook = path.join(f.main, ".git/hooks/pre-push");
  fs.writeFileSync(hook, `#!/bin/sh\ngit --git-dir '${f.bare}' update-ref refs/heads/master '${c}'\n`);
  fs.chmodSync(hook, 0o755);
  const r = f.run([f.b]);
  expect(r.status, `${r.stderr} local=${f.local()} remote=${f.remote()} c=${c}`).not.toBe(0);
  expect(r.stderr).toContain("non-fast-forward");
  expect([f.local(), f.remote()], r.stderr).toEqual([f.a, c]);
  expect(fs.readFileSync(path.join(f.main, "base.txt"), "utf8")).toBe("dirty tracked\n");
  expect(fs.readFileSync(path.join(f.main, "untracked.txt"), "utf8")).toBe("dirty untracked\n");
});

it("refuses a non-descendant candidate, missing CI and extra flags", () => {
  const f = fixture();
  git(f.main, "switch", "--orphan", "unrelated");
  fs.writeFileSync(path.join(f.main, "other.txt"), "O\n");
  git(f.main, "add", "other.txt"); git(f.main, "commit", "-qm", "O");
  const other = git(f.main, "rev-parse", "HEAD");
  git(f.main, "switch", "-q", "master");
  for (const [args, extra] of [
    [[other], { MDPRO_GH_HEAD: other }],
    [[f.b], { MDPRO_GH_CI: "" }],
    [[f.b, "--force"], {}],
    [[f.b, "--dry-run", "--dry-run"], {}],
  ] as [string[], Record<string, string>][]) {
    expect(f.run(args, extra).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
});

it("lands the validated OID when the candidate ref moves after PR validation", () => {
  const f = fixture();
  git(f.main, "switch", "-q", "feature");
  fs.writeFileSync(path.join(f.main, "feature.txt"), "C\n");
  git(f.main, "add", "feature.txt"); git(f.main, "commit", "-qm", "C");
  const c = git(f.main, "rev-parse", "HEAD");
  git(f.main, "switch", "-q", "master");
  git(f.main, "update-ref", "refs/heads/feature", f.b);
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ngit -C '${f.main}' update-ref refs/heads/feature '${c}'\nprintf '[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n'\n`);
  fs.chmodSync(gh, 0o755);
  const result = f.run(["feature"]);
  expect(result.status, result.stderr).toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.b, f.b]);
  expect(git(f.main, "rev-parse", "feature")).toBe(c);
});

it("pins PR lookup to anzchy/mdpro despite an ambient GH_REPO", () => {
  const f = fixture();
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase " $* " in *" --repo anzchy/mdpro "*) ;; *) echo '[]'; exit 0;; esac\nprintf '[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n'\n`);
  fs.chmodSync(gh, 0o755);
  const r = f.run([f.b], { GH_REPO: "attacker/decoy" });
  expect(r.status, r.stderr).toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.b, f.b]);
});

it("rejects missing and symlinked role markers and a linked master tree", () => {
  for (const change of ["missing", "symlink"]) {
    const f = fixture();
    const overlay = path.join(f.main, ".codex/rules/mdpro-role.rules");
    fs.unlinkSync(overlay);
    if (change === "symlink") fs.symlinkSync(path.join(f.main, ".codex/rules/mdpro.rules"), overlay);
    expect(f.run([f.b]).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
  const f = fixture();
  git(f.main, "switch", "-qc", "side");
  const linked = path.join(f.dir, "linked");
  git(f.main, "worktree", "add", "-q", linked, "master");
  fs.mkdirSync(path.join(linked, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(linked, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(linked, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs", "land-guard.mjs"]) fs.copyFileSync(path.join(root, "scripts/codex-rules", name), path.join(linked, "scripts/codex-rules", name));
  const r = call(linked, process.execPath, ["scripts/codex-rules/land-guard.mjs", f.b], { ...f.env, MDPRO_GUARD_TEST_MAIN: linked });
  expect(r.status).not.toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
});

it("rejects multiple push URLs, symlink and nonbare origins with unchanged decoy refs", () => {
  for (const kind of ["multiple", "symlink", "nonbare"]) {
    const f = fixture();
    const decoy = path.join(f.dir, "decoy.git");
    git(f.dir, "init", "-q", "--bare", decoy);
    const decoyBefore = git(f.dir, "--git-dir", decoy, "for-each-ref", "--format=%(refname) %(objectname)");
    if (kind === "multiple") {
      git(f.main, "remote", "set-url", "--push", "origin", f.bare);
      git(f.main, "remote", "set-url", "--add", "--push", "origin", decoy);
    } else {
      const url = kind === "symlink" ? path.join(f.dir, "link.git") : f.main;
      if (kind === "symlink") fs.symlinkSync(f.main, url);
      git(f.main, "remote", "set-url", "origin", url);
      f.env.MDPRO_GUARD_TEST_ORIGIN = url;
    }
    expect(f.run([f.b], f.env).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
    expect(git(f.dir, "--git-dir", decoy, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(decoyBefore);
  }
});

it("rejects wrong-shaped PR JSON and a green check under another name", () => {
  const f = fixture();
  const gh = path.join(f.dir, "bin/gh");
  for (const body of [
    '{"headRefOid":"bad"}',
    `[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"other","conclusion":"SUCCESS"}]}]`,
  ]) {
    fs.writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`); fs.chmodSync(gh, 0o755);
    expect(f.run([f.b]).status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
});

it("refuses extra PR landing arguments without moving local or remote master", () => {
  const f = fixture();
  for (const extra of [["--mirror"], ["extra:refs/heads/other"], ["--dry-run", "--dry-run"]]) {
    const result = f.run([f.b, ...extra]);
    expect(result.status).not.toBe(0);
    expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
  }
});

it("refuses PR landing when only the ambient decoy repository has a matching PR", () => {
  const f = fixture();
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase " $* " in *" --repo anzchy/mdpro "*) echo '[]';; *) printf '[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n';; esac\n`);
  fs.chmodSync(gh, 0o755);
  const result = f.run([f.b], { GH_REPO: "attacker/decoy" });
  expect(result.status).not.toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
});

it("rejects an absolute script invocation from a different working directory", () => {
  const f = fixture();
  const result = call(f.dir, process.execPath,
    [path.join(f.main, "scripts/codex-rules/land-guard.mjs"), f.b], f.env);
  expect(result.status).not.toBe(0);
  expect([f.local(), f.remote()]).toEqual([f.a, f.a]);
});
