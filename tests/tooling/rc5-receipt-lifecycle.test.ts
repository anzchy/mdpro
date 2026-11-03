// @vitest-environment node
/**
 * D357 (RC5 lifecycle rows): crash, aged-lock, concurrent-action and long-wait cases of the receipt
 * entry on the per-item layout. Each kill case stops the inner entry (the one the OS-lock launcher
 * supervises) with SIGKILL at a named barrier, then checks what the next action finds.
 * Matrix rows: L5a, L5b, L5d, L5e (AC-1, AC-3), L2 (AC-2), L6 (AC-4), L7 (AC-5), L8 (AC-6), L9 (AC-7).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, repo as source, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
const T = ".claude/tdd-guardian", R = `${T}/receipts`, E = `${T}/receipt-evidence`, TMP = `${T}/.tmp`;
const VIEW = `${T}/receipts.json`, STAMP = `${T}/.receipts.view`, STORE_LOCK = `${T}/.receipts.store.lock`;
let repo: ReceiptRepo;
const dirs: string[] = [];
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const has = (path: string) => existsSync(join(repo.root, path));
const listing = (dir: string) => (has(dir) ? readdirSync(join(repo.root, dir)).sort() : []);
const item = (id: string) => JSON.parse(repo.read(`${R}/${id}.json`));
const stamp = () => JSON.parse(repo.read(STAMP));
const ids = () => JSON.parse(repo.read(VIEW)).receipts.map((r: { id: string }) => r.id);
/** The view the entry builds from these item files: sorted by id, canonical bytes. */
const built = (list: string[]) => canonical({ schemaVersion: 2, receipts: [...list].sort().map((id) => item(id)) });
/** A spec that fails until src/x.mjs exports 2, after sleeping `sleep` ms. */
const spec = (sleep = 0) => [
  'import { expect, it } from "vitest";',
  'import { v } from "../src/x.mjs";',
  `it("v is two", async () => { await new Promise((r) => setTimeout(r, ${sleep})); expect(v).toBe(2); }, 120000);`,
].join("\n");
/** A failing spec that leaves `ignored/ran.log` when the lane loads it. */
const marked = (target: string) => { repo.write(target, `import { appendFileSync, mkdirSync } from "node:fs";\nmkdirSync("ignored", { recursive: true }); appendFileSync("ignored/ran.log", "x\\n");\n${spec()}`); repo.write("src/x.mjs", "export const v = 1;\n"); };
/** A failing spec on its own module `src/<mod>.mjs`, so another id's fix does not touch it. */
function failingOn(target: string, mod: string, sleep = 0) { repo.write(target, spec(sleep).replace("../src/x.mjs", `../src/${mod}.mjs`)); repo.write(`src/${mod}.mjs`, "export const v = 1;\n"); }
function failing(file: string, sleep = 0) { repo.write(file, spec(sleep)); repo.write("src/x.mjs", "export const v = 1;\n"); }
const fix = () => repo.write("src/x.mjs", "export const v = 2;\n");
const file = (id: string) => `tests/${id.toLowerCase()}.test.ts`;
const run = (args: string[], env: Record<string, string> = {}) => repo.run(process.execPath, [entryScript, ...args, "--cwd", repo.root], env, 200_000);
const record = (id: string, env: Record<string, string> = {}) => run(["record", "--id", id, "--test", file(id)], env);
const until = async (check: () => boolean, ms = 30_000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); return check(); };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A barrier directory with every always-pausing barrier released up front; `held` barriers pause until released or killed. */
function barriers(...held: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "mdpro-d357-"));
  dirs.push(dir);
  for (const name of ["runner-created", "lane-after-read", "record-preflight", "record-engine", "verify-preflight", "discard-preflight", "stale-observed"]) writeFileSync(join(dir, `${name}.go`), "go");
  for (const name of held) writeFileSync(join(dir, `${name}.hold`), "hold");
  return dir;
}
const ready = (dir: string, name: string) => until(() => existsSync(join(dir, `${name}.ready`)), 30_000);
const go = (dir: string, name: string) => writeFileSync(join(dir, `${name}.go`), "go");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** The state a held barrier must freeze: stamp, view, item listings, temp listing. */
const frozen = () => [has(STAMP) ? repo.read(STAMP) : null, has(VIEW) ? repo.read(VIEW) : null, listing(R), listing(E), listing(TMP)];
/** At a held barrier: prove it holds (state unchanged for 500 ms, pid alive), then SIGKILL `pid`. */
async function killHeld(pid: number) {
  const before = JSON.stringify(frozen());
  await pause(500);
  expect(JSON.stringify(frozen())).toBe(before);
  expect(alive(pid)).toBe(true);
  process.kill(pid, "SIGKILL");
}
const killed = (result: { status: number | null }) => expect([0, 64]).not.toContain(result.status);

