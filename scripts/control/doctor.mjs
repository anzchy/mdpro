/**
 * Purpose: The launcher's `doctor` driver (ADR-0047 WI-003 WI-5): read-only
 * fact collection from the repo's verify bundle, the runs parent and the
 * process table, then `doctorChecks.evaluate` and one line per `deps.out`.
 * `launch` runs the same gate before it touches anything.
 *
 * Pipeline: `run(args, deps)` → `collectFacts(deps)`:
 *   `buildLayout(repoRoot, "verify")` → bundle present, manifest read;
 *   `computeSourceTree(repoRoot, { excludes: manifest.sourceTreeExcludes })`
 *     === `manifest.sourceTree`;
 *   `runsParent(realpath(passwdHome))` → `readLock` (+ owner facts →
 *     `quitVerdict` for liveness), run dirs, `.instance.json.*.tmp` files,
 *     `collectLockLeftovers(parent)` (doctorLeftovers.mjs, D174);
 *   `procFacts.scan()`, `procFacts.probe(siSockPath)`
 *   → `evaluate(facts)` → `formatDoctorLines` → `deps.out(line)` for each
 *   line → `{ exit }`. `deps.collectFacts` is the fact seam (default:
 *   `collectFacts`).
 *
 * Key decisions:
 * - Doctor writes nothing under the runs parent or the repo: no `mkdir` (a
 *   missing runs parent reads as empty), no unlink of a stale socket, tmp
 *   file or lock; the socket probe is a connect, never an unlink. Its only
 *   write is the one transient dir under `os.tmpdir()` that
 *   `computeSourceTree` makes for the source-tree hash and removes after.
 * - The tree is compared under the manifest's own `sourceTreeExcludes`,
 *   never the current defaults; a manifest without them, or a git failure,
 *   is "unknown", which fails (Trap 2: an uncommitted edit must fail).
 * - A lock is live only when the full ownership verdict holds for its run
 *   (nonce, pid, alive, start time, exe), from the same shared `ownerFacts`
 *   `quit` and `launch --into` use. A dead or unrecorded owner pid (one that
 *   is not a positive safe integer counts as unrecorded) is stale; anything
 *   else is "unknown". All three block (D2).
 * - A lock naming something that is not a valid run name reads as corrupt,
 *   so no lock text reaches the output unvalidated. Nonces are read only to
 *   compare them and are never passed to `evaluate`.
 * - `deps.procFacts` is the boundary (`alive`, `lstart`, `exe`, `scan`,
 *   `probe`); `defaultProcFacts()` wires the real `procFacts.mjs` wrappers.
 *
 * @module scripts/control/doctor
 * @coordinates-with scripts/control/doctorChecks.mjs (evaluate)
 * @coordinates-with scripts/control/procFacts.mjs (the real process facts)
 * @coordinates-with scripts/control/lock.mjs, ownership.mjs, runDir.mjs, sourceTree.mjs
 * @coordinates-with scripts/control/ownerFacts.mjs (readRunRecords, ownerFacts, goodPid)
 * @coordinates-with scripts/control/doctorLeftovers.mjs (collectLockLeftovers: the lock leftovers)
 * @coordinates-with scripts/control/launcherCli.mjs (`pnpm control:doctor`: parseDoctorArgs, runIfMain)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout } from "./buildSteps.mjs";
import { evaluate } from "./doctorChecks.mjs";
import { collectLockLeftovers } from "./doctorLeftovers.mjs";
import { runIfMain } from "./launcherCli.mjs";
import { formatDoctorLines } from "./launcherFormat.mjs";
import { defaultDeps as launchDeps } from "./launchDeps.mjs";
import { errCode } from "./launchCore.mjs";
import { readLock } from "./lock.mjs";
import { goodPid, ownerFacts, readRunRecords } from "./ownerFacts.mjs";
import { quitVerdict } from "./ownership.mjs";
import { probeSocket, readExe, readStartTime, scanVerifyPids } from "./procFacts.mjs";
import { layout, runsParent } from "./runDir.mjs";
import { computeSourceTree } from "./sourceTree.mjs";

export { parseDoctorArgs } from "./launcherCli.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP_RE = /^\.instance\.json\..+\.tmp$/;
const UNKNOWN = "unknown";

/** @param {number} pid @returns {Promise<boolean | "unknown">} signal 0: existence only, nothing is sent */
async function pidAlive(pid) {
  if (!goodPid(pid)) return UNKNOWN;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (errCode(e) === "ESRCH") return false;
    return errCode(e) === "EPERM" ? true : UNKNOWN;
  }
}

/** The real process-fact boundary. */
export function defaultProcFacts() {
  return {
    alive: pidAlive,
    lstart: readStartTime,
    exe: readExe,
    scan: scanVerifyPids,
    probe: (/** @type {string} */ p) => probeSocket(p),
  };
}

