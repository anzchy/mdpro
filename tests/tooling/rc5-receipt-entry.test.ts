// @vitest-environment node
/**
 * RC5-S4 (AC-1, AC-3, AC-4): the entry on the per-item layout. record writes
 * `receipts/<ID>.json` and `receipt-evidence/<ID>.json`; verify, discard, check-pending and
 * replay read and write those files, not receipts.json or evidence.json; ids that would
 * collide as file names are refused before any lane runs.
 * Matrix rows: S1′, E1, G9, S2, C2′ (verify beside a corrupt neighbour), S3, S4, E2, S7 (view deleted),
 * B2, B3, B5, B6, B9, C1, C5 (record), C2 (check-pending), C4, S6, F1, F2, F3, S8, S9 (view deleted),
 * S11, P2, E2E1.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
const T = ".claude/tdd-guardian", R = `${T}/receipts`, E = `${T}/receipt-evidence`;
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const item = (id: string) => JSON.parse(repo.read(`${R}/${id}.json`));
const has = (path: string) => existsSync(join(repo.root, path));
const listing = (dir: string) => (has(dir) ? readdirSync(join(repo.root, dir)).sort() : []);
/** A spec that leaves a mark in the ignored folder when the lane loads it, and fails until src/x.mjs exports 2. */
const SPEC = [
  'import { appendFileSync, mkdirSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'import { v } from "../src/x.mjs";',
  'mkdirSync("ignored", { recursive: true }); appendFileSync("ignored/ran.log", "x\\n");',
  'it("v is two", () => { expect(v).toBe(2); });',
].join("\n");
const ran = () => (has("ignored/ran.log") ? repo.read("ignored/ran.log").split("\n").filter(Boolean).length : 0);
function failing() { repo.write("tests/a.test.ts", SPEC); repo.write("src/x.mjs", "export const v = 1;\n"); }
const fix = () => repo.write("src/x.mjs", "export const v = 2;\n");
function hand(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", head_sha: "", dirty_source: [],
    red: { kind: "assertion-failure", red: true, reason: "1 failing" },
    test_files: { "tests/a.test.ts": { state: "ok", sha: "abc", lines: ["x"] } }, verified_at: null, verdict: null, findings: [], ...extra,
  };
}
const put = (id: string, value: unknown) => repo.write(`${R}/${id}.json`, canonical(value));
const record = (id: string) => repo.entry("record", "--id", id, "--test", "tests/a.test.ts");
async function onMaster(paths: Record<string, string>) {
  await repo.git("switch", "-q", "master");
  for (const [path, text] of Object.entries(paths)) repo.write(path, text);
  await repo.commit("master item");
  await repo.git("switch", "-q", "feature");
  await repo.git("merge", "-q", "--ff-only", "master");
}

