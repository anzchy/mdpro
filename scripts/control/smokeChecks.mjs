/**
 * Purpose: The decisions of the verify-bundle smoke (ADR-0047 WI-001 review
 * closure, L1), as pure functions over what the driver collected: the bundle
 * directory listed before and after `control:build --profile verify`, the
 * manifest text, and the `codesign -dvvv` stderr. No I/O happens here; the
 * driver reads, spawns and prints.
 *
 * Pipeline:
 *   checkVerifyBundle(inputs)          → string[] failures, [] when the bundle is good
 *   smokeExit({buildStatus, buildSignal, failures})
 *                                      → { signal } to re-raise, or { exit, failures }
 *   formatSmokeSummary(total, failures) → failure lines + "=== N passed, M failed ==="
 *
 * Key decisions:
 * - Failure order is fixed: manifest (not found | not JSON | not an object |
 *   updaterArtifacts, profile, bundle, cdhash) → codesign parse → `.app`
 *   missing → manifest file missing → updater artifacts sorted by name (code
 *   unit). The cdhash comparison is skipped when the manifest is unusable or
 *   codesign fails to parse, so one cause is reported once.
 * - The codesign text goes through `parseCodesign`, never a local regex, so
 *   the `Executable=` home path is dropped there; its `DigestError` message is
 *   reported verbatim (it names the field, never the value).
 * - An updater artifact is any `listingAfter` name ending `.app.tar.gz` or
 *   `.sig` (Tauri v2's `<name>.app.tar.gz(.sig)`); `listingBefore` only
 *   decides "stale" vs "created by this build".
 * - Paths in messages are repo-relative: the `expectedBundleRel` argument and
 *   its posix dirname, never `buildLayout`, so the caller decides the layout.
 * - No message carries a "N passed/failed" phrase or an exec.js
 *   UPGRADE_PATTERNS phrase, so the tdd-guardian plugin reads only the summary
 *   line's counts and never re-classifies a smoke failure as a broken runner.
 * - smokeExit: a signal always wins (the driver re-raises it); 75/126/127/130/
 *   137/143 pass through so the plugin keeps their meaning; any other
 *   non-zero build exit is 1. A build that never ran (status and signal both
 *   null, spawnSync error) is a failure, not a pass.
 *
 * @module scripts/control/smokeChecks
 * @coordinates-with scripts/control/smoke.mjs (the driver, WI-4)
 * @coordinates-with scripts/control/digests.mjs (parseCodesign)
 * @coordinates-with scripts/control/manifest.mjs (MANIFEST_FILE)
 */
import { parseCodesign } from "./digests.mjs";
import { MANIFEST_FILE } from "./manifest.mjs";

/** Build exit codes the plugin gives their own meaning to; passed through unchanged. */
const PASS_THROUGH_EXITS = new Set([75, 126, 127, 130, 137, 143]);
const UPDATER_SUFFIXES = [".app.tar.gz", ".sig"];

/** @param {string} name */
const isArtifact = (name) => UPDATER_SUFFIXES.some((s) => name.endsWith(s));

/** JSON rendering of a manifest value, or "missing" for an absent one. @param {unknown} v */
const show = (v) => (v === undefined ? "missing" : JSON.stringify(v));

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @typedef {{ listingBefore: readonly string[], listingAfter: readonly string[],
 *   manifestText: string | null, codesignText: string, expectedBundleRel: string }} SmokeInputs
 */

/**
 * Manifest checks, in order. Returns the failures and the parsed manifest
 * (null when it is unusable, which suppresses the cdhash check).
 * @param {string | null} text
 * @param {string} manifestRel
 * @param {string} expectedBundleRel
 * @returns {{ failures: string[], manifest: Record<string, unknown> | null }}
 */
function checkManifest(text, manifestRel, expectedBundleRel) {
  if (text === null) return { failures: [`manifest not found: ${manifestRel}`], manifest: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { failures: [`manifest is not valid JSON: ${manifestRel}`], manifest: null };
  }
  if (!isObject(parsed)) return { failures: [`manifest is not a JSON object: ${manifestRel}`], manifest: null };

  const failures = [];
  if (parsed.updaterArtifacts !== false) {
    failures.push(`manifest updaterArtifacts is ${show(parsed.updaterArtifacts)}, expected false`);
  }
  if (parsed.profile !== "verify") {
    failures.push(`manifest profile is ${show(parsed.profile)}, expected "verify"`);
  }
  if (parsed.bundle !== expectedBundleRel) {
    failures.push(`manifest bundle is ${show(parsed.bundle)}, expected "${expectedBundleRel}"`);
  }
  return { failures, manifest: parsed };
}

/**
 * Judge one verify build from what the driver collected.
 * @param {SmokeInputs} inputs
 * @returns {string[]} failures in a fixed order; empty means the bundle is good
 */
export function checkVerifyBundle({ listingBefore, listingAfter, manifestText, codesignText, expectedBundleRel }) {
  const slash = expectedBundleRel.lastIndexOf("/");
  const dir = expectedBundleRel.slice(0, slash);
  const appName = expectedBundleRel.slice(slash + 1);

  const { failures, manifest } = checkManifest(manifestText, `${dir}/${MANIFEST_FILE}`, expectedBundleRel);

  let cdhash = null;
  let codesignFailure = null;
  try {
    cdhash = parseCodesign(codesignText).cdhash;
  } catch (e) {
    codesignFailure = e instanceof Error ? e.message : String(e);
  }
  if (manifest !== null && cdhash !== null) {
    const m = isObject(manifest.codesign) ? manifest.codesign.cdhash : undefined;
    if (m !== cdhash) {
      failures.push(`manifest codesign.cdhash ${show(m)} does not match CDHash= ${cdhash} from codesign -dvvv`);
    }
  }
  if (codesignFailure !== null) failures.push(codesignFailure);

  if (!listingAfter.includes(appName)) failures.push(`${appName} missing from ${dir}`);
  if (!listingAfter.includes(MANIFEST_FILE)) failures.push(`${MANIFEST_FILE} missing from ${dir}`);

  const artifacts = [...new Set(listingAfter.filter(isArtifact))].sort();
  for (const name of artifacts) {
    failures.push(
      listingBefore.includes(name)
        ? `stale updater artifact (present before the build): ${dir}/${name}`
        : `updater artifact created by this build: ${dir}/${name}`,
    );
  }
  return failures;
}

/**
 * The smoke's own outcome from the build's exit and the bundle failures.
 * @param {{ buildStatus: number | null, buildSignal: string | null, failures: readonly string[] }} r
 * @returns {{ signal: string } | { exit: number, failures: string[] }}
 */
export function smokeExit({ buildStatus, buildSignal, failures }) {
  if (buildSignal) return { signal: buildSignal };
  const out = [...failures];
  if (buildStatus === null) {
    out.push("control:build did not run (no exit status)");
    return { exit: 1, failures: out };
  }
  if (buildStatus !== 0) {
    out.push(`control:build exited ${buildStatus}`);
    return { exit: PASS_THROUGH_EXITS.has(buildStatus) ? buildStatus : 1, failures: out };
  }
  return { exit: out.length > 0 ? 1 : 0, failures: out };
}

/**
 * Failure lines, then the count line the tdd-guardian plugin parses.
 * @param {number} total checks run
 * @param {readonly string[]} failures
 * @returns {string} newline-terminated; the last line is `=== N passed, M failed ===`
 */
export function formatSmokeSummary(total, failures) {
  const summary = `=== ${total - failures.length} passed, ${failures.length} failed ===`;
  return `${[...failures, summary].join("\n")}\n`;
}
