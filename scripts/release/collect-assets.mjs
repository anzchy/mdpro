/**
 * Purpose: Build-job CLI (D76-WI-2). Finds one platform's Tauri bundle outputs
 * under `src-tauri/target/<triple>/release/bundle/` and copies them, with their
 * `.sig` files, to `dist-release/<platform>/` under their final asset names.
 *
 * Usage:
 *   node scripts/release/collect-assets.mjs --platform <darwin-aarch64|darwin-x86_64|windows-x86_64|linux-x86_64>
 *        --version X.Y.Z [--root <repo>] [--out <dir>]
 *
 * Pipeline: parseArgs → planCollect (list candidates per FileSpec, exactly one
 *   source each, non-empty `.sig`) → on any error: print all, write nothing →
 *   else copy into a temp dir beside the output and rename it into place.
 *
 * Key decisions:
 * - Exactly one source per expected file. Zero is "missing", two or more (a
 *   stale bundle) lists every candidate. Nothing ever picks the first.
 * - A `.sig` that is absent, empty or whitespace-only fails here, in the build
 *   job, before any artifact is uploaded (requirement ③).
 * - Optional platforms (D-3): a file kind with no candidates at all is skipped;
 *   a present one follows the same rules as a required one.
 * - All-or-nothing output: the set is checked before the first copy, and the
 *   copy lands in a temp dir that is renamed into place, so a failure never
 *   leaves a partial set for the upload step.
 *
 * @module scripts/release/collect-assets
 * @coordinates-with scripts/release/assetNames.mjs (PLATFORM_SPECS)
 * @coordinates-with .github/workflows/release.yml (job build)
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUNDLE_SUBPATH, isKnownPlatform, isRequired, platformSpec } from "./assetNames.mjs";
import { STRICT_VERSION } from "./sourceCheck.mjs";

export const USAGE =
  "usage: collect-assets.mjs --platform <darwin-aarch64|darwin-x86_64|windows-x86_64|linux-x86_64> " +
  "--version X.Y.Z [--root <repo>] [--out <dir>]";

const VALUE_FLAGS = new Set(["--platform", "--version", "--root", "--out"]);

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (!VALUE_FLAGS.has(flag)) return { error: `unknown argument ${JSON.stringify(argv[i])}` };
    const value = inline ?? argv[++i];
    if (value === undefined) return { error: `${flag} needs a value` };
    opts[flag] = value;
  }
  if (!isKnownPlatform(opts["--platform"])) return { error: `--platform ${JSON.stringify(opts["--platform"])} is not known` };
  if (!STRICT_VERSION.test(opts["--version"] ?? "")) return { error: "--version must be X.Y.Z" };
  return { opts };
}

/** Regular files in `dir` (a missing dir has none). @param {string} dir */
function filesIn(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Decide every copy, or every reason not to. Reads the bundle tree; writes nothing.
 * @param {{ root: string, platform: string, version: string }} a
 * @returns {{ errors: string[], copies: {from: string, name: string}[] }}
 */
export function planCollect({ root, platform, version }) {
  const spec = platformSpec(platform);
  const bundle = path.join(root, ...BUNDLE_SUBPATH.map((p) => (p === "<triple>" ? spec.triple : p)));
  const rel = (/** @type {string} */ p) => path.relative(root, p);
  const errors = [];
  const copies = [];
  for (const f of spec.files) {
    const dir = path.join(bundle, f.dir);
    const candidates = filesIn(dir).filter((n) => f.candidates.test(n));
    if (candidates.length === 0 && !isRequired(platform)) continue;
    const exact = f.source(version);
    const want = exact ?? `*${f.candidates.source.replace(/\\/g, "").replace(/\$$/, "")}`;
    if (exact !== null && !candidates.includes(exact)) {
      errors.push(`missing ${rel(path.join(dir, exact))}`);
      continue;
    }
    if (candidates.length === 0) {
      errors.push(`missing ${rel(path.join(dir, want))}`);
      continue;
    }
    if (candidates.length > 1) {
      errors.push(`expected one ${want} in ${rel(dir)}, found ${candidates.length}: ${candidates.map((n) => rel(path.join(dir, n))).join(", ")}`);
      continue;
    }
    const from = path.join(dir, candidates[0]);
    copies.push({ from, name: f.final(version) });
    if (!f.signed) continue;
    const sig = `${from}.sig`;
    let text = null;
    try {
      text = fs.readFileSync(sig, "utf8");
    } catch {
      errors.push(`missing signature ${rel(sig)}`);
      continue;
    }
    if (text.trim() === "") {
      errors.push(`empty signature ${rel(sig)}`);
      continue;
    }
    copies.push({ from: sig, name: `${f.final(version)}.sig` });
  }
  return { errors, copies };
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {number} exit code
 */
export function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const parsed = parseArgs(argv);
  if (!parsed.opts) {
    err(`::error::${parsed.error}`);
    err(USAGE);
    return 1;
  }
  const o = parsed.opts;
  const root = path.resolve(io.cwd ?? process.cwd(), o["--root"] ?? ".");
  const platform = o["--platform"];
  const { errors, copies } = planCollect({ root, platform, version: o["--version"] });
  if (errors.length) {
    for (const e of errors) err(`::error::${platform}: ${e}`);
    return 1;
  }
  if (copies.length === 0) {
    out(`${platform}: no bundle outputs found; optional platform, nothing collected`);
    return 0;
  }
  const outRoot = path.resolve(root, o["--out"] ?? "dist-release");
  const dest = path.join(outRoot, platform);
  fs.mkdirSync(outRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(outRoot, `.${platform}-`));
  for (const c of copies) fs.copyFileSync(c.from, path.join(tmp, c.name));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  for (const c of copies) out(`${platform}: ${path.relative(root, c.from)} → ${path.relative(root, path.join(dest, c.name))}`);
  return 0;
}

/* v8 ignore start -- only reached in a real `node scripts/release/collect-assets.mjs` process */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
