/**
 * Purpose: Re-verify an uploaded draft release right before it is published
 * (D76-WI-5, ADR-0073). Read-only: it only GETs from the GitHub API, downloads
 * the draft's own assets into a temp dir and re-runs verify-assets on those
 * bytes, so "tested bytes = published bytes" holds (#release-031-gate).
 *
 * Usage:
 *   node scripts/release/verify-release.mjs --tag vX.Y.Z --sha <40-hex> [--repo owner/name]
 *   node scripts/release/verify-release.mjs --rehearsal --tag rehearsal-d76-<sha7> --sha <40-hex>
 *        --version X.Y.Z [--repo owner/name]
 *
 * Pipeline: args (default: tag must be vX.Y.Z, rehearsal tags refused;
 *   --rehearsal: tag must be rehearsal-d76-<sha7 of --sha>, --version X.Y.Z;
 *   --sha 40 hex) →
 *   list releases for the tag → exactly one draft → checkDraftRelease (draft,
 *   target_commitish = --sha, no published release for the tag) → the
 *   draft's asset list matches its own manifest.json (gate.postUpload) →
 *   download every asset → latest.json and manifest.json present →
 *   verify-assets check-only, mode draft (rehearsal-draft under --rehearsal)
 *   (asset set, latest.json, manifest bytes, signatures) → exit 0 only if all
 *   pass.
 *
 * Key decisions:
 * - It never changes state: every gh call is a GET `gh api`. The one publish
 *   call lives in the workflow, after `gate.mjs may-publish` exits 0.
 * - Argument errors are caught before any network call, so in the default
 *   mode a rehearsal tag or a short SHA cannot even reach the API.
 * - `--rehearsal` (D127-WI-5) exists so a negative rehearsal (a broken `.sig`
 *   in a rehearsal draft) reaches the signature check. It runs the same
 *   target, byte and signature checks, and accepts only the rehearsal tag of
 *   `--sha`. Exit 0 there means "the checks passed", never "publishable":
 *   publishing is `gate.mjs may-publish`, which refuses every rehearsal tag,
 *   and the workflow never passes `--rehearsal`.
 * - Fail closed: any gh failure, a missing release, or two drafts → exit 1.
 *
 * @module scripts/release/verify-release
 * @coordinates-with scripts/release/gate.mjs (checkDraftRelease, postUpload)
 * @coordinates-with scripts/release/verify-assets.mjs (byte-level checks)
 * @coordinates-with .github/workflows/release.yml (job publish)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REHEARSAL_PREFIX, checkDraftRelease, isFullSha, isReleaseTag, manifestWithSelf, postUpload } from "./gate.mjs";
import { GENERATED, main as verifyAssetsMain } from "./verify-assets.mjs";
import { STRICT_VERSION } from "./sourceCheck.mjs";

export const USAGE =
  "usage: verify-release.mjs --tag vX.Y.Z --sha <40-hex commit> [--repo owner/name]\n" +
  "       verify-release.mjs --rehearsal --tag rehearsal-d76-<sha7> --sha <40-hex commit> --version X.Y.Z [--repo owner/name]";

/** Large enough for every release asset (archives are tens of MB). */
const MAX_ASSET_BYTES = 1 << 30;

/**
 * @typedef {{ status: number | null, stdout: Buffer | string, stderr: Buffer | string }} GhResult
 * @param {string[]} args
 * @returns {GhResult}
 */
/* v8 ignore start -- the real gh process; tests inject runGh */
function defaultRunGh(args) {
  const r = spawnSync("gh", args, { maxBuffer: MAX_ASSET_BYTES });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
}
/* v8 ignore stop */

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ o: {tag: string, sha: string, repo: string, version: string, rehearsal: boolean}, error?: undefined }
 *         | { error: string, o?: undefined }}
 */
