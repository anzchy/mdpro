/**
 * Purpose: Compute the `buildId` — a 64-char lowercase sha256 hex that names
 * one set of build inputs — and reject any input that could make two different
 * builds share an id. Pure: no filesystem, no git, no clock.
 *
 * Pipeline: { sourceTree, sourceTreeExcludes, profile, features, sidecarSha256 }
 *   → validate every field → canonical JSON tuple → sha256 → hex
 *
 * Canonical form (ADR-0047 plan, decision O4), written out literally so a
 * change to it is visible in review:
 *
 *   sha256(utf8(JSON.stringify([
 *     "mdpro-build-id/1", sourceTree, sortedUniqueExcludes,
 *     profile, sortedUniqueFeatures, sidecarSha256,
 *   ])))
 *
 * e.g. ["mdpro-build-id/1","4b825dc6…4904",["**\/*.tsbuildinfo",".claude/","docs/"],"release",[],"e3b0…b855"]
 *
 * Key decisions:
 * - Lists are sorted with the default `Array.prototype.sort()` (UTF-16 code
 *   unit order), never `localeCompare`, so the id does not depend on locale.
 * - The JSON tuple cannot alias: `,`, newline and `"` inside an exclude are
 *   legal because JSON escapes them. Feature names stay strict
 *   (`^[A-Za-z0-9_][A-Za-z0-9_-]*$`) since they are also passed on a cargo
 *   command line, where a leading `-` would read as a flag (WI-19);
 *   `isValidFeatureName` is exported so the argument parser shares it.
 * - `isValidExclude` is exported for the same reason: `computeSourceTree`
 *   validates its excludes with it, so the two units cannot disagree on which
 *   exclude is legal (WI-19).
 * - Hex fields must already be lowercase. Uppercase is rejected, not folded,
 *   so one tree never has two spellings.
 * - The caller's arrays are copied before sorting; inputs are never mutated.
 *
 * @module scripts/control/buildId
 */
import { createHash } from "node:crypto";

const DOMAIN = "mdpro-build-id/1";
const PROFILES = ["release", "verify"];
const FEATURE_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const TREE_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Thrown for any invalid `computeBuildId` input; the message names the field. */
export class BuildIdInputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "BuildIdInputError";
  }
}

/**
 * The feature-name predicate `computeBuildId` enforces: a non-empty string of
 * ASCII letters, digits, `_` and `-` only, not starting with `-`.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidFeatureName(name) {
  return typeof name === "string" && FEATURE_RE.test(name);
}

/**
 * The exclude predicate `computeBuildId` and `computeSourceTree` both enforce:
 * a non-empty string with no leading `/`, no NUL and no `..` path segment.
 * @param {unknown} e
 * @returns {boolean}
 */
export function isValidExclude(e) {
  return (
    typeof e === "string" &&
    e.length > 0 &&
    !e.startsWith("/") &&
    !e.includes("\u0000") &&
    !e.split("/").includes("..")
  );
}

/**
 * @param {string} field
 * @param {unknown} value
 * @param {(item: unknown) => boolean} isValid
 * @param {string} rule
 * @returns {string[]} sorted (code-unit order), de-duplicated copy
 */
function canonicalList(field, value, isValid, rule) {
  if (!Array.isArray(value)) {
    throw new BuildIdInputError(`${field} must be an array, got ${typeof value}`);
  }
  for (const item of value) {
    if (!isValid(item)) {
      throw new BuildIdInputError(`${field} entry ${JSON.stringify(item)} is invalid: ${rule}`);
    }
  }
  return [...new Set(value)].sort();
}

/**
 * Compute the build id for one set of build inputs.
 *
 * @param {{ sourceTree: string, sourceTreeExcludes: string[], profile: "release" | "verify",
 *   features: string[], sidecarSha256: string }} input
 * @returns {string} 64-char lowercase sha256 hex
 * @throws {BuildIdInputError} when any field is invalid; the message names it
 */
export function computeBuildId(input) {
  const { sourceTree, sourceTreeExcludes, profile, features, sidecarSha256 } = input ?? {};
  if (typeof sourceTree !== "string" || !TREE_RE.test(sourceTree)) {
    throw new BuildIdInputError("sourceTree must be 40 or 64 lowercase hex characters");
  }
  const excludes = canonicalList(
    "sourceTreeExcludes",
    sourceTreeExcludes,
    isValidExclude,
    "must be a non-empty relative path with no leading '/', no '..' segment and no NUL",
  );
  if (typeof profile !== "string" || !PROFILES.includes(profile)) {
    throw new BuildIdInputError(`profile must be one of ${PROFILES.join(", ")}`);
  }
  const feats = canonicalList("features", features, isValidFeatureName, `must match ${FEATURE_RE.source}`);
  if (typeof sidecarSha256 !== "string" || !SHA256_RE.test(sidecarSha256)) {
    throw new BuildIdInputError("sidecarSha256 must be 64 lowercase hex characters");
  }
  const canonical = JSON.stringify([DOMAIN, sourceTree, excludes, profile, feats, sidecarSha256]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
