// @vitest-environment node
/**
 * D82-WI-1 (H1) K-H1-S: cross-process stress of the atomic lock release, the
 * real-path pairing for the fs-spy schedules in
 * `control-launcher-lock-release.test.ts` / `-lock-schedules.test.ts`.
 * Real child processes and the real fs; no spies. Slow lane (ADR-0050).
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-1 K-H1-S,
 * with the round 3 invariant (gap R2-1) replacing `stolen ≤ displaced`.
 *
 * Per owned name Aj: an owner loops `acquireLock(Aj)`, and a same-name
 * releaser pair loops `releaseLock(Aj)` / `releaseOrphanLock(Aj)`. Acquirers
 * Bi take, re-read and release their own lock. No releaser targets a B name,
 * so Bi's record may leave `.lock` without Bi's own release only through a
 * tomb: it is restored later (Bi then meets it as `resurrected`), kept by a
 * displaced restore, or still at `.lock` at the end.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { recordBytes } from "./support/lockSchedules";

const LOCK_MODULE = path.resolve(__dirname, "../scripts/control/lock.mjs");
const ROUNDS = 200;
const OWNED = [
  { run: "1".repeat(25), nonce: "m1".repeat(32) },
  { run: "2".repeat(25), nonce: "m2".repeat(32) },
];
const ACQUIRERS = [
  { run: "b".repeat(24) + "1", nonce: "n1".repeat(32) },
  { run: "b".repeat(24) + "2", nonce: "n2".repeat(32) },
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

type Entry = { kind: string; result?: string; acquired?: boolean; reread?: string };

/** The body each child runs after the shared start barrier. */
function childSource(role: string, parent: string, who: { run: string; nonce: string }, logFile: string, startAt: number) {
  const url = pathToFileURL(LOCK_MODULE).href;
  const P = JSON.stringify(parent);
  const O = JSON.stringify(who);
  const body: Record<string, string> = {
    owner: `try { acquireLock(${P}, ${O}); log.push({ kind: "acquire", result: "ok" }); } catch (e) { log.push({ kind: "acquire", result: msg(e) }); }`,
    releaser: `log.push({ kind: "release", result: res(() => releaseLock(${P}, ${O})) });`,
    orphan: `log.push({ kind: "release", result: res(() => releaseOrphanLock(${P}, ${O}.run)) });`,
    acquirer:
      `let acquired = false; try { acquireLock(${P}, ${O}); acquired = true; } catch (e) {` +
      `  const m = msg(e); if (m === "lock held by run " + ${O}.run) { log.push({ kind: "resurrected" }); log.push({ kind: "release", acquired: false, result: res(() => releaseLock(${P}, ${O})) }); } else log.push({ kind: "acquire", result: m }); }` +
      `if (acquired) { let reread; try { reread = readFileSync(${P} + "/.lock", "utf8") === mine ? "own" : "stolen"; } catch { reread = "vanished"; }` +
      `  log.push({ kind: "reread", reread }); log.push({ kind: "release", acquired: true, result: res(() => releaseLock(${P}, ${O})) }); }`,
  };
  return (
    `import { acquireLock, releaseLock, releaseOrphanLock } from ${JSON.stringify(url)};` +
    `import { readFileSync, writeFileSync } from "node:fs";` +
    `const msg = (e) => e instanceof Error ? e.message : String(e);` +
    `const res = (f) => { try { return f(); } catch (e) { return msg(e); } };` +
    `const mine = ${JSON.stringify(recordBytes(who.run, who.nonce))};` +
    `const log = [];` +
    `while (Date.now() < ${startAt}) {}` +
    `for (let i = 0; i < ${ROUNDS}; i++) { ${body[role]} }` +
    `writeFileSync(${JSON.stringify(logFile)}, log.map((l) => JSON.stringify(l)).join("\\n"));`
  );
}

function runChild(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`child exit ${code}: ${err}`))));
  });
}

const VOCAB = [
  /^released$/,
  /^absent$/,
  /^ok$/,
  /^lock unreadable$/,
  /^lock names run [0-9a-z]{25}, not [0-9a-z]{25}$/,
  /^lock for run [0-9a-z]{25} holds another nonce$/,
  /^lock displaced: kept \.lock\.[^/]+\.tomb$/,
  /^lock held by run [0-9a-z]{25}$/,
];

describe("D82-WI-1 K-H1-S cross-process stress", () => {
  it("K-H1-S no acquirer's record is lost: every failed own release is accounted for by a resurrection, a tomb, or the final .lock", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lks-"));
    dirs.push(parent);
    const logs = fs.mkdtempSync(path.join(os.tmpdir(), "lks-log-"));
    dirs.push(logs);
    const startAt = Date.now() + 1500;
    const children: { role: string; who: { run: string; nonce: string }; log: string }[] = [];
    OWNED.forEach((who, j) => {
      for (const role of ["owner", "releaser", "orphan"]) children.push({ role, who, log: path.join(logs, `${role}-${j}.jsonl`) });
    });
    ACQUIRERS.forEach((who, i) => children.push({ role: "acquirer", who, log: path.join(logs, `acquirer-${i}.jsonl`) }));
    await Promise.all(children.map((c) => runChild(childSource(c.role, parent, c.who, c.log, startAt))));

    const read = (f: string): Entry[] => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const all = children.map((c) => ({ ...c, entries: read(c.log) }));
    const results = all.flatMap((c) => c.entries.map((e) => e.result).filter((r): r is string => r !== undefined));
    const displaced = results.filter((r) => r.startsWith("lock displaced: kept ")).length;
    const listing = fs.readdirSync(parent);
    const tombNames = listing.filter((n) => n.endsWith(".tomb"));
    const tombBytes = tombNames.map((n) => fs.readFileSync(path.join(parent, n), "utf8"));
    const finalLock = fs.existsSync(path.join(parent, ".lock")) ? fs.readFileSync(path.join(parent, ".lock"), "utf8") : null;

    const perAcquirer = ACQUIRERS.map((who) => {
      const entries = all.find((c) => c.role === "acquirer" && c.who.run === who.run)?.entries ?? [];
      const mine = recordBytes(who.run, who.nonce);
      const lostOwnReleases = entries.filter((e) => e.kind === "release" && e.acquired === true && e.result !== "released").length;
      const resurrected = entries.filter((e) => e.kind === "resurrected").length;
      const inTombs = tombBytes.filter((b) => b === mine).length;
      const atLock = finalLock === mine ? 1 : 0;
      return { run: who.run, accounted: lostOwnReleases <= resurrected + inTombs + atLock, counts: { lostOwnReleases, resurrected, inTombs, atLock } };
    });
    const own = all.flatMap((c) => c.entries).filter((e) => e.reread === "own").length;
    const releasedByPairs = all
      .filter((c) => c.role === "releaser" || c.role === "orphan")
      .flatMap((c) => c.entries)
      .filter((e) => e.result === "released").length;
    const badMessages = [...new Set(results.filter((r) => !VOCAB.some((re) => re.test(r))))];

    const summary = JSON.stringify({ perAcquirer, displaced, tombs: tombNames.length, own, releasedByPairs, badMessages });
    expect(
      {
        accounted: perAcquirer.map((p) => p.accounted),
        tombs: tombNames.length,
        ownSeen: own > 0,
        releasedSeen: releasedByPairs > 0,
        badMessages,
      },
      summary,
    ).toEqual({ accounted: [true, true], tombs: displaced, ownSeen: true, releasedSeen: true, badMessages: [] });
  }, 120_000);
});
