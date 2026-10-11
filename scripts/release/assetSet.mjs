/**
 * Purpose: The verify job's closed-set check over the downloaded build
 * artifacts (D76-WI-3, requirement ③), and the manifest the draft job checks
 * the uploaded draft against (WI-5). Pure: callers pass file bytes.
 *
 * Pipeline:
 *   verifyAssetSet(files, version) → shape → duplicate names → every required
 *     platform's expected files present and non-empty (zero bytes fails,
 *     signed or not, D127-WI-2), signatures non-empty → optional
 *     platforms: each installer and its `.sig` together or not at all → any
 *     other name is unexpected → { ok, errors, signed }
 *   buildManifest(files)           → [{ name, size, sha256 }] sorted by name
 *
 * Key decisions:
 * - The set is closed: a name not produced by `expectedAssets` for this version
 *   is an error, so a stale dmg, a second archive or a stray file cannot ride
 *   along into a release.
 * - "Non-empty" means non-empty after trimming whitespace; whether the bytes
 *   are a valid signature is minisign.mjs's question (WI-4).
 * - `signed` lists every (file, sig) pair that passed, so the signature check
 *   and `latest.json` work from the verified set rather than re-deriving it.
 * - Never throws on malformed input; it reports it.
 *
 * @module scripts/release/assetSet
 * @coordinates-with scripts/release/assetNames.mjs (expected names, D-3 platform sets)
 * @coordinates-with scripts/release/verify-assets.mjs (CLI)
 */
import crypto from "node:crypto";
import { OPTIONAL_PLATFORMS, REQUIRED_PLATFORMS, expectedAssets, platformSpec } from "./assetNames.mjs";

/**
 * @typedef {{ name: string, data: Buffer | string }} AssetFile
 * @typedef {{ platform: string, name: string, sig: string, updater: boolean }} SignedPair
 */

/** @param {unknown} f */
const isFile = (f) =>
  typeof f === "object" && f !== null && typeof (/** @type {any} */ (f).name) === "string" &&
  (Buffer.isBuffer(/** @type {any} */ (f).data) || typeof (/** @type {any} */ (f).data) === "string");

/** @param {Buffer | string | undefined} data */
const isBlank = (data) => data === undefined || Buffer.from(data).toString("utf8").trim() === "";

/** @param {Buffer | string | undefined} data */
const byteLength = (data) => (data === undefined ? 0 : Buffer.byteLength(data));

/**
 * @param {unknown} files
 * @param {string} version X.Y.Z
 * @returns {{ ok: boolean, errors: string[], signed: SignedPair[] }}
 */
export function verifyAssetSet(files, version) {
  /** @type {string[]} */
  const errors = [];
  /** @type {SignedPair[]} */
  const signed = [];
  if (!Array.isArray(files) || !files.every(isFile)) {
    return { ok: false, errors: ["asset list is missing or malformed"], signed };
  }
  /** @type {Map<string, Buffer | string>} */
  const byName = new Map();
  for (const f of /** @type {AssetFile[]} */ (files)) {
    if (byName.has(f.name)) errors.push(`duplicate file ${f.name}`);
    byName.set(f.name, f.data);
  }
  const known = new Set();

  for (const platform of [...REQUIRED_PLATFORMS, ...OPTIONAL_PLATFORMS]) {
    const required = REQUIRED_PLATFORMS.includes(platform);
    for (const n of expectedAssets(platform, version)) known.add(n);
    for (const spec of platformSpec(platform).files) {
      const name = spec.final(version);
      const sig = `${name}.sig`;
      const hasFile = byName.has(name);
      const hasSig = spec.signed && byName.has(sig);
      if (!required && !hasFile && !hasSig) continue;
      if (!hasFile) {
        errors.push(`${platform}: missing ${name}`);
        continue;
      }
      if (byteLength(byName.get(name)) === 0) {
        errors.push(`${platform}: ${name} is empty (0 bytes)`);
        continue;
      }
      if (!spec.signed) continue;
      if (!hasSig) {
        errors.push(`${platform}: missing signature ${sig}`);
      } else if (isBlank(byName.get(sig))) {
        errors.push(`${platform}: empty signature ${sig}`);
      } else {
        signed.push({ platform, name, sig, updater: spec.updater });
      }
    }
  }

  for (const name of byName.keys()) {
    if (!known.has(name)) errors.push(`unexpected file ${name} (not part of the ${version} release set)`);
  }
  return { ok: errors.length === 0, errors, signed };
}

/**
 * @param {AssetFile[]} files
 * @returns {{ name: string, size: number, sha256: string }[]}
 */
export function buildManifest(files) {
  return files
    .map((f) => {
      const data = Buffer.from(f.data);
      return { name: f.name, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
