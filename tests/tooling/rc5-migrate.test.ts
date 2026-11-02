// @vitest-environment node
/**
 * RC5-S3 (AC-6, AC-1): `receipt-store.mjs migrate` splits the tracked receipts.json and
 * evidence.json into one file per id, proves the byte round trip before it touches the index, and
 * is a no-op once the index no longer tracks them; `migrate --import <rev>` brings a branch cut
 * before the migration across.
 * Matrix rows: M1 (on the real store at 22ffe5ea), M2, M3, M4, M5, M7, M8, K5 (index), R4, R4b (files), R5.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const script = join(repoRoot, "scripts/tdd/receipt-store.mjs");
const PINNED = "22ffe5eadf6abd9de0d234da2e80d8d501a93403";
const T = ".claude/tdd-guardian", R = `${T}/receipts`, E = `${T}/receipt-evidence`, VIEW = `${T}/receipts.json`, SIDECAR = `${T}/evidence.json`;
let root: string;

const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (text: string) => spawnSync("shasum", ["-a", "256"], { input: text, encoding: "utf8" }).stdout.split(" ")[0];
function receipt(id: string, verdict: string | null = null) {
  return {
    id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", head_sha: "", dirty_source: [],
    red: { kind: "assertion-failure", red: true, reason: "1 failing" },
    test_files: { "tests/a.test.ts": { state: "ok", sha: "abc", lines: ["x"] } }, verified_at: null, verdict, findings: [],
  };
}
const entry = (id: string) => ({ id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", plugin_version: "0.10.2" });
const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const read = (path: string) => readFileSync(join(root, path), "utf8");
const legacy = (records: unknown[], entries: Record<string, unknown> = {}) => {
  write(VIEW, canonical({ schemaVersion: 2, receipts: records }));
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
  write(SIDECAR, canonical({ schemaVersion: 1, entries: sorted }));
};
const commit = (message: string) => { git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message); return git("rev-parse", "HEAD").stdout.trim(); };
const store = (...args: string[]) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: `${result.stdout}\n${result.stderr}` };
};
const listing = (dir: string) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).sort() : null);
const tracked = () => git("ls-files", T).stdout.split("\n").filter(Boolean).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mdpro-rc5-migrate-"));
  git("init", "-q", "-b", "master"); git("config", "user.email", "t@example.com"); git("config", "user.name", "T");
  write(".gitignore", `${VIEW}\n${SIDECAR}\n`);
  write(`${T}/config.json`, "{}\n");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("RC5 migrate", () => {
  it("M1, AC-8: the real store at the pinned base splits and round-trips byte for byte", () => {
    const raw = spawnSync("git", ["show", `${PINNED}:${VIEW}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
    const evidence = spawnSync("git", ["show", `${PINNED}:${SIDECAR}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
    write(VIEW, raw); write(SIDECAR, evidence); git("add", "-f", VIEW, SIDECAR); commit("legacy");
    const records = JSON.parse(raw).receipts as Array<{ id: string }>;
    const result = store("migrate");
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain(`receipts.json sha256 ${sha(raw)} rebuilt ${sha(raw)}`);
    expect(result.stdout).toContain(`evidence.json sha256 ${sha(evidence)} rebuilt ${sha(evidence)}`);
    expect(listing(R)?.length).toBe(records.length);
    const rebuilt = canonical({ schemaVersion: 2, receipts: records.map((record) => JSON.parse(read(`${R}/${record.id}.json`))) });
    expect(rebuilt === raw).toBe(true);
    const entries = JSON.parse(evidence).entries as Record<string, unknown>;
    const ids = listing(E)!.map((name) => name.slice(0, -5));
    expect(ids).toEqual(Object.keys(entries).sort());
    const back = canonical({ schemaVersion: 1, entries: Object.fromEntries(ids.map((id) => [id, JSON.parse(read(`${E}/${id}.json`))])) });
    expect(back === evidence).toBe(true);
  });
  it("M2, K5: a second run writes nothing, and the index holds config.json plus the item paths", () => {
    legacy([receipt("A-1"), receipt("B-1")], { "A-1": entry("A-1") });
    git("add", "-f", VIEW, SIDECAR); commit("legacy");
    expect(store("migrate").status).toBe(0);
    expect(tracked()).toEqual([`${T}/config.json`, `${E}/A-1.json`, `${R}/A-1.json`, `${R}/B-1.json`]);
    const before = listing(R)!.map((name) => [name, statSync(join(root, R, name)).mtimeMs, read(`${R}/${name}`)]);
    const again = store("migrate");
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("already migrated");
    expect(listing(R)!.map((name) => [name, statSync(join(root, R, name)).mtimeMs, read(`${R}/${name}`)])).toEqual(before);
  });
  it("ruling 1 opus M1(b): migrate splits the blob the index names, not the working-tree file", () => {
    legacy([receipt("A-1")], { "A-1": entry("A-1") }); git("add", "-f", VIEW, SIDECAR); commit("legacy");
    write(VIEW, canonical({ schemaVersion: 2, receipts: [receipt("A-1", "SEPARATION-HELD"), receipt("W-1")] }));
    const result = store("migrate");
    expect(result.status, result.output).toBe(0);
    expect(listing(R)).toEqual(["A-1.json"]);
    expect(read(`${R}/A-1.json`)).toBe(canonical(receipt("A-1")));
  });
  it("M3: a duplicate, non-conforming or case-colliding id is refused naming it, and nothing is written", () => {
    for (const [records, name] of [
      [[receipt("A-1"), receipt("A-1")], "A-1"], [[receipt("bad id")], "bad id"], [[receipt("D1-WI-1"), receipt("d1-wi-1")], "d1-wi-1"], [[receipt("NUL.1")], "NUL.1"],
    ] as Array<[unknown[], string]>) {
      legacy(records); git("add", "-f", VIEW, SIDECAR); commit(name);
      const result = store("migrate");
      expect(result.status, name).not.toBe(0);
      expect(result.stderr, name).toContain(name);
      expect(listing(R), name).toBeNull();
      expect(tracked(), name).toContain(VIEW);
    }
  });
  it("M4: a store that is not the engine's canonical bytes is refused", () => {
    write(VIEW, JSON.stringify({ schemaVersion: 2, receipts: [receipt("A-1")] })); write(SIDECAR, canonical({ schemaVersion: 1, entries: {} }));
    git("add", "-f", VIEW, SIDECAR); commit("legacy");
    const result = store("migrate");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a canonical engine store");
    expect(listing(R)).toBeNull();
  });
  it("M5: an orphan evidence key or a key holding another id is refused, and neither directory is made", () => {
    for (const entries of [{ "Z-9": entry("Z-9") }, { "A-1": entry("A-2") }]) {
      legacy([receipt("A-1")], entries); git("add", "-f", VIEW, SIDECAR); commit("legacy");
      const result = store("migrate");
      const key = Object.keys(entries)[0];
      expect(result.status, key).not.toBe(0);
      expect(result.stderr, key).toContain(key);
      expect([listing(R), listing(E)], key).toEqual([null, null]);
    }
  });
});

describe("RC5 migrate --import", () => {
  /** master: legacy with M-1, a branch adding P-1 (and its evidence), then master migrates and adds M-2. */
  function setup(branchRecords = [receipt("M-1"), receipt("P-1")], inherited: unknown = entry("M-1")) {
    legacy([receipt("M-1")], { "M-1": entry("M-1") }); git("add", "-f", VIEW, SIDECAR); commit("legacy");
    git("switch", "-qc", "branch");
    legacy(branchRecords, { "M-1": inherited, "P-1": entry("P-1") }); write("tests/p.txt", "p\n"); commit("branch adds P-1");
    git("switch", "-q", "master");
    expect(store("migrate").status).toBe(0); commit("migrate");
    write(`${R}/M-2.json`, canonical(receipt("M-2"))); write(`${E}/M-2.json`, canonical(entry("M-2"))); commit("master adds M-2");
    git("switch", "-q", "branch");
    return git("rev-parse", "branch").stdout.trim();
  }
  it("R4, R4b: the modify/delete conflict is resolved by --import, keeping master's files and adding the branch's", () => {
    const tip = setup();
    const rebased = git("rebase", "master");
    expect(`${rebased.stdout}${rebased.stderr}`).toMatch(/CONFLICT \(modify\/delete\).*receipts\.json/);
    const master = Object.fromEntries(["M-1", "M-2"].map((id) => [id, [read(`${R}/${id}.json`), read(`${E}/${id}.json`)]]));
    const result = store("migrate", "--import", tip);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain("imported 1");
    expect(read(`${R}/P-1.json`)).toBe(canonical(receipt("P-1")));
    expect(read(`${E}/P-1.json`)).toBe(canonical(entry("P-1")));
    for (const id of ["M-1", "M-2"]) expect([read(`${R}/${id}.json`), read(`${E}/${id}.json`)], id).toEqual(master[id]);
    expect(tracked()).not.toContain(VIEW);
    expect(spawnSync("git", ["rebase", "--continue"], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_EDITOR: "true" } }).status).toBe(0);
    const keep = store("keep-check", "--parent", "master", "--head", "HEAD");
    expect(keep.status, keep.output).toBe(0);
    expect(keep.stdout).toContain("kept 2 of 2; added 1");
  });
  it("R5: a branch that changed a master record is refused naming the id, and nothing is written", () => {
    const tip = setup([receipt("M-1", "SEPARATION-HELD"), receipt("P-1")]);
    git("rebase", "master");
    const result = store("migrate", "--import", tip);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("M-1");
    expect(listing(R)).toEqual(["M-1.json", "M-2.json"]);
  });
  it("ruling 1 gpt M2: inherited evidence that differs from master's file is refused naming the id; equal is R4", () => {
    const tip = setup(undefined, { ...entry("M-1"), lane: "rust" });
    git("rebase", "master");
    const before = read(`${E}/M-1.json`);
    const result = store("migrate", "--import", tip);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("M-1");
    expect(read(`${E}/M-1.json`)).toBe(before);
    expect(listing(R)).toEqual(["M-1.json", "M-2.json"]);
  });
  it("M7: an unresolvable revision or one with no tracked receipts.json is refused naming it", () => {
    write(`${R}/M-1.json`, canonical(receipt("M-1"))); const plain = commit("items");
    const before = [listing(R), tracked()];
    for (const rev of ["no-such-rev", plain]) {
      const result = store("migrate", "--import", rev);
      expect(result.status, rev).not.toBe(0);
      expect(result.stderr, rev).toContain(rev);
      expect([listing(R), tracked()], rev).toEqual(before);
    }
  });
  it("M8: a branch id differing only in case from a master file is refused naming both", () => {
    const tip = setup([receipt("M-1"), receipt("m-1")]);
    git("rebase", "master");
    const blob = git("rev-parse", `master:${R}/M-1.json`).stdout.trim();
    const result = store("migrate", "--import", tip);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("m-1");
    expect(result.stderr).toContain("M-1");
    expect(readdirSync(join(root, R)).filter((name) => name.toLowerCase() === "m-1.json")).toEqual(["M-1.json"]);
    expect(spawnSync("git", ["hash-object", `${R}/M-1.json`], { cwd: root, encoding: "utf8" }).stdout.trim()).toBe(blob);
  });
});
