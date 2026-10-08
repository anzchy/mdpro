/**
 * Purpose: The launcher's run-dir contract (ADR-0047 WI-003 WI-1): where runs
 * live, how a run is named, the socket-path length budget, every path inside
 * one run, the `launch.json` body and the child env. Pure: no filesystem, no
 * clock, no randomness, no `process.env`. The drivers (`launch`, `quit`,
 * `clean`, `doctor`) do all I/O and pass realpaths in.
 *
 * Pipeline: passwd home → `runsParent` → `checkBudget` (on the home's
 *   realpath) → `runName(16 random bytes)` → `layout(parent, name)`;
 *   `{ nonce, buildId, mainBinary }` → `launchJsonBody`;
 *   `{ baseEnv, runDirReal, nonce }` → `childEnv`.
 *
 * Key decisions:
 * - The runs parent is built from the **passwd** home the caller supplies,
 *   never `$HOME` (the WI-002 R3 nesting mistake). See `launchDeps.mjs`.
 * - A run name is the 128-bit integer of 16 random bytes in base36, zero
 *   padded to 25 chars: `[0-9a-z]{25}`, injective, so names never collide
 *   unless the bytes do.
 * - Budget: the longest reserved path is `<RUN>/ctl.sock`; it must fit in
 *   103 bytes (104-byte `sun_path` minus the NUL), measured in UTF-8 bytes.
 *   The refusal reason carries numbers only, never the path.
 * - Every path the guard or the app reads is built from `runDir`; only
 *   `lock` (in the parent) and `siSock` (fixed by the app) lie outside it.
 *   The layout is frozen.
 * - `instance.json` is exposed for reading only; nothing here writes it
 *   (hard constraint 2 — the app is its only writer).
 * - `childEnv` returns a fresh object; `HOME`, `CFFIXED_USER_HOME` and
 *   `MDPRO_VERIFY_RUN` all hold `runDirReal`, which must already be absolute
 *   and canonical so the guard's `canonicalize()` cannot rewrite it.
 *   `process.env` is never assigned (hard constraint 5).
 *
 * @module scripts/control/runDir
 * @coordinates-with scripts/control/launchDeps.mjs (passwd home, randomness)
 * @coordinates-with src-tauri/src/services/verify_run.rs (the launch guard)
 */
import path from "node:path";

/** Bytes allowed for the longest in-run socket path (104-byte sun_path − NUL). */
export const SOCKET_PATH_BUDGET = 103;

const RUNS_SUFFIX = ["Library", "Application Support", "mdpro-verify", "runs"];
const CTL_SOCKET = "ctl.sock";
const NAME_BYTES = 16;
const NAME_LENGTH = 25;
const NAME_RE = /^[0-9a-z]{25}$/;
const SI_SOCK = "/tmp/com_mdpro_app_verify_si.sock";
const LAUNCH_FIELDS = ["nonce", "buildId", "mainBinary"];

/**
 * The parent directory every run lives in.
 * @param {string} passwdHome the passwd home (`os.userInfo().homedir`), or its realpath
 * @returns {string} `<home>/Library/Application Support/mdpro-verify/runs`
 */
export function runsParent(passwdHome) {
  if (typeof passwdHome !== "string" || !path.isAbsolute(passwdHome)) {
    throw new Error("passwd home must be absolute");
  }
  return path.join(passwdHome, ...RUNS_SUFFIX);
}

/**
 * A run name: the 16 bytes as a 128-bit integer in base36, padded to 25 chars.
 * @param {Uint8Array} bytes exactly 16 random bytes
 * @returns {string}
 */
export function runName(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== NAME_BYTES) {
    throw new Error("runName needs 16 random bytes");
  }
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString(36).padStart(NAME_LENGTH, "0");
}

/**
 * Whether a run under this home fits the socket-path budget.
 * @param {string} home the home's realpath
 * @returns {{ ok: true, total: number } | { ok: false, reason: string }}
 */
export function checkBudget(home) {
  const longest = path.join(runsParent(home), "0".repeat(NAME_LENGTH), CTL_SOCKET);
  const total = Buffer.byteLength(longest, "utf8");
  if (total <= SOCKET_PATH_BUDGET) return { ok: true, total };
  return { ok: false, reason: `run path budget exceeded: ${total} > ${SOCKET_PATH_BUDGET} bytes` };
}

/**
 * Every path in one run. Frozen.
 * @param {string} parent the runs parent (see `runsParent`)
 * @param {string} name a run name (`[0-9a-z]{25}`)
 * @returns {Readonly<Record<string, string>>}
 */
export function layout(parent, name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("invalid run name");
  const runDir = path.join(parent, name);
  const prefsDir = path.join(runDir, ".mdpro");
  const appSupport = path.join(runDir, "Library", "Application Support", "mdpro");
  return Object.freeze({
    runDir,
    launchJson: path.join(runDir, "launch.json"),
    instanceJson: path.join(runDir, "instance.json"),
    ownerJson: path.join(runDir, "owner.json"),
    stderrLog: path.join(runDir, "launcher-stderr.log"),
    launcherLog: path.join(runDir, "launcher.jsonl"),
    prefsDir,
    prefs: path.join(prefsDir, "config.json"),
    appLog: path.join(prefsDir, "mdpro.log"),
    appSupport,
    serverPort: path.join(appSupport, "server.port"),
    drafts: path.join(appSupport, "drafts"),
    ctlSocket: path.join(runDir, CTL_SOCKET),
    lock: path.join(parent, ".lock"),
    siSock: SI_SOCK,
  });
}

/**
 * The `launch.json` body the guard reads. Exactly three string fields.
 * @param {{ nonce: string, buildId: string, mainBinary: string }} input
 * @returns {{ nonce: string, buildId: string, mainBinary: string }}
 */
export function launchJsonBody({ nonce, buildId, mainBinary }) {
  const body = { nonce, buildId, mainBinary };
  for (const field of LAUNCH_FIELDS) {
    const v = body[/** @type {keyof typeof body} */ (field)];
    if (typeof v !== "string" || v === "") {
      throw new Error(`launch.json field ${field} must be a non-empty string`);
    }
  }
  return body;
}

/**
 * The env for the launched app: a fresh copy of `baseEnv` with the four run
 * variables set. `baseEnv` is never mutated.
 * @param {{ baseEnv: Record<string, string | undefined>, runDirReal: string, nonce: string }} input
 * @returns {Record<string, string | undefined>}
 */
export function childEnv({ baseEnv, runDirReal, nonce }) {
  if (typeof runDirReal !== "string" || !path.isAbsolute(runDirReal)) {
    throw new Error("runDirReal must be absolute");
  }
  if (path.resolve(runDirReal) !== runDirReal) throw new Error("runDirReal must be canonical");
  return {
    ...baseEnv,
    HOME: runDirReal,
    CFFIXED_USER_HOME: runDirReal,
    MDPRO_VERIFY_RUN: runDirReal,
    MDPRO_VERIFY_NONCE: nonce,
  };
}
