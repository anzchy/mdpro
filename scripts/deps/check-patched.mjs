#!/usr/bin/env node
/**
 * Purpose: Fail install and build when a dependency listed in
 * `pnpm.patchedDependencies` is installed without its patch (D181). An
 * incremental `pnpm install --frozen-lockfile --offline` once exited 0 and
 * created `node_modules/.pnpm/prosemirror-tables@1.8.5_patch_hash=…/` with the
 * ORIGINAL files inside; only a vitest guard noticed, and a build would have
 * shipped the bug. This script reads the installed files and checks every hunk
 * (`patchCheck.mjs`). Its stderr IS the interface, so writing to the console
 * is correct here (rule 60's no-console rule scopes to `src/`).
 *
 * Usage: node scripts/deps/check-patched.mjs [--root <dir>]
 * Exit: 0 every patch in effect · 1 a copy is unpatched, drifted or absent ·
 *       2 configuration error (unreadable package.json, missing or unparsable
 *       patch, a key form the guard does not understand).
 *
 * Wired as the root `postinstall` and at the front of `build` (which
 * `tauri build` reaches through `beforeBuildCommand: "pnpm build"`).
 *
 * Key decisions:
 * - Checks the copies that are actually USED: every
 *   `node_modules/.pnpm/<importer>/node_modules/<name>` symlink (one per importer),
 *   plus `node_modules/.pnpm/node_modules/<name>` and root
 *   `node_modules/<name>` when present, each resolved with realpath and kept
 *   when its package.json version matches. Any linked copy without the patch
 *   fails, which still catches D181 itself (the `_patch_hash=` directory is
 *   linked but holds the original files). The guard stays generic: it follows
 *   pnpm's links instead of knowing who imports what.
 * - A copy in `.pnpm` that nothing links to is ignored apart from a one-line
 *   stderr note. An earlier version checked every copy and failed on the
 *   unpatched `prosemirror-tables@1.8.5/` leftover that `pnpm install --force`
 *   does not remove, so its own suggested fix could never clear it.
 * - Zero linked copies is a failure: a patch that targets nothing protects
 *   nothing, and `pnpm install` itself refuses an unused patch.
 * - Only exact-version keys (and bare names, meaning every version) are
 *   understood; a range key exits 2 rather than being skipped in silence.
 * - Default root is the repo containing this script, so the answer does not
 *   depend on cwd; `--root` exists for tests and other checkouts.
 *
 * @module scripts/deps/check-patched
 * @coordinates-with scripts/deps/patchCheck.mjs, package.json (scripts.postinstall, scripts.build)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPatchApplied, PatchParseError } from "./patchCheck.mjs";

const TAG = "check-patched:";
const FIX = "Fix: run `pnpm install --force`, then re-run `node scripts/deps/check-patched.mjs`.";
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

class ConfigError extends Error {}

function parseArgs(argv) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) root = path.resolve(argv[(i += 1)]);
    else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else throw new ConfigError(`unknown argument ${JSON.stringify(arg)}. Usage: node scripts/deps/check-patched.mjs [--root <dir>]`);
  }
  // Real path, so paths reached through realpath print relative to it.
  return fs.existsSync(root) ? fs.realpathSync(root) : root;
}

/** `patchedDependencies` from package.json's `pnpm` field and pnpm-workspace.yaml, merged. */
function patchedDependencies(root) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch (error) {
    throw new ConfigError(`cannot read ${path.join(root, "package.json")}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const out = { ...(pkg.pnpm?.patchedDependencies ?? {}) };
  const workspace = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(workspace)) {
    const lines = fs.readFileSync(workspace, "utf8").split(/\r?\n/);
    const at = lines.findIndex((l) => /^patchedDependencies:\s*$/.test(l));
    for (let i = at + 1; at >= 0 && i < lines.length && /^\s+\S/.test(lines[i]); i += 1) {
      const m = /^\s+['"]?([^'":]+)['"]?:\s*['"]?([^'"]+?)['"]?\s*$/.exec(lines[i]);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

/** `@scope/name@1.2.3` → `{ name: "@scope/name", version: "1.2.3" }`; bare name → version null. */
function parseKey(key) {
  const at = key.lastIndexOf("@");
  if (at <= 0) return { name: key, version: null };
  const version = key.slice(at + 1);
  if (!EXACT_VERSION_RE.test(version)) {
    throw new ConfigError(`patchedDependencies key ${JSON.stringify(key)}: only exact versions are checked, not ${JSON.stringify(version)}`);
  }
  return { name: key.slice(0, at), version };
}

/** The version in `dir/package.json`, or null when unreadable. */
function versionOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

const matches = (dir, version) => version === null || versionOf(dir) === version;

/** Every copy of `name` some importer links to (at `version`, or any when null), as distinct real paths. */
function linkedCopies(root, name, version) {
  const modules = path.join(root, "node_modules");
  const store = path.join(modules, ".pnpm");
  const candidates = [path.join(modules, name), path.join(store, "node_modules", name)];
  if (fs.existsSync(store)) {
    for (const entry of fs.readdirSync(store)) {
      const p = path.join(store, entry, "node_modules", name);
      try {
        if (fs.lstatSync(p).isSymbolicLink()) candidates.push(p);
      } catch {
        // No such entry under this importer.
      }
    }
  }
  const real = new Set();
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const dir = fs.realpathSync(p);
    if (matches(dir, version)) real.add(dir);
  }
  return [...real].sort();
}

/** Copies of `name` in `.pnpm` that no importer links to: leftovers, reported but not checked. */
function unlinkedCopies(root, name, version, linked) {
  const store = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(store)) return [];
  const prefix = `${name.replace("/", "+")}@`;
  return fs
    .readdirSync(store)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => path.join(store, entry, "node_modules", name))
    .filter((dir) => fs.existsSync(dir) && !fs.lstatSync(dir).isSymbolicLink())
    .map((dir) => fs.realpathSync(dir))
    .filter((dir) => !linked.includes(dir) && matches(dir, version))
    .sort();
}

const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

function describe(finding) {
  switch (finding.kind) {
    case "missing":
      return "file is missing";
    case "present":
      return "file should have been deleted by the patch but is still there";
    case "unpatched":
      return `hunk ${finding.hunk} (${finding.header}) not applied: the original lines are still there; expected ${JSON.stringify(finding.expected.trim())}`;
    case "drifted":
      return `hunk ${finding.hunk} (${finding.header}) matches neither the original nor the patched text; expected ${JSON.stringify(finding.expected.trim())}`;
    default:
      throw new Error(`unhandled finding kind ${finding.kind}`);
  }
}

/** Check one patched dependency; returns the failure lines (empty when every copy carries the patch). */
function checkEntry(root, key, patchRel) {
  const { name, version } = parseKey(key);
  const patchFile = path.join(root, patchRel);
  if (!fs.existsSync(patchFile)) throw new ConfigError(`${key}: patch file ${patchRel} does not exist`);
  const patchText = fs.readFileSync(patchFile, "utf8");
  const copies = linkedCopies(root, name, version);
  for (const dir of unlinkedCopies(root, name, version, copies)) {
    console.error(`${TAG} note: ${rel(root, dir)} is not linked from any importer; ignored`);
  }
  if (copies.length === 0) return { copies, problems: [`  ${key} is not installed under node_modules (no importer links to it)`] };
  const problems = [];
  for (const dir of copies) {
    let findings;
    try {
      findings = checkPatchApplied(patchText, (file) => {
        const p = path.join(dir, file);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
      });
    } catch (error) {
      if (error instanceof PatchParseError) throw new ConfigError(`${patchRel}: ${error.message}`);
      throw error;
    }
    for (const f of findings) problems.push(`  ${rel(root, path.join(dir, f.file))}: ${describe(f)}`);
  }
  return { copies, problems };
}

function main() {
  const root = parseArgs(process.argv.slice(2));
  const entries = Object.entries(patchedDependencies(root));
  let failed = false;
  const ok = [];
  for (const [key, patchRel] of entries) {
    const { copies, problems } = checkEntry(root, key, patchRel);
    if (problems.length === 0) {
      ok.push(`${key} (${copies.length} ${copies.length === 1 ? "copy" : "copies"})`);
      continue;
    }
    failed = true;
    console.error(`${TAG} ${key} is installed without its patch (${patchRel})`);
    for (const line of problems) console.error(line);
  }
  if (failed) {
    console.error(`${TAG} node_modules does not carry every patch in pnpm.patchedDependencies; building now would ship unpatched code.`);
    console.error(`${TAG} An incremental install can create the patched directory with the original files inside (D181).`);
    console.error(`${TAG} ${FIX}`);
    return 1;
  }
  console.log(entries.length === 0 ? `${TAG} no patchedDependencies to check` : `${TAG} OK, patch in effect: ${ok.join(", ")}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`${TAG} ${error.message}`);
  process.exitCode = 2;
}
