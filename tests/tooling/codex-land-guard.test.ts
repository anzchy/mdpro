// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const made: string[] = [];
function call(cwd: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(resolve => {
    execFile(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ status: error ? 1 : 0, stdout, stderr });
    });
  });
}
async function git(dir: string, ...args: string[]) {
  const r = await call(dir, "git", args);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-land-"));
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
  (await git(main, "switch", "-qc", "feature"));
  fs.writeFileSync(path.join(main, "feature.txt"), "B\n");
  (await git(main, "add", "feature.txt")); (await git(main, "commit", "-qm", "B"));
  const b = (await git(main, "rev-parse", "HEAD"));
  (await git(main, "switch", "-q", "master"));
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase "$MDPRO_GH_MODE" in\nnone) echo '[]'; exit 0;;\ntwo) printf '[{"headRefOid":"%s","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]},{"headRefOid":"%s","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n' "$MDPRO_GH_HEAD" "$MDPRO_GH_HEAD"; exit 0;;\nmissingci) printf '[{"headRefOid":"%s","statusCheckRollup":[]}]\\n' "$MDPRO_GH_HEAD"; exit 0;;\nesac\nprintf '[{"headRefOid":"%s","statusCheckRollup":[{"name":"ci-gate","conclusion":"%s"}]}]\\n' "$MDPRO_GH_HEAD" "$MDPRO_GH_CI"\n`);
  fs.chmodSync(gh, 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", MDPRO_GUARD_TEST: "1",
    MDPRO_GUARD_TEST_MAIN: main, MDPRO_GUARD_TEST_ORIGIN: bare, MDPRO_GH_HEAD: b,
    MDPRO_GH_CI: "SUCCESS", MDPRO_GH_MODE: "one" };
  const run = async (args: string[], extra: NodeJS.ProcessEnv = {}) => (await call(main, process.execPath,
    ["scripts/codex-rules/land-guard.mjs", ...args], { ...env, ...extra }));
  const local = async () => (await git(main, "rev-parse", "refs/heads/master"));
  const remote = async () => (await git(dir, "--git-dir", bare, "rev-parse", "refs/heads/master"));
  return { dir, main, bare, a, b, run, local, remote, env };
}
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("dry runs without moving refs, then lands audited head by fast-forward", async () => {
  const f = (await fixture());
  const dry = (await f.run([f.b, "--dry-run"]));
  expect(dry.status, dry.stderr).toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  const landed = (await f.run([f.b]));
  expect(landed.status, landed.stderr).toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.b, f.b]);
  expect(landed.stdout).toContain("verifier");
  expect(landed.stdout).toContain("audit");
});

it("lands only master when Git is configured to follow annotated tags", async () => {
  const f = (await fixture());
  (await git(f.main, "tag", "-a", "release-candidate", "-m", "candidate tag", f.b));
  (await git(f.main, "config", "push.followTags", "true"));
  const result = (await f.run([f.b]));
  expect(result.status, result.stderr).toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.b, f.b]);
  expect((await git(f.dir, "--git-dir", f.bare, "for-each-ref", "--format=%(refname) %(objectname)")))
    .toBe(`refs/heads/master ${f.b}`);
});

it("refuses bad role, staged work, wrong branch, stale PR and CI states", async () => {
  const f = (await fixture());
  const overlay = path.join(f.main, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(overlay, "# Local mdpro role: implementor\n");
  expect((await f.run([f.b])).status).not.toBe(0);
  fs.writeFileSync(overlay, "# Local mdpro role: delegator\n");
  fs.writeFileSync(path.join(f.main, "staged.txt"), "staged");
  (await git(f.main, "add", "staged.txt"));
  expect((await f.run([f.b])).status).not.toBe(0);
  (await git(f.main, "reset", "-q", "--", "staged.txt"));
  (await git(f.main, "switch", "-q", "feature"));
  expect((await f.run([f.b])).status).not.toBe(0);
  (await git(f.main, "switch", "-q", "master"));
  for (const extra of [
    { MDPRO_GH_MODE: "none" }, { MDPRO_GH_MODE: "two" }, { MDPRO_GH_MODE: "missingci" },
    { MDPRO_GH_HEAD: f.a }, { MDPRO_GH_CI: "PENDING" }, { MDPRO_GH_CI: "FAILURE" },
  ]) {
    expect((await f.run([f.b], extra)).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
});

it("refuses origin and Git rewrite overrides before landing", async () => {
  for (const change of [
    async (f: Awaited<ReturnType<typeof fixture>>) => (await git(f.main, "remote", "set-url", "origin", "https://github.com/anzchy/mdpro.git")),
    async (f: Awaited<ReturnType<typeof fixture>>) => (await git(f.main, "config", "url.file:///decoy/.insteadOf", f.bare)),
  ]) {
    const f = (await fixture());
    await change(f);
    expect((await f.run([f.b])).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
  const f = (await fixture());
  for (const extra of [{ MDPRO_GUARD_TEST: "0" }, { GIT_CONFIG_COUNT: "0" }, { GIT_CONFIG_PARAMETERS: "'x.y=z'" }]) {
    expect((await f.run([f.b], extra)).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
});

it("allows unrelated unstaged and untracked work on a successful landing", async () => {
  const f = (await fixture());
  fs.writeFileSync(path.join(f.main, "base.txt"), "dirty\n");
  fs.writeFileSync(path.join(f.main, "untracked.txt"), "private\n");
  const r = (await f.run([f.b]));
  expect(r.status, r.stderr).toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.b, f.b]);
  expect(fs.readFileSync(path.join(f.main, "base.txt"), "utf8")).toBe("dirty\n");
  expect(fs.readFileSync(path.join(f.main, "untracked.txt"), "utf8")).toBe("private\n");
});

it("refuses a remote race and restores local master without losing dirty files", async () => {
  const f = (await fixture());
  (await git(f.main, "switch", "-qc", "race"));
  fs.writeFileSync(path.join(f.main, "race.txt"), "C\n");
  (await git(f.main, "add", "race.txt")); (await git(f.main, "commit", "-qm", "C"));
  const c = (await git(f.main, "rev-parse", "HEAD"));
  (await git(f.main, "push", "-q", f.bare, `${c}:refs/heads/race-holder`));
  (await git(f.main, "switch", "-q", "master"));
  fs.writeFileSync(path.join(f.main, "base.txt"), "dirty tracked\n");
  fs.writeFileSync(path.join(f.main, "untracked.txt"), "dirty untracked\n");
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, fs.readFileSync(gh, "utf8").replace("#!/bin/sh\n",
    `#!/bin/sh\ngit --git-dir '${f.bare}' update-ref refs/heads/master '${c}'\n`));
  const hook = path.join(f.main, ".git/hooks/pre-push");
  fs.writeFileSync(hook, `#!/bin/sh\ngit --git-dir '${f.bare}' update-ref refs/heads/master '${c}'\n`);
  fs.chmodSync(hook, 0o755);
  const r = (await f.run([f.b]));
  expect(r.status, `${r.stderr} local=${(await f.local())} remote=${(await f.remote())} c=${c}`).not.toBe(0);
  expect(r.stderr).toContain("non-fast-forward");
  expect([(await f.local()), (await f.remote())], r.stderr).toEqual([f.a, c]);
  expect(fs.readFileSync(path.join(f.main, "base.txt"), "utf8")).toBe("dirty tracked\n");
  expect(fs.readFileSync(path.join(f.main, "untracked.txt"), "utf8")).toBe("dirty untracked\n");
});

