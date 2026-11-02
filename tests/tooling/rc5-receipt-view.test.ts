// @vitest-environment node
/**
 * RC5-S5 (AC-2): the engine's receipts.json view is the entry's alone. record stamps it
 * (`.receipts.view`: sha256, phase, pid, token), refuses a view changed outside the entry or
 * present with no stamp, rebuilds after its own dead call, detects a foreign change made during
 * its engine call, serialises on the store lock, and never takes the evidence lock while
 * holding the store lock. Ruling 1: opus M1(a), opus M3 (PENDING), opus M5, R-g.
 * Matrix rows: V1, V2, V3, V3b, V3c (R-h), L1, L2b, L3′, S5′, S10, M1(a), M3, M5, R-g.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { guardianBoundMs, launcherBoundMs } from "../../scripts/tdd/receipt-locks.mjs";

vi.setConfig({ testTimeout: 240_000 });
const T = ".claude/tdd-guardian", R = `${T}/receipts`, E = `${T}/receipt-evidence`, VIEW = `${T}/receipts.json`, STAMP = `${T}/.receipts.view`, STORE_LOCK = `${T}/.receipts.store.lock`;
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const has = (path: string) => existsSync(join(repo.root, path));
const item = (id: string) => JSON.parse(repo.read(`${R}/${id}.json`));
const stamp = () => JSON.parse(repo.read(STAMP));
const SPEC = [
  'import { appendFileSync, mkdirSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'import { v } from "../src/x.mjs";',
  'mkdirSync("ignored", { recursive: true }); appendFileSync("ignored/ran.log", "x\\n");',
  'it("v is two", () => { expect(v).toBe(2); });',
].join("\n");
const ran = () => (has("ignored/ran.log") ? repo.read("ignored/ran.log").split("\n").filter(Boolean).length : 0);
function failing(file = "tests/a.test.ts") { repo.write(file, SPEC); repo.write("src/x.mjs", "export const v = 1;\n"); }
function hand(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, lane: "unit-red", recorded_at: "2026-11-02T00:00:00.000Z", head_sha: "", dirty_source: [],
    red: { kind: "assertion-failure", red: true, reason: "1 failing" },
    test_files: { "tests/a.test.ts": { state: "ok", sha: "abc", lines: ["x"] } }, verified_at: null, verdict: null, findings: [], ...extra,
  };
}
const put = (id: string, value: unknown) => repo.write(`${R}/${id}.json`, canonical(value));
const view = (ids: string[]) => canonical({ schemaVersion: 2, receipts: ids.map((id) => item(id)) });
const record = (id: string, env: Record<string, string> = {}, file = "tests/a.test.ts") => repo.run(process.execPath, [entryScript, "record", "--id", id, "--test", file, "--cwd", repo.root], env);
const until = async (check: () => boolean, ms = 60_000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); return check(); };
function barrierDir() {
  const dir = mkdtempSync(join(tmpdir(), "mdpro-rc5-view-"));
  // The lane's own phase barriers (unit-red-lane.mjs) read the same directory: release them up front.
  for (const name of ["runner-created", "lane-after-read"]) writeFileSync(join(dir, `${name}.go`), "go");
  return dir;
}
// 20 s, not the 60 s default: five barrier waits must fit the unit-red lane's 180 s timeout at RED.
const ready = (dir: string, name: string) => until(() => existsSync(join(dir, `${name}.ready`)), 20_000);
const go = (dir: string, name: string) => writeFileSync(join(dir, `${name}.go`), "go");
const deadPid = async () => { const result = await repo.run(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]); return Number(result.stdout); };

describe("RC5-S5 the launcher bound (R-g)", () => {
  it("record's launcher bound is twice the guardian bound plus the margin, so a store-lock wait fits", () => {
    expect(launcherBoundMs("record", {}, 0)).toBe(2 * guardianBoundMs(0) + 60_000);
    expect(launcherBoundMs("verify", {}, 0)).toBe(guardianBoundMs(0) + 60_000);
  });
});

describe.skipIf(!pluginVersion)("RC5-S5 the view and its stamp", () => {
  it("S5′, V2: record rebuilds the view sorted from the item files and leaves an idle stamp that matches it", async () => {
    for (const id of ["Z-1", "A-1", "m-2"]) put(id, hand(id));
    writeFileSync(join(repo.root, STAMP), canonical({ sha256: "0".repeat(64), phase: "idle", pid: 1, token: "old" }));
    failing();
    const result = await record("B-1");
    expect(result.status, result.output).toBe(0);
    expect(repo.read(VIEW)).toBe(view(["A-1", "B-1", "Z-1", "m-2"]));
    expect(stamp()).toMatchObject({ sha256: sha(repo.read(VIEW)), phase: "idle" });
  });

  it("V1: a view changed after the entry stamped it refuses the next record before any lane, leaving the view alone", async () => {
    failing();
    expect((await record("A-1")).status).toBe(0);
    const edited = repo.read(VIEW).replace('"verdict": null', '"verdict": "SEPARATION-HELD"');
    repo.write(VIEW, edited);
    const runs = ran();
    failing("tests/b.test.ts");
    const result = await record("B-1", {}, "tests/b.test.ts");
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("receipts.json was changed outside the entry");
    expect(repo.read(VIEW)).toBe(edited);
    expect(ran()).toBe(runs);
    expect(has(`${R}/B-1.json`)).toBe(false);
  });

  it("ruling 1 opus M1(a): a view with no stamp is refused as foreign, naming the file and the remedy", async () => {
    put("A-1", hand("A-1"));
    repo.write(VIEW, canonical({ schemaVersion: 2, receipts: [hand("A-1")] }));
    failing();
    const result = await record("B-1");
    expect(result.status).toBe(64);
    expect(result.stderr).toContain(VIEW);
    expect(result.stderr).toContain("remove it after checking it holds no id master lacks");
    expect(ran()).toBe(0);
  });

  it("L3′: a stamp left in the engine phase by a dead entry is rebuilt over, and the dead run's record is not kept", async () => {
    put("M-1", hand("M-1"));
    const before = view(["M-1"]);
    repo.write(VIEW, canonical({ schemaVersion: 2, receipts: [hand("M-1"), hand("A-1")] }));
    writeFileSync(join(repo.root, STAMP), canonical({ sha256: sha(before), phase: "engine", pid: await deadPid(), token: "dead" }));
    failing();
    const result = await record("B-1");
    expect(result.status, result.output).toBe(0);
    expect(result.stderr).not.toContain("changed outside the entry");
    expect(has(`${R}/A-1.json`)).toBe(false);
    expect(stamp()).toMatchObject({ phase: "idle", sha256: sha(repo.read(VIEW)) });
  });

  it("ruling 1 opus M3: a PENDING verdict in an item file refuses record before any lane, naming the file", async () => {
    put("A-1", hand("A-1", { verdict: "PENDING" }));
    failing();
    const result = await record("B-1");
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("receipts/A-1.json");
    expect(ran()).toBe(0);
  });

  it("P1: the lane's identity check reads the item file, so a view changed during verify has no effect", async () => {
    failing();
    expect((await record("A-1")).status).toBe(0);
    repo.write("src/x.mjs", "export const v = 2;\n");
    // The unit-red lane runs through a wrapper that rewrites A-1's selection in the view only.
    repo.write("scripts/tdd/view-wrapper.mjs", [
      'import { readFileSync, writeFileSync } from "node:fs"; import { spawn } from "node:child_process";',
      `const p = "${VIEW}"; const s = JSON.parse(readFileSync(p, "utf8"));`,
      's.receipts.find((r) => r.id === "A-1").test_files["tests/b.test.ts"] = s.receipts.find((r) => r.id === "A-1").test_files["tests/a.test.ts"];',
      'writeFileSync(p, JSON.stringify(s, null, 2) + "\\n");',
      'spawn(process.execPath, ["scripts/tdd/unit-red-lane.mjs"], { stdio: "inherit", env: process.env }).on("exit", (code) => process.exit(code ?? 64));',
    ].join("\n"));
    const config = JSON.parse(repo.read(`${T}/config.json`));
    config.lanes.find((lane: { name: string }) => lane.name === "unit-red").command = "node scripts/tdd/view-wrapper.mjs";
    repo.write(`${T}/config.json`, JSON.stringify(config));
    const before = repo.read(VIEW);
    const result = await repo.entry("verify", "--id", "A-1");
    expect(result.status, result.output).toBe(0);
    expect(repo.read(VIEW)).not.toBe(before);
    expect(item("A-1").verdict).toBe("SEPARATION-HELD");
    expect(Object.keys(item("A-1").test_files)).toEqual(["tests/a.test.ts"]);
  });

  it("S10: verify and discard never touch the view or its stamp, and the next record finds them its own", async () => {
    // B-1 is recorded, not hand-written: discard checks the recorded test lines' fingerprints.
    failing("tests/b.test.ts");
    expect((await record("B-1", {}, "tests/b.test.ts")).status).toBe(0);
    failing();
    expect((await record("A-1")).status).toBe(0);
    const saved = [repo.read(VIEW), repo.read(STAMP)];
    repo.write("src/x.mjs", "export const v = 2;\n");
    expect((await repo.entry("verify", "--id", "A-1")).status).toBe(0);
    expect((await repo.entry("discard", "--id", "B-1")).status).toBe(0);
    expect([repo.read(VIEW), repo.read(STAMP)]).toEqual(saved);
    failing("tests/c.test.ts");
    const next = await record("C-1", {}, "tests/c.test.ts");
    expect(next.status, next.output).toBe(0);
    expect(next.stderr).not.toContain("changed outside the entry");
  });
});

describe.skipIf(!pluginVersion)("RC5-S5 foreign changes and the store lock", () => {
  it("V3, V3c (R-h): a record written into the view during the engine call is a foreign change: exit 64 naming it, own file and evidence kept", async () => {
    failing();
    const dir = barrierDir();
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    for (const name of ["record-preflight"]) { expect(await ready(dir, name)).toBe(true); go(dir, name); }
    expect(await ready(dir, "record-engine")).toBe(true);
    const current = JSON.parse(repo.read(VIEW));
    current.receipts.push(hand("X-9"));
    repo.write(VIEW, canonical(current));
    go(dir, "record-engine");
    const result = await running;
    expect(result.status).toBe(64);
    expect(result.stderr).toMatch(/foreign.*X-9|X-9.*foreign/);
    expect(item("A-1").red.kind).toBe("assertion-failure");
    expect(has(`${R}/X-9.json`)).toBe(false);
    expect(JSON.parse(repo.read(`${E}/A-1.json`)).recorded_at).toBe(item("A-1").recorded_at);
    expect((await repo.refs()).some((ref) => ref.startsWith("refs/receipts/A-1/"))).toBe(true);
    failing("tests/b.test.ts");
    const next = await record("B-1", {}, "tests/b.test.ts");
    expect(next.status).toBe(64);
    expect(next.stderr).toContain("receipts.json was changed outside the entry");
    rmSync(dir, { recursive: true, force: true });
  });

  it("V3b: a changed or deleted record of another id during the engine call is foreign, and its item file is untouched", async () => {
    for (const mutate of [(receipts: Array<Record<string, unknown>>) => { receipts[0].verdict = "SEPARATION-HELD"; return receipts; }, (receipts: Array<Record<string, unknown>>) => receipts.filter((r) => r.id !== "M-1")]) {
      rmSync(join(repo.root, R), { recursive: true, force: true }); rmSync(join(repo.root, E), { recursive: true, force: true });
      rmSync(join(repo.root, VIEW), { force: true }); rmSync(join(repo.root, STAMP), { force: true });
      put("M-1", hand("M-1"));
      const bytes = repo.read(`${R}/M-1.json`);
      failing();
      const dir = barrierDir();
      const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
      expect(await ready(dir, "record-preflight")).toBe(true); go(dir, "record-preflight");
      expect(await ready(dir, "record-engine")).toBe(true);
      const current = JSON.parse(repo.read(VIEW));
      current.receipts = mutate(current.receipts);
      repo.write(VIEW, canonical(current));
      go(dir, "record-engine");
      const result = await running;
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("M-1");
      expect(repo.read(`${R}/M-1.json`)).toBe(bytes);
      expect(has(`${R}/A-1.json`)).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L1: two records in one worktree serialise on the store lock and both keep their receipt", async () => {
    failing(); failing("tests/b.test.ts");
    const one = barrierDir(), two = barrierDir();
    const first = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: one });
    expect(await ready(one, "record-preflight")).toBe(true); go(one, "record-preflight");
    expect(await ready(one, "record-engine")).toBe(true);
    expect(has(STORE_LOCK)).toBe(true);
    const second = record("B-1", { MDPRO_UNIT_RED_BARRIER_DIR: two }, "tests/b.test.ts");
    expect(await ready(two, "record-preflight")).toBe(true); go(two, "record-preflight");
    await new Promise((r) => setTimeout(r, 1500));
    expect(existsSync(join(two, "record-engine.ready"))).toBe(false);
    go(one, "record-engine");
    expect(await ready(two, "record-engine")).toBe(true); go(two, "record-engine");
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status], `${a.output}\n${b.output}`).toEqual([0, 0]);
    expect([item("A-1").red.kind, item("B-1").red.kind]).toEqual(["assertion-failure", "assertion-failure"]);
    expect(JSON.parse(repo.read(VIEW)).receipts.map((r: { id: string }) => r.id)).toEqual(["A-1", "B-1"]);
    for (const dir of [one, two]) rmSync(dir, { recursive: true, force: true });
  });

  it("L2b: a discard during another id's engine call is not a foreign change", async () => {
    // B-1 is recorded, not hand-written: discard checks the recorded test lines' fingerprints.
    failing("tests/b.test.ts");
    expect((await record("B-1", {}, "tests/b.test.ts")).status).toBe(0);
    failing();
    const dir = barrierDir();
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    expect(await ready(dir, "record-preflight")).toBe(true); go(dir, "record-preflight");
    expect(await ready(dir, "record-engine")).toBe(true);
    const discard = await repo.entry("discard", "--id", "B-1");
    expect(discard.status, discard.output).toBe(0);
    go(dir, "record-engine");
    const result = await running;
    expect(result.status, result.output).toBe(0);
    expect([has(`${R}/B-1.json`), has(`${R}/A-1.json`)]).toEqual([false, true]);
    expect((await repo.entry("check-pending")).stderr).not.toContain("B-1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("ruling 1 opus M5: capture takes the evidence lock only after the store lock is released", async () => {
    failing();
    const dir = barrierDir();
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir, MDPRO_EVIDENCE_LOCK_WAIT_MS: "60000" });
    expect(await ready(dir, "record-preflight")).toBe(true); go(dir, "record-preflight");
    expect(await ready(dir, "record-engine")).toBe(true);
    expect(has(STORE_LOCK)).toBe(true);
    const release = repo.holdEvidenceLock();
    go(dir, "record-engine");
    expect(await until(() => !has(STORE_LOCK) && has(`${R}/A-1.json`))).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(has(`${E}/A-1.json`)).toBe(false);
    release();
    const result = await running;
    expect(result.status, result.output).toBe(0);
    expect(has(`${E}/A-1.json`)).toBe(true);
    mkdirSync(dir, { recursive: true }); rmSync(dir, { recursive: true, force: true });
    expect(readdirSync(join(repo.root, T)).filter((name) => name.startsWith(".receipts.store.lock"))).toEqual([]);
  });
});
