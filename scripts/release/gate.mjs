/**
 * Purpose: The release workflow's decision points (D76-WI-5, revised by
 * ADR-0073 auto-publish): whether to create a draft, whether the uploaded
 * draft matches the verified manifest, whether a draft may be published, and
 * whether a release found on GitHub is the draft this run created. Pure
 * functions plus a thin CLI the workflow calls.
 *
 * Pipeline (release.yml):
 *   draft job   → `gate.mjs decide` (exit 0 ⇒ create the draft) → upload →
 *                 `gate.mjs post-upload` (draft assets = manifest.json, plus
 *                 manifest.json itself when it was uploaded — manifestWithSelf)
 *   publish job → verify-release.mjs (uses checkDraftRelease) →
 *                 `gate.mjs may-publish` (exit 0 ⇒ the one publish call in the YAML)
 *
 * Key decisions:
 * - Fail closed everywhere: flags must be strictly `true` / `false`, unknown
 *   modes and malformed input refuse, nothing throws.
 * - `decide` re-checks `publishedForTag` right before creation, though WI-1
 *   already checked it at preflight: time passes between the two.
 * - A rehearsal draft gets `rehearsal-d76-<sha7>`, never a v* tag, and
 *   `mayPublish` refuses every mode but `draft` (D-7).
 * - The publish call itself is never in a script; it lives in the workflow,
 *   after `may-publish` exits 0.
 *
 * @module scripts/release/gate
 * @coordinates-with scripts/release/verify-release.mjs (checkDraftRelease)
 * @coordinates-with scripts/release/verify-assets.mjs (writes manifest.json)
 * @coordinates-with .github/workflows/release.yml (jobs draft, publish)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STRICT_VERSION } from "./sourceCheck.mjs";

export const DRAFT_MODES = Object.freeze(["draft", "rehearsal-draft"]);
export const REHEARSAL_PREFIX = "rehearsal-d76-";
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** @param {unknown} v */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** `vX.Y.Z` with no prefix, suffix or leading zeros. @param {unknown} tag */
export const isReleaseTag = (tag) => typeof tag === "string" && tag.startsWith("v") && STRICT_VERSION.test(tag.slice(1));

/** @param {unknown} sha */
export const isFullSha = (sha) => typeof sha === "string" && FULL_SHA.test(sha);

/**
 * @param {{ mode?: unknown, verifyOk?: unknown, source?: any, publishedForTag?: unknown }} a
 * @returns {{ createDraft: boolean, draftTag: string | null, reason?: string }}
 */
export function decide({ mode, verifyOk, source, publishedForTag } = {}) {
  const no = (/** @type {string} */ reason) => ({ createDraft: false, draftTag: null, reason });
  if (typeof mode !== "string" || !DRAFT_MODES.includes(mode)) return no(`mode ${JSON.stringify(mode)} creates no draft`);
  if (verifyOk !== true) return no("the verify job did not pass");
  if (!isObj(source) || source.ok !== true) return no("the source check did not pass");
  if (!isFullSha(source.sha)) return no("the source check gave no full SHA");
  if (publishedForTag !== false) return no("a published release may already exist for the tag");
  if (mode === "rehearsal-draft") return { createDraft: true, draftTag: `${REHEARSAL_PREFIX}${source.sha.slice(0, 7)}` };
  if (!isReleaseTag(source.tag)) return no(`source tag ${JSON.stringify(source.tag)} is not vX.Y.Z`);
  return { createDraft: true, draftTag: source.tag };
}

/**
 * The uploaded draft's assets against the verified manifest: same names, same
 * sizes, and the same sha256 wherever the API reports a `digest`.
 * @param {{ manifest?: unknown, draftAssets?: unknown }} a
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function postUpload({ manifest, draftAssets } = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!Array.isArray(manifest) || !Array.isArray(draftAssets) || manifest.length === 0) {
    return { ok: false, errors: ["manifest or draft asset list is missing, malformed or empty"] };
  }
  const want = new Map(manifest.filter(isObj).map((e) => [e.name, e]));
  if (want.size !== manifest.length) errors.push("manifest has malformed or duplicate entries");
  const seen = new Set();
  for (const a of draftAssets) {
    if (!isObj(a) || typeof a.name !== "string") {
      errors.push("draft has a malformed asset entry");
      continue;
    }
    if (seen.has(a.name)) errors.push(`draft has ${a.name} twice`);
    seen.add(a.name);
    const m = want.get(a.name);
    if (!m) {
      errors.push(`draft has unexpected asset ${a.name}`);
      continue;
    }
    if (a.size !== m.size) errors.push(`${a.name}: draft size ${a.size} ≠ manifest ${m.size}`);
    if (a.digest !== undefined && a.digest !== null) {
      const ok = typeof m.sha256 === "string" && SHA256.test(m.sha256) && a.digest === `sha256:${m.sha256}`;
      if (!ok) errors.push(`${a.name}: draft digest ${JSON.stringify(a.digest)} ≠ sha256:${m.sha256}`);
    }
  }
  for (const name of want.keys()) if (!seen.has(name)) errors.push(`draft is missing ${name}`);
  return { ok: errors.length === 0, errors };
}

/**
 * `manifest.json` lists every release file but itself; when it is uploaded too,
 * its expected entry is its own size and sha256 (GitHub reports a digest for
 * every asset). A non-array manifest is returned unchanged, so postUpload fails it.
 * @param {unknown} entries parsed manifest.json
 * @param {Buffer} bytes manifest.json's bytes
 */
