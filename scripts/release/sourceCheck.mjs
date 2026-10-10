/**
 * Purpose: The release preflight's source / tag / version consistency check
 * (D76-WI-1, requirement ②). Pure: the CLI `check-source.mjs` gathers the facts
 * (git, the three version files, GitHub release lookups) and this module
 * judges them.
 *
 * Pipeline:
 *   checkSource(facts) → mode → expectedVersion → ref is explicit → checkout is
 *                        the requested commit → three file versions → tag and
 *                        release conflicts (fatal in draft, warnings otherwise)
 *                        → draft version gate (same major.minor, greater patch)
 *                        → { ok, errors, warnings, sha, tag }
 *   parseCargoPackageVersion(text) → the `version =` inside `[package]` only
 *
 * Key decisions:
 * - Never throws: malformed facts become errors, so the CLI always prints a
 *   reason instead of a stack trace.
 * - A ref is explicit only as a full lowercase 40-hex SHA or exactly
 *   `v<expectedVersion>`. Branches, short SHAs and other tags move or are
 *   ambiguous, so they are refused.
 * - In `draft` mode an existing tag at another commit, any existing release on
 *   the tag (draft or published: the hand-made empty v0.3.0, plan §0.2) and a
 *   non-increasing version are errors. In `build-only` / `rehearsal-draft` the
 *   tag/release conflicts are warnings, because those modes write no tag and no
 *   `v*` release; file, version and SHA mismatches are errors in every mode.
 * - Version order is numeric per part (0.3.10 > 0.3.9) and patch-only within
 *   one major.minor (ADR-0069).
 * - `sha` and `tag` are returned only when `ok`, so a caller cannot use them
 *   from a failed check by accident.
 *
 * @module scripts/release/sourceCheck
 * @coordinates-with scripts/release/check-source.mjs (fact gathering, $GITHUB_OUTPUT)
 */

/** The workflow's three modes; anything else is an error. */
export const MODES = Object.freeze(["build-only", "draft", "rehearsal-draft"]);

/** `X.Y.Z` with no `v`, no pre-release and no build metadata. */
export const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const FULL_SHA = /^[0-9a-f]{40}$/;

/** The version files, keyed as in `facts.versions`, with the path printed in errors. */
export const VERSION_FILES = Object.freeze([
  ["packageJson", "package.json"],
  ["tauriConf", "src-tauri/tauri.conf.json"],
  ["cargoToml", "src-tauri/Cargo.toml"],
]);

/** @param {unknown} v */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** @param {string} v */
const parts = (v) => v.split(".").map(Number);

/**
 * The `version` of the `[package]` table: the first `version = "…"` line after
 * a `[package]` header and before the next table header. Dependency versions,
 * inline or in their own tables, never match.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseCargoPackageVersion(text) {
  if (typeof text !== "string") return null;
  let inPackage = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inPackage = /^\[package\]\s*(#.*)?$/.test(line);
      continue;
    }
    if (!inPackage) continue;
    const m = /^version\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/**
 * Draft-mode gate: `expected` must be a later patch of `latest`'s major.minor.
 * @param {string} expected strict version
 * @param {unknown} latestPublished the latest published release's tag (`v0.3.0`) or version
 * @returns {string | null} an error, or null when it passes
 */
function versionGateError(expected, latestPublished) {
  if (typeof latestPublished !== "string" || latestPublished === "") {
    return "draft mode needs the latest published release to compare against; none was found";
  }
  const latest = latestPublished.replace(/^v/, "");
  if (!STRICT_VERSION.test(latest)) {
    return `latest published release ${JSON.stringify(latestPublished)} is not an X.Y.Z version`;
  }
  const [ea, eb, ec] = parts(expected);
  const [la, lb, lc] = parts(latest);
  if (ea !== la || eb !== lb) {
    return `version ${expected} changes major.minor from ${latest}; releases are patch-only (ADR-0069)`;
  }
  if (ec <= lc) return `version ${expected} is not greater than the latest published ${latest}`;
  return null;
}

/**
 * @param {unknown} facts see the plan's `facts` shape (D76-WI-1)
 * @returns {{ ok: boolean, errors: string[], warnings: string[], sha: string | null, tag: string | null }}
 */
export function checkSource(facts) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const fail = () => ({ ok: false, errors, warnings, sha: null, tag: null });
  if (!isObj(facts)) {
    errors.push("source facts are missing or not an object");
    return fail();
  }
  const f = /** @type {Record<string, unknown>} */ (facts);

  const mode = typeof f.mode === "string" && MODES.includes(f.mode) ? f.mode : null;
  if (!mode) errors.push(`mode ${JSON.stringify(f.mode)} is not one of ${MODES.join(", ")}`);
  const strict = mode === "draft";

  const version = typeof f.expectedVersion === "string" && STRICT_VERSION.test(f.expectedVersion) ? f.expectedVersion : null;
  if (!version) {
    errors.push(`version ${JSON.stringify(f.expectedVersion)} must be X.Y.Z (no "v", no pre-release)`);
  }
  const tag = version ? `v${version}` : null;

  const ref = f.refInput;
  const refIsSha = typeof ref === "string" && FULL_SHA.test(ref);
  const refIsTag = tag !== null && ref === tag;
  if (!refIsSha && !refIsTag) {
    errors.push(
      `ref ${JSON.stringify(ref)} must be an explicit SHA or tag: a full 40-hex commit SHA or exactly ${tag ?? "v<version>"}`,
    );
  }

  const head = typeof f.headSha === "string" && FULL_SHA.test(f.headSha) ? f.headSha : null;
  if (!head) errors.push("the checked-out HEAD SHA is missing or not a 40-hex SHA");
  if (head && f.refSha !== head) {
    errors.push(`checkout HEAD ${head} is not the requested ref's commit ${String(f.refSha)}`);
  }
  if (head && refIsSha && ref !== head) {
    errors.push(`checkout HEAD ${head} is not the requested SHA ${ref}`);
  }

  const versions = isObj(f.versions) ? /** @type {Record<string, unknown>} */ (f.versions) : {};
  for (const [key, file] of VERSION_FILES) {
    const v = versions[key];
    if (version && v !== version) {
      errors.push(`version mismatch: ${file} = ${typeof v === "string" ? v : "(none)"} (expected ${version})`);
    }
  }

  const conflict = (/** @type {string} */ msg) => (strict ? errors : warnings).push(msg);
  if (tag && f.tagSha != null && f.tagSha !== head) {
    conflict(`tag ${tag} already exists at ${String(f.tagSha)}, not at ${head ?? "HEAD"}`);
  }
  if (tag && isObj(f.existingRelease)) {
    const kind = /** @type {{isDraft?: unknown}} */ (f.existingRelease).isDraft === true ? "a draft" : "a published";
    conflict(`${kind} release already exists on tag ${tag}`);
  }
  if (strict && version) {
    const gate = versionGateError(version, f.latestPublished);
    if (gate) errors.push(gate);
  }

  if (errors.length) return fail();
  return { ok: true, errors, warnings, sha: head, tag };
}
