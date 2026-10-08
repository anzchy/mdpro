/**
 * Purpose: The entry of `pnpm control:build` (ADR-0047). `runBuild` builds the
 * sidecar and the `.app` with a `buildId` compiled in, checks that the binary
 * really carries that id, and writes `build-manifest.json` next to the `.app`.
 * The CLI shim at the bottom runs it with the real `spawnSync`.
 *
 * Pipeline (plan WI-10 with decisions O1-O3):
 *   parse argv (`--help` → done, nothing touched)
 *   → delete this profile's existing manifest (every later failure leaves none)
 *   → `verify` without `src-tauri/tauri.verify.conf.json` → fail (the overlay, WI-002)
 *   → sourceTree (before) → placeholder `binaries/` sidecar if absent
 *   → cargo build the sidecar (no MDPRO_BUILD_ID) → copy into `binaries/` if bytes differ
 *   → sha256 sidecar → buildId → `pnpm tauri build` with MDPRO_BUILD_ID=buildId
 *     (`verify`: + `--config` overlay and the `verify-run` feature)
 *   → sourceTree (after) must equal before → main binary must embed buildId
 *   → codesign / digests / versions / HEAD → assemble → privacy check → write
 *
 * Key decisions:
 * - `run(cmd, args, { cwd, env, capture })` is injected and synchronous; it
 *   returns `{ status, stdout, stderr }` and any status but 0 (null included)
 *   fails the build. Only codesign is captured; its report is read from stderr.
 * - The child environment is the caller's, read at call time, except
 *   `CARGO_TARGET_DIR` (set for `verify`, removed for `release`) and
 *   `MDPRO_BUILD_ID` (removed for the sidecar, set for the app): the sidecar
 *   must not depend on the id it is an input to.
 * - The manifest is deleted before any check and written only after every
 *   check, so a failed or interrupted build never leaves a manifest, stale or new.
 * - Every failure rejects with `BuildError` (argument errors stay
 *   `BuildArgsError`); the first line of the message is the reason. Nothing is
 *   printed by `runBuild`; progress goes to the optional `log`.
 * - `buildId` and the manifest's `features` take the user's feature list; the
 *   `verify-run` feature the verify profile adds is implied by `profile`,
 *   which is already hashed. Arguments are parsed before anything on disk is
 *   touched, so an argument error (a user `verify-run` included) leaves even a
 *   stale manifest in place (matrix F5).
 * - The whole manifest goes through `assertNoPrivateData` before it is written,
 *   not just the codesign fields.
 * - `spawnTool`, the real `run`, is exported only for its tests; a spawn error
 *   always wins its `stderr`, so a missing tool is named in the failure reason.
 *
 * @module scripts/control/build
 * @coordinates-with scripts/control/buildSteps.mjs (paths, commands, copy, embed check)
 * @coordinates-with scripts/control/args.mjs (parseBuildArgs, USAGE)
 * @coordinates-with scripts/control/sourceTree.mjs (computeSourceTree, headCommit)
 * @coordinates-with scripts/control/manifest.mjs (assemble, privacy check, write)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USAGE, parseBuildArgs } from "./args.mjs";
import { computeBuildId } from "./buildId.mjs";
import {
  VERIFY_OVERLAY_REL,
  buildLayout,
  childEnv,
  codesignCommand,
  copyIfDifferent,
  embedsId,
  ensurePlaceholder,
  redactPaths,
  repoRelative,
  sidecarCommand,
  tauriCommand,
} from "./buildSteps.mjs";
import { digestDir, parseCodesign, sha256File } from "./digests.mjs";
import { assembleManifest, assertNoPrivateData, writeManifest } from "./manifest.mjs";
import { computeSourceTree, headCommit } from "./sourceTree.mjs";
import { collectVersions } from "./versions.mjs";

/** Thrown for every build failure; the message's first line is the reason. */
export class BuildError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = "BuildError";
  }
}

/**
 * @typedef {{ status: number | null, stdout?: string, stderr?: string }} RunResult
 * @typedef {(cmd: string, args: string[], opts: { cwd: string, env: NodeJS.ProcessEnv,
 *   capture: boolean }) => RunResult} Run
 */

/** @param {unknown} e */
const reasonOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Run one step that is not a child process, turning its error into a `BuildError`.
 * @template T
 * @param {string} label
 * @param {() => T} fn
 * @returns {Promise<Awaited<T>>}
 */
async function step(label, fn) {
  try {
    return await fn();
  } catch (e) {
    throw new BuildError(`${label}: ${reasonOf(e)}`, { cause: e });
  }
}

/**
 * Run one tool through the injected spawner; a non-zero or null status fails.
 * @param {Run} run
 * @param {string} what human name of the step, used in the failure reason
 * @param {[string, string[]]} command
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, capture: boolean }} opts
 * @returns {RunResult}
 */
function runTool(run, what, [cmd, args], opts) {
  const result = run(cmd, args, opts);
  if (!result || result.status !== 0) {
    const status = result ? result.status : null;
    // Uncaptured tools already printed their own output; a spawn failure arrives in stderr.
    const firstLine = String(result?.stderr ?? "").trim().split("\n")[0];
    const tail = firstLine ? `: ${firstLine}` : "";
    throw new BuildError(`${what} failed (${cmd} exited with status ${status})${tail}`);
  }
  return result;
}

/**
 * Build the sidecar and the app for one profile and write its manifest.
 *
 * @param {{ repoRoot: string, argv: string[], run: Run, log?: (line: string) => void }} options
 *   `repoRoot` must be absolute.
 * @returns {Promise<{ help: true } | { manifest: object, manifestPath: string }>}
 * @throws {import("./args.mjs").BuildArgsError} for invalid arguments
 * @throws {BuildError} for every other failure; no manifest exists for the profile afterwards
 */
