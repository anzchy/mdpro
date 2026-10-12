/**
 * Purpose: The lock leftovers `doctor` reports (D174): every `.lock.mutex`,
 * `.lock.mutex.break`, `.clean.<run>`, `.lock.*.tomb` and `.lock.mutex*.tmp`
 * / `.clean.*.tmp` file in the runs parent, collected read-only, and the one
 * `lock leftover <name>: …` line each gets. ADR-0077, D105, D148 and D170
 * each recorded "the refusal message is the only guidance" as a cost; these
 * lines are the guidance.
 *
 * Pipeline: `collectLockLeftovers(parent)` → sorted `readdir` → classify by
 *   name → `lstat` (not a regular file → `irregular`) → read the record with
 *   the lock code's own reader (`readHolder`, `readMarker`, `readRecordAt`)
 *   → `holderLiveness(pid)` → entries; `leftoverLine(entry)` → the line
 *   (`doctorChecks` prefixes `[info] `); `blocksLaunch(entry)` → whether the
 *   next launch's acquire refuses on it with nothing that would clear it.
 *
 * Key decisions:
 * - Read-only: nothing is created, replaced or removed, and a file that
 *   vanishes between `readdir` and its read is simply not listed.
 * - Liveness is ESRCH-only, as in lockMutex / cleanClaim: `kill(pid, 0)`
 *   succeeding is `alive`, ESRCH is `dead`, anything else (EPERM) is
 *   `unknown`. Doctor's own `pidAlive` maps EPERM to alive and the lock
 *   code's `isDead` is a private boolean, so neither could say `unknown`.
 * - `rm '<absolute path>'` is offered exactly when removing the file cannot
 *   hurt a live holder: a dead holder, a tomb, an unreadable record, a temp.
 *   A live or unknown holder, a non-regular file, or a name that cannot be
 *   printed on one line gets none. The path is absolute (the passwd home's
 *   realpath, never `~`, which expands `$HOME`) and single-quoted for sh.
 * - What blocks launches is what `acquireLock` refuses on and nothing ever
 *   clears: any tomb; a mutex that is unreadable, irregular or held by an
 *   unknown pid; a break file in any state but a live holder. A dead mutex
 *   holder is not counted: the next lock section breaks it. A clean marker
 *   only ever blocks `clean <run>`; a temp blocks nothing.
 * - Lines carry file names, pids and validated run names only: never a
 *   token, nonce or digest. A tomb whose run is not a run name reads as
 *   unreadable; a name with a non-printable byte is shown JSON-escaped.
 *
 * @module scripts/control/doctorLeftovers
 * @coordinates-with scripts/control/doctor.mjs (collectFacts: `lockLeftovers`)
 * @coordinates-with scripts/control/doctorChecks.mjs (the `[info]` lines and the run-lock check)
 * @coordinates-with scripts/control/lockMutex.mjs, cleanClaim.mjs, lock.mjs (the record readers)
 * @coordinates-with scripts/control/writeWhole.mjs, lockTomb.mjs (the temp and tomb names)
 */
import fs from "node:fs";
import path from "node:path";
import { readMarker } from "./cleanClaim.mjs";
import { readRecordAt } from "./lock.mjs";
import { readHolder } from "./lockMutex.mjs";
import { layout } from "./runDir.mjs";

const MUTEX = ".lock.mutex";
const BREAK = ".lock.mutex.break";
const CLEAN_PREFIX = ".clean.";
const TEMP_RE = /^(\.lock\.mutex|\.clean\.).*\.tmp$/;
const TOMB_RE = /^\.lock\..+\.tomb$/;
const PRINTABLE_RE = /^[\x20-\x7e]+$/;
const REMOVABLE = new Set(["dead", "unreadable", "temp", "tomb"]);

/** @typedef {"mutex" | "break" | "clean" | "tomb" | "temp"} Kind */
/**
 * @typedef {{ name: string, path: string, kind: Kind, run?: string,
 *   state: "alive" | "dead" | "unknown" | "unreadable" | "irregular" | "temp" | "tomb",
 *   pid?: number, why?: string, empty?: boolean, tombRun?: string }} Leftover
 */

