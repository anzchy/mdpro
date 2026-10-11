/**
 * Cross-process harness for the K-H1-S lock stress (D82-WI-1, D131) in
 * `tests/control-launcher-lock.slow.test.ts`. Real child processes and the
 * real fs; no spies. Returns raw observations; the test owns the invariants.
 *
 * Children: per owned name Aj an owner (`acquireLock(Aj)`), a releaser
 * (`releaseLock(Aj)`) and an orphan releaser (`releaseOrphanLock(Aj)`); per
 * acquirer Bi one child that takes, re-reads and releases its own lock. All
 * share one runs parent and a busy-wait start barrier. Each writes its JSONL
 * log under a separate logs dir, which also holds the marker files, so the
 * parent's listing only ever shows the lock and its tombs.
 *
 * Every child runs at least `ROUNDS` rounds, then keeps running rounds until
 * both non-vacuity events have happened in some child: an acquirer's `own`
 * re-read (`seen-own`) and a releaser pair's `"released"` (`seen-released`).
 * Ending on events, not on a count, is the D131 fix: under load a fixed count
 * did not guarantee that an owner and its releaser pair ever overlapped.
 * `HANG_BOUND_MS` only stops a run that never converges.
 *
 * `ownersAfterTheirPairs` injects the interleaving D131 hit under load: an
 * owner starts only once its releaser pair has written its `.rounds` marker
 * (finished its first `ROUNDS` rounds).
 *
 * D105-WI-5: `strict` adds `Observed.strict`: the acquirers' non-own re-reads
 * (`stolen` / `vanished`), the `lock busy` results, the resurrections and lost
 * own releases summed over acquirers, and the `.lock.mutex*` files left at the
 * end. `killInsideMutex` adds one more child, started with the others, that
 * SIGKILLs itself inside its first acquire's mutex section (at the `.lock`
 * write, after recording the pid `.lock.mutex` names); `strict.killer` reports
 * its pid, its signal and that recorded pid.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { recordBytes } from "./lockSchedules";

const LOCK_MODULE = path.resolve(__dirname, "../../scripts/control/lock.mjs");
export const ROUNDS = 200;
const START_DELAY_MS = 1500;
/** Bounds a hang only; the guards then fail with their counts. */
const HANG_BOUND_MS = 60_000;

export type Who = { run: string; nonce: string };
type Role = "owner" | "releaser" | "orphan" | "acquirer";
type Entry = { kind: string; result?: string; acquired?: boolean; reread?: string };
type Child = { role: Role; who: Who; log: string; rounds: string; gates: string[] };

export const OWNED: Who[] = [
  { run: "1".repeat(25), nonce: "m1".repeat(32) },
  { run: "2".repeat(25), nonce: "m2".repeat(32) },
];
export const ACQUIRERS: Who[] = [
  { run: "b".repeat(24) + "1", nonce: "n1".repeat(32) },
  { run: "b".repeat(24) + "2", nonce: "n2".repeat(32) },
];

export type StressOptions = { ownersAfterTheirPairs?: boolean; strict?: boolean; killInsideMutex?: boolean };
export type Killer = { pid: number | undefined; signal: string | null; mutexPidAtKill: number | null };
export type StrictObserved = {
  nonOwnRereads: number;
  busy: number;
  resurrected: number;
  lostOwnReleases: number;
  mutexFiles: string[];
  killer?: Killer;
};
export type Observed = {
  perAcquirer: { run: string; counts: { lostOwnReleases: number; resurrected: number; inTombs: number; atLock: number } }[];
  results: string[];
  displaced: number;
  tombs: number;
  own: number;
  releasedByPairs: number;
  strict?: StrictObserved;
};

