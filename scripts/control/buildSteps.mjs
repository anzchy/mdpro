/**
 * Purpose: The fixed names and small filesystem steps `build.mjs` composes:
 * where each profile builds, the child environments and command lines of the
 * three tools, the sidecar placeholder and copy, and the "binary embeds the
 * buildId" check. No child process is started here.
 *
 * Pipeline (one call each, in `runBuild`'s order):
 *   buildLayout(repoRoot, profile)   → every path the entry reads or writes
 *   childEnv(callerEnv, layout)      → caller env with CARGO_TARGET_DIR per profile
 *   sidecarCommand / tauriCommand / codesignCommand → [cmd, args]
 *   ensurePlaceholder(dest)          → empty file when absent (as release.yml does)
 *   copyIfDifferent(src, dest)       → bytes replaced only when they differ
 *   embedsId(binary, buildId)        → the ASCII id occurs in the binary's bytes
 *   redactPaths(text, ctx)           → repo root → `.`, home → `~`, for CLI output
 *
 * Key decisions (ADR-0047 plan WI-10, decisions O1-O3):
 * - `release` builds under `src-tauri/target` and removes a caller's
 *   `CARGO_TARGET_DIR`; `verify` builds under `src-tauri/target/verify` and sets
 *   it, for the sidecar and the app build alike, so a profile never picks up the
 *   other's sidecar. Nothing else in the caller's environment is changed here;
 *   `MDPRO_BUILD_ID` is removed for the sidecar and set for the app by the caller.
 * - The sidecar copy compares bytes first, so an unchanged sidecar keeps its
 *   mtime and does not make cargo or tauri think the bundle input changed.
 * - The embed check looks for the full 64-character id, never a prefix or "any
 *   hex string", so a binary cargo did not relink (still carrying the previous
 *   build's id) fails.
 *
 * @module scripts/control/buildSteps
 * @coordinates-with scripts/control/build.mjs (runBuild)
 */
import fs from "node:fs";
import path from "node:path";
import { MANIFEST_FILE } from "./manifest.mjs";

/** The sidecar's cargo binary name. */
export const SIDECAR_BIN = "mdpro_mcp";
/** Where the bundle takes the sidecar from (tauri's `externalBin` + target triple). */
export const SIDECAR_DEST_REL = ["src-tauri", "binaries", "mdpro_mcp-aarch64-apple-darwin"];
/** Overlay config the `verify` profile needs; added by WI-002. */
export const VERIFY_OVERLAY_REL = ["src-tauri", "tauri.verify.conf.json"];
export const CARGO_MANIFEST_REL = "src-tauri/Cargo.toml";
const TARGET_REL = ["src-tauri", "target"];
const VERIFY_TARGET_SUBDIR = "verify";
const BUNDLE_SUBDIR = ["release", "bundle", "macos"];
const APP_NAME = "mdpro.app";
const MAIN_BINARY_REL = ["Contents", "MacOS", "tauri-app"];
const DIST_DIR = "dist";
/** `--config` value for the app build: no updater artifacts, so no signing key is needed. */
export const NO_UPDATER_CONFIG = JSON.stringify({ bundle: { createUpdaterArtifacts: false } });

/**
 * @typedef {{ targetDir: string, bundleDir: string, manifestPath: string, app: string,
 *   mainBinary: string, builtSidecar: string, sidecarDest: string, overlay: string,
 *   dist: string, profile: "release" | "verify" }} BuildLayout
 */

/**
 * Every path one profile's build reads or writes.
 * @param {string} repoRoot absolute
 * @param {"release" | "verify"} profile
 * @returns {BuildLayout}
 */
export function buildLayout(repoRoot, profile) {
  const base = path.join(repoRoot, ...TARGET_REL);
  const targetDir = profile === "verify" ? path.join(base, VERIFY_TARGET_SUBDIR) : base;
  const bundleDir = path.join(targetDir, ...BUNDLE_SUBDIR);
  const app = path.join(bundleDir, APP_NAME);
  return {
    profile,
    targetDir,
    bundleDir,
    manifestPath: path.join(bundleDir, MANIFEST_FILE),
    app,
    mainBinary: path.join(app, ...MAIN_BINARY_REL),
    builtSidecar: path.join(targetDir, "release", SIDECAR_BIN),
    sidecarDest: path.join(repoRoot, ...SIDECAR_DEST_REL),
    overlay: path.join(repoRoot, ...VERIFY_OVERLAY_REL),
    dist: path.join(repoRoot, DIST_DIR),
  };
}