it("refuses a non-descendant candidate, missing CI and extra flags", async () => {
  const f = (await fixture());
  (await git(f.main, "switch", "--orphan", "unrelated"));
  fs.writeFileSync(path.join(f.main, "other.txt"), "O\n");
  (await git(f.main, "add", "other.txt")); (await git(f.main, "commit", "-qm", "O"));
  const other = (await git(f.main, "rev-parse", "HEAD"));
  (await git(f.main, "switch", "-q", "master"));
  for (const [args, extra] of [
    [[other], { MDPRO_GH_HEAD: other }],
    [[f.b], { MDPRO_GH_CI: "" }],
    [[f.b, "--force"], {}],
    [[f.b, "--dry-run", "--dry-run"], {}],
  ] as [string[], Record<string, string>][]) {
    expect((await f.run(args, extra)).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
});

it("lands the validated OID when the candidate ref moves after PR validation", async () => {
  const f = (await fixture());
  (await git(f.main, "switch", "-q", "feature"));
  fs.writeFileSync(path.join(f.main, "feature.txt"), "C\n");
  (await git(f.main, "add", "feature.txt")); (await git(f.main, "commit", "-qm", "C"));
  const c = (await git(f.main, "rev-parse", "HEAD"));
  (await git(f.main, "switch", "-q", "master"));
  (await git(f.main, "update-ref", "refs/heads/feature", f.b));
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ngit -C '${f.main}' update-ref refs/heads/feature '${c}'\nprintf '[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n'\n`);
  fs.chmodSync(gh, 0o755);
  const result = (await f.run(["feature"]));
  expect(result.status, result.stderr).toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.b, f.b]);
  expect((await git(f.main, "rev-parse", "feature"))).toBe(c);
});

it("pins PR lookup to anzchy/mdpro despite an ambient GH_REPO", async () => {
  const f = (await fixture());
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase " $* " in *" --repo anzchy/mdpro "*) ;; *) echo '[]'; exit 0;; esac\nprintf '[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n'\n`);
  fs.chmodSync(gh, 0o755);
  const r = (await f.run([f.b], { GH_REPO: "attacker/decoy" }));
  expect(r.status, r.stderr).toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.b, f.b]);
});