/** Production deps; tests inject their own. */
export function defaultDeps() {
  return {
    passwdHome: launchDeps().passwdHome,
    repoRoot: REPO_ROOT,
    siSockPath: layout(runsParent("/"), "0".repeat(25)).siSock,
    procFacts: defaultProcFacts(),
    collectFacts,
    out: (/** @type {string} */ line) => process.stdout.write(`${line}\n`),
  };
}

/** @param {string} p */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} file */
function readManifest(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, why: errCode(e) === "ENOENT" ? "missing" : "unreadable" };
  }
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return { ok: false, why: "not valid JSON" };
  }
  if (m === null || typeof m !== "object" || Array.isArray(m)) return { ok: false, why: "not a JSON object" };
  return { ok: true, buildId: m.buildId, profile: m.profile, tree: m.sourceTree, excludes: m.sourceTreeExcludes };
}

/** @param {string} repoRoot @param {any} m @returns {Promise<boolean | "unknown">} */
async function treeMatches(repoRoot, m) {
  if (typeof m.tree !== "string" || !Array.isArray(m.excludes)) return UNKNOWN;
  try {
    const { tree } = await computeSourceTree(repoRoot, { excludes: m.excludes });
    return tree === m.tree;
  } catch {
    return UNKNOWN;
  }
}

/** @param {Readonly<Record<string, string>>} lay @param {any} pf @returns {Promise<boolean | "unknown">} */
async function lockLiveness(lay, pf) {
  const records = readRunRecords(lay);
  const pid = records.owner?.pid ?? records.inst?.pid;
  if (!goodPid(pid)) return false;
  const alive = await pf.alive(pid);
  if (alive === false) return false;
  if (alive !== true) return UNKNOWN;
  return quitVerdict(await ownerFacts(pf, records)).ok ? true : UNKNOWN;
}

/** @param {string} parent @param {any} pf */
async function lockFacts(parent, pf) {
  const lock = readLock(parent);
  if (lock.state !== "held") return lock;
  let lay;
  try {
    lay = layout(parent, lock.run);
  } catch {
    return { state: "corrupt" };
  }
  return { state: "held", run: lock.run, live: await lockLiveness(lay, pf) };
}

/** @param {string} parent @returns {{ runs: string[], tmps: { run: string, file: string }[] }} */
function leftovers(parent) {
  let names;
  try {
    names = fs.readdirSync(parent).sort();
  } catch {
    return { runs: [], tmps: [] };
  }
  const runs = [];
  const tmps = [];
  for (const name of names) {
    let lay;
    try {
      lay = layout(parent, name);
      if (!fs.lstatSync(lay.runDir).isDirectory()) continue;
    } catch {
      continue;
    }
    runs.push(name);
    let inner = [];
    try {
      inner = fs.readdirSync(lay.runDir).sort();
    } catch {
      inner = [];
    }
    for (const file of inner) if (TMP_RE.test(file)) tmps.push({ run: name, file });
  }
  return { runs, tmps };
}

/**
 * Gather every fact `evaluate` judges. Reads only.
 * @param {ReturnType<typeof defaultDeps>} deps
 */
export async function collectFacts(deps) {
  const parent = runsParent(fs.realpathSync(deps.passwdHome));
  const lay = buildLayout(deps.repoRoot, "verify");
  const manifest = readManifest(lay.manifestPath);
  const { runs, tmps } = leftovers(parent);
  return {
    bundlePresent: isDir(lay.app),
    manifest,
    sourceTreeMatches: manifest.ok ? await treeMatches(deps.repoRoot, manifest) : UNKNOWN,
    lock: await lockFacts(parent, deps.procFacts),
    verifyPids: await deps.procFacts.scan(),
    siSock: await deps.procFacts.probe(deps.siSockPath),
    leftoverRuns: runs,
    leftoverTmps: tmps,
    lockLeftovers: collectLockLeftovers(parent),
    siSockPath: deps.siSockPath,
  };
}

/**
 * Run doctor. Takes no arguments; `args` is accepted for the shared verb shape.
 * @param {unknown} args
 * @param {Partial<ReturnType<typeof defaultDeps>>} [deps]
 * @returns {Promise<{ exit: number, lines: string[] }>} exit 0 pass, 1 otherwise
 */
export async function run(args, deps = {}) {
  void args;
  const d = { ...defaultDeps(), ...deps };
  let lines;
  let exit;
  try {
    ({ lines, exit } = evaluate(await d.collectFacts(d)));
  } catch (e) {
    lines = [`verdict: driver failure — facts unavailable (${errCode(e)})`];
    exit = 1;
  }
  const safe = formatDoctorLines(lines);
  for (const line of safe) d.out(line);
  return { exit, lines: safe };
}

runIfMain(import.meta.url, "doctor", run);
