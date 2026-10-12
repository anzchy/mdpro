// @vitest-environment node
/**
 * D180 follow-up (coordinator ruling, 2026-10-12): role-guard.sh imports its
 * ref-move checks from the sibling `role_guard_refs.py`. When that module is
 * missing or raises on import and a role is set, the hook must refuse the Bash
 * call (exit 2, one line) rather than crash with exit 1, which Claude Code treats
 * as a non-blocking error and so lets every call through. No role set: unchanged.
 *
 * Each case copies the real hook into its own temp hooks dir, next to an absent,
 * broken or intact copy of the module, and feeds it PreToolUse JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HOOK, bashInput, makeRepo, makeRoot, runHookAt } from "./support/roleGuardHarness";

const root = makeRoot("role-guard-d180-fc-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const feature = makeRepo(root, "feature", "fix/d180-fail-closed");
const MODULE = path.join(path.dirname(HOOK), "role_guard_refs.py");

function hooksDir(name: string, module: "absent" | "broken" | "intact"): string {
  const dir = path.join(root, name, ".claude", "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, "role-guard.sh"));
  if (module === "broken") fs.writeFileSync(path.join(dir, "role_guard_refs.py"), "raise RuntimeError('broken on import')\n");
  if (module === "intact") {
    for (const f of fs.readdirSync(path.dirname(MODULE)).filter((n) => /^role_guard_.*\.py$/.test(n))) {
      fs.copyFileSync(path.join(path.dirname(MODULE), f), path.join(dir, f));
    }
  }
  return dir;
}

const refusal = (command: string) =>
  `role-guard: refs module missing or broken, refusing ${command}; fix .claude/hooks/role_guard_refs.py`;

describe("D180 role-guard: fails closed when role_guard_refs.py cannot be imported", () => {
  it.each([["absent" as const], ["broken" as const]])("module %s: implementor `git status` is refused", (module) => {
    const dir = hooksDir(`impl-${module}`, module);
    const r = runHookAt(path.join(dir, "role-guard.sh"), "implementor", bashInput("git status", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(refusal("git status"));
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "__pycache__"))).toBe(false);
  });

  it.each([["absent" as const], ["broken" as const]])("module %s: no role set still allows `git status`", (module) => {
    const dir = hooksDir(`norole-${module}`, module);
    const r = runHookAt(path.join(dir, "role-guard.sh"), undefined, bashInput("git status", feature), feature);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("module intact: implementor `git status` is allowed and the hook leaves no __pycache__", () => {
    const dir = hooksDir("impl-intact", "intact");
    const r = runHookAt(path.join(dir, "role-guard.sh"), "implementor", bashInput("git status", feature), feature);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(fs.existsSync(path.join(dir, "__pycache__"))).toBe(false);
  });

  it("module intact: implementor `git branch -f master HEAD` is still refused", () => {
    const dir = hooksDir("impl-intact-deny", "intact");
    const r = runHookAt(path.join(dir, "role-guard.sh"), "implementor", bashInput("git branch -f master HEAD", feature), feature);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("master");
  });
});