it("rejects missing and symlinked role markers and a linked master tree", async () => {
  for (const change of ["missing", "symlink"]) {
    const f = (await fixture());
    const overlay = path.join(f.main, ".codex/rules/mdpro-role.rules");
    fs.unlinkSync(overlay);
    if (change === "symlink") fs.symlinkSync(path.join(f.main, ".codex/rules/mdpro.rules"), overlay);
    expect((await f.run([f.b])).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
  const f = (await fixture());
  (await git(f.main, "switch", "-qc", "side"));
  const linked = path.join(f.dir, "linked");
  (await git(f.main, "worktree", "add", "-q", linked, "master"));
  fs.mkdirSync(path.join(linked, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(linked, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(linked, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs", "land-guard.mjs"]) fs.copyFileSync(path.join(root, "scripts/codex-rules", name), path.join(linked, "scripts/codex-rules", name));
  const r = (await call(linked, process.execPath, ["scripts/codex-rules/land-guard.mjs", f.b], { ...f.env, MDPRO_GUARD_TEST_MAIN: linked }));
  expect(r.status).not.toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
});

it("rejects multiple push URLs, symlink and nonbare origins with unchanged decoy refs", async () => {
  for (const kind of ["multiple", "symlink", "nonbare"]) {
    const f = (await fixture());
    const decoy = path.join(f.dir, "decoy.git");
    (await git(f.dir, "init", "-q", "--bare", decoy));
    const decoyBefore = (await git(f.dir, "--git-dir", decoy, "for-each-ref", "--format=%(refname) %(objectname)"));
    if (kind === "multiple") {
      (await git(f.main, "remote", "set-url", "--push", "origin", f.bare));
      (await git(f.main, "remote", "set-url", "--add", "--push", "origin", decoy));
    } else {
      const url = kind === "symlink" ? path.join(f.dir, "link.git") : f.main;
      if (kind === "symlink") fs.symlinkSync(f.main, url);
      (await git(f.main, "remote", "set-url", "origin", url));
      f.env.MDPRO_GUARD_TEST_ORIGIN = url;
    }
    expect((await f.run([f.b], f.env)).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
    expect((await git(f.dir, "--git-dir", decoy, "for-each-ref", "--format=%(refname) %(objectname)"))).toBe(decoyBefore);
  }
});

it("rejects wrong-shaped PR JSON and a green check under another name", async () => {
  const f = (await fixture());
  const gh = path.join(f.dir, "bin/gh");
  for (const body of [
    '{"headRefOid":"bad"}',
    `[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"other","conclusion":"SUCCESS"}]}]`,
  ]) {
    fs.writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`); fs.chmodSync(gh, 0o755);
    expect((await f.run([f.b])).status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
});

it("refuses extra PR landing arguments without moving local or remote master", async () => {
  const f = (await fixture());
  for (const extra of [["--mirror"], ["extra:refs/heads/other"], ["--dry-run", "--dry-run"]]) {
    const result = (await f.run([f.b, ...extra]));
    expect(result.status).not.toBe(0);
    expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
  }
});

it("refuses PR landing when only the ambient decoy repository has a matching PR", async () => {
  const f = (await fixture());
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase " $* " in *" --repo anzchy/mdpro "*) echo '[]';; *) printf '[{"headRefOid":"${f.b}","statusCheckRollup":[{"name":"ci-gate","conclusion":"SUCCESS"}]}]\\n';; esac\n`);
  fs.chmodSync(gh, 0o755);
  const result = (await f.run([f.b], { GH_REPO: "attacker/decoy" }));
  expect(result.status).not.toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
});

it("rejects an absolute script invocation from a different working directory", async () => {
  const f = (await fixture());
  const result = (await call(f.dir, process.execPath,
    [path.join(f.main, "scripts/codex-rules/land-guard.mjs"), f.b], f.env));
  expect(result.status).not.toBe(0);
  expect([(await f.local()), (await f.remote())]).toEqual([f.a, f.a]);
});
