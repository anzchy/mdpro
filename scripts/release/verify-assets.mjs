/**
 * Purpose: Verify-job CLI (D76-WI-3). Checks the downloaded build artifacts as
 * one closed release set, generates `latest.json` with final-tag URLs, and
 * writes the verified files + `latest.json` + `manifest.json` to `--out` only
 * when every check passes. Every signed file's `.sig` must be a valid minisign
 * signature by the tauri.conf.json updater key (WI-4). Without `--out` it is check-only, which is how an
 * operator re-verifies a downloaded `release-set` artifact (plan WI-8 R1).
 *
 * Usage:
 *   node scripts/release/verify-assets.mjs --dir <artifacts> --version X.Y.Z
 *        [--repo owner/name] [--mode build-only|draft|rehearsal-draft] [--out <dir>]
 *        [--pub-date <ISO>] [--changelog <path>] [--tauri-conf <path>]
 *
 * Pipeline: parseArgs → readTree (flatten, duplicate basenames fail; an input
 *   latest.json / manifest.json is set aside) → verifyAssetSet → minisign
 *   verifyFile on every signed pair (key from `--tauri-conf`, default
 *   `src-tauri/tauri.conf.json`; absent or unparsable fails) → resolveNotes →
 *   buildLatestJson + validateLatestJson (self-check) → an input latest.json
 *   must parse to a JSON object and is then validated (null, an array or any
 *   other non-object fails, D127-WI-1), an input manifest.json must equal the
 *   recomputed one → on any
 *   error print all and write nothing → else write to a temp dir and rename it
 *   to `--out`.
 *
 * Key decisions:
 * - All or nothing: no `latest.json` or `manifest.json` exists unless the set
 *   verified; that absence is the "no publish decision" signal (requirement ③).
 * - `manifest.json` lists every written file except itself, `latest.json`
 *   included, as `{ name, size, sha256 }`; the draft job compares the uploaded
 *   draft to it (WI-5).
 * - `--out` may not be `--dir`: the input is never rewritten in place.
 *
 * @module scripts/release/verify-assets
 * @coordinates-with scripts/release/assetSet.mjs, scripts/release/latestJson.mjs
 * @coordinates-with scripts/release/minisign.mjs (signature validity)
 * @coordinates-with .github/workflows/release.yml (job verify)
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildManifest, verifyAssetSet } from "./assetSet.mjs";
import { buildLatestJson, resolveNotes, validateLatestJson } from "./latestJson.mjs";
import { parsePublicKey, verifyFile } from "./minisign.mjs";
import { MODES, STRICT_VERSION } from "./sourceCheck.mjs";

export const USAGE =
  "usage: verify-assets.mjs --dir <artifacts> --version X.Y.Z [--repo owner/name] " +
  "[--mode build-only|draft|rehearsal-draft] [--out <dir>] [--pub-date <ISO>] [--changelog <path>] [--tauri-conf <path>]";

/** Files the verify job generates; set aside from the asset set when re-verifying. */
export const GENERATED = Object.freeze(["latest.json", "manifest.json"]);

const VALUE_FLAGS = new Set(["--dir", "--version", "--repo", "--mode", "--out", "--pub-date", "--changelog", "--tauri-conf"]);

/** @param {string[]} argv @param {NodeJS.ProcessEnv} env */
function parseArgs(argv, env) {
  /** @type {Record<string, string>} */
  const o = { "--mode": "build-only" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (!VALUE_FLAGS.has(flag)) return { error: `unknown argument ${JSON.stringify(argv[i])}` };
    const value = inline ?? argv[++i];
    if (value === undefined) return { error: `${flag} needs a value` };
    o[flag] = value;
  }
  o["--repo"] ??= env.GITHUB_REPOSITORY ?? "";
  if (!o["--dir"]) return { error: "--dir is required" };
  if (!STRICT_VERSION.test(o["--version"] ?? "")) return { error: "--version must be X.Y.Z" };
  if (!o["--repo"]) return { error: "--repo (or GITHUB_REPOSITORY) is required" };
  if (!MODES.includes(o["--mode"])) return { error: `--mode must be one of ${MODES.join(", ")}` };
  return { o };
}

/**
 * Every regular file under `dir`, flattened to its basename.
 * @param {string} dir
 * @returns {{ files: {name: string, data: Buffer}[], errors: string[] }}
 */
