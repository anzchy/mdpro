/**
 * Purpose: The `versions` group of the build manifest — which Tauri crates and
 * JS packages a build was made with. Crates come from `src-tauri/Cargo.lock`;
 * the two JS packages come from `node_modules/<pkg>/package.json`.
 *
 * Pipeline:
 *   cargoLockVersions(text, names)      → split into `[[package]]` blocks → keep the
 *                                         top-level `name = "…"` / `version = "…"`
 *                                         lines → per requested name, unique versions
 *                                         in semver order
 *   readNodeModuleVersion(root, pkg)    → node_modules/<pkg>/package.json → [version] | []
 *   collectVersions(root)               → the 10 names in VERSION_NAMES, each an array
 *
 * Key decisions:
 * - Every requested name is a key and every value is an array (plan O8): an
 *   absent crate or package is `[]`, never `null` and never omitted, so a
 *   manifest consumer can tell "not present" from "not asked".
 * - Only a block's own top-level `name =` / `version =` lines count. Lines in a
 *   `dependencies = [...]` list are quoted strings (`"tauri 1.0.0"`) and never
 *   match, and the name is compared exactly, so `tauri-build` is not `tauri`.
 *   The lock file's own top-level `version = 4` sits before any block and is ignored.
 * - Order is numeric semver precedence (major, minor, patch); a pre-release sorts
 *   before the same core without one, and pre-releases of the same core compare
 *   as plain strings (O14). A version that is not semver-shaped sorts after all
 *   semver-shaped ones, by plain string compare, so the order is still total.
 * - JS versions are read from `node_modules`, which is what was actually built,
 *   rather than from `pnpm-lock.yaml`, which would need a YAML parser
 *   (a recorded deviation from "read from the lock files", plan WI-7). A missing
 *   package.json is `[]`; an unreadable one, invalid JSON, or a non-string
 *   `version` throws `VersionsError` naming the package.
 * - A missing `src-tauri/Cargo.lock` throws: no build can have happened without it.
 *
 * @module scripts/control/versions
 * @coordinates-with scripts/control/manifest.mjs (the manifest's `versions` field)
 */
import fs from "node:fs";
import path from "node:path";

/** Crates recorded from `src-tauri/Cargo.lock`. */
export const CRATE_NAMES = Object.freeze([
  "tauri",
  "tauri-build",
  "wry",
  "tao",
  "tauri-plugin-opener",
  "tauri-plugin-single-instance",
  "tauri-plugin-updater",
  "tauri-plugin-process",
]);

/** JS packages recorded from `node_modules/<pkg>/package.json`. */
export const JS_PACKAGES = Object.freeze(["@tauri-apps/api", "@tauri-apps/cli"]);

/** All 10 keys of the manifest's `versions` group: crates first, then JS packages. */
export const VERSION_NAMES = Object.freeze([...CRATE_NAMES, ...JS_PACKAGES]);

const CARGO_LOCK_REL = ["src-tauri", "Cargo.lock"];

/** Thrown when a version source cannot be read or parsed; the message names the source. */
export class VersionsError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "VersionsError";
  }
}

/** @param {unknown} e */
const reason = (e) => (e instanceof Error ? e.message : String(e));

const BLOCK_HEADER = /^\[\[package\]\]\s*$/;
const TABLE_HEADER = /^\[/;
const NAME_LINE = /^name\s*=\s*"([^"]*)"\s*$/;
const VERSION_LINE = /^version\s*=\s*"([^"]*)"\s*$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]*))?(?:\+.*)?$/;

/**
 * Compare two non-negative decimal digit strings numerically, at any length.
 * @param {string} a
 * @param {string} b
 */
function compareDigits(a, b) {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** @param {string} a @param {string} b */
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Semver precedence: major, minor, patch numerically; a pre-release before the
 * plain release of the same core; pre-releases of one core by plain string compare.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (!ma || !mb) {
    if (ma) return -1;
    if (mb) return 1;
    return compareStrings(a, b);
  }
  for (let i = 1; i <= 3; i += 1) {
    const c = compareDigits(ma[i], mb[i]);
    if (c !== 0) return c;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa === undefined && pb === undefined) return compareStrings(a, b);
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  return compareStrings(pa, pb) || compareStrings(a, b);
}

