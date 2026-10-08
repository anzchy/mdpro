/**
 * Purpose: The build manifest (`build-manifest.json`): assemble it from the
 * build's inputs and artifacts, refuse to record anything private, and write it
 * atomically with a canonical byte form.
 *
 * Pipeline:
 *   assembleManifest(inputs)    → closed key set → validate fields → repo-relative bundle
 *                                 → buildId recomputed via computeBuildId and compared
 *   assertNoPrivateData(m, ctx) → re-exported from manifestPrivacy.mjs (see its header)
 *   writeManifest(dir, m)       → keys sorted recursively (O11) → JSON, 2-space indent, one
 *                                 trailing LF → temp file in `dir` → rename
 *
 * Key decisions:
 * - The key set is closed at the top level and inside `versions` (exactly
 *   VERSION_NAMES, plan O8) and `codesign` (the five parseCodesign fields, O7/O14).
 *   An unknown key is rejected, so nothing such as an environment or a token can
 *   ride along (acceptance 4). `repoRoot` is an input only and is never written.
 * - `buildId` must equal `computeBuildId` over the manifest's own fields, so the
 *   assembler cannot produce a self-inconsistent manifest. `features` and
 *   `sourceTreeExcludes` are stored in canonical form (sorted by code unit,
 *   de-duplicated), the form the id hashes.
 * - `bundle` is resolved against `repoRoot` and stored repo-relative in posix
 *   form; a path outside the root, or the root itself, throws. Comparison is by
 *   `path.relative`, not a string prefix, so `<root>-evil/` is outside.
 * - The privacy guard lives in manifestPrivacy.mjs, a leaf module that also owns
 *   the single `ManifestError` class and the hex predicates. This module imports
 *   from it and re-exports `assertNoPrivateData` and `ManifestError` (no wrapper,
 *   no cycle), so `./manifest.mjs` stays a valid import path for both. The guard's
 *   user-name match is a case-insensitive whole token and fails closed; a user name
 *   that is a common word can collide with a fixed value such as the bundle path
 *   or the `tauri_app-…` identifier (C3, documented there).
 * - Error messages name the field path and never repeat the rejected value.
 *
 * @module scripts/control/manifest
 * @coordinates-with scripts/control/manifestPrivacy.mjs (assertNoPrivateData, ManifestError,
 *   hex predicates, isPlainObject)
 * @coordinates-with scripts/control/buildId.mjs (computeBuildId)
 * @coordinates-with scripts/control/versions.mjs (VERSION_NAMES)
 * @coordinates-with scripts/control/digests.mjs (parseCodesign's field set)
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeBuildId } from "./buildId.mjs";
import { ManifestError, SHA1_OR_256_RE, SHA256_RE, isPlainObject } from "./manifestPrivacy.mjs";
import { VERSION_NAMES } from "./versions.mjs";

/** File name the manifest is written under, next to the `.app`. */
export const MANIFEST_FILE = "build-manifest.json";
export const SCHEMA_VERSION = 1;

const INPUT_KEYS = Object.freeze(
  ["repoRoot", "buildId", "sourceTree", "sourceTreeExcludes", "commit", "profile", "features"].concat(
    ["sidecarSha256", "distSha256", "mainBinarySha256", "versions", "codesign", "bundle"],
  ),
);
const CODESIGN_KEYS = Object.freeze(["identifier", "format", "cdhash", "signature", "teamIdentifier"]);

// Re-exported, not wrapped: one class and one function on either import path (WI-20).
export { ManifestError, assertNoPrivateData } from "./manifestPrivacy.mjs";

/**
 * @param {unknown} obj
 * @param {readonly string[]} allowed
 * @param {string} prefix "" at the top level, else "codesign." etc.
 */
function requireExactKeys(obj, allowed, prefix) {
  const where = prefix === "" ? "inputs" : prefix.slice(0, -1);
  if (!isPlainObject(obj)) throw new ManifestError(`assembleManifest: ${where} must be a plain object`);
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ManifestError(`assembleManifest: unknown key ${unknown.map((k) => prefix + k).join(", ")}`);
  }
  const missing = allowed.filter((k) => !Object.hasOwn(obj, k));
  if (missing.length > 0) {
    throw new ManifestError(`assembleManifest: missing key ${missing.map((k) => prefix + k).join(", ")}`);
  }
}

/** @param {string} field @param {unknown} v @param {RegExp} re */
function requireHex(field, v, re) {
  if (typeof v !== "string" || !re.test(v)) {
    throw new ManifestError(`assembleManifest: ${field} must be lowercase hex of the expected length`);
  }
}

/** @param {string} root @param {unknown} bundle @returns {string} */
function relativeBundle(root, bundle) {
  if (typeof bundle !== "string" || bundle === "" || bundle.includes("\u0000")) {
    throw new ManifestError("assembleManifest: bundle must be a non-empty path");
  }
  const rel = path.relative(root, path.resolve(root, bundle));
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new ManifestError("assembleManifest: bundle must be a path strictly inside repoRoot");
  }
  return rel.split(path.sep).join("/");
}

/** @param {unknown} versions @returns {Record<string, string[]>} */
function copyVersions(versions) {
  requireExactKeys(versions, VERSION_NAMES, "versions.");
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const name of VERSION_NAMES) {
    const list = /** @type {Record<string, unknown>} */ (versions)[name];
    if (!Array.isArray(list) || !list.every((v) => typeof v === "string" && v !== "")) {
      throw new ManifestError(`assembleManifest: versions.${name} must be an array of non-empty strings`);
    }
    out[name] = [...list];
  }
  return out;
}

