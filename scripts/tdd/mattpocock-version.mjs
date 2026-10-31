#!/usr/bin/env node
/**
 * Purpose: Decide whether an installed Matt Pocock skills plugin meets jack-tdd-workflow's minimum (#567 T-01), and read
 * whether Claude and Codex have it enabled.
 *
 * Pipeline: a cache root (`defaultCacheRoot`) → every version folder's `.claude-plugin/plugin.json` → the numerically
 * highest version, compared with MIN_VERSION. The enabled-state readers take file text, never a path, so they cannot write.
 *
 * Key decisions:
 * - Fail closed: an unknown directory, a bad manifest in any folder, or an unreadable root is `malformed`/`unreadable`,
 *   never skipped, because that folder may be the active install. Regular files and dot-entries are ignored.
 * - The highest folder is assumed active. Claude's installed_plugins.json lets the live test confirm it; Codex keeps no
 *   install record, so for Codex this is a known limit (named for T-02).
 * - Claude's enabled state is the last settings scope (user, project, local) that sets the key to a boolean.
 * - Codex's config.toml is read by a line scan of the plugin's own table, not a TOML parser.
 * - CLI: `node scripts/tdd/mattpocock-version.mjs <cacheDir>` prints one JSON line; exit 0 ok, 1 not ok, 2 usage.
 *
 * @coordinates-with tests/tooling/t567-mattpocock-version.test.ts — fixture, CLI and the live (`plugin`-tagged) case
 * @coordinates-with tests/ci-inventory.json — declares the live case so every CI runner may skip it
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MIN_VERSION = "1.3.1";
export const PLUGIN_NAME = "mattpocock-skills";

/** Negative, zero or positive as `a` is below, equal to or above `b`, comparing `X.Y.Z` per number. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index] - y[index];
  return 0;
}

const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The version a cache's version folder declares, or a `malformed` reason naming the folder. Never throws. */
function readFolder(cacheDir, folder) {
  if (!STRICT_VERSION.test(folder)) return { reason: `malformed: folder ${folder} is not a version` };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(cacheDir, folder, ".claude-plugin/plugin.json"), "utf8"));
  } catch (error) {
    return { reason: `malformed: ${folder}/.claude-plugin/plugin.json: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (manifest?.name !== PLUGIN_NAME) return { reason: `malformed: ${folder} names ${JSON.stringify(manifest?.name)}, not ${PLUGIN_NAME}` };
  if (manifest.version !== folder) return { reason: `malformed: folder ${folder} declares version ${JSON.stringify(manifest.version)}` };
  return { version: folder };
}

export function checkMattPocockVersion(cacheDir) {
  if (!statSync(cacheDir, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, version: null, reason: `missing: ${cacheDir} is not a directory` };
  let entries;
  try {
    entries = readdirSync(cacheDir, { withFileTypes: true });
  } catch (error) {
    return { ok: false, version: null, reason: `unreadable: ${cacheDir}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
  if (folders.length === 0) return { ok: false, version: null, reason: `missing: no version folder in ${cacheDir}` };
  const reads = folders.map((folder) => readFolder(cacheDir, folder));
  const bad = reads.find((read) => !read.version);
  if (bad) return { ok: false, version: null, reason: bad.reason };
  const [version] = reads.map((read) => read.version).sort((a, b) => compareVersions(b, a));
  if (compareVersions(version, MIN_VERSION) < 0) return { ok: false, version, reason: `too old: ${version} < ${MIN_VERSION}` };
  return { ok: true, version, reason: "ok" };
}
export const CLAUDE_PLUGIN_KEY = `${PLUGIN_NAME}@claude-plugins-official`;

/** Whether one Claude settings file's text sets `enabledPlugins[CLAUDE_PLUGIN_KEY]` to `true`, `false`, or not at all (`undefined`). */
function claudeSetting(text) {
  try {
    const value = JSON.parse(text)?.enabledPlugins?.[CLAUDE_PLUGIN_KEY];
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Claude's enabled state across its settings scopes, given as texts in precedence order (user, project, local; `null` for
 * a missing file): the last scope that sets the key to a boolean wins, and an invalid or non-boolean scope counts as unset.
 */
export function claudePluginEnabledAcross(texts) {
  let enabled = false;
  for (const text of texts) {
    const value = text == null ? undefined : claudeSetting(text);
    if (value !== undefined) enabled = value;
  }
  return enabled;
}

/** True only when the settings text sets the plugin's key to the boolean `true`. */
export function claudePluginEnabled(text) {
  return claudeSetting(text) === true;
}
export const CODEX_PLUGIN_TABLE = `[plugins."${PLUGIN_NAME}@mattpocock"]`;

/**
 * True only when Codex's config.toml text has the plugin's own table and that table sets `enabled = true`.
 * A line scan, not a TOML parser: a header ends the table, and a commented line counts for nothing.
 */
export function codexPluginEnabled(text) {
  let inTable = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (line.startsWith("[")) inTable = line === CODEX_PLUGIN_TABLE;
    else if (inTable && /^enabled\s*=\s*true$/.test(line)) return true;
  }
  return false;
}
/**
 * `{ version, installPath }` from Claude's installed_plugins.json text for the plugin's key: the user-scope entry when
 * there is one, else the first. `null` for invalid JSON, no entry, or a version or installPath that is not a non-empty
 * string. Never throws.
 */
export function claudeInstalledVersion(text) {
  let entries;
  try {
    entries = JSON.parse(text)?.plugins?.[CLAUDE_PLUGIN_KEY];
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const entry = entries.find((candidate) => candidate?.scope === "user") ?? entries[0];
  const { version, installPath } = entry ?? {};
  if (typeof version !== "string" || version === "" || typeof installPath !== "string" || installPath === "") return null;
  return { version, installPath };
}
const CACHE_ROOTS = {
  claude: [".claude/plugins/cache/claude-plugins-official", PLUGIN_NAME],
  codex: [".codex/plugins/cache/mattpocock", PLUGIN_NAME],
};

/** The plugin's cache root for `claude` or `codex` under `home`; throws for any other runtime. */
export function defaultCacheRoot(runtime, home) {
  if (!Object.hasOwn(CACHE_ROOTS, runtime)) throw new Error(`unknown runtime ${JSON.stringify(runtime)}: expected claude or codex`);
  return join(home, ...CACHE_ROOTS[runtime]);
}
/**
 * Whether the live, read-only case on the real caches runs: macOS only, and never on a GitHub runner (which sets
 * `RUNNER_OS`, even empty, and has no plugin cache). The case is declared with the `plugin` prerequisite in
 * tests/ci-inventory.json, so the CI comparator accepts its skip.
 */
export function liveCaseEnabled({ platform, env }) {
  return platform === "darwin" && !Object.hasOwn(env ?? {}, "RUNNER_OS");
}

/** CLI: `node scripts/tdd/mattpocock-version.mjs <cacheDir>` prints one JSON line; exit 0 ok, 1 not ok, 2 usage. */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cacheDir] = process.argv.slice(2);
  if (!cacheDir) {
    process.stderr.write("usage: node scripts/tdd/mattpocock-version.mjs <cacheDir>\n");
    process.exit(2);
  }
  const result = checkMattPocockVersion(cacheDir);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
