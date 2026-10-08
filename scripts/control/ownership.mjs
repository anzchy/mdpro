/**
 * Purpose: The ownership verdicts the launcher's destructive verbs decide on
 * (ADR-0047 WI-003 WI-3): `quitVerdict` (may `quit` signal this pid?) and
 * `cleanVerdict` (may `clean` delete this run dir?). Pure: the drivers gather
 * the facts (`ps`, `lsof`, `lstat`, the lock) and pass them in.
 *
 * Pipeline: driver facts → `quitVerdict` / `cleanVerdict` →
 *   `{ ok: true }` | `{ ok: false, failed: [check names] }`.
 *
 * Key decisions:
 * - Conjunction: one failed check refuses. Every check is evaluated, so
 *   `failed` names all of them, in a fixed order, never just the first.
 * - Monotonic: each check accepts only its one good value (`=== true`,
 *   `=== false`, an equal pair of known values), so a worse fact, including
 *   `null` / `undefined` / `"unknown"`, can never turn a refusal into `ok`.
 * - Unknown never compares equal: `null === null` and `"unknown" ===
 *   "unknown"` fail. Pids must be positive safe integers, because
 *   `process.kill(0 | -1, …)` signals a process group or every process.
 * - Start time alone (1-second precision) is never enough; the exe realpath
 *   is checked too. The pid is never enough either.
 * - Verdicts carry check names only, never the facts (no nonce leaks).
 * - `isSymlink` is the caller's `lstat` on the path itself, never through it.
 *
 * @module scripts/control/ownership
 * @coordinates-with scripts/control/runDir.mjs (the paths the facts come from)
 */

const UNKNOWN = "unknown";

/** A fact that is a real, comparable value: a non-empty, non-"unknown" string. */
const known = (v) => typeof v === "string" && v !== "" && v !== UNKNOWN;
const sameKnown = (a, b) => known(a) && a === b;
const goodPid = (p) => Number.isSafeInteger(p) && p > 0;

/** Quit checks, in report order. */
const QUIT_CHECKS = [
  ["nonce", (f) => sameKnown(f.launchNonce, f.instanceNonce)],
  ["pid", (f) => goodPid(f.ownerPid) && f.ownerPid === f.instancePid],
  ["alive", (f) => f.pidAlive === true],
  ["startTime", (f) => sameKnown(f.psStartTime, f.recordedStartTime)],
  ["exe", (f) => sameKnown(f.exeRealpath, f.recordedExeRealpath)],
];

/** Clean preconditions, in report order. */
const CLEAN_CHECKS = [
  ["realpathUnderParent", (f) => f.realpathUnderParent === true],
  ["notSymlink", (f) => f.isSymlink === false],
  ["owner", (f) => f.ownerUidMatches === true],
  ["mode", (f) => f.modeIs0700 === true],
  ["launchJson", (f) => f.hasLauncherLaunchJson === true],
  ["noLiveProcess", (f) => f.ownedLiveProcess === false],
  ["lock", (f) => f.lockState === "absent" || f.lockState === "thisRun"],
];

function verdict(checks, facts) {
  const f = facts ?? {};
  const failed = checks.filter(([, holds]) => !holds(f)).map(([name]) => name);
  return failed.length === 0 ? { ok: true } : { ok: false, failed };
}

/**
 * May `quit` signal the recorded owner pid?
 * @param {{ launchNonce?: unknown, instanceNonce?: unknown, ownerPid?: unknown,
 *   instancePid?: unknown, pidAlive?: unknown, psStartTime?: unknown,
 *   recordedStartTime?: unknown, exeRealpath?: unknown,
 *   recordedExeRealpath?: unknown }} facts process facts gathered for `ownerPid`
 * @returns {{ ok: true } | { ok: false, failed: string[] }} failures in the
 *   order `nonce`, `pid`, `alive`, `startTime`, `exe`
 */
export function quitVerdict(facts) {
  return verdict(QUIT_CHECKS, facts);
}

/**
 * May `clean` delete this run dir?
 * @param {{ realpathUnderParent?: unknown, isSymlink?: unknown,
 *   ownerUidMatches?: unknown, modeIs0700?: unknown,
 *   hasLauncherLaunchJson?: unknown, ownedLiveProcess?: unknown,
 *   lockState?: unknown }} facts `lockState` is `absent` | `thisRun` (good)
 *   or `otherRun` | `corrupt` (bad)
 * @returns {{ ok: true } | { ok: false, failed: string[] }} failures in the
 *   order `realpathUnderParent`, `notSymlink`, `owner`, `mode`, `launchJson`,
 *   `noLiveProcess`, `lock`
 */
export function cleanVerdict(facts) {
  return verdict(CLEAN_CHECKS, facts);
}