export function manifestWithSelf(entries, bytes) {
  if (!Array.isArray(entries)) return entries;
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return [...entries, { name: "manifest.json", size: bytes.length, sha256 }];
}

/**
 * @param {unknown} input `{ mode, tag, postUploadOk, verifyReleaseOk }`
 * @returns {{ ok: boolean, reason: string }}
 */
export function mayPublish(input) {
  const no = (/** @type {string} */ reason) => ({ ok: false, reason });
  if (!isObj(input)) return no("no publish facts given");
  const { mode, tag, postUploadOk, verifyReleaseOk } = /** @type {Record<string, unknown>} */ (input);
  if (mode !== "draft") return no(`mode ${JSON.stringify(mode)} never publishes`);
  if (!isReleaseTag(tag)) return no(`tag ${JSON.stringify(tag)} is not vX.Y.Z`);
  if (postUploadOk !== true) return no("the post-upload check did not pass");
  if (verifyReleaseOk !== true) return no("verify-release did not pass");
  return { ok: true, reason: "" };
}

/**
 * Is `release` the draft this run created: a draft, pinned to `sha`, with no
 * published release for its tag?
 * @param {{ release?: unknown, sha?: unknown, publishedForTag?: unknown }} a
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkDraftRelease({ release, sha, publishedForTag } = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isFullSha(sha)) errors.push(`expected SHA ${JSON.stringify(sha)} is not 40 lowercase hex`);
  if (!isObj(release)) {
    errors.push("no release object");
  } else {
    const r = /** @type {Record<string, unknown>} */ (release);
    if (r.draft !== true) errors.push(`release ${JSON.stringify(r.tag_name)} is not a draft`);
    if (r.target_commitish !== sha) {
      errors.push(`release target ${JSON.stringify(r.target_commitish)} ≠ expected ${JSON.stringify(sha)}`);
    }
  }
  if (publishedForTag !== false) errors.push("a published release exists (or may exist) for the tag");
  return { ok: errors.length === 0, errors };
}

// --------------------------------------------------------------------- CLI --

export const USAGE = [
  "usage: gate.mjs decide --mode M --verify ok|fail --source ok|fail --sha S --tag T --published-for-tag true|false",
  "       gate.mjs post-upload --manifest manifest.json --assets draft-assets.json",
  "       gate.mjs may-publish --mode M --tag T --post-upload ok|fail --verify-release ok|fail",
].join("\n");

/** @param {string[]} argv */
function flags(argv) {
  /** @type {Record<string, string>} */
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) return null;
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

/** A check result: exactly "ok" → true, "fail" → false; anything else passes through and fails strict checks. */
const result = (/** @type {string | undefined} */ v) => (v === "ok" ? true : v === "fail" ? false : v);

/** A boolean: exactly "true" / "false"; anything else passes through and fails strict checks. */
const bool = (/** @type {string | undefined} */ v) => (v === "true" ? true : v === "false" ? false : v);

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {number} exit code: 0 only for a positive decision
 */
export function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const [cmd, ...rest] = argv;
  const o = flags(rest);
  const usage = (/** @type {string} */ why) => {
    err(`::error::${why}`);
    err(USAGE);
    return 1;
  };
  if (!o) return usage("malformed arguments");

  if (cmd === "decide") {
    const source = { ok: result(o.source), sha: o.sha ?? null, tag: o.tag ?? null };
    const d = decide({ mode: o.mode, verifyOk: result(o.verify), source, publishedForTag: bool(o["published-for-tag"]) });
    if (!d.createDraft) {
      err(`::error::no draft: ${d.reason}`);
      return 1;
    }
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `create_draft=true\ndraft_tag=${d.draftTag}\n`);
    out(`create draft ${d.draftTag}`);
    return 0;
  }
  if (cmd === "post-upload") {
    if (!o.manifest || !o.assets) return usage("post-upload needs --manifest and --assets");
    const manifestFile = path.resolve(cwd, o.manifest);
    const manifest = readJson(manifestFile);
    const draftAssets = readJson(path.resolve(cwd, o.assets));
    const uploadedSelf = Array.isArray(draftAssets) && draftAssets.some((a) => a?.name === "manifest.json");
    const r = postUpload({
      manifest: uploadedSelf ? manifestWithSelf(manifest, fs.readFileSync(manifestFile)) : manifest,
      draftAssets,
    });
    for (const e of r.errors) err(`::error::${e}`);
    if (r.ok) out("draft assets match the manifest");
    return r.ok ? 0 : 1;
  }
  if (cmd === "may-publish") {
    const r = mayPublish({
      mode: o.mode,
      tag: o.tag,
      postUploadOk: result(o["post-upload"]),
      verifyReleaseOk: result(o["verify-release"]),
    });
    if (!r.ok) {
      err(`::error::not publishable: ${r.reason}`);
      return 1;
    }
    out(`${o.tag} may be published`);
    return 0;
  }
  return usage(`unknown subcommand ${JSON.stringify(cmd ?? "")}`);
}

/* v8 ignore start -- only reached in a real `node scripts/release/gate.mjs` process */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
