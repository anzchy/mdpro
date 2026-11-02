// @vitest-environment node
/**
 * RC5-S1 (AC-1, AC-2, AC-4): the per-item receipt store module on its own. One file per id
 * under `.claude/tdd-guardian/receipts/` and `receipt-evidence/`, canonical bytes, the id
 * rules (regex, Windows device stems, case-insensitive collisions), the strict full load and
 * the one-id read, and the engine view's sorted bytes.
 * Matrix rows: B1, B4, B7, B8, B9 (store half), C2, C2′, C3, C5, C5′, S5 (view bytes), S11 (store half), X1.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../../scripts/tdd/receipt-store.mjs";

const RECEIPTS = ".claude/tdd-guardian/receipts";
const EVIDENCE = ".claude/tdd-guardian/receipt-evidence";
let root: string;

function receipt(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", head_sha: "", dirty_source: [],
    red: { kind: "assertion-failure", red: true, reason: "1 failing" },
    test_files: { "tests/a.test.ts": { state: "ok", sha: "abc", lines: ["x"] } },
    verified_at: null, verdict: null, findings: [], ...extra,
  };
}
const entry = (id: string) => ({ id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", plugin_version: "0.10.2" });
const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const put = (dir: string, name: string, text: string) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, name), text); };
const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return { code: (error as { code?: number }).code, message: (error as Error).message }; } };

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mdpro-rc5-store-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("RC5 ids", () => {
  it("B4: refuses `..`, a leading dot and 65 characters; admits 64", () => {
    for (const id of ["..", ".hidden", "a".repeat(65), "D1/WI-1", "修复-1", ""]) expect(code(() => store.checkId(id))?.code, id).toBe(64);
    expect(code(() => store.checkId("a".repeat(64)))).toBeNull();
  });
  it("B7, B9: refuses Windows device names by the stem before the first dot, in any case", () => {
    for (const id of ["CON", "nul", "COM1", "CON.1", "aux.WI-1", "lpt9.x", "Prn"]) {
      expect(code(() => store.checkId(id)), id).toMatchObject({ code: 64, message: expect.stringContaining("Windows device name") });
    }
    for (const id of ["CONSOLE-1", "COM10", "LPT0", "NULL-1", "A.CON"]) expect(code(() => store.checkId(id)), id).toBeNull();
  });
});

describe("RC5 item files", () => {
  it("B1, AC-1: a 64-character id is written as <ID>.json in canonical bytes and read back", () => {
    const id = `A${"b".repeat(63)}`;
    store.writeItem(root, "receipt", id, receipt(id));
    expect(readdirSync(join(root, RECEIPTS))).toEqual([`${id}.json`]);
    expect(readFileSync(join(root, RECEIPTS, `${id}.json`), "utf8")).toBe(canonical(receipt(id)));
    expect(store.readItem(root, "receipt", id)).toEqual(receipt(id));
    expect(store.readItem(root, "receipt", "Absent-1")).toBeNull();
  });
  it("B8: a CJK test path with a space round-trips as UTF-8, not \\u escapes", () => {
    const path = "tests/修复 用例.test.ts";
    const value = receipt("C-1", { test_files: { [path]: { state: "ok", sha: "abc", lines: ["中文"] } } });
    store.writeItem(root, "receipt", "C-1", value);
    const bytes = readFileSync(join(root, RECEIPTS, "C-1.json"), "utf8");
    expect(bytes).toContain(path);
    expect(bytes).not.toContain("\\u");
    expect(Object.keys(store.readItem(root, "receipt", "C-1").test_files)).toEqual([path]);
  });
  it("temps never land in the item directories, and removeItem deletes the one file", () => {
    store.writeItem(root, "receipt", "A-1", receipt("A-1"));
    store.writeItem(root, "evidence", "A-1", entry("A-1"));
    store.writeItem(root, "receipt", "B-1", receipt("B-1"));
    expect(readdirSync(join(root, RECEIPTS)).sort()).toEqual(["A-1.json", "B-1.json"]);
    store.removeItem(root, "receipt", "A-1");
    expect(readdirSync(join(root, RECEIPTS))).toEqual(["B-1.json"]);
    expect(readFileSync(join(root, EVIDENCE, "A-1.json"), "utf8")).toBe(canonical(entry("A-1")));
  });
});

describe("RC5 strict load", () => {
  it("loads every receipt and evidence entry keyed by id", () => {
    put(RECEIPTS, "A-1.json", canonical(receipt("A-1")));
    put(RECEIPTS, "B-1.json", canonical(receipt("B-1")));
    put(EVIDENCE, "A-1.json", canonical(entry("A-1")));
    const loaded = store.loadStore(root);
    expect([...loaded.receipts.keys()].sort()).toEqual(["A-1", "B-1"]);
    expect(loaded.evidence.get("A-1")).toEqual(entry("A-1"));
    expect(store.loadStore(mkdtempSync(join(tmpdir(), "mdpro-rc5-empty-"))).receipts.size).toBe(0);
  });
  it("C2: a file whose id differs from its name is refused naming the file, by the full load and by its own read", () => {
    put(RECEIPTS, "A-1.json", canonical(receipt("A-2")));
    expect(code(() => store.loadStore(root))).toMatchObject({ code: 64, message: expect.stringContaining("id A-2 does not match file name A-1") });
    expect(code(() => store.readItem(root, "receipt", "A-1"))?.message).toContain("id A-2 does not match file name A-1");
  });
  it("C1, C3: truncated JSON, a missing red or test_files, an array, and minified bytes are refused naming the file", () => {
    const cases: Array<[string, string]> = [
      [canonical(receipt("A-1")).slice(0, 40), "is not valid JSON"],
      [canonical({ ...receipt("A-1"), red: undefined }), "is malformed"],
      [canonical({ ...receipt("A-1"), test_files: undefined }), "is malformed"],
      [canonical([receipt("A-1")]), "is malformed"],
      [canonical({ ...receipt("A-1"), verdict: "PENDING" }), "is malformed"],
      [JSON.stringify(receipt("A-1")), "is not canonical"],
    ];
    for (const [text, why] of cases) {
      put(RECEIPTS, "A-1.json", text);
      expect(code(() => store.loadStore(root)), why).toMatchObject({ code: 64, message: expect.stringContaining(`receipts/A-1.json ${why}`) });
    }
  });
  it("C5: a stray file or a subdirectory is refused, not ignored", () => {
    put(RECEIPTS, "A-1.json", canonical(receipt("A-1")));
    put(RECEIPTS, "notes.txt", "hi");
    expect(code(() => store.loadStore(root))?.message).toContain("unexpected file in receipts/: notes.txt");
    rmSync(join(root, RECEIPTS, "notes.txt"));
    put(`${RECEIPTS}/sub`, "x.json", canonical(receipt("x")));
    expect(code(() => store.loadStore(root))?.message).toContain("unexpected file in receipts/: sub");
  });
  it("C2′, C5′ (R-e): a one-id read succeeds beside a corrupt or stray neighbour", () => {
    put(RECEIPTS, "A-1.json", "{");
    put(RECEIPTS, "notes.txt", "hi");
    put(RECEIPTS, "B-1.json", canonical(receipt("B-1")));
    expect(store.readItem(root, "receipt", "B-1")).toEqual(receipt("B-1"));
  });
  it("evidence with no receipt is refused by the full load", () => {
    put(RECEIPTS, "A-1.json", canonical(receipt("A-1")));
    put(EVIDENCE, "Z-9.json", canonical(entry("Z-9")));
    expect(code(() => store.loadStore(root))?.message).toContain("orphan evidence: Z-9");
  });
  it("X1: two files equal ignoring case are refused by the full load, whatever the filesystem does", () => {
    put(RECEIPTS, "D41-WI-1.json", canonical(receipt("D41-WI-1")));
    const names = readdirSync(join(root, RECEIPTS));
    // On a case-insensitive filesystem the second write would overwrite the first, so the check is by name, tested directly.
    expect(store.caseCollisions([...names, "d41-wi-1.json"].map((name) => name.slice(0, -5)))).toEqual([["D41-WI-1", "d41-wi-1"]]);
  });
});

describe("RC5 case-variant lookups", () => {
  beforeEach(() => {
    git("init", "-q", "-b", "master"); git("config", "user.email", "t@example.com"); git("config", "user.name", "T");
    git("commit", "-q", "--allow-empty", "-m", "base");
  });
  it("B5, S11 (store half): a worktree file differing only in case is a collision, and its one-id read is refused", () => {
    put(RECEIPTS, "D41-WI-1.json", canonical(receipt("D41-WI-1")));
    expect(store.collision(root, "d41-wi-1")).toBe("D41-WI-1");
    expect(store.collision(root, "D41-WI-1")).toBeNull();
    expect(code(() => store.readItem(root, "receipt", "d41-wi-1"))).toMatchObject({ code: 64, message: expect.stringContaining("differs only in case from D41-WI-1") });
    expect(readdirSync(join(root, RECEIPTS))).toEqual(["D41-WI-1.json"]);
  });
  it("B6, X1: a master file differing only in case is a collision though the worktree has none", () => {
    put(RECEIPTS, "D41-WI-1.json", canonical(receipt("D41-WI-1")));
    git("add", "."); git("commit", "-qm", "m");
    git("switch", "-qc", "feature"); git("rm", "-q", `${RECEIPTS}/D41-WI-1.json`); git("commit", "-qm", "f");
    expect(store.collision(root, "d41-WI-1")).toBe("D41-WI-1");
    expect([...store.masterIds(root)]).toEqual(["D41-WI-1"]);
  });
  it("masterIds reads a legacy master's receipts.json during the transition", () => {
    put(".claude/tdd-guardian", "receipts.json", canonical({ schemaVersion: 2, receipts: [receipt("L-1")] }));
    put(RECEIPTS, "M-1.json", canonical(receipt("M-1")));
    git("add", "."); git("commit", "-qm", "m");
    expect([...store.masterIds(root)].sort()).toEqual(["L-1", "M-1"]);
  });
});

describe("RC5 engine view", () => {
  it("S5: the view lists every receipt in code-point order, in the engine's own bytes", () => {
    const receipts = new Map(["Z-1", "A-1", "m-2", "B-1"].map((id) => [id, receipt(id)]));
    const view = store.buildView(receipts);
    expect(JSON.parse(view).receipts.map((item: { id: string }) => item.id)).toEqual(["A-1", "B-1", "Z-1", "m-2"]);
    expect(view).toBe(canonical({ schemaVersion: 2, receipts: ["A-1", "B-1", "Z-1", "m-2"].map((id) => receipt(id)) }));
    expect(store.buildView(new Map())).toBe(canonical({ schemaVersion: 2, receipts: [] }));
  });
});
