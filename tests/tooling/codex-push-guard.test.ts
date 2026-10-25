// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const made: string[] = [];
function cmd(cwd: string, file: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}
function git(dir: string, ...args: string[]) {
  const r = cmd(dir, "git", args);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-push-"));
  made.push(dir);
  const main = path.join(dir, "main"), bare = path.join(dir, "origin.git"), bin = path.join(dir, "bin");
  fs.mkdirSync(main); fs.mkdirSync(bin);
  git(dir, "init", "-q", "--bare", bare);
  git(main, "init", "-q", "-b", "master");
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "t@t");
  fs.writeFileSync(path.join(main, "a.txt"), "A\n");
  git(main, "add", "a.txt"); git(main, "commit", "-qm", "A");
  const a = git(main, "rev-parse", "HEAD");
  git(main, "remote", "add", "origin", bare);
  git(main, "push", "-q", bare, "HEAD:refs/heads/master");
  fs.mkdirSync(path.join(main, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro.rules"), "# common\n");
  fs.writeFileSync(path.join(main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(main, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs"]) {
    const source = path.join(root, "scripts/codex-rules", name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(main, "scripts/codex-rules", name));
  }
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, `#!/bin/sh\nif [ "$MDPRO_GH_MODE" = "fail" ]; then exit 1; fi\nif [ "$MDPRO_GH_MODE" = "malformed" ]; then echo '{'; exit 0; fi\nif [ "$MDPRO_GH_MODE" = "none" ]; then echo '[]'; exit 0; fi\noid=$(git --git-dir "$MDPRO_GH_BARE" rev-parse refs/heads/fix/topic 2>/dev/null)\nif [ -z "$oid" ]; then echo '[]'; exit 0; fi\nif [ "$MDPRO_GH_MODE" = "two" ]; then printf '[{"headRefOid":"%s"},{"headRefOid":"%s"}]\\n' "$oid" "$oid"; exit 0; fi\nif [ "$MDPRO_GH_MODE" = "stale" ]; then oid=0000000000000000000000000000000000000000; fi\nprintf '[{"headRefOid":"%s"}]\\n' "$oid"\n`);
  fs.writeFileSync(gh, fs.readFileSync(gh, "utf8").replace("rev-parse refs/heads/fix/topic", "rev-parse --verify refs/heads/fix/topic"));
  fs.chmodSync(gh, 0o755);
  fs.writeFileSync(path.join(main, "a.txt"), "B\n");
  git(main, "add", "a.txt"); git(main, "commit", "-qm", "B");
  const b = git(main, "rev-parse", "HEAD");
  const env = { PATH: `${bin}:${process.env.PATH}`, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: main,
    MDPRO_GUARD_TEST_ORIGIN: bare, MDPRO_GH_BARE: bare, MDPRO_GH_MODE: "derive" };
  Object.assign(env, { GIT_CONFIG_GLOBAL: "/dev/null" });
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => cmd(main, process.execPath,
    ["scripts/codex-rules/push-guard.mjs", ...args], { ...env, ...extra });
  const refs = () => git(dir, "--git-dir", bare, "for-each-ref", "--format=%(refname) %(objectname)");
  return { dir, main, bare, a, b, run, refs, env };
}
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("pushes the supplied SHA to the supplied topic ref and dry run changes nothing", () => {
  const f = fixture();
  const before = f.refs();
  const dry = f.run([f.b, "fix/topic", "--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect(f.refs()).toBe(before);
  const push = f.run([f.b, "fix/topic"]);
  expect(push.status, push.stderr).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/master")).toBe(f.a);
});

it("moves only the topic ref when Git is configured to follow annotated tags", () => {
  for (const leased of [false, true]) {
    const f = fixture();
    let candidate = f.b;
    if (leased) {
      git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
      git(f.main, "switch", "-qc", "sibling", f.a);
      fs.writeFileSync(path.join(f.main, "sibling.txt"), "divergent\n");
      git(f.main, "add", "sibling.txt"); git(f.main, "commit", "-qm", "sibling");
      candidate = git(f.main, "rev-parse", "HEAD");
    }
    git(f.main, "tag", "-a", "release-candidate", "-m", "candidate tag", candidate);
    git(f.main, "config", "push.followTags", "true");
    const args = [candidate, "fix/topic", ...(leased ? ["--expected-remote-oid", f.a] : [])];
    const result = f.run(args);
    expect(result.status, result.stderr).toBe(0);
    expect(f.refs().split("\n")).toEqual([
      `refs/heads/fix/topic ${candidate}`,
      `refs/heads/master ${f.a}`,
    ]);
  }
});

it("leases old PR head A and confirms new head B; dry run leaves A", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  const before = f.refs();
  const dry = f.run([f.b, "fix/topic", "--expected-remote-oid", f.a, "--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect(f.refs()).toBe(before);
  const result = f.run([f.b, "fix/topic", "--expected-remote-oid", f.a]);
  expect(result.status, result.stderr).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
});

it("refuses zero or multiple lease PRs and protects the remote", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  for (const mode of ["none", "two"]) {
    const before = f.refs();
    const r = f.run([f.b, "fix/topic", "--expected-remote-oid", f.a], { MDPRO_GH_MODE: mode });
    expect(r.status).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
});

it("refuses protected destinations, bad arguments, PR errors and rewrite variables", () => {
  const f = fixture();
  for (const [args, extra] of [
    [[f.b, "master"], {}], [[f.b, "release/1"], {}], [[f.b, "-bad"], {}],
    [[f.b, "refs/heads/x"], {}], [[f.b, "fix/topic", "--force"], {}],
    [[f.b, "fix/topic"], { MDPRO_GH_MODE: "fail" }],
    [[f.b, "fix/topic"], { MDPRO_GH_MODE: "malformed" }],
    [[f.b, "fix/topic"], { GIT_CONFIG_COUNT: "1" }],
  ] as [string[], Record<string, string>][]) {
    const before = f.refs();
    expect(f.run(args, extra).status).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
});

it("test mode refuses GitHub or nonbare origin before any push", () => {
  const f = fixture();
  for (const url of ["https://github.com/anzchy/mdpro.git", f.main]) {
    git(f.main, "remote", "set-url", "origin", url);
    const before = f.refs();
    expect(f.run([f.b, "fix/topic"]).status).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
});

it("uses an explicit ancestor SHA and a different Unicode destination", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.main, "a.txt"), "C\n");
  git(f.main, "add", "a.txt"); git(f.main, "commit", "-qm", "C");
  git(f.main, "switch", "-qc", "chore/local");
  const before = f.refs();
  expect(f.run([f.b, "fix/审计", "--dry-run"]).status).toBe(0);
  expect(f.refs()).toBe(before);
  expect(f.run([f.b, "fix/审计"]).status).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/审计")).toBe(f.b);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/master")).toBe(f.a);
});

it("reports post-push PR uncertainty without retry or rollback", () => {
  for (const leased of [false, true]) {
    const f = fixture();
    if (leased) git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
    const gh = path.join(f.dir, "bin/gh");
    fs.writeFileSync(gh, `#!/bin/sh\noid=$(git --git-dir "$MDPRO_GH_BARE" rev-parse refs/heads/fix/topic 2>/dev/null)\nif [ "$oid" = "${f.b}" ]; then exit 1; fi\nif [ -z "$oid" ]; then echo '[]'; else printf '[{"headRefOid":"%s"}]\\n' "$oid"; fi\n`);
    fs.chmodSync(gh, 0o755);
    const args = [f.b, "fix/topic", ...(leased ? ["--expected-remote-oid", f.a] : [])];
    const result = f.run(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("push may already have happened");
    expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
  }
});

it("refuses an origin URL rewrite and disabled test mode without moving refs", () => {
  const f = fixture();
  for (const extra of [
    { GIT_CONFIG_PARAMETERS: "'x.y=z'" },
    { GIT_CONFIG_COUNT: "0" },
    { MDPRO_GUARD_TEST: "0" },
  ]) {
    const before = f.refs();
    expect(f.run([f.b, "fix/topic"], extra).status).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
  git(f.main, "config", "url.file:///decoy/.insteadOf", f.bare);
  const before = f.refs();
  expect(f.run([f.b, "fix/topic"]).status).not.toBe(0);
  expect(f.refs()).toBe(before);
});

it("reports the exact explicit SHA push outcome", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.main, "a.txt"), "C\n");
  git(f.main, "add", "a.txt"); git(f.main, "commit", "-qm", "C");
  git(f.main, "switch", "-qc", "chore/local");
  const result = f.run([f.b, "fix/审计"]);
  expect(result.status, result.stderr).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/审计")).toBe(f.b);
});

it("pushes the validated OID when its supplied ref moves during the push", () => {
  const f = fixture();
  git(f.main, "branch", "candidate", f.b);
  fs.writeFileSync(path.join(f.main, "a.txt"), "C\n");
  git(f.main, "add", "a.txt"); git(f.main, "commit", "-qm", "C");
  const c = git(f.main, "rev-parse", "HEAD");
  const realGit = cmd(f.main, "which", ["git"]).stdout.trim();
  const shim = path.join(f.dir, "bin/git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = push ]; then '${realGit}' -C '${f.main}' update-ref refs/heads/candidate '${c}'; fi\nexec '${realGit}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
  const result = f.run(["candidate", "fix/topic"]);
  expect(result.status, result.stderr).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
  expect(git(f.main, "rev-parse", "candidate")).toBe(c);
});

it("pins PR lookup to anzchy/mdpro despite an ambient GH_REPO", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase " $* " in *" --repo anzchy/mdpro "*) ;; *) echo '[]'; exit 0;; esac\noid=$(git --git-dir "$MDPRO_GH_BARE" rev-parse refs/heads/fix/topic)\nprintf '[{"headRefOid":"%s"}]\\n' "$oid"\n`);
  fs.chmodSync(gh, 0o755);
  const r = f.run([f.b, "fix/topic", "--expected-remote-oid", f.a], { GH_REPO: "attacker/decoy" });
  expect(r.status, r.stderr).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
});

it("refuses missing, symlinked and wrong role overlays and a linked tree", () => {
  for (const alter of [
    (f: ReturnType<typeof fixture>) => fs.unlinkSync(path.join(f.main, ".codex/rules/mdpro-role.rules")),
    (f: ReturnType<typeof fixture>) => fs.writeFileSync(path.join(f.main, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: auditor\n"),
    (f: ReturnType<typeof fixture>) => {
      const overlay = path.join(f.main, ".codex/rules/mdpro-role.rules");
      fs.unlinkSync(overlay); fs.symlinkSync(path.join(f.main, ".codex/rules/mdpro.rules"), overlay);
    },
  ]) {
    const f = fixture(); alter(f);
    const before = f.refs();
    expect(f.run([f.b, "fix/topic"]).status).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
  const f = fixture();
  const linked = path.join(f.dir, "linked");
  git(f.main, "worktree", "add", "-q", "-b", "linked", linked, f.a);
  fs.mkdirSync(path.join(linked, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(linked, ".codex/rules/mdpro-role.rules"), "# Local mdpro role: delegator\n");
  fs.mkdirSync(path.join(linked, "scripts/codex-rules"), { recursive: true });
  for (const name of ["install-role.mjs", "push-guard.mjs"]) fs.copyFileSync(path.join(root, "scripts/codex-rules", name), path.join(linked, "scripts/codex-rules", name));
  const before = f.refs();
  const r = cmd(linked, process.execPath, ["scripts/codex-rules/push-guard.mjs", f.b, "fix/topic"], { ...f.env, MDPRO_GUARD_TEST_MAIN: linked });
  expect(r.status).not.toBe(0);
  expect(f.refs()).toBe(before);
});

it("refuses multiple origins, a symlink escape and nonbare decoy origins", () => {
  for (const kind of ["multiple", "symlink", "nonbare"]) {
    const f = fixture();
    const decoy = path.join(f.dir, "decoy.git");
    git(f.dir, "init", "-q", "--bare", decoy);
    const decoyBefore = git(f.dir, "--git-dir", decoy, "for-each-ref", "--format=%(refname) %(objectname)");
    if (kind === "multiple") {
      git(f.main, "remote", "set-url", "--push", "origin", f.bare);
      git(f.main, "remote", "set-url", "--add", "--push", "origin", decoy);
    }
    if (kind === "symlink") {
      const link = path.join(f.dir, "origin-link.git"); fs.symlinkSync(f.main, link);
      git(f.main, "remote", "set-url", "origin", link);
      f.env.MDPRO_GUARD_TEST_ORIGIN = link;
    }
    if (kind === "nonbare") {
      git(f.main, "remote", "set-url", "origin", f.main);
      f.env.MDPRO_GUARD_TEST_ORIGIN = f.main;
    }
    const before = f.refs();
    expect(f.run([f.b, "fix/topic"], f.env).status).not.toBe(0);
    expect(f.refs()).toBe(before);
    expect(git(f.dir, "--git-dir", decoy, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(decoyBefore);
  }
});

it("refuses stale or malformed leases, invalid destinations and noncommits", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  const tree = git(f.main, "rev-parse", "HEAD^{tree}");
  for (const args of [
    [f.b, "fix/topic", "--expected-remote-oid", "bad"],
    [f.b, "fix/topic", "--expected-remote-oid", "0".repeat(40)],
    [f.b, "frontend-backend-redesign"], [f.b, "bad..name"],
    ["0".repeat(40), "fix/topic"], [tree, "fix/topic"],
  ]) {
    const before = f.refs();
    expect(f.run(args).status, args.join(" ")).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
});

it("refuses wrong-shaped PR JSON and reports a post-push head disagreement", () => {
  const f = fixture();
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, "#!/bin/sh\necho '{\"headRefOid\":\"bad\"}'\n"); fs.chmodSync(gh, 0o755);
  const before = f.refs();
  expect(f.run([f.b, "fix/topic"]).status).not.toBe(0);
  expect(f.refs()).toBe(before);
  fs.writeFileSync(gh, "#!/bin/sh\necho '[{\"headRefOid\":\"0000000000000000000000000000000000000000\"}]'\n");
  const after = f.run([f.b, "fix/topic"]);
  expect(after.status).not.toBe(0);
  expect(after.stderr).toContain("push may already have happened");
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
});

it("dry-runs an ordinary push with an existing PR and replaces a divergent head with a lease", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  const before = f.refs();
  const dry = f.run([f.b, "fix/topic", "--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect(f.refs()).toBe(before);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.a);
  git(f.main, "push", "-q", f.bare, `${f.b}:refs/heads/fix/topic`);
  git(f.main, "switch", "-qc", "sibling", f.a);
  fs.writeFileSync(path.join(f.main, "sibling.txt"), "sibling\n");
  git(f.main, "add", "sibling.txt"); git(f.main, "commit", "-qm", "sibling");
  const sibling = git(f.main, "rev-parse", "HEAD");
  expect(cmd(f.main, "git", ["merge-base", "--is-ancestor", f.b, sibling]).status).not.toBe(0);
  const result = f.run([sibling, "fix/topic", "--expected-remote-oid", f.b]);
  expect(result.status, result.stderr).toBe(0);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(sibling);
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/master")).toBe(f.a);
});

it("reports leased post-push head mismatch once, leaving the pushed commit in place", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\nprintf '[{"headRefOid":"${f.a}"}]\\n'\n`);
  fs.chmodSync(gh, 0o755);
  const realGit = cmd(f.main, "which", ["git"]).stdout.trim();
  const pushes = path.join(f.dir, "guard-pushes");
  const shim = path.join(f.dir, "bin/git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = push ]; then printf 'push\\n' >> '${pushes}'; fi\nexec '${realGit}' "$@"\n`);
  fs.chmodSync(shim, 0o755);
  const result = f.run([f.b, "fix/topic", "--expected-remote-oid", f.a]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("push may already have happened");
  expect(git(f.dir, "--git-dir", f.bare, "rev-parse", "refs/heads/fix/topic")).toBe(f.b);
  expect(fs.readFileSync(pushes, "utf8")).toBe("push\n");
});

