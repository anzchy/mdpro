// @vitest-environment node
/**
 * RC5-S3 (AC-6, AC-1): `receipt-store.mjs migrate` splits the tracked receipts.json and
 * evidence.json into one file per id, proves the byte round trip before it touches the index, and
 * is a no-op once the index no longer tracks them; `migrate --import <rev>` brings a branch cut
 * before the migration across.
 * Matrix rows: M1s (every real-store field, item bytes, the store loads), M1s-big (over 2 MiB), M2, M3, M4, M5, M7, M8,
 * K5 (index), R4, R4b (files), R5. M1, the run on the real store at 22ffe5ea, read git history the shallow CI checkout
 * lacks; it left the suite in RC5 fix 1 and was run once at that fix's head (no test reads the repository's history).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../scripts/tdd/receipt-store.mjs");
const T = ".claude/tdd-guardian", R = `${T}/receipts`, E = `${T}/receipt-evidence`, VIEW = `${T}/receipts.json`, SIDECAR = `${T}/evidence.json`;
let root: string;
type Run = { status: number | null; stdout: string; stderr: string };
/** An async child call (rule: no worker-blocking child process in a test); it never throws, like spawnSync. */
const exec = (cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) => new Promise<Run>((done) => {
  execFile(cmd, args, { cwd: opts.cwd ?? root, env: opts.env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout, stderr }));
});

