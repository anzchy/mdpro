/**
 * Purpose: The outside mutex for the launcher's one-run lock (D105-WI-1):
 * `<runs parent>/.lock.mutex`, created whole and exclusively at mode 0600
 * (a temp, then a link: `writeWhole.mjs`), holding `{ pid, token }`. `withLockMutex` runs one synchronous section
 * (an acquire with launch's run-dir mkdir, a release, clean's socket step,
 * or taking or dropping a clean claim) while no other process that follows
 * this protocol is inside its own.
 *
 * Pipeline: `withLockMutex(parent, fn, { waitMs })` → create `.lock.mutex`
 *   whole (temp → link) | on EEXIST read the holder:
 *   this pid → throw at once; ESRCH → break (`.lock.mutex.break` created the
 *   same way → re-read
 *   → unlink the mutex only if its bytes are unchanged and its pid still
 *   ESRCH → unlink the break file) → retry; alive, EPERM, unreadable or a
 *   break file present → poll every `MUTEX_POLL_MS` until `waitMs`, then
 *   `lock busy: …` → `fn()` → release: unlink only if the token is ours,
 *   else `lock mutex lost`.
 *
 * Key decisions:
 * - The section is synchronous, and so is the wait (`Atomics.wait`): nothing
 *   inside `withLockMutex` awaits, so a hold lasts a few syscalls. An async
 *   step inside a section would break that assumption.
 * - A holder whose pid is this process can only be a re-entry (sync code), so
 *   it is refused at once (`lock busy: mutex held by this process`); waiting
 *   would deadlock.
 * - Liveness is by pid only, and it is fail-closed: only `kill(pid, 0)` →
 *   ESRCH proves the holder dead. A reused pid reads as alive, so the wait
 *   times out (`lock busy: mutex held by pid <n>`) and a human removes the file.
 *   Age never breaks a mutex: an age rule could make two holders.
 * - Neither file is ever seen incomplete (D170-WI-1): the body goes to a
 *   unique `<name>.<pid>-<hex>.tmp` beside it, which is linked onto the name,
 *   so an existing file still means EEXIST ("held"); the temp is removed in
 *   `finally`. A process killed in between leaves at most a temp, which
 *   nothing reads, so it blocks nothing.
 * - An unparsable mutex (empty or partial from code before D170, a directory,
 *   a bad pid) is never broken: `lock busy: mutex unreadable`, bytes kept. An
 *   empty or partial break file is waited on like any other.
 * - Breaking happens only under `.lock.mutex.break` (itself exclusive), so two
 *   breakers cannot both pass the re-read and delete a newcomer's mutex. An
 *   existing break file is waited on and never removed by anyone but its
 *   creator: `lock busy: mutex break file kept (.lock.mutex.break)`.
 * - Both files carry only `{ pid, token }`, never a run name, nonce or digest.
 *   The token (random, per call) is what release checks, so a section never
 *   unlinks a mutex it does not hold. A lost mutex throws `lock mutex lost`
 *   from the release, which then replaces any error `fn` threw.
 * - Any create error other than EEXIST (a missing or unwritable parent) is
 *   rethrown as-is, before `fn` runs.
 *
 * @module scripts/control/lockMutex
 * @coordinates-with scripts/control/lock.mjs (acquire and release sections)
 * @coordinates-with scripts/control/writeWhole.mjs (writeWhole: the create of both files)
 * @coordinates-with scripts/control/doctorLeftovers.mjs (readHolder: doctor's `.lock.mutex` / `.lock.mutex.break` lines, D174)
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeWhole } from "./writeWhole.mjs";

/** How long a section waits for a live or unreadable holder before `lock busy`. */
export const MUTEX_WAIT_MS = 2000;
/** The poll interval of that wait. */
export const MUTEX_POLL_MS = 5;

const MUTEX_NAME = ".lock.mutex";
const BREAK_NAME = ".lock.mutex.break";
const FILE_MODE = 0o600;
const TOKEN_BYTES = 8;
const TOKEN_RE = /^[0-9a-f]{16}$/;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

/**
 * Run `fn` while holding `<parent>/.lock.mutex`.
 * @template T
 * @param {string} parent the runs parent (must exist)
 * @param {() => T} fn a synchronous section
 * @param {{ waitMs?: number }} [opts]
 * @returns {T} fn's value; fn's error passes through
 */
export function withLockMutex(parent, fn, { waitMs = MUTEX_WAIT_MS } = {}) {
  const file = path.join(parent, MUTEX_NAME);
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  enter(parent, file, JSON.stringify({ pid: process.pid, token }), waitMs);
  let outcome;
  try {
    outcome = { value: fn() };
  } catch (error) {
    outcome = { error };
  }
  leave(file, token);
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Unlink the mutex only if it still carries `token`; otherwise `lock mutex lost`, file kept. */
function leave(file, token) {
  const h = readHolder(file);
  if (h.state !== "held" || h.token !== token) throw new Error("lock mutex lost");
  fs.unlinkSync(file);
}

/** Create the mutex, breaking a provably dead holder, or throw `lock busy: …` after `waitMs`. */
function enter(parent, file, body, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      writeWhole(file, body, FILE_MODE);
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const h = readHolder(file);
    if (h.state === "absent") continue;
    if (h.state === "held" && h.pid === process.pid) throw new Error("lock busy: mutex held by this process");
    let busy = h.state === "held" ? `mutex held by pid ${h.pid}` : "mutex unreadable";
    if (h.state === "held" && isDead(h.pid)) {
      if (breakDead(parent, file, h.bytes, body)) continue;
      busy = `mutex break file kept (${BREAK_NAME})`;
    }
    if (Date.now() >= deadline) throw new Error(`lock busy: ${busy}`);
    Atomics.wait(sleepCell, 0, 0, MUTEX_POLL_MS);
  }
}

/**
 * Remove a dead holder's mutex under the break file.
 * @returns {boolean} false when another break file is present (left alone)
 */
function breakDead(parent, file, seen, body) {
  const breakFile = path.join(parent, BREAK_NAME);
  try {
    writeWhole(breakFile, body, FILE_MODE);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  try {
    const now = readHolder(file);
    if (now.state === "held" && now.bytes === seen && isDead(now.pid)) unlinkIfPresent(file);
  } finally {
    fs.unlinkSync(breakFile);
  }
  return true;
}

/** @param {string} file */
function unlinkIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/** @param {number} pid @returns {boolean} true only when `kill(pid, 0)` says ESRCH */
function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
}

/**
 * @param {string} file
 * @returns {{ state: "absent" } | { state: "unreadable" } | { state: "held", pid: number, token: string, bytes: string }}
 */
export function readHolder(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { state: "absent" } : { state: "unreadable" };
  }
  let rec;
  try {
    rec = JSON.parse(bytes);
  } catch {
    return { state: "unreadable" };
  }
  const ok =
    rec !== null &&
    typeof rec === "object" &&
    Number.isSafeInteger(rec.pid) &&
    rec.pid > 0 &&
    typeof rec.token === "string" &&
    TOKEN_RE.test(rec.token);
  return ok ? { state: "held", pid: rec.pid, token: rec.token, bytes } : { state: "unreadable" };
}

/** @param {unknown} error @returns {unknown} */
function errorCode(error) {
  return error instanceof Error ? /** @type {any} */ (error).code : undefined;
}