const dirs: string[] = [];
export function cleanupStressDirs(): void {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}
function scratch(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** One round of each role, as source; it pushes its entries to `log`. */
function body(role: Role, P: string, O: string): string {
  if (role === "owner")
    return `try { acquireLock(${P}, ${O}); log.push({ kind: "acquire", result: "ok" }); } catch (e) { log.push({ kind: "acquire", result: msg(e) }); }`;
  if (role === "releaser") return `log.push({ kind: "release", result: res(() => releaseLock(${P}, ${O})) });`;
  if (role === "orphan") return `log.push({ kind: "release", result: res(() => releaseOrphanLock(${P}, ${O}.run)) });`;
  return (
    `let acquired = false; try { acquireLock(${P}, ${O}); acquired = true; } catch (e) {` +
    `  const m = msg(e); if (m === "lock held by run " + ${O}.run) { log.push({ kind: "resurrected" }); log.push({ kind: "release", acquired: false, result: res(() => releaseLock(${P}, ${O})) }); } else log.push({ kind: "acquire", result: m }); }` +
    `if (acquired) { let reread; try { reread = readFileSync(${P} + "/.lock", "utf8") === mine ? "own" : "stolen"; } catch { reread = "vanished"; }` +
    `  log.push({ kind: "reread", reread }); log.push({ kind: "release", acquired: true, result: res(() => releaseLock(${P}, ${O})) }); }`
  );
}

/**
 * The child program. Each round marks the guard events it produced: an
 * acquirer's `own` re-read (`seenOwn`) and a pair's `"released"`
 * (`seenReleased`).
 */
function childSource(c: Child, parent: string, marks: { seenOwn: string; seenReleased: string }, startAt: number): string {
  const J = JSON.stringify;
  const isPair = c.role === "releaser" || c.role === "orphan";
  return (
    `import { acquireLock, releaseLock, releaseOrphanLock } from ${J(pathToFileURL(LOCK_MODULE).href)};` +
    `import { existsSync, readFileSync, writeFileSync } from "node:fs";` +
    `const msg = (e) => e instanceof Error ? e.message : String(e);` +
    `const res = (f) => { try { return f(); } catch (e) { return msg(e); } };` +
    `const mine = ${J(recordBytes(c.who.run, c.who.nonce))};` +
    `const SEEN_OWN = ${J(marks.seenOwn)}, SEEN_RELEASED = ${J(marks.seenReleased)};` +
    `const goalOf = (e) => e.reread === "own" ? SEEN_OWN : ${isPair} && e.result === "released" ? SEEN_RELEASED : null;` +
    `const log = [];` +
    `const round = () => { const from = log.length; ${body(c.role, J(parent), J(c.who))}` +
    `  for (let k = from; k < log.length; k++) { const g = goalOf(log[k]); if (g && !existsSync(g)) writeFileSync(g, ""); } };` +
    `const stopBy = ${startAt + HANG_BOUND_MS};` +
    `while (Date.now() < ${startAt}) {}` +
    `while (!${J(c.gates)}.every((g) => existsSync(g)) && Date.now() < stopBy) {}` +
    `for (let i = 0; i < ${ROUNDS}; i++) round();` +
    `writeFileSync(${J(c.rounds)}, "");` +
    // D131: keep racing until both guard events happened somewhere. A fixed
    // round count let a loaded scheduler run an owner's window apart from its
    // releaser pair's, so the guards failed with every invariant intact.
    `while (!(existsSync(SEEN_OWN) && existsSync(SEEN_RELEASED)) && Date.now() < stopBy) round();` +
    `writeFileSync(${J(c.log)}, log.map((l) => JSON.stringify(l)).join("\\n"));`
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

const KILLER: Who = { run: "k".repeat(25), nonce: "k1".repeat(32) };

/** D105-WI-5 ST-2: a child that SIGKILLs itself at its first acquire's `.lock` write, inside `.lock.mutex`. */
function killerSource(parent: string, mark: string, startAt: number): string {
  const J = JSON.stringify;
  return (
    `import fs from "node:fs";` +
    `const P = ${J(parent)}; const real = fs.writeFileSync;` +
    `fs.writeFileSync = (f, ...a) => { if (f === P + "/.lock") { let pid = null;` +
    `  try { pid = JSON.parse(fs.readFileSync(P + "/.lock.mutex", "utf8")).pid; } catch {}` +
    `  real(${J(mark)}, JSON.stringify({ pid })); process.kill(process.pid, "SIGKILL"); } return real(f, ...a); };` +
    `const { acquireLock } = await import(${J(pathToFileURL(LOCK_MODULE).href)});` +
    `while (Date.now() < ${startAt}) {}` +
    `acquireLock(P, ${J(KILLER)});`
  );
}

function runKiller(src: string): Promise<{ pid: number | undefined; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (_code, signal) => resolve({ pid: child.pid, signal }));
  });
}

