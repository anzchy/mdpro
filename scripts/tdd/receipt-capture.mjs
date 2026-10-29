/**
 * Purpose: The entry's evidence at RED (ADR-0145 d1 and d6, as amended by ADR-0149 d1).
 * `prepare` runs before the plugin records; `capture` runs only after the plugin's record
 * succeeded and writes the pin ref, then the sidecar entry.
 *
 * Pipeline: prepare (ref name check, sidecar readable under the lock, test tree hashed,
 * fresh evidence dir) → lane runs with MDPRO_RED_EVIDENCE_DIR → capture (tree unchanged,
 * failing ids parsed from the lane's own output, ref created, entry written).
 *
 * Key decisions:
 * - The ref is created before the entry, so an entry never names a missing pin; a failure
 *   after the ref leaves only an orphan ref, which the 30-day sweep removes.
 * - The test tree is hashed before and after the lane; any change (a support file, a
 *   fixture) refuses: the RED's bytes must be the bytes that ran.
 * - The environment is a whitelist, so no token or secret reaches a tracked file.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-tree.mjs, scripts/tdd/receipt-evidence.mjs
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageError } from "./unit-red-lane.mjs";
import { failuresOf, libtestOutcomes, vitestOutcomes } from "./receipt-failures.mjs";
import { buildTree, git, pinRef, refFor, testPaths } from "./receipt-tree.mjs";
import { readEvidence, withEvidenceLock, writeEntry } from "./receipt-evidence.mjs";

const ENV_KEYS = ["CARGO_TARGET_DIR", "CI", "LANG", "NODE_ENV", "RUSTFLAGS", "RUST_BACKTRACE", "TZ", "VITEST_MAX_WORKERS"];

function pinPaths(cwd, specFiles) { return [...new Set([...testPaths(cwd), ...specFiles])].sort(); }

/** Checks that need nothing from the lane; returns the RED-time tree and the evidence dir. */
export function prepare(cwd, id, specFiles) {
  refFor(cwd, id, new Date().toISOString());
  withEvidenceLock(cwd, () => readEvidence(cwd));
  return { tree: buildTree(cwd, pinPaths(cwd, specFiles)), dir: mkdtempSync(join(tmpdir(), "mdpro-red-evidence-")) };
}

/** Per-test outcomes of the lane run whose output landed in `dir`. */
export function laneOutcomes(cwd, lane, dir) {
  const root = realpathSync.native(cwd);
  if (lane === "rust") {
    if (!existsSync(join(dir, "stdout.log")) && !existsSync(join(dir, "stderr.log"))) throw usageError("The rust lane left no output for the evidence.");
    const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "");
    return libtestOutcomes(read("stdout.log"), read("stderr.log"), root).outcomes;
  }
  let report;
  try { report = JSON.parse(readFileSync(join(dir, "vitest.json"), "utf8")); } catch { throw usageError("The lane left no readable Vitest JSON for the evidence."); }
  return vitestOutcomes(report, root);
}

export function envSnapshot() {
  return { ...Object.fromEntries(ENV_KEYS.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])), node: process.version, platform: process.platform };
}

/** After the plugin recorded `receipt`: pin the tree and write the sidecar entry. */
export function capture(cwd, { receipt, laneCommand, pluginVersion, prepared, specFiles }) {
  try {
    const tree = buildTree(cwd, pinPaths(cwd, specFiles));
    if (tree !== prepared.tree) throw usageError("Test paths changed while the lane ran; nothing was pinned. Discard the receipt and record again.");
    const failures = failuresOf(laneOutcomes(cwd, receipt.lane, prepared.dir));
    if (!failures.length) throw usageError("The lane's output named no failing test; no evidence was written.");
    const ref = refFor(cwd, receipt.id, receipt.recorded_at);
    const specBlobs = Object.fromEntries(specFiles.map((file) => [file, git(cwd, ["rev-parse", `${tree}:${file}`]).stdout.trim()]));
    pinRef(cwd, ref, tree);
    withEvidenceLock(cwd, () => writeEntry(cwd, receipt.id, {
      id: receipt.id, lane: receipt.lane, recorded_at: receipt.recorded_at, plugin_version: pluginVersion,
      lane_command: laneCommand, env: envSnapshot(), failures, tests_tree: { ref, tree }, spec_blobs: specBlobs,
    }));
    return failures;
  } finally { rmSync(prepared.dir, { recursive: true, force: true }); }
}
