/**
 * Purpose: Build and validate the updater manifest `latest.json` (D76-WI-3,
 * requirement ③), and take its `notes` from the CHANGELOG. Pure.
 *
 * Pipeline:
 *   buildLatestJson({ repo, version, notes, pubDate, sigs })
 *     → { version, notes, pub_date, platforms: { <required platform>: { signature, url } } }
 *   validateLatestJson(json, { repo, version, files }) → { ok, errors }
 *   changelogNotes(text, version)  → body of `## [<version>]`, or null
 *   resolveNotes({ changelog, version, mode }) → { notes, errors, warnings }
 *
 * Key decisions:
 * - URLs are constructed from the final tag,
 *   `https://github.com/<repo>/releases/download/v<version>/<name>`, and never
 *   read back from GitHub: a draft's asset URLs use an `untagged-…` path and
 *   go stale on publish (plan §0.3). The validator also names `untagged-`
 *   explicitly so that failure is recognisable.
 * - `platforms` is exactly REQUIRED_PLATFORMS (D-3): Windows/Linux installers
 *   are never offered to the updater.
 * - `signature` is the `.sig` file's text minus one trailing newline; nothing
 *   else is normalised, so a validator compare is byte-exact.
 * - `pub_date` is ISO 8601 UTC without milliseconds (the v0.2.6 form).
 * - A missing CHANGELOG section is an error in `draft` mode (users would get
 *   an empty About pane) and a warning with `notes: ""` otherwise.
 *
 * @module scripts/release/latestJson
 * @coordinates-with scripts/release/assetNames.mjs (REQUIRED_PLATFORMS, archive names)
 * @coordinates-with scripts/release/verify-assets.mjs (writes latest.json)
 */
import { REQUIRED_PLATFORMS, platformSpec } from "./assetNames.mjs";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** @param {string} platform @param {string} version */
export const updaterArchiveName = (platform, version) =>
  /** @type {{final: (v: string) => string}} */ (platformSpec(platform).files.find((f) => f.updater)).final(version);

/** @param {string} repo @param {string} version @param {string} name */
export const releaseAssetUrl = (repo, version, name) =>
  `https://github.com/${repo}/releases/download/v${version}/${name}`;

/** One trailing newline (LF or CRLF) off; nothing else. @param {string} text */
export const sigText = (text) => text.replace(/\r?\n$/, "");

/** @param {unknown} v */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @param {{ repo: string, version: string, notes: string, pubDate: Date | string,
 *           sigs: Record<string, string> }} a
 */
export function buildLatestJson({ repo, version, notes, pubDate, sigs }) {
  if (!REPO_RE.test(repo)) throw new TypeError(`repo ${JSON.stringify(repo)} is not owner/name`);
  const date = pubDate instanceof Date ? pubDate : new Date(pubDate);
  if (Number.isNaN(date.getTime())) throw new TypeError(`pub date ${JSON.stringify(pubDate)} is not a date`);
  /** @type {Record<string, {signature: string, url: string}>} */
  const platforms = {};
  for (const p of REQUIRED_PLATFORMS) {
    if (typeof sigs?.[p] !== "string") throw new TypeError(`no signature for ${p}`);
    platforms[p] = { signature: sigText(sigs[p]), url: releaseAssetUrl(repo, version, updaterArchiveName(p, version)) };
  }
  return { version, notes, pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"), platforms };
}

/**
 * @param {unknown} json
 * @param {{ repo: string, version: string, files: { name: string, data: Buffer | string }[] }} ctx
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateLatestJson(json, { repo, version, files }) {
  /** @type {string[]} */
  const errors = [];
  const done = () => ({ ok: errors.length === 0, errors });
  if (!isObj(json)) {
    errors.push("latest.json is not an object");
    return done();
  }
  const j = /** @type {Record<string, any>} */ (json);
  if (j.version !== version) errors.push(`latest.json version ${JSON.stringify(j.version)} ≠ ${version}`);
  if (typeof j.notes !== "string") errors.push("latest.json notes is not a string");
  if (typeof j.pub_date !== "string" || !ISO_UTC.test(j.pub_date) || Number.isNaN(Date.parse(j.pub_date))) {
    errors.push(`latest.json pub_date ${JSON.stringify(j.pub_date)} is not ISO 8601 UTC`);
  }
  if (!isObj(j.platforms)) {
    errors.push("latest.json platforms is not an object");
    return done();
  }
  for (const key of Object.keys(j.platforms)) {
    if (!REQUIRED_PLATFORMS.includes(key)) errors.push(`latest.json has an unsupported platform ${key}`);
  }
  for (const p of REQUIRED_PLATFORMS) {
    const entry = j.platforms[p];
    if (!isObj(entry)) {
      errors.push(`latest.json is missing platform ${p}`);
      continue;
    }
    const name = updaterArchiveName(p, version);
    const want = releaseAssetUrl(repo, version, name);
    if (typeof entry.url === "string" && entry.url.includes("untagged-")) {
      errors.push(`${p}: url ${entry.url} is a draft's untagged- URL, not the final tag's`);
    } else if (entry.url !== want) {
      errors.push(`${p}: url ${JSON.stringify(entry.url)} ≠ ${want}`);
    }
    const sigFile = files.find((f) => f.name === `${name}.sig`);
    if (typeof entry.signature !== "string" || entry.signature === "") {
      errors.push(`${p}: empty signature`);
    } else if (!sigFile) {
      errors.push(`${p}: no ${name}.sig in the asset set to compare the signature with`);
    } else if (entry.signature !== sigText(Buffer.from(sigFile.data).toString("utf8"))) {
      errors.push(`${p}: signature does not match ${name}.sig`);
    }
  }
  return done();
}

/**
 * @param {unknown} text CHANGELOG.md contents
 * @param {string} version
 * @returns {string | null}
 */
export function changelogNotes(text, version) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  const head = `## [${version}]`;
  const start = lines.findIndex((l) => l === head || l.startsWith(`${head} `));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body.replace(/\n*-{3,}\s*$/, "").trim();
}

/**
 * @param {{ changelog: unknown, version: string, mode: string }} a
 * @returns {{ notes: string, errors: string[], warnings: string[] }}
 */
export function resolveNotes({ changelog, version, mode }) {
  const notes = changelogNotes(changelog, version);
  if (notes !== null) return { notes, errors: [], warnings: [] };
  const msg = `CHANGELOG.md has no "## [${version}]" section for the release notes`;
  return mode === "draft"
    ? { notes: "", errors: [msg], warnings: [] }
    : { notes: "", errors: [], warnings: [`${msg}; notes left empty`] };
}