describe.skipIf(!pluginVersion)("RC5-S4 the entry on item files", () => {
  it("S1′, E1, G9: record writes the two item files in canonical bytes and no evidence.json", async () => {
    failing();
    const result = await record("A-1");
    expect(result.status, result.output).toBe(0);
    expect(listing(R)).toEqual(["A-1.json"]);
    expect(repo.read(`${R}/A-1.json`)).toBe(canonical(item("A-1")));
    expect(item("A-1")).toMatchObject({ id: "A-1", lane: "unit-red", red: { kind: "assertion-failure" } });
    expect(JSON.parse(repo.read(`${E}/A-1.json`))).toMatchObject({ id: "A-1", recorded_at: item("A-1").recorded_at, plugin_version: pluginVersion });
    expect(repo.read(`${E}/A-1.json`)).toBe(canonical(JSON.parse(repo.read(`${E}/A-1.json`))));
    expect(has(`${T}/evidence.json`)).toBe(false);
    const status = (await repo.git("status", "--porcelain=v1", "--untracked-files=all")).stdout;
    expect(status).toContain(`${R}/A-1.json`);
    expect(status).toContain(`${E}/A-1.json`);
    expect(status).not.toContain("evidence.json");
  });

  it("S2, C2′: verify settles the item file beside a corrupt neighbour and leaves every other file's bytes alone", async () => {
    put("B-1", hand("B-1"));
    failing();
    expect((await record("A-1")).status).toBe(0);
    repo.write(`${R}/Z-9.json`, "{");
    const others = [repo.read(`${R}/B-1.json`), repo.read(`${R}/Z-9.json`)];
    fix();
    const result = await repo.entry("verify", "--id", "A-1");
    expect(result.status, result.output).toBe(0);
    expect(item("A-1")).toMatchObject({ verdict: "SEPARATION-HELD", verified_at: expect.any(String) });
    expect(JSON.parse(repo.read(`${E}/A-1.json`)).settled_blobs).toEqual({ "tests/a.test.ts": expect.any(String) });
    expect([repo.read(`${R}/B-1.json`), repo.read(`${R}/Z-9.json`)]).toEqual(others);
  });

  it("S3: discard removes both item files of a branch receipt and nothing else", async () => {
    put("B-1", hand("B-1"));
    failing();
    expect((await record("A-1")).status).toBe(0);
    const other = repo.read(`${R}/B-1.json`);
    const result = await repo.entry("discard", "--id", "A-1");
    expect(result.status, result.output).toBe(0);
    expect([has(`${R}/A-1.json`), has(`${E}/A-1.json`)]).toEqual([false, false]);
    expect(repo.read(`${R}/B-1.json`)).toBe(other);
  });

  it("S4, E2, S7: check-pending judges branch item files, not master's, and not the view", async () => {
    const empty = await repo.entry("check-pending");
    expect(empty.status, empty.output).toBe(0);
    expect(empty.stdout).toContain("No unsettled, invalid or unevidenced branch receipts.");
    await onMaster({ [`${R}/M-1.json`]: canonical(hand("M-1")) });
    failing();
    expect((await record("B-1")).status).toBe(0);
    rmSync(join(repo.root, T, "receipts.json"), { force: true });
    const result = await repo.entry("check-pending");
    expect(result.status, result.output).toBe(1);
    expect(result.stderr).toContain("B-1 (unit-red): verdict unsettled");
    expect(result.stderr).not.toContain("M-1");
  });

  it("B2, B3, B5, B6, B9: an id that cannot be a safe, distinct file name is refused before any lane", async () => {
    failing();
    put("D41-WI-1", hand("D41-WI-1"));
    await onMaster({ [`${R}/X7-WI-1.json`]: canonical(hand("X7-WI-1")) });
    const before = repo.read(`${R}/D41-WI-1.json`);
    for (const [id, why] of [["D1/WI-1", /A valid --id is required/], ["修复-1", /A valid --id is required/], ["CON.1", /Windows device name/], ["aux.WI-1", /Windows device name/], ["d41-wi-1", /D41-WI-1/], ["x7-wi-1", /X7-WI-1/]] as Array<[string, RegExp]>) {
      const result = await record(id);
      expect(result.status, id).toBe(64);
      expect(result.stderr, id).toMatch(why);
    }
    expect(ran()).toBe(0);
    expect(listing(R)).toEqual(["D41-WI-1.json", "X7-WI-1.json"]);
    expect(repo.read(`${R}/D41-WI-1.json`)).toBe(before);
  });

  it("C1, C5, C2: record refuses a corrupt or stray item file naming it, and check-pending refuses a misnamed one", async () => {
    failing();
    for (const [name, text, why] of [["A-1.json", canonical(hand("A-1")).slice(0, 30), "receipts/A-1.json is not valid JSON"], ["notes.txt", "hi", "unexpected file in receipts/: notes.txt"]]) {
      repo.write(`${R}/${name}`, text);
      const result = await record("B-1");
      expect(result.status, name).toBe(64);
      expect(result.stderr, name).toContain(why);
      expect(has(`${R}/B-1.json`), name).toBe(false);
      rmSync(join(repo.root, R, name));
    }
    expect(ran()).toBe(0);
    put("A-1", hand("A-2"));
    const pending = await repo.entry("check-pending");
    expect(pending.status, pending.output).toBe(64);
    expect(pending.stderr).toContain("id A-2 does not match file name A-1");
  });

  it("C4: verify refuses an unreadable evidence file before the lane and leaves the receipt alone", async () => {
    failing();
    expect((await record("A-1")).status).toBe(0);
    repo.write(`${E}/A-1.json`, "{");
    const bytes = repo.read(`${R}/A-1.json`), runs = ran();
    fix();
    const result = await repo.entry("verify", "--id", "A-1");
    expect(result.status, result.output).toBe(64);
    expect(result.stderr).toContain("receipt-evidence/A-1.json");
    expect(ran()).toBe(runs);
    expect(repo.read(`${R}/A-1.json`)).toBe(bytes);
  });

  it("S6: an opaque-failure unit-red item file is re-recorded in place as one file", async () => {
    put("A-1", hand("A-1", { red: { kind: "opaque-failure", red: true, reason: "opaque" } }));
    failing();
    const result = await record("A-1");
    expect(result.status, result.output).toBe(0);
    expect(item("A-1").red.kind).toBe("assertion-failure");
    expect(item("A-1").recorded_at > "2026-11-02T00:00:00.000Z").toBe(true);
    expect(listing(R).filter((name) => /^a-1\.json$/i.test(name))).toEqual(["A-1.json"]);
    expect(JSON.parse(repo.read(`${E}/A-1.json`)).recorded_at).toBe(item("A-1").recorded_at);
  });

  it("F1, F2, F3: a refused record keeps its invalid receipt visible and discardable, with no evidence, and a later record succeeds", async () => {
    repo.write("tests/a.test.ts", SPEC); fix();
    const refs = await repo.refs();
    const refused = await record("A-1");
    expect(refused.status).toBe(64);
    expect(refused.stderr).toContain("Record refused");
    expect(item("A-1").red.kind).toBe("green");
    expect([has(`${E}/A-1.json`), await repo.refs()]).toEqual([false, refs]);
    const pending = await repo.entry("check-pending");
    expect(pending.stderr).toContain("A-1 (unit-red): RED kind green");
    repo.write("src/x.mjs", "export const v = 1;\n");
    const again = await record("A-1");
    expect(again.status, again.output).toBe(0);
    expect(again.stderr).not.toContain("changed outside the entry");
    expect(item("A-1").red.kind).toBe("assertion-failure");
    fix();
    repo.write("tests/b.test.ts", SPEC);
    expect((await repo.entry("record", "--id", "B-1", "--test", "tests/b.test.ts")).status).toBe(64);
    expect(item("B-1").red.kind).toBe("green");
    const gone = await repo.entry("discard", "--id", "B-1");
    expect(gone.status, gone.output).toBe(0);
    expect(has(`${R}/B-1.json`)).toBe(false);
  });

  it("S8, S9: an id on master is neither discarded nor re-recorded, and a settled item file blocks a record with the view gone", async () => {
    await onMaster({ [`${R}/M-1.json`]: canonical(hand("M-1")) });
    put("S-1", hand("S-1", { verdict: "SEPARATION-HELD", verified_at: "2026-11-02T01:00:00.000Z" }));
    failing();
    rmSync(join(repo.root, T, "receipts.json"), { force: true });
    const bytes = [repo.read(`${R}/M-1.json`), repo.read(`${R}/S-1.json`)];
    const discard = await repo.entry("discard", "--id", "M-1");
    expect(discard.status).toBe(64);
    expect(discard.stderr).toContain("Cannot discard a receipt inherited from master.");
    const onMasterRecord = await record("M-1");
    expect(onMasterRecord.status).toBe(64);
    expect(onMasterRecord.stderr).toContain("already on master");
    const settled = await record("S-1");
    expect(settled.status).toBe(64);
    expect(settled.stderr).toContain("already has valid or settled evidence");
    expect(ran()).toBe(0);
    expect([repo.read(`${R}/M-1.json`), repo.read(`${R}/S-1.json`)]).toEqual(bytes);
  });

  it("S11: verify, discard and replay refuse an id that differs only in case from an item file", async () => {
    put("D41-WI-1", hand("D41-WI-1"));
    failing();
    const bytes = repo.read(`${R}/D41-WI-1.json`);
    for (const action of ["verify", "discard", "replay"]) {
      const result = await repo.entry(action, "--id", "d41-wi-1");
      expect(result.status, action).toBe(64);
      expect(result.stderr, action).toContain("differs only in case from D41-WI-1");
    }
    expect(ran()).toBe(0);
    expect(listing(R)).toEqual(["D41-WI-1.json"]);
    expect(repo.read(`${R}/D41-WI-1.json`)).toBe(bytes);
  });

  it("P2, E2E1: record, verify and replay on a branch keep canonical item files, replay lands in the evidence file, and keep-check passes", async () => {
    failing();
    expect((await record("A-1")).status).toBe(0);
    fix();
    expect((await repo.entry("verify", "--id", "A-1")).status).toBe(0);
    await repo.commit("A-1");
    const replayed = await repo.entry("replay", "--id", "A-1", "--base", "master");
    expect(replayed.output).toMatch(/replay: /);
    const evidence = JSON.parse(repo.read(`${E}/A-1.json`));
    expect(evidence.replay).toMatchObject({ digest: expect.any(String), path: `${T}/evidence/A-1.json` });
    for (const path of [`${R}/A-1.json`, `${E}/A-1.json`]) expect(repo.read(path)).toBe(canonical(JSON.parse(repo.read(path))));
    expect(has(`${T}/evidence.json`)).toBe(false);
    await repo.commit("A-1 replay");
    const keep = await repo.run(process.execPath, [join(import.meta.dirname, "../../scripts/tdd/receipt-store.mjs"), "keep-check", "--parent", "master", "--head", "HEAD"]);
    expect(keep.status, keep.output).toBe(0);
    expect(keep.stdout).toContain("added 1");
  });
});