describe.skipIf(!pluginVersion)("D357 RC5 view kill windows (L5)", () => {
  it("L5a: SIGKILL at record-view-written (stamp engine, view not yet rebuilt) leaves a store the next record accepts", async () => {
    for (const id of ["B-1", "D-1"]) { failing(file(id)); expect((await record(id)).status).toBe(0); }
    expect((await run(["discard", "--id", "D-1"])).status).toBe(0);
    const v0 = repo.read(VIEW);
    expect(JSON.parse(v0).receipts.map((r: { id: string }) => r.id)).toContain("D-1");
    failing(file("A-1"));
    const dir = barriers("record-view-written");
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    expect(await ready(dir, "record-view-written")).toBe(true);
    expect(repo.read(VIEW)).toBe(v0);
    expect(stamp()).toMatchObject({ phase: "engine", sha256: sha(built(["B-1"])) });
    expect(sha(built(["B-1"]))).not.toBe(sha(v0));
    expect(has(`${R}/A-1.json`)).toBe(false);
    await killHeld(stamp().pid);
    killed(await running);
    const next = await record("A-1");
    expect(next.status, next.output).toBe(0);
    expect(next.stderr).not.toContain("changed outside");
    expect(ids()).toEqual(["A-1", "B-1"]);
    expect(stamp()).toMatchObject({ phase: "idle", sha256: sha(repo.read(VIEW)) });
    expect(item("A-1").red.kind).toBe("assertion-failure");
  });

  it("L5b: SIGKILL at record-rebuilt (sorted view written, stamp still engine) leaves a store the next record accepts", async () => {
    failing(file("B-1"));
    expect((await record("B-1")).status).toBe(0);
    failing(file("A-1"));
    const dir = barriers("record-rebuilt");
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    expect(await ready(dir, "record-rebuilt")).toBe(true);
    expect(repo.read(VIEW)).toBe(built(["A-1", "B-1"]));
    expect(stamp().phase).toBe("engine");
    expect(item("A-1").red.kind).toBe("assertion-failure");
    await killHeld(stamp().pid);
    killed(await running);
    // A-1.json holds a counted RED written before the kill, so A-1 itself is refused by design (Q4).
    const again = await record("A-1");
    expect(again.status).toBe(64);
    expect(again.stderr).toContain("already has valid or settled evidence");
    failing(file("C-1"));
    const next = await record("C-1");
    expect(next.status, next.output).toBe(0);
    expect(next.stderr).not.toContain("changed outside");
    expect(ids()).toEqual(["A-1", "B-1", "C-1"]);
    expect(stamp()).toMatchObject({ phase: "idle", sha256: sha(repo.read(VIEW)) });
  });

  it("L5d: both named barriers, held then released, let the record finish with a matching idle stamp", async () => {
    failing(file("A-1"));
    const dir = barriers("record-view-written", "record-rebuilt");
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    for (const name of ["record-view-written", "record-rebuilt"]) { expect(await ready(dir, name), name).toBe(true); go(dir, name); }
    const result = await running;
    expect(result.status, result.output).toBe(0);
    expect(stamp()).toMatchObject({ phase: "idle", sha256: sha(repo.read(VIEW)) });
    expect(item("A-1").red.kind).toBe("assertion-failure");
  });

  it("L5e: SIGKILL at record-engine (view rebuilt, stamp engine, engine not called) leaves a store the next record accepts", async () => {
    for (const id of ["B-1", "D-1"]) { failing(file(id)); expect((await record(id)).status).toBe(0); }
    expect((await run(["discard", "--id", "D-1"])).status).toBe(0);
    failing(file("A-1"));
    const dir = barriers();
    rmSync(join(dir, "record-engine.go"));
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    expect(await ready(dir, "record-engine")).toBe(true);
    expect(repo.read(VIEW)).toBe(built(["B-1"]));
    expect(stamp()).toMatchObject({ phase: "engine", sha256: sha(built(["B-1"])) });
    await killHeld(stamp().pid);
    killed(await running);
    const next = await record("A-1");
    expect(next.status, next.output).toBe(0);
    expect(next.stderr).not.toContain("changed outside");
    expect(ids()).toEqual(["A-1", "B-1"]);
    expect(stamp()).toMatchObject({ phase: "idle", sha256: sha(repo.read(VIEW)) });
  });

  it("N4: an existing barrier with no .hold file still pauses (hold-on-request is only for the new barriers)", async () => {
    marked(file("A-1"));
    const dir = barriers();
    rmSync(join(dir, "record-engine.go"));
    const running = record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    expect(await ready(dir, "record-engine")).toBe(true);
    await pause(500);
    expect(alive(stamp().pid)).toBe(true);
    expect(stamp().phase).toBe("engine");
    expect(has(`${R}/A-1.json`)).toBe(false);
    await pause(2500);
    expect(has("ignored/ran.log")).toBe(false);
    go(dir, "record-engine");
    const result = await running;
    expect(result.status, result.output).toBe(0);
    expect(has("ignored/ran.log")).toBe(true);
  });
});