/** Run every child to completion, then read the logs and the parent's listing. */
export async function runStress(opts: StressOptions = {}): Promise<Observed> {
  const parent = scratch("lks-");
  const logs = scratch("lks-log-");
  const file = (name: string) => path.join(logs, name);
  const marks = { seenOwn: file("seen-own"), seenReleased: file("seen-released") };
  const children: Child[] = [];
  OWNED.forEach((who, j) => {
    const pairRounds = ["releaser", "orphan"].map((r) => file(`${r}-${j}.rounds`));
    for (const role of ["owner", "releaser", "orphan"] as const) {
      const gates = role === "owner" && opts.ownersAfterTheirPairs ? pairRounds : [];
      children.push({ role, who, log: file(`${role}-${j}.jsonl`), rounds: file(`${role}-${j}.rounds`), gates });
    }
  });
  ACQUIRERS.forEach((who, i) =>
    children.push({ role: "acquirer", who, log: file(`acquirer-${i}.jsonl`), rounds: file(`acquirer-${i}.rounds`), gates: [] }),
  );
  const startAt = Date.now() + START_DELAY_MS;
  const killMark = file("killer.json");
  const killer = opts.killInsideMutex ? runKiller(killerSource(parent, killMark, startAt)) : null;
  await Promise.all(children.map((c) => runChild(childSource(c, parent, marks, startAt))));
  const killed = killer === null ? null : await killer;

  const read = (f: string): Entry[] => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const all = children.map((c) => ({ ...c, entries: read(c.log) }));
  const results = all.flatMap((c) => c.entries.map((e) => e.result).filter((r): r is string => r !== undefined));
  const tombNames = fs.readdirSync(parent).filter((n) => n.endsWith(".tomb"));
  const tombBytes = tombNames.map((n) => fs.readFileSync(path.join(parent, n), "utf8"));
  const lock = path.join(parent, ".lock");
  const finalLock = fs.existsSync(lock) ? fs.readFileSync(lock, "utf8") : null;

  const perAcquirer = ACQUIRERS.map((who) => {
    const entries = all.find((c) => c.role === "acquirer" && c.who.run === who.run)?.entries ?? [];
    const mine = recordBytes(who.run, who.nonce);
    return {
      run: who.run,
      counts: {
        lostOwnReleases: entries.filter((e) => e.kind === "release" && e.acquired === true && e.result !== "released").length,
        resurrected: entries.filter((e) => e.kind === "resurrected").length,
        inTombs: tombBytes.filter((b) => b === mine).length,
        atLock: finalLock === mine ? 1 : 0,
      },
    };
  });
  const acquirerEntries = all.filter((c) => c.role === "acquirer").flatMap((c) => c.entries);
  const sum = (k: "resurrected" | "lostOwnReleases") => perAcquirer.reduce((n, a) => n + a.counts[k], 0);
  const strict: StrictObserved | undefined = opts.strict
    ? {
        nonOwnRereads: acquirerEntries.filter((e) => e.kind === "reread" && e.reread !== "own").length,
        busy: results.filter((r) => r.startsWith("lock busy: ")).length,
        resurrected: sum("resurrected"),
        lostOwnReleases: sum("lostOwnReleases"),
        mutexFiles: fs.readdirSync(parent).filter((n) => n.startsWith(".lock.mutex")).sort(),
        ...(killed === null ? {} : { killer: { ...killed, mutexPidAtKill: readKillMark(killMark) } }),
      }
    : undefined;
  return {
    ...(strict ? { strict } : {}),
    perAcquirer,
    results,
    displaced: results.filter((r) => r.startsWith("lock displaced: kept ")).length,
    tombs: tombNames.length,
    own: all.flatMap((c) => c.entries).filter((e) => e.reread === "own").length,
    releasedByPairs: all
      .filter((c) => c.role === "releaser" || c.role === "orphan")
      .flatMap((c) => c.entries)
      .filter((e) => e.result === "released").length,
  };
}

/** The pid `.lock.mutex` named when the killer died, or null when it never got there. */
function readKillMark(mark: string): number | null {
  try {
    return JSON.parse(fs.readFileSync(mark, "utf8")).pid;
  } catch {
    return null;
  }
}