it("refuses wrong invocation directory, missing origin and extra push arguments", () => {
  const f = fixture();
  const before = f.refs();
  const wrongDir = cmd(f.dir, process.execPath,
    [path.join(f.main, "scripts/codex-rules/push-guard.mjs"), f.b, "fix/topic"], f.env);
  expect(wrongDir.status).not.toBe(0);
  expect(f.refs()).toBe(before);
  for (const extra of [["--mirror"], ["extra:refs/heads/other"], ["--dry-run", "--dry-run"],
    ["--expected-remote-oid", f.a, "--expected-remote-oid", f.a]]) {
    expect(f.run([f.b, "fix/topic", ...extra]).status).not.toBe(0);
    expect(f.refs()).toBe(before);
  }
  git(f.main, "remote", "remove", "origin");
  expect(f.run([f.b, "fix/topic"]).status).not.toBe(0);
  expect(f.refs()).toBe(before);
});

it("refuses a leased push when only the ambient decoy repository has a PR", () => {
  const f = fixture();
  git(f.main, "push", "-q", f.bare, `${f.a}:refs/heads/fix/topic`);
  const gh = path.join(f.dir, "bin/gh");
  fs.writeFileSync(gh, `#!/bin/sh\ncase " $* " in *" --repo anzchy/mdpro "*) echo '[]';; *) printf '[{"headRefOid":"${f.a}"}]\\n';; esac\n`);
  fs.chmodSync(gh, 0o755);
  const before = f.refs();
  const result = f.run([f.b, "fix/topic", "--expected-remote-oid", f.a], { GH_REPO: "attacker/decoy" });
  expect(result.status).not.toBe(0);
  expect(f.refs()).toBe(before);
});
