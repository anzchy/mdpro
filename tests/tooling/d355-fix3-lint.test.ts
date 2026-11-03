// @vitest-environment node
// D355 fix 3: ci-gate's test lint (scripts/lint/conditional-tests.mjs) passes on the files this branch added, by the
// real fix (awaited child processes, unconditional .each data), not by D302 exception entries.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanupFixtures, fixture } from "./rules-budget-fixture";
import * as core from "./rules-lib-core";
import { trackedFiles } from "./rules-lib-core";

// attack gap 2: any synchronous child call reached from the fixture or the tracked-file cache throws "sync"
vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  const sync = () => { throw new Error("sync"); };
  // D355 fix 5 (L-r4-1): the default export too, so `cp.default.<sync>` cannot slip past the mock
  const def = { ...(real as unknown as { default: object }).default, execFileSync: sync, execSync: sync, spawnSync: sync };
  return { ...real, default: def, execFileSync: sync, execSync: sync, spawnSync: sync };
});

const run = promisify(execFile);
const made: string[] = [];
const root = path.resolve(__dirname, "../..");
const LINT = "scripts/lint/conditional-tests.mjs";
const FLAGGED = [
  "tests/tooling/codex-land-guard-export.test.ts",
  "tests/tooling/d355-fix1-lib.ts",
  "tests/tooling/d355-r3-history.test.ts",
  "tests/tooling/gh586-audit-policy-split.test.ts",
  "tests/tooling/rules-budget-fixture.ts",
  "tests/tooling/rules-budget-lib.test.ts",
  "tests/tooling/rules-lib-core.ts",
];
const loadTracked = (dir: string) => (core as { loadTrackedFiles?: (r: string) => Promise<string[]> }).loadTrackedFiles?.(dir);
/** A real git repository holding `files`, made with awaited git and never loaded into the tracked-file cache. */
async function bareRepo(files: Record<string, string>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d355-fix3-"));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), body);
  await run("git", ["init", "-q"], { cwd: dir });
  await run("git", ["add", "--", ...Object.keys(files)], { cwd: dir });
  return dir;
}

/** The lint's exit code and output for `args`, awaited (a non-zero exit is a result here, not a throw). */
async function lint(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [LINT, ...args], { cwd: root, maxBuffer: 16 << 20 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

afterAll(() => {
  cleanupFixtures();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("D355 fix 3: the test lint", () => {
  it.each([
    "tests/tooling/codex-land-guard-export.test.ts",
    "tests/tooling/d355-fix1-lib.ts",
    "tests/tooling/d355-r3-history.test.ts",
    "tests/tooling/gh586-audit-policy-split.test.ts",
    "tests/tooling/rules-budget-fixture.ts",
    "tests/tooling/rules-budget-lib.test.ts",
    "tests/tooling/rules-lib-core.ts",
  ])("L1-L7: %s passes the lint on its own", async (file) => {
    const out = await lint([file]);
    expect(out.stderr).toBe("");
    expect(out.stdout).toBe("Conditional registration PASS (1 files)\n");
    expect(out.code).toBe(0);
  });

  it("L9: trackedFiles never runs git itself; an unloaded root names loadTrackedFiles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d355-fix3-"));
    made.push(dir);
    expect(() => trackedFiles(dir)).toThrow(/loadTrackedFiles/);
  });

  it("L9b: an unloaded root that is a real repository still throws; trackedFiles does not fall back to git", async () => {
    const dir = await bareRepo({ "a.md": "a\n" });
    expect(() => trackedFiles(dir)).toThrow(/loadTrackedFiles/);
  });

  it("L12: no flagged file, nor any module it imports relatively, names a synchronous child call", () => {
    const files = new Set(FLAGGED);
    for (const f of FLAGGED) for (const m of fs.readFileSync(path.join(root, f), "utf8").matchAll(/from "(\.\/[^"]+)"/g)) {
      files.add(path.posix.join(path.posix.dirname(f), `${m[1]}.ts`));
    }
    const hits: string[] = [];
    for (const f of files) fs.readFileSync(path.join(root, f), "utf8").split("\n").forEach((line, i) => {
      if (/\b(execFileSync|execSync|spawnSync)\b|require\(\s*["'](node:)?child_process/.test(line)) hits.push(`${f}:${i + 1}`);
    });
    expect(hits).toEqual([]);
  });

  it("L13: a fixture is built and read with every synchronous child call throwing", async () => {
    const built = (async () => fixture({ "a.md": "a\n" }))();
    await expect(built).resolves.toEqual(expect.any(String));
    expect(trackedFiles(await built)).toEqual(["a.md"]);
  });

  it("L16: the default export's three synchronous child calls throw too", async () => {
    const cp = await import("node:child_process");
    const calls = cp.default as unknown as Record<"execFileSync" | "execSync" | "spawnSync", () => unknown>;
    for (const name of ["execFileSync", "execSync", "spawnSync"] as const) expect(() => calls[name](), name).toThrow("sync");
  });

  it("L14: a failed load rejects and caches nothing", async () => {
    expect(typeof (core as Record<string, unknown>).loadTrackedFiles).toBe("function");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d355-fix3-"));
    made.push(dir);
    await expect(loadTracked(dir)).rejects.toThrow();
    expect(() => trackedFiles(dir)).toThrow(/loadTrackedFiles/);
  });

  it("L15: the cache is per root: two fixtures keep their own lists, a third unloaded repository still throws", async () => {
    const a = await fixture({ "a.md": "a\n" });
    const b = await fixture({ "b.md": "b\n" });
    expect(trackedFiles(a)).toEqual(["a.md"]);
    expect(trackedFiles(b)).toEqual(["b.md"]);
    const c = await bareRepo({ "c.md": "c\n" });
    expect(() => trackedFiles(c)).toThrow(/loadTrackedFiles/);
  });

  it("L10: a fixture's tracked files are exactly what it added: CJK unquoted, untracked absent", async () => {
    const dir = await fixture({ "docs/架构.md": "a\n", "b.md": "b\n" }, { "docs/untracked.md": "u\n" });
    expect([...trackedFiles(dir)].sort()).toEqual(["b.md", "docs/架构.md"]);
  });

});
