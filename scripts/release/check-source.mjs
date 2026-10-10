/**
 * Purpose: CLI for the release preflight (D76-WI-1). Gathers the facts
 * `sourceCheck.checkSource` judges, prints every error and warning, and writes
 * `sha`, `version`, `tag` to `$GITHUB_OUTPUT` only when the check passes.
 *
 * Usage:
 *   node scripts/release/check-source.mjs --ref <sha|vX.Y.Z> --version X.Y.Z
 *        [--mode build-only|draft|rehearsal-draft] [--repo owner/name] [--skip-github]
 *
 * Pipeline: parseArgs → git rev-parse HEAD, `<ref>^{commit}` (peeled, so an
 *   annotated tag yields its commit), `refs/tags/v<version>^{commit}` → read
 *   package.json / tauri.conf.json / Cargo.toml → `gh api` GETs for a release
 *   on the tag (drafts included) and the latest published release →
 *   checkSource → print → $GITHUB_OUTPUT.
 *
 * Key decisions:
 * - Read-only: every git and gh call is a read. Nothing is tagged or created.
 * - A GitHub lookup that fails for any reason other than 404 is an error (fail
 *   closed). `--skip-github` drops the lookups for local runs and says so in a
 *   warning.
 * - Errors and warnings use the `::error::` / `::warning::` workflow-command
 *   prefix so they show as annotations in the run summary.
 * - `io.runGh` is the network boundary seam; tests inject it, CI uses `gh`.
 *
 * @module scripts/release/check-source
 * @coordinates-with scripts/release/sourceCheck.mjs (checkSource, parseCargoPackageVersion)
 * @coordinates-with .github/workflows/release.yml (job preflight)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkSource, parseCargoPackageVersion } from "./sourceCheck.mjs";

export const USAGE =
  "usage: check-source.mjs --ref <40-hex sha | vX.Y.Z> --version X.Y.Z " +
  "[--mode build-only|draft|rehearsal-draft] [--repo owner/name] [--skip-github]";

const VALUE_FLAGS = new Set(["--ref", "--version", "--mode", "--repo"]);

/**
 * @param {string[]} argv
 * @returns {{ ok: true, opts: Record<string, string | boolean> } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = { "--mode": "build-only" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (flag === "--skip-github" && inline === undefined) {
      opts[flag] = true;
    } else if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? argv[++i];
      if (value === undefined) return { ok: false, error: `${flag} needs a value` };
      opts[flag] = value;
    } else {
      return { ok: false, error: `unknown argument ${JSON.stringify(argv[i])}` };
    }
  }
  for (const req of ["--ref", "--version"]) {
    if (typeof opts[req] !== "string") return { ok: false, error: `${req} is required` };
  }
  return { ok: true, opts };
}

/** @param {string[]} args @param {{cwd: string, env: NodeJS.ProcessEnv}} io */
function gitRead(args, io) {
  try {
    return execFileSync("git", args, { cwd: io.cwd, env: io.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/** @param {string} rev @param {{cwd: string, env: NodeJS.ProcessEnv}} io */
const peel = (rev, io) => (rev.startsWith("-") ? null : gitRead(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], io));

/** @param {string} file */
function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** @param {string} file */
function jsonVersion(file) {
  try {
    const v = JSON.parse(String(readText(file))).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
function defaultRunGh(args, env) {
  const r = spawnSync("gh", args, { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
}

/**
 * One `gh api` GET. 404 → `{ value: null }`; any other failure → `{ error }`.
 * @param {(args: string[], env: NodeJS.ProcessEnv) => {status: number|null, stdout: string, stderr: string}} runGh
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function ghGet(runGh, args, env) {
  const r = runGh(["api", ...args], env);
  if (r.status === 0) return { value: r.stdout.trim() };
  if (/HTTP 404/.test(r.stderr)) return { value: null };
  return { error: `gh api ${args[args.length - 3] ?? args[0]} failed: ${r.stderr.trim() || `exit ${r.status}`}` };
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, out?: (s: string) => void, err?: (s: string) => void,
 *           runGh?: typeof defaultRunGh }} [io]
 * @returns {number} exit code: 0 ok, 1 any error
 */
export function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const runGh = io.runGh ?? defaultRunGh;

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(`::error::${parsed.error}`);
    err(USAGE);
    return 1;
  }
  const o = parsed.opts;
  const ref = String(o["--ref"]);
  const version = String(o["--version"]);
  const tag = `v${version}`;
  const g = { cwd, env };

  /** @type {string[]} */
  const lookupErrors = [];
  /** @type {null | {isDraft: boolean}} */
  let existingRelease = null;
  /** @type {string | null} */
  let latestPublished = null;
  const extraWarnings = [];
  if (o["--skip-github"] === true) {
    extraWarnings.push("--skip-github: existing releases and the latest published version were not checked");
  } else {
    const repo = typeof o["--repo"] === "string" ? o["--repo"] : env.GITHUB_REPOSITORY;
    if (!repo) {
      lookupErrors.push("--repo (or GITHUB_REPOSITORY) is required unless --skip-github is given");
    } else {
      const jq = `.[] | select(.tag_name == ${JSON.stringify(tag)}) | .draft`;
      const rel = ghGet(runGh, ["--paginate", `repos/${repo}/releases?per_page=100`, "--jq", jq], env);
      const latest = ghGet(runGh, [`repos/${repo}/releases/latest`, "--jq", ".tag_name"], env);
      if ("error" in rel) lookupErrors.push(String(rel.error));
      else if (rel.value) existingRelease = { isDraft: rel.value.split(/\s+/).every((d) => d === "true") };
      if ("error" in latest) lookupErrors.push(String(latest.error));
      else latestPublished = latest.value || null;
    }
  }

  const result = checkSource({
    mode: o["--mode"],
    refInput: ref,
    expectedVersion: version,
    headSha: gitRead(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], g),
    refSha: peel(ref, g),
    versions: {
      packageJson: jsonVersion(path.join(cwd, "package.json")),
      tauriConf: jsonVersion(path.join(cwd, "src-tauri", "tauri.conf.json")),
      cargoToml: parseCargoPackageVersion(readText(path.join(cwd, "src-tauri", "Cargo.toml"))),
    },
    tagSha: peel(`refs/tags/${tag}`, g),
    existingRelease,
    latestPublished,
  });

  for (const w of [...extraWarnings, ...result.warnings]) err(`::warning::${w}`);
  const errors = [...lookupErrors, ...result.errors];
  for (const e of errors) err(`::error::${e}`);
  if (errors.length || !result.ok) return 1;

  const lines = `sha=${result.sha}\nversion=${version}\ntag=${result.tag}\n`;
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines);
  out(`source ok: ${result.tag} at ${result.sha} (mode ${o["--mode"]})`);
  return 0;
}

/* v8 ignore start -- only reached in a real `node scripts/release/check-source.mjs` process */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