describe.skipIf(!pluginVersion)("D357 unarmed barriers and concurrent actions", () => {
  it("X4 (ruling 1): with a barrier dir but nothing armed, the new barriers are reached and add no wait", async () => {
    failing(file("A-1"));
    const dir = barriers();
    const started = Date.now();
    const result = await record("A-1", { MDPRO_UNIT_RED_BARRIER_DIR: dir });
    expect(result.status, result.output).toBe(0);
    for (const name of ["record-view-written", "record-rebuilt"]) expect(existsSync(join(dir, `${name}.ready`)), name).toBe(true);
    // An armed barrier with no release would stop the record at its 10 s deadline with exit 64.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("L2: verify of another id completes while a record holds the store lock, without waiting for it", async () => {
    for (const id of ["B-1", "E-1"]) { failing(file(id)); expect((await record(id)).status).toBe(0); }
    fix();
    const control = Date.now();
    expect((await run(["verify", "--id", "E-1"])).status).toBe(0);
    const t0 = Date.now() - control;
    failingOn(file("A-1"), "a", 25_000);
    const running = record("A-1");
    expect(await until(() => has(`${STORE_LOCK}/owner.json`) && has(STAMP) && stamp().phase === "engine")).toBe(true);
    const owner = repo.read(`${STORE_LOCK}/owner.json`), pid = stamp().pid;
    const started = Date.now();
    const verified = await run(["verify", "--id", "B-1"]);
    const elapsed = Date.now() - started;
    expect(verified.status, verified.output).toBe(0);
    expect(verified.stdout).toContain("B-1: SEPARATION-HELD");
    expect(elapsed).toBeLessThan(t0 + 3_000);
    expect(repo.read(`${STORE_LOCK}/owner.json`)).toBe(owner);
    expect(alive(pid)).toBe(true);
    expect(has(`${R}/A-1.json`)).toBe(false);
    const settled = repo.read(`${R}/B-1.json`);
    expect(JSON.parse(settled).verdict).toBe("SEPARATION-HELD");
    const result = await running;
    expect(result.status, result.output).toBe(0);
    expect(result.output).not.toContain("foreign");
    expect(item("A-1").red.kind).toBe("assertion-failure");
    expect(repo.read(`${R}/B-1.json`)).toBe(settled);
    const pending = await run(["check-pending"]);
    expect(pending.stderr).toContain("A-1 (unit-red)");
    expect(pending.stderr).not.toContain("B-1 (");
  });
});

const storeScript = join(source, "scripts/tdd/receipt-store.mjs");
const keepCheck = () => repo.run(process.execPath, [storeScript, "keep-check", "--parent", "master", "--head", "HEAD"]);
const opOwner = (id: string) => JSON.parse(repo.read(`${T}/.unit-red-${id}.lock/owner.json`)).pid as number;
const itemNames = (dir: string) => listing(dir).every((name) => /^[A-Z][A-Z0-9-]*\.json$/.test(name));

describe.skipIf(!pluginVersion)("D357 interrupted item writes and discards (L6, L7)", () => {
  it("L6: SIGKILL between an item's temp write and its rename leaves only <ID>.json names, and git status shows no temp path", async () => {
    const ignore = readFileSync(join(source, ".gitignore"), "utf8").split("\n").filter((line) => line.startsWith(".claude/tdd-guardian/"));
    expect(ignore).toContain(".claude/tdd-guardian/.tmp/");
    repo.write(".gitignore", ["ignored/", ...ignore, ""].join("\n"));
    expect((await repo.commit("the repository's tdd-guardian ignore lines")).status).toBe(0);
    failing(file("A-1"));
    expect((await record("A-1")).status).toBe(0);
    fix();
    const v = barriers("verify-item-temp");
    const verifying = run(["verify", "--id", "A-1"], { MDPRO_UNIT_RED_BARRIER_DIR: v });
    expect(await ready(v, "verify-item-temp")).toBe(true);
    expect(listing(TMP).some((name) => /^receipt-.+\.json$/.test(name))).toBe(true);
    await killHeld(opOwner("A-1"));
    killed(await verifying);
    expect(item("A-1").verdict).toBeFalsy();
    failingOn(file("B-1"), "b");
    const r = barriers("record-item-temp");
    const recording = record("B-1", { MDPRO_UNIT_RED_BARRIER_DIR: r });
    expect(await ready(r, "record-item-temp")).toBe(true);
    await killHeld(stamp().pid);
    killed(await recording);
    expect(listing(TMP).length).toBeGreaterThan(0);
    expect(listing(R)).toEqual(["A-1.json"]);
    expect(itemNames(R) && itemNames(E)).toBe(true);
    const status = (await repo.git("status", "--porcelain=v1", "--untracked-files=all")).stdout;
    expect(status).not.toContain(".tmp");
    const pending = await run(["check-pending"]);
    expect(pending.status, pending.output).not.toBe(64);
    expect(pending.output).not.toContain("unexpected file");
    failingOn(file("C-1"), "c");
    const next = await record("C-1");
    expect(next.status, next.output).toBe(0);
    expect(listing(R)).toEqual(["A-1.json", "C-1.json"]);
  });

});
