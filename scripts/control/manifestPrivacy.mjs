/**
 * Purpose: The build manifest's privacy check (`assertNoPrivateData`) and the
 * leaf pieces the manifest module shares with it: the single `ManifestError`
 * class, the hex predicates and `isPlainObject`.
 *
 * Pipeline:
 *   assertNoPrivateData(m, ctx) → ctx strings validated (trailing `/` trimmed)
 *                                 → walk every leaf, tracking its `keyPath`
 *                                 → hash fields: hex predicate; other string leaves: no rooted
 *                                   path, home dir, repo root or user name
 *
 * Key decisions:
 * - This module is a leaf: it imports nothing from `manifest.mjs`, which imports
 *   it and re-exports `assertNoPrivateData` and `ManifestError`. One class and one
 *   function exist, so `instanceof` and identity hold on either import path.
 * - Hash-typed fields are skipped only after checking they are hex, so a short user
 *   name such as `ab` cannot false-trip on a digest and a hash field cannot smuggle
 *   a path.
 * - The user name matches as a case-insensitive whole token: bounded by start/end
 *   or a non-alphanumeric character. It fails closed. Known collision (C3): a user
 *   name that is a common word (`app`, `release`, `macos`, `bundle`, `tauri`) can
 *   match a fixed value such as the bundle path or the `tauri_app-…` codesign
 *   identifier, and the build is refused. The error says so, so the cause is
 *   findable without the message repeating the name.
 * - Every error starts `assertNoPrivateData: <fieldPath>` (the `keyPath` form:
 *   `codesign.identifier`, `features[1]`, `versions["@tauri-apps/cli"][0]`) and never
 *   repeats the rejected value, the user name, the home directory or the repo root.
 *
 * @module scripts/control/manifestPrivacy
 * @coordinates-with scripts/control/manifest.mjs (re-exports assertNoPrivateData and
 *   ManifestError; imports the hex predicates and isPlainObject)
 * @coordinates-with scripts/control/build.mjs (calls assertNoPrivateData via manifest.mjs)
 */

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const SHA1_OR_256_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Hash-typed fields: path → [hex predicate, may be null]. */
const HASH_FIELDS = Object.freeze({
  buildId: [SHA256_RE, false],
  sourceTree: [SHA1_OR_256_RE, false],
  commit: [SHA1_OR_256_RE, true],
  sidecarSha256: [SHA256_RE, false],
  distSha256: [SHA256_RE, false],
  mainBinarySha256: [SHA256_RE, false],
  "codesign.cdhash": [SHA1_OR_256_RE, false],
});

/** Thrown for any invalid manifest, private value or failed write; the message names the field. */
export class ManifestError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ManifestError";
  }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
export const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** @param {string} prefix @param {string} key */
const keyPath = (prefix, key) =>
  /^[A-Za-z_$][\w$]*$/.test(key) ? (prefix === "" ? key : `${prefix}.${key}`) : `${prefix}[${JSON.stringify(key)}]`;

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {unknown} v @param {string} field @returns {string} */
function ctxString(v, field) {
  if (typeof v !== "string" || v.replace(/\/+$/, "") === "") {
    throw new ManifestError(`assertNoPrivateData: ${field} must be a non-empty string`);
  }
  return v.replace(/\/+$/, "");
}

/** Explains the user-name match without naming the user (C3). */
const USER_NAME_MATCH =
  "contains the account user name as a whole token (case-insensitive, bounded by non-alphanumerics); " +
  "a user name that is a common word can collide with a fixed value such as the bundle path " +
  "or the tauri_app-… codesign identifier";

/**
 * Throw if the manifest records anything private.
 *
 * @param {unknown} manifest
 * @param {{ repoRoot: string, homeDir: string, userName: string }} ctx
 * @throws {ManifestError} starting `assertNoPrivateData: <fieldPath>` (never the value) when a
 *   hash field is not hex, or a non-hash string leaf starts with `/` or `~`, contains `homeDir`
 *   or `repoRoot`, or has `userName` as a case-insensitive whole token
 */
export function assertNoPrivateData(manifest, ctx) {
  const repoRoot = ctxString(ctx?.repoRoot, "repoRoot");
  const homeDir = ctxString(ctx?.homeDir, "homeDir");
  const userName = ctxString(ctx?.userName, "userName");
  const userRe = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(userName)}(?:$|[^A-Za-z0-9])`, "i");

  /** @param {unknown} v @param {string} at */
  const walk = (v, at) => {
    if (Object.hasOwn(HASH_FIELDS, at)) {
      const [re, nullable] = HASH_FIELDS[/** @type {keyof typeof HASH_FIELDS} */ (at)];
      if (v === undefined || (v === null && nullable)) return;
      if (typeof v !== "string" || !re.test(v)) {
        throw new ManifestError(`assertNoPrivateData: ${at} is a hash field but is not lowercase hex`);
      }
      return;
    }
    if (typeof v === "string") {
      if (v.startsWith("/") || v.startsWith("~")) {
        throw new ManifestError(`assertNoPrivateData: ${at} is a rooted or home-relative path`);
      }
      if (v.includes(homeDir) || v.includes(repoRoot)) {
        throw new ManifestError(`assertNoPrivateData: ${at} contains the home directory or the repo root`);
      }
      if (userRe.test(v)) throw new ManifestError(`assertNoPrivateData: ${at} ${USER_NAME_MATCH}`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${at}[${i}]`));
    } else if (v !== null && typeof v === "object") {
      for (const [k, item] of Object.entries(v)) walk(item, keyPath(at, k));
    }
  };
  if (!isPlainObject(manifest)) throw new ManifestError("assertNoPrivateData: manifest must be a plain object");
  walk(manifest, "");
}
