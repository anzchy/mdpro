// @vitest-environment node
/**
 * D186 phase 0: the real-device-tester checks moved out of role-guard.sh into
 * `.claude/hooks/role_guard_tester.py`, imported lazily on the tester path only.
 * When that module is missing or raises on import, every tester Bash / Write call
 * is refused in one line (exit 2) instead of crashing with exit 1, which Claude Code
 * treats as non-blocking. No role set, and the implementor, are unaffected.
 *
 * Mirrors tests/tooling/d180-role-guard-fail-closed.test.ts: each case copies the real hook
 * and every other `role_guard_*.py` into a temp hooks dir, with the tester module
 * absent, broken or intact.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HOOK, bashInput, makeRepo, makeRoot, runHookAt } from "../support/roleGuardHarness";

const root = makeRoot("role-guard-d186-fc-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d186-fail-closed");
const TESTER = "role_guard_tester.py";
type State = "absent" | "broken" | "intact";

function hooksDir(name: string, tester: State): string {
  const dir = path.join(root, name, ".claude", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, "role-guard.sh"));
  const src = path.dirname(HOOK);
  for (const f of fs.readdirSync(src).filter((n) => /^role_guard_.*\.py$/.test(n) && n !== TESTER)) {
    fs.copyFileSync(path.join(src, f), path.join(dir, f));
  }
  if (tester === "broken") fs.writeFileSync(path.join(dir, TESTER), "raise RuntimeError('broken on import')\n");
  if (tester === "intact") fs.copyFileSync(path.join(src, TESTER), path.join(dir, TESTER));
  return dir;
}

const hook = (dir: string) => path.join(dir, "role-guard.sh");
const refusal = (what: string) =>
  `role-guard: tester module missing or broken, refusing ${what}; fix .claude/hooks/role_guard_tester.py`;

describe("D186 role-guard: fails closed when role_guard_tester.py cannot be imported", () => {
  it.each([["absent" as const], ["broken" as const]])("module %s: tester `git status` is refused in one line", (state) => {
    const dir = hooksDir(`tester-${state}`, state);
    const r = runHookAt(hook(dir), "real-device-tester", bashInput("git status", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(refusal("git status"));
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "__pycache__"))).toBe(false);
  });

  it.each([["absent" as const], ["broken" as const]])("module %s: tester Write is refused in one line", (state) => {
    const dir = hooksDir(`tester-write-${state}`, state);
    const target = path.join(root, "report", "r.md");
    const r = runHookAt(hook(dir), "real-device-tester", { tool_name: "Write", tool_input: { file_path: target } }, feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(refusal(`Write ${target}`));
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each([["absent" as const], ["broken" as const]])("module %s: no role set still allows `git status`", (state) => {
    const dir = hooksDir(`norole-${state}`, state);
    const r = runHookAt(hook(dir), undefined, bashInput("git status", feature), feature);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it.each([["absent" as const], ["broken" as const]])("module %s: implementor is unaffected", (state) => {
    const dir = hooksDir(`impl-${state}`, state);
    const ok = runHookAt(hook(dir), "implementor", bashInput("git status", feature), feature);
    expect(ok.status).toBe(0);
    expect(ok.stderr).toBe("");
    const deny = runHookAt(hook(dir), "implementor", bashInput("git branch -f master HEAD", feature), feature);
    expect(deny.status).toBe(2);
    expect(deny.stderr).toContain("master");
    expect(deny.stderr).not.toContain("tester module");
  });

  it("module absent: a tester tool the guard does not check (Read) still passes", () => {
    const dir = hooksDir("tester-read-absent", "absent");
    const r = runHookAt(hook(dir), "real-device-tester", { tool_name: "Read", tool_input: { file_path: "/etc/hosts" } }, feature);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("role_guard_shell.py absent, tester module intact: tester `git status` is refused (fail closed)", () => {
    const dir = hooksDir("shell-absent", "intact");
    fs.rmSync(path.join(dir, "role_guard_shell.py"));
    const r = runHookAt(hook(dir), "real-device-tester", bashInput("git status", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(refusal("git status"));
  });

  it("role_guard_tester_opts.py absent, tester module intact: tester `git status` is refused (fail closed)", () => {
    const dir = hooksDir("tester-opts-absent", "intact");
    fs.rmSync(path.join(dir, "role_guard_tester_opts.py"), { force: true });
    const r = runHookAt(hook(dir), "real-device-tester", bashInput("git status", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(refusal("git status"));
    expect(r.stderr).toContain("role_guard_tester_opts.py");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("module intact: tester `git status` is allowed, `git commit` refused, no __pycache__ left", () => {
    const dir = hooksDir("tester-intact", "intact");
    const ok = runHookAt(hook(dir), "real-device-tester", bashInput("git status", feature), feature);
    expect(ok.status).toBe(0);
    expect(ok.stderr).toBe("");
    const deny = runHookAt(hook(dir), "real-device-tester", bashInput("git commit -m x", feature), feature);
    expect(deny.status).toBe(2);
    expect(deny.stderr).toContain("real-device-tester");
    expect(fs.existsSync(path.join(dir, "__pycache__"))).toBe(false);
  });
});

describe("D186 round 2 H4: an exception while checking refuses the call (both roles)", () => {
  const internal = (cls: string) => `role-guard: internal error (${cls}) while checking`;

  it.each([["implementor"], ["real-device-tester"]])("%s: `env -S \"'\" ; git push` is refused in one line", (role) => {
    const dir = hooksDir(`h4-parse-${role}`, "intact");
    const r = runHookAt(hook(dir), role, bashInput(`env -S "'" ; git push`, feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(internal("ValueError"));
    expect(r.stderr).toContain("refusing");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("no role: `env -S \"'\" ; git push` is still allowed silently", () => {
    const dir = hooksDir("h4-parse-norole", "intact");
    const r = runHookAt(hook(dir), undefined, bashInput(`env -S "'" ; git push`, feature), feature);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("tester: a check that raises (forced) is refused, naming the exception class", () => {
    const dir = hooksDir("h4-forced-tester", "intact");
    fs.writeFileSync(
      path.join(dir, TESTER),
      "def tester_bash(cmd, cwd):\n    raise LookupError('forced')\n\ndef tester_write(p, cwd):\n    raise LookupError('forced')\n",
    );
    for (const input of [bashInput("git status", feature), { tool_name: "Write", tool_input: { file_path: "/tmp/claude-1/x.md" } }]) {
      const r = runHookAt(hook(dir), "real-device-tester", input, feature);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(internal("LookupError"));
      expect(r.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("implementor: a check that raises (forced) is refused, naming the exception class", () => {
    const dir = hooksDir("h4-forced-impl", "intact");
    fs.writeFileSync(path.join(dir, "role_guard_refs.py"), "def implementor_git(*a):\n    raise ZeroDivisionError('forced')\n");
    const r = runHookAt(hook(dir), "implementor", bashInput("git status", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(internal("ZeroDivisionError"));
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });
});