/**
 * The caller's environment with `CARGO_TARGET_DIR` fixed for the profile (O3).
 * @param {NodeJS.ProcessEnv} callerEnv
 * @param {BuildLayout} layout
 * @returns {NodeJS.ProcessEnv} a copy; the caller's object is not changed
 */
export function childEnv(callerEnv, layout) {
  const env = { ...callerEnv };
  if (layout.profile === "verify") env.CARGO_TARGET_DIR = layout.targetDir;
  else delete env.CARGO_TARGET_DIR;
  return env;
}

/** @param {string[]} features @returns {string[]} */
const featureArgs = (features) => (features.length > 0 ? ["--features", features.join(",")] : []);

/** @param {string[]} features @returns {[string, string[]]} */
export function sidecarCommand(features) {
  return [
    "cargo",
    ["build", "--release", "--bin", SIDECAR_BIN, "--manifest-path", CARGO_MANIFEST_REL, ...featureArgs(features)],
  ];
}

/**
 * The app build. The `verify` overlay is NOT passed yet: adding it as a second
 * `--config` belongs to WI-002, which also creates the file.
 * @param {string[]} features
 * @returns {[string, string[]]}
 */
export function tauriCommand(features) {
  return ["pnpm", ["tauri", "build", "--bundles", "app", "--config", NO_UPDATER_CONFIG, ...featureArgs(features)]];
}

/** @param {string} app absolute path of the `.app` @returns {[string, string[]]} */
export function codesignCommand(app) {
  return ["codesign", ["-dvvv", app]];
}

/**
 * Create an empty file at `dest` when nothing is there, matching `release.yml`:
 * tauri refuses to build when an `externalBin` is absent.
 * @param {string} dest
 * @returns {boolean} whether a placeholder was created
 */
export function ensurePlaceholder(dest) {
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, "", { mode: 0o755 });
  return true;
}

/**
 * Copy `src` over `dest` only when the bytes differ; identical bytes leave
 * `dest` untouched, mtime included.
 * @param {string} src
 * @param {string} dest
 * @returns {boolean} whether `dest` was written
 */
export function copyIfDifferent(src, dest) {
  const next = fs.readFileSync(src);
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(next)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * @param {string} binary
 * @param {string} buildId 64-char lowercase hex
 * @returns {boolean} whether the binary's bytes contain the ASCII id
 */
export function embedsId(binary, buildId) {
  return fs.readFileSync(binary).includes(Buffer.from(buildId, "ascii"));
}

/**
 * A path relative to the repo, in posix form, for messages.
 * @param {string} repoRoot
 * @param {string} p
 */
export function repoRelative(repoRoot, p) {
  return path.relative(repoRoot, p).split(path.sep).join("/");
}

/** @param {string} p @returns {string} `p` without trailing slashes (`/` becomes `""`) */
const stripTrailingSlashes = (p) => p.replace(/\/+$/, "");

/**
 * Replace this machine's repo root (with `.`) and home directory (with `~`) in
 * a message, so CLI output carries no absolute path of its own making.
 *
 * Law (ADR-0047 WI-14, decisions O18-O19):
 * - The output contains no `repoRoot`, and no `homeDir` unless `homeDir` is
 *   `/` or `""` (then home is not replaced at all).
 * - It is idempotent: `redactPaths(redactPaths(t)) === redactPaths(t)`.
 * - Text containing neither path is returned unchanged.
 * - Trailing slashes on either path are ignored: `/h/u/` redacts `/h/u`, and a
 *   `homeDir` of only slashes counts as `/`.
 *
 * A replacement can join its neighbours into a new occurrence of either path
 * (root `/a.b` in `/a/a.bb`; home `/h` turning `/r/hs` into the root `/r~s`),
 * so both replacements loop together until a full pass changes nothing. That
 * always ends: each replacement swaps a path of two or more characters for one.
 * A `repoRoot` of `/` is out of domain. Home inside the repo root leaves the
 * user segment as `./u/…` (O18); neither full path remains.
 * @param {string} text
 * @param {{ repoRoot: string, homeDir: string }} ctx
 * @returns {string}
 */
export function redactPaths(text, { repoRoot, homeDir }) {
  const root = stripTrailingSlashes(repoRoot);
  const home = stripTrailingSlashes(homeDir ?? "");
  let out = text;
  let prev;
  do {
    prev = out;
    if (root) out = out.split(root).join(".");
    if (home) out = out.split(home).join("~");
  } while (out !== prev);
  return out;
}
