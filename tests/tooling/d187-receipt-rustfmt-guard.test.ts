// @vitest-environment node
/**
 * D187: the PreToolUse(Bash) hook `.claude/hooks/receipt-rustfmt-guard.sh`
 * refuses a tdd-guardian `receipt.js record` whose `--files` list names a Rust
 * file that is not rustfmt-clean.
 *
 * The receipt fingerprints the listed files' bytes. A `.rs` spec recorded before
 * `cargo fmt` is broken for good by the reformat the fmt lane demands (D173
 * commit 1: 8 of 9 files). Each case spawns the real hook with Claude Code's
 * PreToolUse JSON on stdin against fixtures in a temp dir; exit 2 means denied.
 * A stub `rustfmt` first on PATH writes a marker and then runs the real one, so
 * a case can tell whether rustfmt was invoked at all.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK = path.join(REPO, ".claude/hooks/receipt-rustfmt-guard.sh");
const RECEIPT = "/Users/someone/.claude/plugins/cache/x/tdd-guardian/0.10.2/scripts/tdd-guardian/receipt.js";

const GOOD_RS = "fn main() {\n    let x = 1;\n    println!(\"{x}\");\n}\n";
const BAD_RS = "fn  main( ){let x=1;}\n";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d187-rustfmt-guard-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const work = path.join(root, "work");
const sub = path.join(work, "sub");
const stubDir = path.join(root, "stub-bin");
const marker = path.join(root, "rustfmt-called");
for (const d of [sub, stubDir, path.join(root, "home")]) fs.mkdirSync(d, { recursive: true });
for (const d of [work, sub]) {
  fs.writeFileSync(path.join(d, "good.rs"), GOOD_RS);
  fs.writeFileSync(path.join(d, "bad.rs"), BAD_RS);
  fs.writeFileSync(path.join(d, "a.test.ts"), "export const x = 1;\n");
}
fs.writeFileSync(path.join(work, "broken.rs"), "fn {{{\n");

/** The real rustfmt on the test runner's PATH (or ~/.cargo/bin), wrapped by the stub. */
function findRustfmt(): string {
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".cargo/bin")];
  for (const d of dirs) {
    const p = path.join(d, "rustfmt");
    if (d && fs.existsSync(p)) return p;
  }
  return "rustfmt-not-installed";
}
fs.writeFileSync(path.join(stubDir, "rustfmt"), `#!/bin/sh\necho called >> "${marker}"\nexec "${findRustfmt()}" "$@"\n`, {
  mode: 0o755,
});

const stubEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ""}`,
  CLAUDE_PROJECT_DIR: REPO,
};
/** A PATH with python3 and the shell, but no rustfmt anywhere the hook may look. */
const noRustfmtEnv: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  HOME: path.join(root, "home"),
  CARGO_HOME: path.join(root, "no-cargo"),
  CLAUDE_PROJECT_DIR: REPO,
};

/** Spawns the hook; a missing script yields bash's 127, which every case treats as a failure. */
function run(input: string, env: NodeJS.ProcessEnv = stubEnv): { status: number | null; stderr: string } {
  const r = spawnSync("/bin/bash", [HOOK], { input, env, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stderr: r.stderr ?? "" };
}
const bash = (command: string, cwd = work, env?: NodeJS.ProcessEnv) =>
  run(JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }), env);
const record = (files: string, extra = `--cwd ${work}`) => `node ${RECEIPT} record --id D187-WI-1 ${extra} --files ${files}`;
const rustfmtCalled = () => fs.existsSync(marker);
const oneLine = (s: string) => s.trim().split("\n").length === 1;

beforeEach(() => fs.rmSync(marker, { force: true }));

describe("D187 receipt-rustfmt-guard: records with Rust files", () => {
  it("denies a record of one unformatted .rs file, naming it on one line", () => {
    const r = bash(record("bad.rs"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bad.rs");
    expect(r.stderr).toContain("cargo fmt");
    expect(oneLine(r.stderr)).toBe(true);
  });

  it("names only the unformatted file when a clean one is listed too", () => {
    const r = bash(record("good.rs,bad.rs"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bad.rs");
    expect(r.stderr).not.toContain("good.rs");
  });

  it("names every unformatted file", () => {
    const r = bash(record("bad.rs,sub/bad.rs"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("sub/bad.rs");
    expect(r.stderr.split("bad.rs").length - 1).toBe(2);
  });

  it("allows a record of a rustfmt-clean .rs file, after checking it", () => {
    const r = bash(record("good.rs"));
    expect(r.status).toBe(0);
    expect(rustfmtCalled()).toBe(true);
  });

  it("allows a mixed list whose .rs files are all clean", () => {
    expect(bash(record("a.test.ts,good.rs,sub/good.rs")).status).toBe(0);
  });

  it("denies the --files=a,b form", () => {
    expect(bash(`node ${RECEIPT} record --id D187-WI-1 --cwd ${work} --files=good.rs,bad.rs`).status).toBe(2);
  });

  it("accepts --cwd=DIR and resolves the files against it", () => {
    expect(bash(`node ${RECEIPT} record --id X --cwd=${sub} --files bad.rs`, root).status).toBe(2);
  });

  it("resolves a relative --cwd against the input cwd", () => {
    expect(bash(record("bad.rs", "--cwd sub"), work).status).toBe(2);
  });

  it("resolves files against the input cwd when --cwd is absent", () => {
    expect(bash(`node ${RECEIPT} record --id X --files bad.rs`, work).status).toBe(2);
    expect(bash(`node ${RECEIPT} record --id X --files good.rs`, work).status).toBe(0);
  });

  it("checks an absolute path as given", () => {
    expect(bash(`node ${RECEIPT} record --id X --files ${path.join(sub, "bad.rs")}`, root).status).toBe(2);
  });

  it("trims spaces around comma-separated entries", () => {
    expect(bash(`node ${RECEIPT} record --id X --cwd ${work} --files 'good.rs, bad.rs'`).status).toBe(2);
  });

  it("follows a cd earlier in the chain", () => {
    expect(bash(`cd sub && node ${RECEIPT} record --id X --files bad.rs`, work).status).toBe(2);
  });

  it("sees through bash -lc, env and a ; chain", () => {
    expect(bash(`bash -lc '${record("bad.rs")}'`).status).toBe(2);
    expect(bash(`env FOO=1 ${record("bad.rs")}`).status).toBe(2);
    expect(bash(`echo start; ${record("bad.rs")}`).status).toBe(2);
    expect(bash(`cd ${work} && bash -c "node ${RECEIPT} record --id X --files bad.rs"`, root).status).toBe(2);
  });

  it("denies a .rs file rustfmt cannot parse (unchecked bytes are not clean bytes)", () => {
    const r = bash(record("broken.rs"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("broken.rs");
  });

  it("leaves a missing .rs file to receipt.js", () => {
    expect(bash(record("does-not-exist.rs")).status).toBe(0);
  });
});

describe("D187 receipt-rustfmt-guard: everything else passes without rustfmt", () => {
  it.each([
    [`node ${RECEIPT} record --id X --cwd ${work} --files a.test.ts`],
    [`node ${RECEIPT} verify --id D187-WI-1`],
    [`node ${RECEIPT} show --id D187-WI-1`],
    [`echo "node receipt.js record --files bad.rs"`],
    ["cargo fmt --check"],
    ["ls -la"],
  ])("allows %s", (command) => {
    expect(bash(command).status).toBe(0);
    expect(rustfmtCalled()).toBe(false);
  });

  it("ignores tools other than Bash", () => {
    const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x", content: record("bad.rs") }, cwd: work });
    expect(run(input).status).toBe(0);
    expect(rustfmtCalled()).toBe(false);
  });
});

/**
 * `record` without `--files` hashes the changed test files `git status` reports,
 * as tdd-guardian 0.10.2's `isTestFile` classifies them (scripts/tdd-guardian/
 * lib/verification.js): `*_tests.rs`, `*_test.rs`, or any path under a `tests/`
 * dir, but never `.claude/tdd-guardian/`. Each case gets its own repo with
 * `src/lib.rs`, `src/ok_tests.rs` and `tests/x.rs` committed clean.
 */
describe("D187 receipt-rustfmt-guard: record without --files reads git status", () => {
  const gitEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete gitEnv[k];
  let n = 0;

  function git(dir: string, ...args: string[]): void {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { env: gitEnv, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  }

  function makeRepo(): string {
    const dir = path.join(root, `repo-${++n}`);
    for (const [f, body] of [
      ["src/lib.rs", GOOD_RS],
      ["src/ok_tests.rs", GOOD_RS],
      ["tests/x.rs", GOOD_RS],
    ]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), body);
    }
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "clean");
    return dir;
  }
  const write = (dir: string, f: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  };
  const recordAll = `node ${RECEIPT} record --id X`;

  it("denies an unformatted untracked *_tests.rs, naming it", () => {
    const repo = makeRepo();
    write(repo, "src/foo_tests.rs", BAD_RS);
    const r = bash(recordAll, repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/foo_tests.rs");
    expect(oneLine(r.stderr)).toBe(true);
  });

  it("denies an unformatted modified file under tests/", () => {
    const repo = makeRepo();
    write(repo, "tests/x.rs", BAD_RS);
    const r = bash(recordAll, repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("tests/x.rs");
  });

  it("denies an unformatted staged *_test.rs", () => {
    const repo = makeRepo();
    write(repo, "src/new_test.rs", BAD_RS);
    git(repo, "add", "src/new_test.rs");
    expect(bash(recordAll, repo).status).toBe(2);
  });

  it("checks the new path of a renamed test file", () => {
    const repo = makeRepo();
    git(repo, "mv", "tests/x.rs", "tests/y.rs");
    write(repo, "tests/y.rs", BAD_RS);
    const r = bash(recordAll, repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("tests/y.rs");
  });

  it("finds the repo through --cwd when the input cwd is elsewhere", () => {
    const repo = makeRepo();
    write(repo, "src/foo_tests.rs", BAD_RS);
    expect(bash(`${recordAll} --cwd ${repo}`, root).status).toBe(2);
  });

  it("allows an unformatted change to a .rs file that is not a test", () => {
    const repo = makeRepo();
    write(repo, "src/lib.rs", BAD_RS);
    expect(bash(recordAll, repo).status).toBe(0);
    expect(rustfmtCalled()).toBe(false);
  });

  it("ignores the gate's own bookkeeping dir", () => {
    const repo = makeRepo();
    write(repo, ".claude/tdd-guardian/x_tests.rs", BAD_RS);
    expect(bash(recordAll, repo).status).toBe(0);
  });

  it("allows a formatted changed *_tests.rs, after checking it", () => {
    const repo = makeRepo();
    write(repo, "src/ok_tests.rs", `${GOOD_RS}\nfn other() {}\n`);
    expect(bash(recordAll, repo).status).toBe(0);
    expect(rustfmtCalled()).toBe(true);
  });

  it("allows a deleted test file (nothing left to hash)", () => {
    const repo = makeRepo();
    fs.rmSync(path.join(repo, "tests/x.rs"));
    expect(bash(recordAll, repo).status).toBe(0);
  });

  it("allows a clean repo without running rustfmt", () => {
    expect(bash(recordAll, makeRepo()).status).toBe(0);
    expect(rustfmtCalled()).toBe(false);
  });

  it("allows .ts-only changes when rustfmt is not installed", () => {
    const repo = makeRepo();
    write(repo, "tests/a.test.ts", "export const x = 1;\n");
    expect(bash(recordAll, repo, noRustfmtEnv).status).toBe(0);
  });

  it("denies when git cannot list the working tree (not a repository)", () => {
    const r = bash(recordAll, work);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git status");
    expect(oneLine(r.stderr)).toBe(true);
  });
});

describe("D187 receipt-rustfmt-guard: fails closed", () => {
  it("denies a .rs record when rustfmt is not installed", () => {
    const r = bash(record("good.rs"), work, noRustfmtEnv);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("rustfmt not found");
    expect(oneLine(r.stderr)).toBe(true);
  });

  it("still allows a .ts-only record when rustfmt is not installed", () => {
    expect(bash(record("a.test.ts"), work, noRustfmtEnv).status).toBe(0);
  });

  it("denies on malformed hook input with a one-line message", () => {
    const r = run("{not json");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("receipt-rustfmt-guard");
    expect(oneLine(r.stderr)).toBe(true);
  });
});

describe("D187 receipt-rustfmt-guard: wiring", () => {
  type Hook = { type: string; command: string; timeout?: number };
  type Entry = { matcher: string; hooks: Hook[] };
  const settings = JSON.parse(fs.readFileSync(path.join(REPO, ".claude/settings.json"), "utf8")) as {
    hooks: { PreToolUse: Entry[] };
  };

  it("registers the hook as its own PreToolUse Bash entry", () => {
    const entry = settings.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes("receipt-rustfmt-guard.sh")));
    expect(entry?.matcher).toBe("Bash");
    expect(entry?.hooks).toEqual([
      { type: "command", command: 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/receipt-rustfmt-guard.sh', timeout: 30 },
    ]);
  });

  it("keeps the existing block-target-scan entry", () => {
    const commands = settings.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toContain('bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/block-target-scan.sh');
  });
});

/**
 * Integration: the hook against the real rustfmt binary, with no stub on PATH,
 * so the stdin `--emit stdout` byte comparison is proven on the binary itself.
 * Skipped, with the reason in its name, on a machine without rustfmt.
 */
describe("D187 receipt-rustfmt-guard: real rustfmt", () => {
  const realRustfmt = findRustfmt() === "rustfmt-not-installed" ? null : findRustfmt();
  const realEnv: NodeJS.ProcessEnv = {
    PATH: `${realRustfmt ? path.dirname(realRustfmt) : ""}${path.delimiter}/usr/bin:/bin`,
    HOME: os.homedir(),
    CLAUDE_PROJECT_DIR: REPO,
  };

  it.skipIf(!realRustfmt)("compares bytes with the real binary (skipped: rustfmt not installed)", () => {
    const dir = path.join(root, "real");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "clean.rs"), GOOD_RS);
    fs.writeFileSync(path.join(dir, "trailing.rs"), GOOD_RS.replace("let x = 1;", "let x = 1;   "));
    const cmd = (f: string) => `node ${RECEIPT} record --id X --cwd ${dir} --files ${f}`;
    expect(bash(cmd("clean.rs"), dir, realEnv).status).toBe(0);
    const r = bash(cmd("trailing.rs"), dir, realEnv);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("trailing.rs");
    expect(rustfmtCalled()).toBe(false);
  });
});
