/**
 * Purpose: the real reads behind `releaseClean.mjs` (ADR-0047 WI-009 plan
 * item 10). Thin I/O only: every judgement lives in `releaseCleanChecks.mjs`
 * and every ordering decision in `releaseClean.mjs`.
 *
 * Key decisions:
 * - The bundle read is `buildLayout(repo, "release")`, the same paths
 *   `pnpm control:build --profile release` writes; nothing is built here.
 * - Layer 4 launches the main binary directly with a verify run's env
 *   (`runDir.mjs` `childEnv`: HOME, CFFIXED_USER_HOME, MDPRO_VERIFY_RUN and
 *   a fresh nonce) on a run dir holding the `eval` opt-in, so the release
 *   app sees every signal a verify run gives a control-channel build.
 * - "mdpro is running" is any process named `tauri-app`: the daily, dev and
 *   verify builds all keep the cargo name.
 * - Ready means the release single-instance socket exists, then a settle
 *   wait, since the channel opens only after `setup`.
 * - `removeRun` deletes only a dir this module made under the temp dir.
 * - `stop` sends SIGTERM, so the app's exit hooks never remove its
 *   single-instance socket; once the app is gone `stop` unlinks it. That
 *   socket is ours: layer 4 refuses to launch while it exists.
 * - Each lsof run goes through `lsofOutput`: exit 1 counts as an empty
 *   listing only with nothing on stderr.
 *
 * @module scripts/control/releaseCleanDeps
 * @coordinates-with scripts/control/releaseClean.mjs (calls these)
 * @coordinates-with scripts/control/buildSteps.mjs (buildLayout)
 * @coordinates-with scripts/control/runDir.mjs (childEnv)
 * @coordinates-with scripts/control/controlOptin.mjs (writeOptin)
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout } from "./buildSteps.mjs";
import { writeOptin } from "./controlOptin.mjs";
import { lsofOutput, SI_SOCK_RELEASE } from "./releaseCleanChecks.mjs";
import { childEnv } from "./runDir.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_PREFIX = "mdpro-release-clean-";
const POLL_MS = 200;
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 5_000;
const STOP_TIMEOUT_MS = 10_000;
const NONCE_BYTES = 32;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} p */
const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** @param {string} p */
const isSocket = (p) => {
  try {
    return fs.lstatSync(p).isSocket();
  } catch {
    return false;
  }
};

/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Run a command; throw unless it exits with one of `ok`.
 * @param {string} cmd @param {string[]} args @param {number[]} [ok]
 */
function run(cmd, args, ok = [0]) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (!ok.includes(r.status ?? -1)) throw new Error(`${cmd} exited ${r.status ?? r.signal}: ${r.stderr.trim()}`);
  return r;
}

/** Every file under `dir`, path relative to `root`. @param {string} root @param {string} [dir] @returns {string[]} */
function walk(root, dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    return e.isDirectory() ? [rel, ...walk(root, full)] : [rel];
  });
}

/** The production deps. */
export function defaultDeps() {
  const lay = buildLayout(REPO, "release");
  const tmpRoot = fs.realpathSync(os.tmpdir());
  return {
    cargoTree: () =>
      run("cargo", ["tree", "-e", "features", "-i", "tauri-app", "--prefix", "none", "--manifest-path", "src-tauri/Cargo.toml"])
        .stdout,
    distFiles: () =>
      walk(lay.dist)
        .filter((rel) => fs.statSync(path.join(lay.dist, rel)).isFile())
        .map((rel) => ({ path: rel, text: fs.readFileSync(path.join(lay.dist, rel)).toString("latin1") })),
    binaryBytes: () => fs.readFileSync(lay.mainBinary),
    mdproRunning: () => run("pgrep", ["-x", "tauri-app"], [0, 1]).status === 0,
    siSockExists: () => exists(SI_SOCK_RELEASE),
    makeRun: () => fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, RUN_PREFIX))),
    placeOptin: (/** @type {string} */ dir) => writeOptin(dir, "eval"),
    launch: (/** @type {string} */ dir) => {
      const nonce = randomBytes(NONCE_BYTES).toString("hex");
      const child = spawn(lay.mainBinary, [], {
        detached: true,
        stdio: "ignore",
        env: childEnv({ baseEnv: process.env, runDirReal: dir, nonce }),
      });
      child.unref();
      if (child.pid === undefined) throw new Error(`could not spawn ${lay.mainBinary}`);
      return child.pid;
    },
    waitReady: async (/** @type {number} */ pid) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (!exists(SI_SOCK_RELEASE)) {
        if (!alive(pid)) throw new Error("the release app exited before it was ready");
        if (Date.now() > deadline) throw new Error(`no ${SI_SOCK_RELEASE} after ${READY_TIMEOUT_MS / 1000} s`);
        await sleep(POLL_MS);
      }
      await sleep(SETTLE_MS);
      if (!alive(pid)) throw new Error("the release app exited while settling");
    },
    lsof: (/** @type {number} */ pid) => ({
      tcp: lsofOutput(run("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-F", "n"], [0, 1])),
      unix: lsofOutput(run("lsof", ["-nP", "-a", "-p", String(pid), "-U", "-F", "n"], [0, 1])),
    }),
    stop: async (/** @type {number} */ pid) => {
      if (!alive(pid)) return;
      process.kill(pid, "SIGTERM");
      const deadline = Date.now() + STOP_TIMEOUT_MS;
      while (alive(pid) && Date.now() < deadline) await sleep(POLL_MS);
      if (alive(pid)) process.kill(pid, "SIGKILL");
      const killDeadline = Date.now() + STOP_TIMEOUT_MS;
      while (alive(pid) && Date.now() < killDeadline) await sleep(POLL_MS);
      if (alive(pid)) throw new Error(`the release app (pid ${pid}) did not exit after SIGKILL`);
      if (isSocket(SI_SOCK_RELEASE)) fs.unlinkSync(SI_SOCK_RELEASE);
    },
    listRun: (/** @type {string} */ dir) => walk(dir),
    removeRun: (/** @type {string} */ dir) => {
      if (path.dirname(dir) !== tmpRoot || !path.basename(dir).startsWith(RUN_PREFIX)) {
        throw new Error(`refusing to remove ${dir}: not a release-clean run dir`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