/** @param {unknown} codesign */
function copyCodesign(codesign) {
  requireExactKeys(codesign, CODESIGN_KEYS, "codesign.");
  const c = /** @type {Record<string, unknown>} */ (codesign);
  requireHex("codesign.cdhash", c.cdhash, SHA1_OR_256_RE);
  for (const k of ["identifier", "format", "signature", "teamIdentifier"]) {
    const nullable = k === "signature" || k === "teamIdentifier";
    if ((c[k] !== null || !nullable) && (typeof c[k] !== "string" || c[k] === "")) {
      throw new ManifestError(`assembleManifest: codesign.${k} must be a non-empty string${nullable ? " or null" : ""}`);
    }
  }
  return Object.fromEntries(CODESIGN_KEYS.map((k) => [k, c[k]]));
}

/**
 * Assemble the closed-schema manifest.
 *
 * @param {{ repoRoot: string, buildId: string, sourceTree: string, sourceTreeExcludes: string[],
 *   commit: string | null, profile: "release" | "verify", features: string[], sidecarSha256: string,
 *   distSha256: string, mainBinarySha256: string, versions: Record<string, string[]>,
 *   codesign: import("./digests.mjs").CodesignInfo, bundle: string }} inputs
 *   `bundle` may be absolute or relative to `repoRoot`; `repoRoot` must be absolute.
 * @returns {object} the 14-field manifest (`schemaVersion: 1`, `updaterArtifacts: false`,
 *   repo-relative `bundle`, canonical `features` and `sourceTreeExcludes`)
 * @throws {ManifestError} on an unknown or missing key, an invalid field, a bundle outside
 *   the root, or a `buildId` that disagrees with the fields; the message names the field
 */
export function assembleManifest(inputs) {
  requireExactKeys(inputs, INPUT_KEYS, "");
  const x = /** @type {Record<string, any>} */ (inputs);
  if (typeof x.repoRoot !== "string" || !path.isAbsolute(x.repoRoot)) {
    throw new ManifestError("assembleManifest: repoRoot must be an absolute path");
  }
  if (x.commit !== null) requireHex("commit", x.commit, SHA1_OR_256_RE);
  requireHex("distSha256", x.distSha256, SHA256_RE);
  requireHex("mainBinarySha256", x.mainBinarySha256, SHA256_RE);
  const versions = copyVersions(x.versions);
  const codesign = copyCodesign(x.codesign);
  const bundle = relativeBundle(path.resolve(x.repoRoot), x.bundle);

  const { sourceTree, sourceTreeExcludes, profile, features, sidecarSha256 } = x;
  let expectedId;
  try {
    expectedId = computeBuildId({ sourceTree, sourceTreeExcludes, profile, features, sidecarSha256 });
  } catch (e) {
    // computeBuildId's messages start with the field name but may quote the value; keep the name only.
    const field = /^(\w+)/.exec(e instanceof Error ? e.message : "")?.[1] ?? "buildId input";
    throw new ManifestError(`assembleManifest: ${field} is not a valid buildId input`);
  }
  if (x.buildId !== expectedId) {
    throw new ManifestError("assembleManifest: buildId does not match computeBuildId over the manifest's fields");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    buildId: expectedId,
    sourceTree: x.sourceTree,
    sourceTreeExcludes: [...new Set(/** @type {string[]} */ (x.sourceTreeExcludes))].sort(),
    commit: x.commit,
    profile: x.profile,
    features: [...new Set(/** @type {string[]} */ (x.features))].sort(),
    sidecarSha256: x.sidecarSha256,
    distSha256: x.distSha256,
    mainBinarySha256: x.mainBinarySha256,
    versions,
    codesign,
    updaterArtifacts: false,
    bundle,
  };
}

/** @param {unknown} v @returns {unknown} */
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === "object") {
    const o = /** @type {Record<string, unknown>} */ (v);
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeysDeep(o[k])]));
  }
  return v;
}

/**
 * Write `build-manifest.json` into `dir` atomically: a temp file in the same
 * directory, then rename over the target. No temp file survives, on success or failure.
 *
 * @param {string} dir existing directory
 * @param {object} manifest
 * @returns {string} the path written, `path.join(dir, MANIFEST_FILE)`
 * @throws {ManifestError} when the manifest is not a plain object or the write fails
 *   (the message carries the error code, not the path)
 */
export function writeManifest(dir, manifest) {
  if (!isPlainObject(manifest)) throw new ManifestError("writeManifest: manifest must be a plain object");
  const text = `${JSON.stringify(sortKeysDeep(manifest), null, 2)}\n`;
  const target = path.join(dir, MANIFEST_FILE);
  const tmp = path.join(dir, `.${MANIFEST_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { flag: "wx" });
    fs.renameSync(tmp, target);
  } catch (e) {
    // `force` ignores ENOENT (nothing was created); any other cleanup error must not mask `e`.
    try { fs.rmSync(tmp, { force: true }); } catch { /* the original failure is what matters */ }
    const code = /** @type {{ code?: unknown }} */ (e)?.code;
    throw new ManifestError(`writeManifest: cannot write ${MANIFEST_FILE} (${typeof code === "string" ? code : "error"})`);
  }
  return target;
}