export function readTree(dir) {
  const files = [];
  const errors = [];
  const seen = new Map();
  const walk = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        if (seen.has(e.name)) errors.push(`${e.name} appears twice: ${seen.get(e.name)} and ${p}`);
        else files.push({ name: e.name, data: fs.readFileSync(p) });
        seen.set(e.name, p);
      }
    }
  };
  try {
    walk(dir);
  } catch (e) {
    errors.push(`cannot read ${dir}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { files, errors };
}

/** @param {string} file */
function readOptional(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * The updater pubkey from tauri.conf.json, or an error.
 * @param {string} file
 * @returns {{ pubkey: string } | { error: string }}
 */
function readPubkey(file) {
  let pubkey;
  try {
    pubkey = JSON.parse(fs.readFileSync(file, "utf8"))?.plugins?.updater?.pubkey;
  } catch {
    return { error: `cannot read ${file} for the updater pubkey` };
  }
  if (typeof pubkey !== "string") return { error: `${file} has no plugins.updater.pubkey` };
  const parsed = parsePublicKey(pubkey);
  if (!parsed.ok) return { error: `the updater pubkey in ${file} does not parse (${parsed.reason})` };
  return { pubkey };
}

/**
 * Every signed pair's `.sig` against the updater key.
 * @param {{name: string, sig: string}[]} signed
 * @param {{name: string, data: Buffer}[]} assets
 * @param {string} confFile
 */
function checkSignatures(signed, assets, confFile) {
  const key = readPubkey(confFile);
  if (!("pubkey" in key)) return [key.error];
  const bytes = (/** @type {string} */ name) => assets.find((f) => f.name === name)?.data;
  return signed.flatMap((s) => {
    const v = verifyFile(bytes(s.name), String(bytes(s.sig)), key.pubkey);
    return v.ok ? [] : [`${s.name}: ${s.sig} does not verify (${v.reason})`];
  });
}

/**
 * What a parsed JSON value is, as the error names it. Only "an object" is a
 * plain `{...}`; `null` and arrays are their own kinds (D127-WI-1).
 * @param {unknown} v
 */
const jsonKind = (v) =>
  v === null ? "null" : Array.isArray(v) ? "an array" : typeof v === "object" ? "an object" : `a ${typeof v}`;

/**
 * Re-verify a generated `latest.json` / `manifest.json` found in the input.
 * @param {{name: string, data: Buffer}[]} generated
 * @param {{name: string, data: Buffer}[]} assets
 * @param {{repo: string, version: string}} ctx
 */
function checkGenerated(generated, assets, ctx) {
  const errors = [];
  const latest = generated.find((f) => f.name === "latest.json");
  const manifest = generated.find((f) => f.name === "manifest.json");
  if (latest) {
    let json;
    let parsed = false;
    try {
      json = JSON.parse(latest.data.toString("utf8"));
      parsed = true;
    } catch {
      errors.push("input latest.json is not valid JSON");
    }
    const kind = jsonKind(json);
    if (parsed && kind !== "an object") errors.push(`input latest.json is ${kind}, not a JSON object`);
    else if (parsed) errors.push(...validateLatestJson(json, { ...ctx, files: assets }).errors);
  }
  if (manifest) {
    const want = JSON.stringify(buildManifest(latest ? [...assets, latest] : assets));
    let got = null;
    try {
      got = JSON.stringify(JSON.parse(manifest.data.toString("utf8")));
    } catch {
      /* reported below */
    }
    if (got !== want) errors.push("input manifest.json does not match the files beside it");
  }
  return errors;
}

/** @param {string} out @param {{name: string, data: Buffer | string}[]} files */
function writeAtomically(out, files) {
  const parent = path.dirname(out);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(parent, `.${path.basename(out)}-`));
  for (const f of files) fs.writeFileSync(path.join(tmp, f.name), f.data);
  fs.rmSync(out, { recursive: true, force: true });
  fs.renameSync(tmp, out);
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {number} exit code
 */
export function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const parsed = parseArgs(argv, io.env ?? process.env);
  if (!parsed.o) {
    err(`::error::${parsed.error}`);
    err(USAGE);
    return 1;
  }
  const o = parsed.o;
  const version = o["--version"];
  const repo = o["--repo"];
  const dir = path.resolve(cwd, o["--dir"]);
  const outDir = o["--out"] ? path.resolve(cwd, o["--out"]) : null;

  const tree = readTree(dir);
  const errors = [...tree.errors];
  if (outDir === dir) errors.push("--out must not be the --dir being verified");
  const generated = tree.files.filter((f) => GENERATED.includes(f.name));
  const assets = tree.files.filter((f) => !GENERATED.includes(f.name));

  const set = verifyAssetSet(assets, version);
  errors.push(...set.errors);
  errors.push(...checkSignatures(set.signed, assets, path.resolve(cwd, o["--tauri-conf"] ?? "src-tauri/tauri.conf.json")));
  const notes = resolveNotes({
    changelog: readOptional(path.resolve(cwd, o["--changelog"] ?? "CHANGELOG.md")),
    version,
    mode: o["--mode"],
  });
  errors.push(...notes.errors);
  errors.push(...checkGenerated(generated, assets, { repo, version }));

  let latest = null;
  if (set.ok) {
    /** @type {Record<string, string>} */
    const sigs = {};
    for (const s of set.signed.filter((x) => x.updater)) {
      sigs[s.platform] = String(assets.find((f) => f.name === s.sig)?.data);
    }
    latest = buildLatestJson({ repo, version, notes: notes.notes, pubDate: o["--pub-date"] ?? new Date(), sigs });
    errors.push(...validateLatestJson(latest, { repo, version, files: assets }).errors);
  }

  for (const w of notes.warnings) err(`::warning::${w}`);
  if (errors.length || !latest) {
    for (const e of errors) err(`::error::${e}`);
    return 1;
  }

  out(`verified ${assets.length} release assets for v${version} (${set.signed.length} signed)`);
  if (!outDir) return 0;
  const latestFile = { name: "latest.json", data: `${JSON.stringify(latest, null, 2)}\n` };
  const manifest = buildManifest([...assets, latestFile]);
  writeAtomically(outDir, [...assets, latestFile, { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` }]);
  out(`wrote ${manifest.length} files + manifest.json to ${outDir}`);
  return 0;
}

/* v8 ignore start -- only reached in a real `node scripts/release/verify-assets.mjs` process */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
