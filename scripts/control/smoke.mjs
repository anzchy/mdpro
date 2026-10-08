/**
 * Purpose: The verify-bundle smoke driver (ADR-0047 WI-001 review closure, L1),
 * run by the tdd-guardian `integration` lane. It runs a real
 * `pnpm control:build --profile verify`, collects what the build left behind
 * and hands it to the pure checks in `smokeChecks.mjs`. Thin glue only: every
 * decision lives in `smokeChecks.mjs`.
 *
 * Pipeline:
 *   list bundle dir (before; [] when absent)
 *   → spawn `pnpm control:build --profile verify` (output inherited)
 *   → on exit 0: read manifest (null on ENOENT), list bundle dir (after),
 *     capture `codesign -dvvv` stderr → checkVerifyBundle
 *   → smokeExit → print formatSmokeSummary → exit code, or re-raise the signal
 *
 * Key decisions:
 * - Verify profile only; the release `--config` path is not exercised here.
 * - A failed build skips the inspection: its manifest was deleted by design,
 *   so inspecting would only restate the build failure smokeExit reports.
 * - `total` is the fixed count of named checks (SMOKE_CHECKS), raised to the
 *   failure count when several artifacts fail the one artifact check. A failed
 *   build inspected nothing, so its total is its failure count alone.
 * - A re-raised signal sets exitCode 1 first, so a signal Node ignores can
 *   never end the run as 0.
 * - The summary always goes to stdout as the last line. The plugin's count
 *   parser takes the first match in stdout + stderr, so this relies on the
 *   inherited build output carrying no count-shaped line of its own.
 *
 * @module scripts/control/smoke
 * @coordinates-with scripts/control/smokeChecks.mjs (every decision)
 * @coordinates-with scripts/control/buildSteps.mjs (buildLayout, codesignCommand)
 * @coordinates-with .claude/tdd-guardian/config.json (the `integration` lane)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout, codesignCommand } from "./buildSteps.mjs";
import { checkVerifyBundle, formatSmokeSummary, smokeExit } from "./smokeChecks.mjs";

/**
 * Named checks: build exit, manifest readable, updaterArtifacts, profile,
 * bundle, cdhash match, codesign parse, `.app` present, manifest file
 * present, no updater artifacts.
 */
const SMOKE_CHECKS = 10;

/** @param {string} dir @returns {string[]} entry names, [] when the dir is absent */
const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

/** @param {string} file @returns {string | null} */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const layout = buildLayout(repoRoot, "verify");
const listingBefore = listDir(layout.bundleDir);

const build = spawnSync("pnpm", ["control:build", "--profile", "verify"], { cwd: repoRoot, stdio: "inherit" });

let failures = [];
if (build.status === 0 && !build.signal) {
  const manifestText = readOrNull(layout.manifestPath);
  const listingAfter = listDir(layout.bundleDir);
  const [cmd, args] = codesignCommand(layout.app);
  const codesignText = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" }).stderr ?? "";
  const expectedBundleRel = path.relative(repoRoot, layout.app).split(path.sep).join("/");
  failures = checkVerifyBundle({ listingBefore, listingAfter, manifestText, codesignText, expectedBundleRel });
}

const outcome = smokeExit({ buildStatus: build.status, buildSignal: build.signal, failures });
if ("signal" in outcome) {
  // Fallback if the re-raised signal does not end the process (Node ignores SIGPIPE).
  process.exitCode = 1;
  process.kill(process.pid, outcome.signal);
} else {
  // A failed build inspected nothing, so only its failures count toward the total.
  const total = build.status === 0 ? Math.max(SMOKE_CHECKS, outcome.failures.length) : outcome.failures.length;
  const summary = formatSmokeSummary(total, outcome.failures);
  process.stdout.write(summary);
  process.exitCode = outcome.exit;
}
