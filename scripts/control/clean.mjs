/**
 * Purpose: The launcher's `clean <run>` driver (ADR-0047 WI-003 WI-8): the
 * only verb that deletes a run dir, and the only one that removes a stale
 * lock or a stale `si.sock` (decision D2: nothing auto-cleans).
 *
 * Pipeline: `run(args, deps)` → `layout` (name check) →
 *   `lstat(<parent>/R)` (absent → `absentRun` in cleanSocket.mjs: lock state,
 *   scan, probe → stale `si.sock` step while an orphan lock naming R is held
 *   → `releaseOrphanLock` → pass)
 *   → facts: `realpath`, `stat` of the realpath, `launch.json`, liveness from
 *   `owner.json` | `instance.json` | the verify scan, `readLock` →
 *   `cleanVerdict` → probe `si.sock` (live refuses) → re-`lstat` R →
 *   `checkLockOwner` (a lock naming R) → `removeRunDir` (R's entries,
 *   `launch.json` last, then R) → `siSock` (scan `[]` only, re-probe `stale`
 *   → unlink) while the lock is still held → `settle`: `releaseLock`, then
 *   the removed line, the held socket line, the verdict.
 *
 * Key decisions:
 * - The runs parent is `runsParent(realpath(passwd home))`, and R's realpath
 *   must equal `<parent>/R` exactly, so realpaths are compared with realpaths.
 * - The root is checked with `lstat`; a symlinked R is refused and neither
 *   the link nor its target is touched. `fs.rm` unlinks inner symlinks and
 *   never traverses them, and the root is re-`lstat`ed before it is removed.
 * - Delete before release: the lock is checked first, R removed, and only
 *   then the lock unlinked, so a partial `rm` keeps the lock and the next
 *   `clean R` is still the way out (a half-deleted R never goes unlocked).
 * - `launch.json` goes last: R's other entries are removed one by one
 *   (sorted), then `launch.json`, then the now-empty R. Any failure before
 *   that keeps `launch.json`, so the retry can still prove ownership. The
 *   one window left is R's own removal failing after `launch.json` is gone.
 * - Absent R with a lock naming R (an orphan, left by a crash): released by
 *   `releaseOrphanLock` (run match only; the nonce went with R) when the scan
 *   is exactly `[]` and `si.sock` is not live or unknown; otherwise refused,
 *   lock kept. A lock naming another run is never touched (`clean: absent R`,
 *   pass); a corrupt one refuses as `ownership: lock`. With no lock left, a
 *   stale `si.sock` follows the same rule as below, so `clean <any absent
 *   name>` is the way out of a stale socket with no run dir (doctor's hint).
 * - A missing record never counts as "no live process": `owner.json`'s pid
 *   must be dead; without it, `instance.json`'s pid must be dead and the scan
 *   exactly `[]`; with neither, the scan alone must be `[]`. Unknown refuses.
 * - A corrupt lock is `corrupt` (a refusal), never `absent`; its bytes stay.
 * - `si.sock` is decided only after the run verdict passed: `live` refuses
 *   the whole clean, `stale` is unlinked only when the scan is exactly `[]`
 *   and a re-probe right before the unlink still says `stale`.
 * - The socket step runs before the lock is released (D82-WI-2): remove R,
 *   then the socket step, then release, so a launch racing `clean` is refused
 *   instead of binding a socket `clean` then deletes. The socket line is held
 *   and printed after the removed line on success, before the driver-failure
 *   verdict when the release fails. With no lock to hold, the window between
 *   the re-probe and the unlink stays open (accepted limit, cleanSocket.mjs).
 * - The release runs inside `.lock.mutex` (D105-WI-2, lockMutex.mjs); a mutex
 *   still busy after its wait is `removed R, lock not released: lock busy: …`.
 *   `deps.lockMutexWaitMs` (tests) bounds the wait, production uses
 *   `MUTEX_WAIT_MS`. `checkLockOwner` stays an unlocked read.
 * - Every refusal is read-only. No `launcher.jsonl` record is written: on a
 *   refusal it would change R, and on success R is gone. `process.env` is
 *   never read for a child or assigned; stdout never carries the nonce.
 *
 * @module scripts/control/clean
 * @coordinates-with scripts/control/ownership.mjs (cleanVerdict)
 * @coordinates-with scripts/control/ownerFacts.mjs (goodPid)
 * @coordinates-with scripts/control/launcherCli.mjs (`pnpm control:clean`: parseCleanArgs, runIfMain)
 * @coordinates-with scripts/control/cleanSocket.mjs (absentRun, siSock, settle, lockState, normScan, lstatOrNull, UNKNOWN)
 * @coordinates-with scripts/control/lock.mjs (checkLockOwner, releaseLock)
 * @coordinates-with scripts/control/doctor.mjs (defaultProcFacts; doctor names `clean <run>` as the next step)
 * @coordinates-with scripts/control/doctorChecks.mjs (the stale-socket hint names a `clean` this file honours)
 */
