// @vitest-environment node
/**
 * RC5-S2 (AC-5): `receipt-store.mjs keep-check --parent P --head H`, the landing verifier's
 * replacement for the receipts-union check. Every parent record must reach the head with the same
 * bytes; every head item file must be well named, canonical and shaped; a tracked legacy store at
 * the head fails unless P and H are both legacy. It reads trees, never the checkout.
 * Matrix rows: E3, R1, R2, R3′, D1–D8, D2e, D6′, D6e, D7, D8b, D8c, K1–K5, K-L.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../scripts/tdd/receipt-store.mjs");
const R = ".claude/tdd-guardian/receipts", E = ".claude/tdd-guardian/receipt-evidence";
const VIEW = ".claude/tdd-guardian/receipts.json", SIDECAR = ".claude/tdd-guardian/evidence.json";
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
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", plugin_version: "0.10.2", ...extra });
const git = (...args: string[]) => exec("git", args);
const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const item = (id: string, value: unknown = receipt(id)) => write(`${R}/${id}.json`, canonical(value));
const ev = (id: string, value: unknown = entry(id)) => write(`${E}/${id}.json`, canonical(value));
const legacy = (ids: string[], entries: string[] = []) => {
  write(VIEW, canonical({ schemaVersion: 2, receipts: ids.map((id) => receipt(id)) }));
  write(SIDECAR, canonical({ schemaVersion: 1, entries: Object.fromEntries(entries.map((id) => [id, entry(id)])) }));
};
const commit = async (message: string) => { await git("add", "-A"); await git("commit", "-q", "--allow-empty", "-m", message); return (await git("rev-parse", "HEAD")).stdout.trim(); };
const keep = async (...args: string[]) => {
  const result = await exec(process.execPath, [script, "keep-check", ...args]);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: `${result.stdout}\n${result.stderr}` };
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mdpro-rc5-keep-"));
  await git("init", "-q", "-b", "master"); await git("config", "user.email", "t@example.com"); await git("config", "user.name", "T");
  write("README.md", "x\n");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("RC5 keep-check on the item layout", () => {
  it("E3: no item files at either side keeps 0 of 0", async () => {
    const p = await commit("p"), h = await commit("h");
    const result = await keep("--parent", p, "--head", h);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kept 0 of 0; added 0");
  });
  it("D7: a head that only adds keeps every parent record", async () => {
    item("M-1"); item("M-2"); ev("M-1");
    const p = await commit("p");
    item("X-1"); item("X-2");
    const result = await keep("--parent", p, "--head", await commit("h"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kept 2 of 2; added 2");
  });
  it("D1, D2, D4, D2e: a deleted or changed receipt or evidence file fails, whitespace included", async () => {
    item("M-1"); item("M-2"); ev("M-1"); ev("M-2");
    const p = await commit("p");
    await git("rm", "-q", `${R}/M-1.json`); await git("rm", "-q", `${E}/M-2.json`);
    write(`${R}/M-2.json`, `${canonical(receipt("M-2"))}\n`);
    write(`${E}/M-1.json`, canonical(entry("M-1", { lane: "rust" })));
    const result = await keep("--parent", p, "--head", await commit("h"));
    expect(result.status).toBe(1);
    for (const line of ["deleted: M-1", "changed: M-2", "evidence deleted: M-2", "evidence changed: M-1", "kept 0 of 2"]) expect(result.output).toContain(line);
  });
  it("D3: a rename with the same content is a deletion and a misnamed file", async () => {
    item("M-1");
    const p = await commit("p");
    await git("mv", `${R}/M-1.json`, `${R}/M-1b.json`);
    const result = await keep("--parent", p, "--head", await commit("h"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("deleted: M-1");
    expect(result.output).toContain("misnamed: M-1b.json");
  });
  it("D5, K1: a non-canonical, misnamed, orphan or nested head file fails naming it", async () => {
    const p = await commit("p");
    const cases: Array<[() => void, string]> = [
      [() => write(`${R}/X-1.json`, JSON.stringify(receipt("X-1"))), "non-canonical: X-1"],
      [() => { item("X-1"); write(`${E}/X-1.json`, JSON.stringify(entry("X-1"))); }, "evidence non-canonical: X-1"],
      [() => { item("X-1"); ev("X-1", entry("X-2")); }, "evidence misnamed: X-1.json"],
      [() => ev("Y-1"), "orphan evidence: Y-1"],
      [() => item("sub/A-1", receipt("A-1")), `unexpected path: ${R}/sub/A-1.json`],
      [() => write(`${R}/X-1.json`, canonical({ ...receipt("X-1"), red: null })), "malformed: X-1"],
      [() => item("CON.1", receipt("CON.1")), "misnamed: CON.1.json"],
    ];
    for (const [make, line] of cases) {
      await git("checkout", "-q", "--detach", p); await git("clean", "-qfdx");
      make();
      const result = await keep("--parent", p, "--head", await commit(line));
      expect(result.status, line).toBe(1);
      expect(result.output, line).toContain(line);
    }
  });
  it("R3′: two ids equal ignoring case fail, built with plumbing so no filesystem is involved", async () => {
    const p = await commit("p");
    const blob = async (id: string) => {
      const file = join(root, `blob-${id}`);
      writeFileSync(file, canonical(receipt(id)));
      const hashed = (await exec("git", ["hash-object", "-w", file])).stdout.trim();
      rmSync(file);
      return hashed;
    };
    await git("update-index", "--add", "--cacheinfo", `100644,${await blob("D1-WI-1")},${R}/D1-WI-1.json`);
    await git("update-index", "--add", "--cacheinfo", `100644,${await blob("d1-wi-1")},${R}/d1-wi-1.json`);
    const tree = (await git("write-tree")).stdout.trim();
    const h = (await git("commit-tree", tree, "-p", p, "-m", "h")).stdout.trim();
    const result = await keep("--parent", p, "--head", h);
    expect(result.status).toBe(1);
    expect(result.output).toContain("case-insensitive duplicate: D1-WI-1, d1-wi-1");
  });
  it("D6′, D6e: a head that tracks receipts.json or evidence.json again fails when the parent is on items", async () => {
    item("M-1");
    const p = await commit("p");
    for (const path of [VIEW, SIDECAR]) {
      await git("checkout", "-q", "--detach", p);
      write(path, canonical(path === VIEW ? { schemaVersion: 2, receipts: [receipt("M-1")] } : { schemaVersion: 1, entries: {} }));
      await git("add", "-f", path);
      const result = await keep("--parent", p, "--head", await commit(path));
      expect(result.status, path).toBe(1);
      expect(result.output, path).toContain("legacy store tracked at head");
    }
  });
});

describe("RC5 keep-check across rebases", () => {
  it("R1: two PRs adding different ids rebase without a conflict and keep everything", async () => {
    item("M-1");
    await commit("m");
    await git("switch", "-qc", "a"); item("A-1"); await commit("a");
    await git("switch", "-q", "master"); await git("switch", "-qc", "b"); item("B-1"); await commit("b");
    await git("switch", "-q", "master"); await git("merge", "-q", "--ff-only", "a");
    await git("switch", "-q", "b");
    const rebased = await git("rebase", "master");
    expect(rebased.status).toBe(0);
    expect(`${rebased.stdout}${rebased.stderr}`).not.toContain("CONFLICT");
    const result = await keep("--parent", "master", "--head", "b");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kept 2 of 2; added 1");
    expect((await git("ls-tree", "--name-only", "b", `${R}/`)).stdout.split("\n").filter(Boolean)).toEqual([`${R}/A-1.json`, `${R}/B-1.json`, `${R}/M-1.json`]);
  });
  it("R2: two PRs adding the same id stop on an add/add conflict naming the file", async () => {
    await commit("m");
    await git("switch", "-qc", "a"); item("X-1"); await commit("a");
    await git("switch", "-q", "master"); await git("switch", "-qc", "b"); item("X-1", receipt("X-1", "SEPARATION-HELD")); await commit("b");
    await git("switch", "-q", "master"); await git("merge", "-q", "--ff-only", "a"); await git("switch", "-q", "b");
    const rebased = await git("rebase", "master");
    expect(rebased.status).not.toBe(0);
    expect(`${rebased.stdout}${rebased.stderr}`).toMatch(new RegExp(`CONFLICT \\(add/add\\).*${R}/X-1\\.json`));
    await git("rebase", "--abort");
  });
});

describe("RC5 keep-check across the migration", () => {
  const migrated = async (ids: string[], entries: string[]) => {
    await git("rm", "-q", "--cached", VIEW, SIDECAR); rmSync(join(root, VIEW)); rmSync(join(root, SIDECAR));
    for (const id of ids) item(id);
    for (const id of entries) ev(id);
  };
  it("D8: a migration commit keeps every legacy record byte for byte; a mutated one fails", async () => {
    legacy(["L-1", "L-2"], ["L-1"]);
    const p = await commit("p");
    await migrated(["L-1", "L-2"], ["L-1"]);
    const h = await commit("h");
    const result = await keep("--parent", p, "--head", h);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kept 2 of 2; added 0");
    item("L-2", receipt("L-2", "SEPARATION-HELD"));
    const bad = await keep("--parent", p, "--head", await commit("bad"));
    expect(bad.status).toBe(1);
    expect(bad.output).toContain("changed: L-2");
  });
  it("D8b, D8c: a legacy record or evidence entry missing or changed at the head fails", async () => {
    legacy(["L-1", "L-2"], ["L-1", "L-2"]);
    const p = await commit("p");
    await migrated(["L-1"], ["L-1"]);
    ev("L-1", entry("L-1", { lane: "rust" }));
    const result = await keep("--parent", p, "--head", await commit("h"));
    expect(result.status).toBe(1);
    for (const line of ["deleted: L-2", "evidence deleted: L-2", "evidence changed: L-1"]) expect(result.output).toContain(line);
  });
  it("K-L (R-c): legacy to legacy compares per record", async () => {
    legacy(["L-1", "L-2"], ["L-1"]);
    const p = await commit("p");
    legacy(["L-1", "L-2", "L-3"], ["L-1"]);
    const kept = await keep("--parent", p, "--head", await commit("kept"));
    expect(kept.status).toBe(0);
    expect(kept.stdout).toContain("kept 2 of 2; added 1");
    legacy(["L-1"], ["L-1"]);
    const dropped = await keep("--parent", p, "--head", await commit("dropped"));
    expect(dropped.status).toBe(1);
    expect(dropped.output).toContain("deleted: L-2");
  });
  it("K5 (R-f): a head that tracks the legacy store and every item file still fails", async () => {
    legacy(["L-1"], ["L-1"]);
    const p = await commit("p");
    item("L-1"); ev("L-1");
    const result = await keep("--parent", p, "--head", await commit("h"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("legacy store tracked at head");
  });
  it("K2, K4: the result depends on the revisions, not on what is checked out", async () => {
    legacy(["L-1", "L-2"], []);
    const p = await commit("p");
    await migrated(["L-1", "L-2"], []);
    item("L-2", receipt("L-2", "SEPARATION-HELD"));
    const h = await commit("h");
    item("Z-1");
    const third = await commit("third");
    const d8 = new Set<string>();
    for (const at of [p, h, third]) {
      await git("checkout", "-q", "--detach", at);
      const result = await keep("--parent", p, "--head", h);
      d8.add(`${result.status} ${result.output.includes("changed: L-2")}`);
    }
    expect([...d8]).toEqual(["1 true"]);
    await git("checkout", "-q", "--detach", third);
    rmSync(join(root, R, "Z-1.json"));
    const inverse = await keep("--parent", third, "--head", third);
    expect(inverse.status).toBe(0);
    expect(inverse.stdout).toContain("kept 3 of 3; added 0");
  });
  it("K3: an unresolvable or missing revision exits 64 naming it, with no count", async () => {
    const p = await commit("p");
    for (const [args, name] of [[["--parent", "0".repeat(40), "--head", p], "0".repeat(40)], [["--parent", p, "--head", "no-such-ref"], "no-such-ref"], [["--parent", p], "--head"]] as Array<[string[], string]>) {
      const result = await keep(...args);
      expect(result.status, name).toBe(64);
      expect(result.stderr, name).toContain(name);
      expect(result.stdout, name).not.toContain("kept");
    }
  });
});
