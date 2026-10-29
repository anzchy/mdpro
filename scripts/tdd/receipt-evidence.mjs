/**
 * Purpose: The receipt evidence sidecar `.claude/tdd-guardian/evidence.json` and its
 * repo-wide lock (ADR-0145 d6, ADR-0149 d1). One entry per receipt id, beside the
 * plugin's receipts.json, which never gains a field.
 *
 * Entry: { id, lane, recorded_at, plugin_version, lane_command, env, failures,
 * tests_tree: {ref, tree}, spec_blobs, settled_blobs?, evidence_required?, replay? }.
 *
 * Key decisions:
 * - Every read-modify-write of the sidecar, for every id and lane, runs inside
 *   withEvidenceLock (a `mkdir` lock whose owner file is written whole, then hard-linked
 *   in, so a taker whose directory was reaped during a stall finds the new owner and backs
 *   off instead of overwriting it). A
 *   dead owner's lock, or an ownerless one older than a second, is reaped; a live one is
 *   waited on for MDPRO_EVIDENCE_LOCK_WAIT_MS (default 20 s), then the operation fails
 *   closed and writes nothing.
 * - The reap is one at a time (fix 2, gpt-auditor M3): a reaper takes `.evidence.lock.reap`,
 *   then re-reads the lock and removes it only when its inode and owner text are still the
 *   ones it judged stale, and still stale; otherwise another process has reaped it and
 *   taken a fresh lock, which is waited on. The deadline holds on the stale path too. A reap mutex older than 10 s is dropped
 *   (its critical section is a stat, a read and a rename). Test barriers here use
 *   MDPRO_EVIDENCE_BARRIER_DIR, never the entry's MDPRO_UNIT_RED_BARRIER_DIR.
 * - A malformed sidecar or an unknown schemaVersion is an error, never an empty store:
 *   rewriting it would drop every other receipt's evidence.
 * - entryFor reads an entry whose recorded_at, lane or plugin version differs from the
 *   receipt's as "no evidence" (stale or mismatched), which is the user path.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-capture.mjs, scripts/tdd/receipt-replay.mjs
 */
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { usageError } from "./unit-red-lane.mjs";

export const EVIDENCE = ".claude/tdd-guardian/evidence.json";
const LOCK = ".claude/tdd-guardian/.evidence.lock";
const SCHEMA = 1;
const STALE_WITHOUT_OWNER_MS = 1000;
const STALE_REAP_MS = 10_000;
const POLL_MS = 25;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function barrier(name) {
  const directory = process.env.MDPRO_EVIDENCE_BARRIER_DIR;
  if (!directory) return;
  writeFileSync(join(directory, `${name}.ready`), "ready");
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(directory, `${name}.go`))) {
    if (Date.now() > deadline) throw usageError(`Barrier ${name} timed out.`);
    sleep(10);
  }
}