import fs from "node:fs";
import path from "node:path";
import { defaultProcFacts } from "./doctor.mjs";
import { errCode, errMessage, reporter } from "./launchCore.mjs";
import { defaultDeps as launchDeps } from "./launchDeps.mjs";
import { runIfMain } from "./launcherCli.mjs";
import { formatCleanRefusal } from "./launcherFormat.mjs";
import { absentRun, lockState, lstatOrNull, normScan, settle, siSock, UNKNOWN } from "./cleanSocket.mjs";
import { checkLockOwner, releaseLock } from "./lock.mjs";
import { goodPid } from "./ownerFacts.mjs";
import { cleanVerdict } from "./ownership.mjs";
import { layout, runsParent } from "./runDir.mjs";

export { parseCleanArgs } from "./launcherCli.mjs";

const DIR_MODE = 0o700;
const LAUNCH_FIELDS = ["nonce", "buildId", "mainBinary"];

/** Production deps; tests inject their own. */
export function defaultDeps() {
  return {
    passwdHome: launchDeps().passwdHome,
    uid: process.getuid?.(),
    siSockPath: layout(runsParent("/"), "0".repeat(25)).siSock,
    procFacts: defaultProcFacts(),
    rmSync: fs.rmSync,
    out: (/** @type {string} */ line) => process.stdout.write(`${line}\n`),
    err: (/** @type {string} */ line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * A record file as a fact: absent, or present with its parsed value (null
 * when it is not a regular file or does not parse).
 * @param {string | null} dir @param {string} file
 * @returns {{ present: boolean, value: any }}
 */
function readRecord(dir, file) {
  if (dir === null) return { present: false, value: null };
  const p = path.join(dir, file);
  const st = lstatOrNull(p);
  if (st === null) return { present: false, value: null };
  if (!st.isFile()) return { present: true, value: null };
  try {
    return { present: true, value: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return { present: true, value: null };
  }
}

/** R's entries (sorted) except `launch.json`, then `launch.json`, then R; every removal via `rmSync`. */
function removeRunDir(rmSync, runDir) {
  for (const entry of fs.readdirSync(runDir).sort()) {
    if (entry !== "launch.json") rmSync(path.join(runDir, entry), { recursive: true });
  }
  rmSync(path.join(runDir, "launch.json"), { recursive: true });
  rmSync(runDir, { recursive: true });
}

/** @param {any} v */
const isLaunchBody = (v) =>
  v !== null && typeof v === "object" && LAUNCH_FIELDS.every((k) => typeof v[k] === "string" && v[k] !== "");

/** @returns {Promise<boolean>} true only when the pid is valid and reported dead */
async function deadPid(pf, pid) {
  return goodPid(pid) && (await pf.alive(pid)) === false;
}

/** `ownedLiveProcess`: false only when the first record that exists proves no live process. */
async function ownedLive(pf, owner, inst, scan) {
  if (owner.present) return !(await deadPid(pf, owner.value?.pid));
  const scanClear = Array.isArray(scan) && scan.length === 0;
  if (inst.present) return !(scanClear && (await deadPid(pf, inst.value?.pid)));
  return !scanClear;
}

/** Every `cleanVerdict` fact for R, plus what the removal steps need. */
async function gather(d, parent, lay, name, rootStat) {
  let real = null;
  let st = null;
  try {
    real = fs.realpathSync(lay.runDir);
    st = fs.statSync(real);
  } catch {
    // A dangling link or a vanished R: every fact below reads as a refusal.
  }
  const dir = st?.isDirectory() ? real : null;
  const launch = readRecord(dir, "launch.json");
  const owner = readRecord(dir, "owner.json");
  const inst = readRecord(dir, "instance.json");
  const scan = normScan(await d.procFacts.scan());
  const facts = {
    realpathUnderParent: real === lay.runDir,
    isSymlink: rootStat.isSymbolicLink(),
    ownerUidMatches: st !== null && typeof d.uid === "number" && st.uid === d.uid,
    modeIs0700: dir !== null && (st.mode & 0o777) === DIR_MODE,
    hasLauncherLaunchJson: isLaunchBody(launch.value),
    ownedLiveProcess: dir === null ? UNKNOWN : await ownedLive(d.procFacts, owner, inst, scan),
    lockState: lockState(parent, name),
  };
  return { facts, nonce: launch.value?.nonce, scan };
}

/**
 * Run `clean`.
 * @param {{ run?: string }} [args]
 * @param {Record<string, unknown>} [deps]
 * @returns {Promise<{ exit: 0 | 1, lines: string[] }>} exit 0 pass, 1 otherwise
 */
export async function run(args = {}, deps = {}) {
  const d = /** @type {any} */ ({ ...defaultDeps(), ...deps });
  const secrets = /** @type {string[]} */ ([]);
  const rep = reporter(d, secrets);
  const name = args.run;
  try {
    layout(runsParent("/"), name);
  } catch (e) {
    return rep.verdict("fail", errMessage(e));
  }
  let parent;
  try {
    parent = runsParent(fs.realpathSync(d.passwdHome));
  } catch (e) {
    return rep.verdict("fail", errMessage(e));
  }
  const lay = layout(parent, name);
  let rootStat;
  try {
    rootStat = fs.lstatSync(lay.runDir);
  } catch (e) {
    if (errCode(e) !== "ENOENT") return rep.verdict("driver failure", `run dir unreadable: ${errCode(e)}`);
    return absentRun(d, rep, parent, name);
  }
  const g = await gather(d, parent, lay, name, rootStat);
  if (typeof g.nonce === "string" && g.nonce !== "") secrets.push(g.nonce);
  const v = cleanVerdict(g.facts);
  if (!v.ok) return rep.finish(formatCleanRefusal(v.failed, { secrets }));

  const probe = await d.procFacts.probe(d.siSockPath);
  if (probe === "live") return rep.verdict("fail", "si.sock live");
  const again = lstatOrNull(lay.runDir);
  if (again === null || again.isSymbolicLink() || !again.isDirectory()) {
    return rep.verdict("driver failure", "run dir changed during clean");
  }
  const owner = { run: name, nonce: g.nonce };
  const ours = g.facts.lockState === "thisRun";
  try {
    if (ours) checkLockOwner(parent, owner);
  } catch (e) {
    return rep.verdict("driver failure", `lock not released: ${errMessage(e)}`);
  }
  try {
    removeRunDir(d.rmSync, lay.runDir);
  } catch (e) {
    return rep.verdict("driver failure", `remove failed: ${errCode(e)}`);
  }
  const sockLine = await siSock(d, probe, g.scan);
  return settle(
    rep,
    sockLine,
    () => (ours ? releaseLock(parent, owner, { mutexWaitMs: d.lockMutexWaitMs }) : "absent"),
    () => `clean: removed ${name}`,
    (msg) => `removed ${name}, lock not released: ${msg}`,
  );
}

runIfMain(import.meta.url, "clean", run);