export async function runBuild({ repoRoot, argv, run, log = () => {} }) {
  const args = parseBuildArgs(argv);
  if ("help" in args) return { help: true };
  const { profile, features } = args;
  const layout = buildLayout(repoRoot, profile);
  const rel = (/** @type {string} */ p) => repoRelative(repoRoot, p);

  // O1: the old manifest goes first, so every failure below leaves none.
  await step("removing the previous manifest", () => fs.rmSync(layout.manifestPath, { force: true }));
  if (profile === "verify" && !fs.existsSync(layout.overlay)) {
    throw new BuildError(
      `profile verify needs ${VERIFY_OVERLAY_REL.join("/")} (the verify overlay, ADR-0047 WI-002), ` +
        "which is missing; restore it from git, or build with --profile release.",
    );
  }

  const before = await step("source tree before the build", () => computeSourceTree(repoRoot));
  log(`control:build: profile ${profile}, sourceTree ${before.tree}`);
  if (ensurePlaceholder(layout.sidecarDest)) log(`control:build: created placeholder ${rel(layout.sidecarDest)}`);

  const env = childEnv(process.env, layout);
  const sidecarEnv = { ...env };
  delete sidecarEnv.MDPRO_BUILD_ID;
  log("control:build: building the mdpro_mcp sidecar");
  runTool(run, "sidecar build (mdpro_mcp)", sidecarCommand(features), {
    cwd: repoRoot,
    env: sidecarEnv,
    capture: false,
  });
  const copied = await step("copying the mdpro_mcp sidecar", () => {
    if (!fs.existsSync(layout.builtSidecar)) {
      throw new Error(`the sidecar build left no ${rel(layout.builtSidecar)}`);
    }
    return copyIfDifferent(layout.builtSidecar, layout.sidecarDest);
  });
  log(`control:build: ${rel(layout.sidecarDest)} ${copied ? "updated" : "unchanged"}`);

  const sidecarSha256 = await step("hashing the sidecar", () => sha256File(layout.sidecarDest));
  const buildId = await step("computing buildId", () =>
    computeBuildId({
      sourceTree: before.tree,
      sourceTreeExcludes: before.excludes,
      profile,
      features,
      sidecarSha256,
    }),
  );
  log(`control:build: buildId ${buildId}; building the app`);
  runTool(run, "tauri build", tauriCommand(profile, features), {
    cwd: repoRoot,
    env: { ...env, MDPRO_BUILD_ID: buildId },
    capture: false,
  });

  const after = await step("source tree after the build", () => computeSourceTree(repoRoot));
  if (after.tree !== before.tree) {
    throw new BuildError(
      `source tree changed during build (${before.tree} before, ${after.tree} after); ` +
        "a file was edited while building, or the build wrote into a non-ignored path",
    );
  }
  if (!fs.existsSync(layout.mainBinary)) {
    throw new BuildError(`tauri build left no main binary at ${rel(layout.mainBinary)}`);
  }
  if (!embedsId(layout.mainBinary, buildId)) {
    throw new BuildError(
      `binary does not embed buildId ${buildId}: ${rel(layout.mainBinary)} was not rebuilt with MDPRO_BUILD_ID`,
    );
  }

  const report = runTool(run, "codesign -dvvv", codesignCommand(layout.app), {
    cwd: repoRoot,
    env,
    capture: true,
  });
  const manifest = await step("assembling the manifest", async () =>
    assembleManifest({
      repoRoot,
      buildId,
      sourceTree: before.tree,
      sourceTreeExcludes: before.excludes,
      commit: await headCommit(repoRoot),
      profile,
      features,
      sidecarSha256,
      distSha256: digestDir(layout.dist),
      mainBinarySha256: sha256File(layout.mainBinary),
      versions: collectVersions(repoRoot),
      codesign: parseCodesign(String(report.stderr ?? "")),
      bundle: layout.app,
    }),
  );
  const ctx = { repoRoot, homeDir: os.homedir(), userName: os.userInfo().username };
  await step("privacy check", () => assertNoPrivateData(manifest, ctx));
  const manifestPath = await step("writing the manifest", () => writeManifest(layout.bundleDir, manifest));
  return { manifest, manifestPath };
}

/**
 * The real spawner (a `Run`), exported for its tests. Returns `{ status, stdout, stderr }`.
 * Capture on: the child's stdout and stderr exactly. Capture off: output goes to the
 * terminal and both come back `""`. A spawn error (e.g. a missing command) gives
 * `status: null` and a `stderr` naming the command, whether captured or not.
 * @type {Run}
 */
export function spawnTool(cmd, args, { cwd, env, capture }) {
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const spawnFailure = r.error ? `${cmd}: ${r.error.message}` : "";
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.error ? spawnFailure : (r.stderr ?? "") };
}

/** The CLI: `node scripts/control/build.mjs [--profile …] [--features …] [--help]`. */
async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const homeDir = os.homedir();
  try {
    const result = await runBuild({
      repoRoot,
      argv: process.argv.slice(2),
      run: spawnTool,
      log: (line) => process.stdout.write(`${redactPaths(line, { repoRoot, homeDir })}\n`),
    });
    if ("help" in result) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      const id = /** @type {{ buildId: string }} */ (result.manifest).buildId;
      process.stdout.write(`control:build: buildId ${id} → ${repoRelative(repoRoot, result.manifestPath)}\n`);
    }
    process.exitCode = 0;
  } catch (e) {
    process.stderr.write(`${redactPaths(reasonOf(e), { repoRoot, homeDir })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
