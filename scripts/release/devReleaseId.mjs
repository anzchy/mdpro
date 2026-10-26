#!/usr/bin/env node
/**
 * Purpose: Give internal app bundles a commit-specific release id without
 * changing the package version or the release workflow (D322).
 *
 * Pipeline: read package.json (or validated --version override) → read Git
 * HEAD and porcelain status → check GITHUB_SHA in CI → format the id.
 *
 * Key decisions:
 * - A package prerelease is refused. Appending `-dev` to an existing
 *   prerelease would invent an ordering rule for channels not yet designed.
 * - Dirty trees fail by default; --allow-dirty marks the value `dev.dirty`.
 * - Only the app build receives this id. The sidecar does not need one.
 *
 * @module scripts/release/devReleaseId
 * @coordinates-with src-tauri/src/services/release_info.rs (validates the id)
 * @coordinates-with .github/workflows/build-windows.yml (sets the app env)
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const CORE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Format a value accepted by release_info.rs, with no fabricated defaults.
 * @param {{version?: unknown, sha?: unknown, dirty?: boolean, allowDirty?: boolean}} input
 */
export function devReleaseId({ version, sha, dirty = false, allowDirty = false }) {
  if (typeof version !== "string" || !CORE_VERSION.test(version)) {
    throw new Error("version must be a MAJOR.MINOR.PATCH release without prerelease or build metadata");
  }
  if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
    throw new Error("sha must be the full 40-character lowercase Git HEAD");
  }
  if (dirty && !allowDirty) throw new Error("Git checkout is dirty; use --allow-dirty only for a marked local build");
  return `${version}-dev${dirty ? ".dirty" : ""}@${sha}`;
}

function parseArgs(args) {
  let allowDirty = false;
  let version;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-dirty" && !allowDirty) allowDirty = true;
    else if (args[i] === "--version" && version === undefined && args[i + 1] !== undefined) version = args[++i];
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  return { allowDirty, version };
}

/** Read Git and package state from cwd, then print exactly one id. */
export async function main(args = process.argv.slice(2), cwd = process.cwd(), env = process.env) {
  const options = parseArgs(args);
  const pkg = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  const version = options.version ?? pkg.version;
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    runFile("git", ["rev-parse", "HEAD"], { cwd, env }),
    runFile("git", ["status", "--porcelain"], { cwd, env }),
  ]);
  const sha = head.trim();
  if (Object.hasOwn(env, "GITHUB_SHA") && env.GITHUB_SHA !== sha) {
    throw new Error("GITHUB_SHA does not equal checked-out Git HEAD");
  }
  return devReleaseId({ version, sha, dirty: status.length > 0, allowDirty: options.allowDirty });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (id) => process.stdout.write(`${id}\n`),
    (error) => {
      process.stderr.write(`devReleaseId: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
