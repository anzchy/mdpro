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
 *   withEvidenceLock (a `mkdir` lock with an owner file). A dead owner's lock is reaped;
 *   a live one is waited on for MDPRO_EVIDENCE_LOCK_WAIT_MS (default 20 s), then the
 *   operation fails closed and writes nothing.
 * - A malformed sidecar or an unknown schemaVersion is an error, never an empty store:
 *   rewriting it would drop every other receipt's evidence.
 * - entryFor reads an entry whose recorded_at, lane or plugin version differs from the
 *   receipt's as "no evidence" (stale or mismatched), which is the user path.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-capture.mjs, scripts/tdd/receipt-replay.mjs
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { usageError } from "./unit-red-lane.mjs";

export const EVIDENCE = ".claude/tdd-guardian/evidence.json";
const LOCK = ".claude/tdd-guardian/.evidence.lock";
const SCHEMA = 1;
const STALE_WITHOUT_OWNER_MS = 1000;
const POLL_MS = 25;

function ownerAlive(owner) {
  try { process.kill(JSON.parse(readFileSync(owner, "utf8")).pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

/** Run `operation` holding the repo-wide evidence lock. */
export function withEvidenceLock(cwd, operation) {
  const lock = join(cwd, LOCK), owner = join(lock, "owner.json"), token = randomUUID();
  const deadline = Date.now() + Number(process.env.MDPRO_EVIDENCE_LOCK_WAIT_MS || 20_000);
  mkdirSync(dirname(lock), { recursive: true });
  for (;;) {
    try { mkdirSync(lock); writeFileSync(owner, JSON.stringify({ pid: process.pid, token }), { mode: 0o600 }); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try { stale = existsSync(owner) ? !ownerAlive(owner) : Date.now() - statSync(lock).mtimeMs > STALE_WITHOUT_OWNER_MS; } catch {}
      if (stale) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) throw usageError("The evidence lock is held by another process; nothing was written.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_MS);
    }
  }
  try { return operation(); }
  finally { try { if (JSON.parse(readFileSync(owner, "utf8")).token === token) rmSync(lock, { recursive: true, force: true }); } catch {} }
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
