// @vitest-environment node
/**
 * RC5 pins of behaviour earlier cycles built (no RED: each passed on its first run and fails
 * under a targeted mutation, named in the handoff). Kept out of the settled S1/S3 spec files so
 * their receipts' settled bytes stay unchanged.
 * Matrix rows: M6 (migrate), GI1 (the repository .gitignore, with ruling 1 L2's .tmp/).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const script = join(repoRoot, "scripts/tdd/receipt-store.mjs");
const T = ".claude/tdd-guardian", R = `${T}/receipts`, E = `${T}/receipt-evidence`, VIEW = `${T}/receipts.json`, SIDECAR = `${T}/evidence.json`;
let root: string;
type Run = { status: number | null; stdout: string; stderr: string };
/** An async child call (rule: no worker-blocking child process in a test); it never throws, like spawnSync. */
const exec = (cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) => new Promise<Run>((done) => {
  execFile(cmd, args, { cwd: opts.cwd ?? root, env: opts.env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout, stderr }));
});

const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function receipt(id: string, verdict: string | null = null) {
  return {
    id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", head_sha: "", dirty_source: [],
    red: { kind: "assertion-failure", red: true, reason: "1 failing" },
    test_files: { "tests/a.test.ts": { state: "ok", sha: "abc", lines: ["x"] } }, verified_at: null, verdict, findings: [],
  };
}
const entry = (id: string) => ({ id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", plugin_version: "0.10.2" });
const git = (...args: string[]) => exec("git", args);
const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const read = (path: string) => readFileSync(join(root, path), "utf8");
const legacy = (records: unknown[], entries: Record<string, unknown> = {}) => {
  write(VIEW, canonical({ schemaVersion: 2, receipts: records }));
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
  write(SIDECAR, canonical({ schemaVersion: 1, entries: sorted }));
};
const commit = async (message: string) => { await git("add", "-A"); await git("commit", "-q", "--allow-empty", "-m", message); return (await git("rev-parse", "HEAD")).stdout.trim(); };
const store = async (...args: string[]) => {
  const result = await exec(process.execPath, [script, ...args]);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: `${result.stdout}\n${result.stderr}` };
};
const listing = (dir: string) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).sort() : null);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mdpro-rc5-migrate-"));
  await git("init", "-q", "-b", "master"); await git("config", "user.email", "t@example.com"); await git("config", "user.name", "T");
  write(".gitignore", `${VIEW}\n${SIDECAR}\n`);
  write(`${T}/config.json`, "{}\n");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("RC5 migrate after the migration commit (M6)", () => {
  it("M6: after the migration commit, a settled B-1 and a stale view do not make migrate write anything", async () => {
    legacy([receipt("A-1")], { "A-1": entry("A-1") }); await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    expect((await store("migrate")).status).toBe(0);
    await commit("migrate");
    // B-1 as the entry leaves it after record and verify: item files written, the engine's view not rebuilt.
    write(`${R}/B-1.json`, canonical(receipt("B-1", "SEPARATION-HELD")));
    write(`${E}/B-1.json`, canonical(entry("B-1")));
    write(VIEW, canonical({ schemaVersion: 2, receipts: [receipt("A-1")] }));
    await git("add", R, E); await commit("record B-1");
    const bytes = () => [R, E].flatMap((dir) => listing(dir)!.map((name) => [`${dir}/${name}`, read(`${dir}/${name}`)]));
    const before = bytes(), view = read(VIEW);
    const again = await store("migrate");
    expect(again.status, again.output).toBe(0);
    expect(again.stdout).toContain("already migrated");
    expect(bytes()).toEqual(before);
    expect(JSON.parse(read(`${R}/B-1.json`)).verdict).toBe("SEPARATION-HELD");
    expect(read(VIEW)).toBe(view);
    expect((await git("status", "--porcelain")).stdout).toBe("");
  });
});

describe("RC5 the repository's .gitignore (GI1)", () => {
  const repoRoot = join(import.meta.dirname, "../..");
  const ignored = async (path: string) => (await exec("git", ["check-ignore", "-q", "--no-index", path], { cwd: repoRoot })).status;
  it("GI1, ruling 1 L2: ignores the view, the sidecar, the stamp, the store lock and the temp dir, and tracks the item files", async () => {
    for (const path of ["receipts.json", "evidence.json", ".receipts.view", ".receipts.store.lock/owner.json", ".tmp/x.json"]) {
      expect(await ignored(`.claude/tdd-guardian/${path}`), path).toBe(0);
    }
    for (const path of ["receipts/D41-WI-1.json", "receipt-evidence/D41-WI-1.json"]) {
      expect(await ignored(`.claude/tdd-guardian/${path}`), path).toBe(1);
    }
  });
});