function ownerAlive(text) {
  try { process.kill(JSON.parse(text).pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

/** The lock as it stands: its inode, owner text (null when absent) and staleness; null when there is no lock. */
function observe(lock) {
  try {
    const stat = statSync(lock);
    let text = null;
    try { text = readFileSync(join(lock, "owner.json"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    return { ino: stat.ino, text, stale: text === null ? Date.now() - stat.mtimeMs > STALE_WITHOUT_OWNER_MS : !ownerAlive(text) };
  } catch { return null; }
}

/** Move the lock aside and delete it: never leaves a half-removed lock for another process to see. */
function removeLock(lock) {
  const gone = `${lock}.${randomUUID()}.gone`;
  renameSync(lock, gone);
  rmSync(gone, { recursive: true, force: true });
}

/** Reap `lock` if it is still exactly the stale lock `seen`, one reaper at a time. */
function reap(lock, seen) {
  const mutex = `${lock}.reap`;
  try { mkdirSync(mutex); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try { if (Date.now() - statSync(mutex).mtimeMs > STALE_REAP_MS) rmdirSync(mutex); } catch {}
    sleep(POLL_MS); // another reaper is at work
    return;
  }
  try {
    const now = observe(lock);
    if (now && now.stale && now.ino === seen.ino && now.text === seen.text) removeLock(lock);
  } catch {} finally { try { rmdirSync(mutex); } catch {} }
}

/**
 * Install this process's owner file in `lock`: written whole beside the lock, then hard-linked
 * in, which fails when an owner is already there. False means the directory this process made
 * was reaped during a stall and another process owns the lock now (or it is gone).
 */
function claim(lock, owner, token) {
  const temp = `${lock}.${token}.owner`;
  writeFileSync(temp, JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
  try { linkSync(temp, owner); return true; }
  catch (error) { if (error.code === "EEXIST" || error.code === "ENOENT") return false; throw error; }
  finally { rmSync(temp, { force: true }); }
}

/** Run `operation` holding the repo-wide evidence lock. */
export function withEvidenceLock(cwd, operation) {
  const lock = join(cwd, LOCK), owner = join(lock, "owner.json"), token = randomUUID();
  const deadline = Date.now() + Number(process.env.MDPRO_EVIDENCE_LOCK_WAIT_MS || 20_000);
  mkdirSync(dirname(lock), { recursive: true });
  for (;;) {
    let made = false;
    try { mkdirSync(lock); made = true; } catch (error) { if (error.code !== "EEXIST") throw error; }
    if (made) {
      barrier("evidence-before-owner");
      if (claim(lock, owner, token)) break;
      continue; // reaped while this process stalled, and another took it
    }
    if (Date.now() > deadline) throw usageError("The evidence lock is held by another process; nothing was written.");
    const seen = observe(lock);
    if (seen?.stale) { barrier("evidence-stale-observed"); reap(lock, seen); continue; }
    sleep(POLL_MS);
  }
  try { return operation(); }
  finally { try { if (JSON.parse(readFileSync(owner, "utf8")).token === token) removeLock(lock); } catch {} }
}

/** The sidecar store; an absent file is an empty store, a malformed one throws. */
export function readEvidence(cwd) {
  const file = join(cwd, EVIDENCE);
  if (!existsSync(file)) return { schemaVersion: SCHEMA, entries: {} };
  let store;
  try { store = JSON.parse(readFileSync(file, "utf8")); } catch { throw usageError("evidence.json is not valid JSON; fix or restore it before recording."); }
  if (store?.schemaVersion !== SCHEMA || !store.entries || typeof store.entries !== "object" || Array.isArray(store.entries)) {
    throw usageError("evidence.json has an unknown schema; fix or restore it before recording.");
  }
  return store;
}

function writeEvidence(cwd, store) {
  const file = join(cwd, EVIDENCE), temp = `${file}.${process.pid}.tmp`;
  const sorted = Object.fromEntries(Object.keys(store.entries).sort().map((id) => [id, store.entries[id]]));
  writeFileSync(temp, `${JSON.stringify({ schemaVersion: SCHEMA, entries: sorted }, null, 2)}\n`);
  renameSync(temp, file);
}

/** Set one entry. Call inside withEvidenceLock. */
export function writeEntry(cwd, id, entry) {
  const store = readEvidence(cwd);
  store.entries[id] = entry;
  writeEvidence(cwd, store);
}

/** Merge fields into one existing entry. Call inside withEvidenceLock. */
export function updateEntry(cwd, id, fields) {
  const store = readEvidence(cwd);
  if (!store.entries[id]) throw usageError(`No evidence entry for ${id}.`);
  store.entries[id] = { ...store.entries[id], ...fields };
  writeEvidence(cwd, store);
}

/** Remove one entry if present. Call inside withEvidenceLock. */
export function removeEntry(cwd, id) {
  const store = readEvidence(cwd);
  if (!(id in store.entries)) return;
  delete store.entries[id];
  writeEvidence(cwd, store);
}

/** The receipt's entry when it is current for this receipt and plugin version, else null. */
export function entryFor(store, receipt, pluginVersion) {
  const entry = store.entries[receipt.id];
  return entry && entry.recorded_at === receipt.recorded_at && entry.lane === receipt.lane && entry.plugin_version === pluginVersion ? entry : null;
}