function parseArgs(argv, env) {
  /** @type {Record<string, string>} */
  const o = {};
  let rehearsal = false;
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--rehearsal") {
      rehearsal = true;
      i -= 1;
      continue;
    }
    if (!["--tag", "--sha", "--repo", "--version"].includes(argv[i]) || argv[i + 1] === undefined) {
      return { error: `unexpected argument ${JSON.stringify(argv[i])}` };
    }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  o.repo ??= env.GITHUB_REPOSITORY ?? "";
  if (!rehearsal) {
    // The default (publish) path: a rehearsal tag is refused here, before any gh call.
    if (typeof o.tag === "string" && o.tag.startsWith(REHEARSAL_PREFIX)) {
      return { error: `${o.tag}: rehearsal drafts are never publishable` };
    }
    if (o.version !== undefined) return { error: "--version is only for --rehearsal (a vX.Y.Z tag carries its version)" };
    if (!isReleaseTag(o.tag)) return { error: `--tag ${JSON.stringify(o.tag)} is not vX.Y.Z` };
  }
  if (!isFullSha(o.sha)) return { error: `--sha ${JSON.stringify(o.sha)} is not a 40-hex lowercase commit` };
  if (rehearsal) {
    const want = `${REHEARSAL_PREFIX}${o.sha.slice(0, 7)}`;
    if (o.tag !== want) return { error: `--rehearsal checks only ${want}, the rehearsal draft for --sha; got --tag ${JSON.stringify(o.tag)}` };
    if (!STRICT_VERSION.test(o.version ?? "")) return { error: "--rehearsal needs --version X.Y.Z (a rehearsal tag carries none)" };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(o.repo)) return { error: "--repo (or GITHUB_REPOSITORY) must be owner/name" };
  const version = rehearsal ? o.version : o.tag.slice(1);
  return { o: { tag: o.tag, sha: o.sha, repo: o.repo, version, rehearsal } };
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, out?: (s: string) => void, err?: (s: string) => void,
 *           runGh?: (args: string[]) => GhResult }} [io]
 * @returns {number} exit code
 */
export function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const runGh = io.runGh ?? defaultRunGh;
  const fail = (/** @type {string[]} */ errors) => {
    for (const e of errors) err(`::error::${e}`);
    return 1;
  };

  const parsed = parseArgs(argv, env);
  if (!parsed.o) {
    err(USAGE);
    return fail([parsed.error]);
  }
  const { tag, sha, repo, version, rehearsal } = parsed.o;

  const list = runGh([
    "api",
    "--paginate",
    `repos/${repo}/releases?per_page=100`,
    "--jq",
    `.[] | select(.tag_name == "${tag}")`,
  ]);
  if (list.status !== 0) return fail([`cannot list releases of ${repo}: ${String(list.stderr).trim()}`]);
  /** @type {any[]} */
  let releases;
  try {
    releases = String(list.stdout).split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  } catch {
    return fail(["the release list is not valid JSON"]);
  }
  const drafts = releases.filter((r) => r?.draft === true);
  const publishedForTag = releases.some((r) => r?.draft !== true);
  if (drafts.length !== 1) return fail([`expected exactly one draft release for ${tag}, found ${drafts.length}`]);
  const release = drafts[0];
  const check = checkDraftRelease({ release, sha, publishedForTag });
  if (!check.ok) return fail(check.errors);

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-verify-release-"));
  try {
    /** @type {string[]} */
    const errors = [];
    for (const a of assets) {
      if (typeof a?.name !== "string" || path.basename(a.name) !== a.name || !Number.isInteger(a.id)) {
        errors.push(`draft asset ${JSON.stringify(a?.name)} is malformed`);
        continue;
      }
      const r = runGh(["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${a.id}`]);
      if (r.status !== 0) errors.push(`cannot download ${a.name}: ${String(r.stderr).trim()}`);
      else fs.writeFileSync(path.join(tmp, a.name), r.stdout);
    }
    for (const g of GENERATED) if (!assets.some((/** @type {any} */ a) => a?.name === g)) errors.push(`draft has no ${g}`);
    if (errors.length) return fail(errors);

    const manifestBytes = fs.readFileSync(path.join(tmp, "manifest.json"));
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      return fail(["draft manifest.json is not valid JSON"]);
    }
    const listed = postUpload({
      manifest: manifestWithSelf(manifest, manifestBytes),
      draftAssets: assets.map((/** @type {any} */ a) => ({ name: a.name, size: a.size, digest: a.digest })),
    });
    if (!listed.ok) return fail(listed.errors);

    const mode = rehearsal ? "rehearsal-draft" : "draft";
    const code = verifyAssetsMain(["--dir", tmp, "--version", version, "--repo", repo, "--mode", mode], { cwd, env, out, err });
    if (code !== 0) return fail([`the draft's downloaded assets for ${tag} did not verify`]);
    if (rehearsal) {
      out(`${tag}: rehearsal draft pinned to ${sha} verified (${assets.length} assets); rehearsal drafts are never publishable`);
    } else {
      out(`${tag}: draft pinned to ${sha} verified (${assets.length} assets)`);
    }
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* v8 ignore start -- only reached in a real `node scripts/release/verify-release.mjs` process */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