/** @param {Iterable<string>} versions */
const uniqueSorted = (versions) => [...new Set(versions)].sort(compareVersions);

/**
 * @param {unknown} names
 * @returns {string[]}
 */
function checkNames(names) {
  if (!Array.isArray(names) || names.some((n) => typeof n !== "string" || n === "")) {
    throw new VersionsError("cargoLockVersions: names must be an array of non-empty strings");
  }
  return names;
}

/**
 * For each requested crate name, every version locked in `Cargo.lock`.
 * @param {string} text the lock file's contents
 * @param {readonly string[]} names crate names to report
 * @returns {Record<string, string[]>} one key per requested name; absent crates map to `[]`
 * @throws {VersionsError} when `text` is not a string or `names` is not a string array
 */
export function cargoLockVersions(text, names) {
  if (typeof text !== "string") {
    throw new VersionsError(`cargoLockVersions: expected the lock file as a string, got ${typeof text}`);
  }
  const wanted = checkNames(names);
  /** @type {Map<string, string[]>} */
  const found = new Map(wanted.map((n) => [n, []]));

  /** @type {{ name?: string, version?: string } | null} */
  let block = null;
  const flush = () => {
    if (block && block.name !== undefined && block.version !== undefined) {
      found.get(block.name)?.push(block.version);
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (BLOCK_HEADER.test(line)) {
      flush();
      block = {};
      continue;
    }
    if (TABLE_HEADER.test(line)) {
      flush();
      block = null;
      continue;
    }
    if (block === null) continue;
    const name = NAME_LINE.exec(line);
    if (name && block.name === undefined) block.name = name[1];
    const version = VERSION_LINE.exec(line);
    if (version && block.version === undefined) block.version = version[1];
  }
  flush();

  /** @type {Record<string, string[]>} */
  const out = {};
  for (const n of wanted) out[n] = uniqueSorted(/** @type {string[]} */ (found.get(n)));
  return out;
}

/**
 * The installed version of one package, from `node_modules/<pkg>/package.json`.
 * @param {string} repoRoot
 * @param {string} pkg package name, scoped names included (`@scope/name`)
 * @returns {string[]} `[version]`, or `[]` when the package.json does not exist
 * @throws {VersionsError} when the file cannot be read, is not valid JSON, or has
 *   no string `version`; the message names the package
 */
export function readNodeModuleVersion(repoRoot, pkg) {
  const file = path.join(repoRoot, "node_modules", ...pkg.split("/"), "package.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return [];
    throw new VersionsError(`readNodeModuleVersion: cannot read package.json of ${pkg}: ${reason(e)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new VersionsError(`readNodeModuleVersion: package.json of ${pkg} is not valid JSON: ${reason(e)}`);
  }
  const version = parsed !== null && typeof parsed === "object" ? parsed.version : undefined;
  if (typeof version !== "string" || version === "") {
    throw new VersionsError(`readNodeModuleVersion: package.json of ${pkg} has no string "version"`);
  }
  return [version];
}

/**
 * The manifest's `versions` group: all 10 names in VERSION_NAMES, each an array.
 * @param {string} repoRoot
 * @returns {Record<string, string[]>}
 * @throws {VersionsError} when `src-tauri/Cargo.lock` cannot be read, or a JS
 *   package's package.json is malformed
 */
export function collectVersions(repoRoot) {
  const lockPath = path.join(repoRoot, ...CARGO_LOCK_REL);
  let text;
  try {
    text = fs.readFileSync(lockPath, "utf8");
  } catch (e) {
    throw new VersionsError(`collectVersions: cannot read ${CARGO_LOCK_REL.join("/")}: ${reason(e)}`);
  }
  /** @type {Record<string, string[]>} */
  const out = cargoLockVersions(text, CRATE_NAMES);
  for (const pkg of JS_PACKAGES) out[pkg] = readNodeModuleVersion(repoRoot, pkg);
  return out;
}