/** @param {string} name @returns {boolean} */
function isRun(name) {
  try {
    layout("/", name);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} name @returns {Kind | null} */
function kindOf(name) {
  if (name === MUTEX) return "mutex";
  if (name === BREAK) return "break";
  if (TEMP_RE.test(name)) return "temp";
  if (TOMB_RE.test(name)) return "tomb";
  if (name.startsWith(CLEAN_PREFIX) && isRun(name.slice(CLEAN_PREFIX.length))) return "clean";
  return null;
}

/**
 * Liveness by `kill(pid, 0)`, ESRCH-only.
 * @param {number} pid @returns {{ live: "alive" | "dead" | "unknown", why?: string }}
 */
export function holderLiveness(pid) {
  try {
    process.kill(pid, 0);
    return { live: "alive" };
  } catch (e) {
    const code = /** @type {any} */ (e)?.code;
    return code === "ESRCH" ? { live: "dead" } : { live: "unknown", why: String(code) };
  }
}

/** @param {string} parent @param {string} name @param {Kind} kind @returns {Leftover | null} */
function inspect(parent, name, kind) {
  const file = path.join(parent, name);
  /** @type {Leftover} */
  const base = { name, path: file, kind, state: "irregular" };
  if (kind === "clean") base.run = name.slice(CLEAN_PREFIX.length);
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!st.isFile()) return base;
  if (kind === "temp") return { ...base, state: "temp" };
  const empty = st.size === 0;
  if (kind === "tomb") {
    const rec = readRecordAt(file);
    if (rec.state === "absent") return null;
    if (rec.state === "held" && isRun(rec.run)) return { ...base, state: "tomb", tombRun: rec.run };
    return { ...base, state: "unreadable", empty };
  }
  const h = kind === "clean" ? readMarker(file) : readHolder(file);
  if (h.state === "absent") return null;
  if (h.state !== "held") return { ...base, state: "unreadable", empty };
  const { live, why } = holderLiveness(h.pid);
  return { ...base, state: live, pid: h.pid, ...(why === undefined ? {} : { why }) };
}

/**
 * Every lock leftover in `parent`, in name order. Reads only; a missing or
 * unreadable parent has none.
 * @param {string} parent the runs parent @returns {Leftover[]}
 */
export function collectLockLeftovers(parent) {
  let names;
  try {
    names = fs.readdirSync(parent).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const kind = kindOf(name);
    const entry = kind === null ? null : inspect(parent, name, kind);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/**
 * Whether the next launch's acquire refuses on `e` and nothing will clear it.
 * @param {Leftover} e @returns {boolean}
 */
export function blocksLaunch(e) {
  if (e.kind === "tomb") return true;
  if (e.kind === "mutex") return e.state !== "alive" && e.state !== "dead";
  if (e.kind === "break") return e.state !== "alive";
  return false;
}

/** @param {Leftover} e @returns {string | null} */
function blocks(e) {
  if (blocksLaunch(e)) return "blocks launches";
  const stuck = e.state === "unknown" || e.state === "unreadable" || e.state === "irregular";
  return e.kind === "clean" && stuck ? `blocks clean ${e.run}` : null;
}

/** @param {string} p @returns {string} `p` single-quoted for sh */
const shellQuote = (p) => `'${p.replace(/'/g, `'\\''`)}'`;

/** @param {Leftover} e @returns {string} */
function describe(e) {
  const why = e.empty ? "empty" : e.kind === "tomb" ? "not a lock record" : "not a {pid, token} record";
  switch (e.state) {
    case "alive":
      return `holder pid ${e.pid} alive, in use`;
    case "dead":
      return `holder pid ${e.pid} dead`;
    case "unknown":
      return `holder pid ${e.pid} unknown (${e.why})`;
    case "unreadable":
      return `${e.kind === "tomb" ? "tomb, record unreadable" : "unreadable"} (${why}), may be a crash leftover`;
    case "irregular":
      return "not a regular file";
    case "temp":
      return "temp file, nothing reads it (a crash leftover)";
    case "tomb":
      return `tomb of run ${e.tombRun}`;
  }
}

/** @param {Leftover} e @param {boolean} printable @returns {string | null} */
function action(e, printable) {
  if (e.state === "alive") return null;
  if (e.state === "unknown") return `check pid ${e.pid}, then remove it by hand`;
  if (!printable || !REMOVABLE.has(e.state)) return "inspect it by hand";
  return `remove: rm ${shellQuote(e.path)}`;
}

/**
 * The line for one leftover: `lock leftover <name>: <what>[; blocks …][; <action>]`.
 * @param {Leftover} e @returns {string}
 */
export function leftoverLine(e) {
  const shown = PRINTABLE_RE.test(e.name) ? e.name : JSON.stringify(e.name);
  const parts = [describe(e), blocks(e), action(e, PRINTABLE_RE.test(e.path))].filter((p) => p !== null);
  return `lock leftover ${shown}: ${parts.join("; ")}`;
}