const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function receipt(id: string, verdict: string | null = null) {
  return {
    id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", head_sha: "", dirty_source: [],
    red: { kind: "assertion-failure", red: true, reason: "1 failing" },
    test_files: { "tests/a.test.ts": { state: "ok", sha: "abc", lines: ["x"] } }, verified_at: null, verdict, findings: [],
  };
}
const entry = (id: string) => ({ id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", plugin_version: "0.10.2" });
/** The field sets of the real store at 22ffe5ea (1020 receipts, 123 evidence entries), which M1s must carry. */
const RECEIPT_FIELDS = ["id", "lane", "recorded_at", "head_sha", "dirty_source", "red", "test_files", "verified_at", "verdict", "findings", "accepted"];
const EVIDENCE_FIELDS = ["id", "lane", "recorded_at", "plugin_version", "lane_command", "env", "failures", "tests_tree", "spec_blobs", "settled_blobs", "evidence_required", "replay"];
const fieldUnion = (values: object[]) => [...new Set(values.flatMap((value) => Object.keys(value)))];
/** A receipt shaped like the real store's: settled, a CJK test path with a space, escapes, nested findings, optionally `accepted`. */
function richReceipt(id: string, verdict: string | null, accepted: boolean) {
  return {
    id, lane: "unit", recorded_at: "2026-10-08T08:36:59.630Z", head_sha: "a39d4b2635af8c877646072e38bc201533f6c32e",
    dirty_source: ["scripts/control/doctor.mjs", "src-tauri/src/models/preferences.rs"],
    red: { red: true, kind: "opaque-failure", reason: `${id}: "quoted" \\ back\nslash, 中文 and 🙂` },
    test_files: {
      "tests/中文 a.test.ts": { state: "ok", sha: "3720e2d7b2af413a5db3348b78f2f01ae662e5c8a5de1583a06db28e33a90744", lines: ["9c61af8e89480691", "1cc70bd54b855eca"], reason: "" },
      "src-tauri/src/x_tests.rs": { state: "ok", sha: "c8eda8bb12047cd583b5fb2f6a0f4e712f875ebbcd3dc51ac052c5faf9469315", lines: ["e89bcc293adfc2b4"], reason: "" },
    },
    verified_at: verdict ? "2026-10-08T09:00:19.477Z" : null, verdict,
    findings: verdict ? [{ severity: "medium", code: "weak-red", message: "无计数 (no counts) — weaker evidence" }] : [],
    ...(accepted ? { accepted: { by: "user", at: "2026-10-08", file: "tests/support/launchHarness.ts", reason: "改为比较 { ...process.env }" } } : {}),
  };
}
/** An evidence entry carrying every field of the real sidecar, nested. */
const richEntry = (id: string) => ({
  ...entry(id), lane_command: "node scripts/tdd/unit-red-lane.mjs", env: { LANG: "C.UTF-8", VITEST_MAX_WORKERS: "1", node: "v22.22.3", platform: "darwin" },
  failures: [{ id: JSON.stringify(["tests/中文 a.test.ts", id, "case"]), kind: "assertion", location: { file: "tests/中文 a.test.ts", line: 19 }, message: "AssertionError: \"x\"\n: expected false to be true" }],
  tests_tree: { ref: `refs/receipts/${id}/20261029T043045269Z/tests`, tree: "2bf80afce2dfd548f2d6299990b2821cdebf0ea9" },
  spec_blobs: { "tests/中文 a.test.ts": "7bddf09a738e23bfeb548badff6eb0ce626566ae" }, settled_blobs: { "tests/中文 a.test.ts": "0785af9f9d49dbf328267268c1ad2823957f7487" },
  evidence_required: true, replay: { path: `.claude/tdd-guardian/evidence/${id}.json`, digest: "bd2cf0ade96ca225c73fe212ddafd750c18d916abecaf9c878c568f3dc1078cd", result: "passed", base: "de0f65ee8fbb7495737df85b67e73a2e0c5674c8", head: "3acd63f9e342bdda31523f7efe705f4f1f798ea8" },
});
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
const tracked = async () => (await git("ls-files", T)).stdout.split("\n").filter(Boolean).sort();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mdpro-rc5-migrate-"));
  await git("init", "-q", "-b", "master"); await git("config", "user.email", "t@example.com"); await git("config", "user.name", "T");
  write(".gitignore", `${VIEW}\n${SIDECAR}\n`);
  write(`${T}/config.json`, "{}\n");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("RC5 migrate", () => {
  it("M1s, AC-8: a store with every field the real store carries splits, each item file is its record's canonical bytes, and the store loads", async () => {
    const records = [richReceipt("Z-2", "SEPARATION-BROKEN", true), richReceipt("A-1", null, false), richReceipt("D355-S20", "SEPARATION-HELD", false)];
    const entries = { "A-1": richEntry("A-1"), "Z-2": richEntry("Z-2") };
    expect(fieldUnion(records)).toEqual(expect.arrayContaining(RECEIPT_FIELDS));
    expect(fieldUnion(Object.values(entries))).toEqual(expect.arrayContaining(EVIDENCE_FIELDS));
    legacy(records, entries); const raw = read(VIEW), evidence = read(SIDECAR);
    await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    const result = await store("migrate");
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain(`receipts.json sha256 ${sha(raw)} rebuilt ${sha(raw)}`);
    expect(result.stdout).toContain(`evidence.json sha256 ${sha(evidence)} rebuilt ${sha(evidence)}`);
    expect(listing(R)).toEqual(["A-1.json", "D355-S20.json", "Z-2.json"]);
    for (const record of records) expect(read(`${R}/${record.id}.json`), record.id).toBe(canonical(record));
    expect(listing(E)).toEqual(["A-1.json", "Z-2.json"]);
    for (const [id, value] of Object.entries(entries)) expect(read(`${E}/${id}.json`), id).toBe(canonical(value));
    expect(canonical({ schemaVersion: 2, receipts: records.map((record) => JSON.parse(read(`${R}/${record.id}.json`))) })).toBe(raw);
    await commit("migrate");
    const keep = await store("keep-check", "--parent", "HEAD", "--head", "HEAD");
    expect(keep.status, keep.output).toBe(0);
    expect(keep.stdout).toContain("kept 3 of 3");
  });
  it("M1s-big, AC-8: a store over 2 MiB (CJK, so bytes differ from characters) is read from the index and round-trips", async () => {
    const records = ["Q-3", "B-1", "K-2", "C-4"].map((id) => ({ ...receipt(id), red: { kind: "assertion-failure", red: true, reason: `${id} 失败的断言 ✓ `.repeat(40_000) } }));
    legacy(records); const raw = read(VIEW);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(2 * 1024 * 1024);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(raw.length);
    await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    const result = await store("migrate");
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain(`receipts.json sha256 ${sha(raw)} rebuilt ${sha(raw)}`);
    expect(listing(R)?.length).toBe(records.length);
    expect(canonical({ schemaVersion: 2, receipts: records.map((record) => JSON.parse(read(`${R}/${record.id}.json`))) })).toBe(raw);
  });
  it("M2, K5: a second run writes nothing, and the index holds config.json plus the item paths", async () => {
    legacy([receipt("A-1"), receipt("B-1")], { "A-1": entry("A-1") });
    await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    expect((await store("migrate")).status).toBe(0);
    expect(await tracked()).toEqual([`${T}/config.json`, `${E}/A-1.json`, `${R}/A-1.json`, `${R}/B-1.json`]);
    const before = listing(R)!.map((name) => [name, statSync(join(root, R, name)).mtimeMs, read(`${R}/${name}`)]);
    const again = await store("migrate");
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("already migrated");
    expect(listing(R)!.map((name) => [name, statSync(join(root, R, name)).mtimeMs, read(`${R}/${name}`)])).toEqual(before);
  });
  it("ruling 1 opus M1(b): migrate splits the blob the index names, not the working-tree file", async () => {
    legacy([receipt("A-1")], { "A-1": entry("A-1") }); await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    write(VIEW, canonical({ schemaVersion: 2, receipts: [receipt("A-1", "SEPARATION-HELD"), receipt("W-1")] }));
    const result = await store("migrate");
    expect(result.status, result.output).toBe(0);
    expect(listing(R)).toEqual(["A-1.json"]);
    expect(read(`${R}/A-1.json`)).toBe(canonical(receipt("A-1")));
  });
  it("M3: a duplicate, non-conforming or case-colliding id is refused naming it, and nothing is written", async () => {
    for (const [records, name] of [
      [[receipt("A-1"), receipt("A-1")], "A-1"], [[receipt("bad id")], "bad id"], [[receipt("D1-WI-1"), receipt("d1-wi-1")], "d1-wi-1"], [[receipt("NUL.1")], "NUL.1"],
    ] as Array<[unknown[], string]>) {
      legacy(records); await git("add", "-f", VIEW, SIDECAR); await commit(name);
      const result = await store("migrate");
      expect(result.status, name).not.toBe(0);
      expect(result.stderr, name).toContain(name);
      expect(listing(R), name).toBeNull();
      expect(await tracked(), name).toContain(VIEW);
    }
  });
  it("M4: a store that is not the engine's canonical bytes is refused", async () => {
    write(VIEW, JSON.stringify({ schemaVersion: 2, receipts: [receipt("A-1")] })); write(SIDECAR, canonical({ schemaVersion: 1, entries: {} }));
    await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    const result = await store("migrate");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a canonical engine store");
    expect(listing(R)).toBeNull();
  });
  it("M5: an orphan evidence key or a key holding another id is refused, and neither directory is made", async () => {
    for (const entries of [{ "Z-9": entry("Z-9") }, { "A-1": entry("A-2") }]) {
      legacy([receipt("A-1")], entries); await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
      const result = await store("migrate");
      const key = Object.keys(entries)[0];
      expect(result.status, key).not.toBe(0);
      expect(result.stderr, key).toContain(key);
      expect([listing(R), listing(E)], key).toEqual([null, null]);
    }
  });
});

describe("RC5 migrate --import", () => {
  /** master: legacy with M-1, a branch adding P-1 (and its evidence), then master migrates and adds M-2. */
  async function setup(branchRecords = [receipt("M-1"), receipt("P-1")], inherited: unknown = entry("M-1")) {
    legacy([receipt("M-1")], { "M-1": entry("M-1") }); await git("add", "-f", VIEW, SIDECAR); await commit("legacy");
    await git("switch", "-qc", "branch");
    legacy(branchRecords, { "M-1": inherited, "P-1": entry("P-1") }); write("tests/p.txt", "p\n"); await commit("branch adds P-1");
    await git("switch", "-q", "master");
    expect((await store("migrate")).status).toBe(0); await commit("migrate");
    write(`${R}/M-2.json`, canonical(receipt("M-2"))); write(`${E}/M-2.json`, canonical(entry("M-2"))); await commit("master adds M-2");
    await git("switch", "-q", "branch");
    return (await git("rev-parse", "branch")).stdout.trim();
  }
  it("R4, R4b: the modify/delete conflict is resolved by --import, keeping master's files and adding the branch's", async () => {
    const tip = await setup();
    const rebased = await git("rebase", "master");
    expect(`${rebased.stdout}${rebased.stderr}`).toMatch(/CONFLICT \(modify\/delete\).*receipts\.json/);
    const master = Object.fromEntries(["M-1", "M-2"].map((id) => [id, [read(`${R}/${id}.json`), read(`${E}/${id}.json`)]]));
    const result = await store("migrate", "--import", tip);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain("imported 1");
    expect(read(`${R}/P-1.json`)).toBe(canonical(receipt("P-1")));
    expect(read(`${E}/P-1.json`)).toBe(canonical(entry("P-1")));
    for (const id of ["M-1", "M-2"]) expect([read(`${R}/${id}.json`), read(`${E}/${id}.json`)], id).toEqual(master[id]);
    expect(await tracked()).not.toContain(VIEW);
    expect((await exec("git", ["rebase", "--continue"], { env: { ...process.env, GIT_EDITOR: "true" } })).status).toBe(0);
    const keep = await store("keep-check", "--parent", "master", "--head", "HEAD");
    expect(keep.status, keep.output).toBe(0);
    expect(keep.stdout).toContain("kept 2 of 2; added 1");
  });
  it("R5: a branch that changed a master record is refused naming the id, and nothing is written", async () => {
    const tip = await setup([receipt("M-1", "SEPARATION-HELD"), receipt("P-1")]);
    await git("rebase", "master");
    const result = await store("migrate", "--import", tip);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("M-1");
    expect(listing(R)).toEqual(["M-1.json", "M-2.json"]);
  });
  it("ruling 1 gpt M2: inherited evidence that differs from master's file is refused naming the id; equal is R4", async () => {
    const tip = await setup(undefined, { ...entry("M-1"), lane: "rust" });
    await git("rebase", "master");
    const before = read(`${E}/M-1.json`);
    const result = await store("migrate", "--import", tip);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("M-1");
    expect(read(`${E}/M-1.json`)).toBe(before);
    expect(listing(R)).toEqual(["M-1.json", "M-2.json"]);
  });
  it("M7: an unresolvable revision or one with no tracked receipts.json is refused naming it", async () => {
    write(`${R}/M-1.json`, canonical(receipt("M-1"))); const plain = await commit("items");
    const before = [listing(R), await tracked()];
    for (const rev of ["no-such-rev", plain]) {
      const result = await store("migrate", "--import", rev);
      expect(result.status, rev).not.toBe(0);
      expect(result.stderr, rev).toContain(rev);
      expect([listing(R), await tracked()], rev).toEqual(before);
    }
  });
  it("M8: a branch id differing only in case from a master file is refused naming both", async () => {
    const tip = await setup([receipt("M-1"), receipt("m-1")]);
    await git("rebase", "master");
    const blob = (await git("rev-parse", `master:${R}/M-1.json`)).stdout.trim();
    const result = await store("migrate", "--import", tip);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("m-1");
    expect(result.stderr).toContain("M-1");
    expect(readdirSync(join(root, R)).filter((name) => name.toLowerCase() === "m-1.json")).toEqual(["M-1.json"]);
    expect((await git("hash-object", `${R}/M-1.json`)).stdout.trim()).toBe(blob);
  });
});
