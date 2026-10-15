#!/usr/bin/env node
/**
 * Purpose: The journey-catalogue gate, `pnpm journeys:check` (plan §4.5, §4.8,
 * ADR-0103). Runs the per-file and catalogue rules (`catalogue.mjs`), checks
 * every run manifest under `docs/test/journey-runs/` (`manifest.mjs`), and
 * holds the working tree against a base commit (`history.mjs`). Prints each
 * finding and exits 1 if there is any. stdout IS the interface, so
 * `console.log` is correct here (rule 60's no-console rule scopes to `src/`).
 *
 * Usage:
 *   node scripts/journeys/check.mjs [--base <rev>]   check everything
 *   node scripts/journeys/check.mjs --write-count    regenerate the README count block
 *
 * In GitHub Actions the base comes from the event (GITHUB_EVENT_NAME,
 * GITHUB_EVENT_PATH, GITHUB_REF); locally it is the merge-base with master.
 * `--base` overrides both. Plain node, no dependencies: CI runs it without
 * installing pnpm.
 *
 * @module scripts/journeys/check
 * @coordinates-with scripts/journeys/catalogue.mjs, scripts/journeys/history.mjs,
 *   scripts/journeys/manifest.mjs, .github/workflows/ci.yml
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { README_FILE, checkCatalogue, loadCatalogue, rewriteCount } from "./catalogue.mjs";
import { checkHistory, gitIn, resolveBase } from "./history.mjs";
import { RUNS_DIR, checkManifest } from "./manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function writeCount() {
  const metas = loadCatalogue(ROOT).map((j) => j.meta).filter(Boolean);
  const abs = path.join(ROOT, README_FILE);
  const next = fs.existsSync(abs) ? rewriteCount(fs.readFileSync(abs, "utf8"), metas) : null;
  if (next === null) {
    console.log(`${README_FILE} has no <!-- journeys:count --> block to rewrite`);
    return 1;
  }
  fs.writeFileSync(abs, next);
  console.log(`${README_FILE}: count block rewritten for ${metas.length} journeys`);
  return 0;
}

function checkManifests(journeys) {
  const dir = path.join(ROOT, RUNS_DIR);
  if (!fs.existsSync(dir)) return [];
  const catalogue = new Map(journeys.filter((j) => j.meta).map((j) => [j.meta.id, j.meta]));
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const file = `${RUNS_DIR}/${name}`;
      try {
        return checkManifest(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")), catalogue).map((f) => ({ ...f, file }));
      } catch (error) {
        return [{ rule: "manifest-schema", message: `not JSON: ${error instanceof Error ? error.message : String(error)}`, file }];
      }
    });
}

function checkAgainstBase() {
  const run = gitIn(ROOT);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const payload = eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, "utf8")) : {};
  let headSha = "";
  try {
    headSha = run(["rev-parse", "HEAD"]);
  } catch {
    return { findings: [{ rule: "journey-base", message: "not a git checkout; the history rules cannot run" }] };
  }
  const resolved = resolveBase({
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    payload,
    ref: process.env.GITHUB_REF ?? "",
    headSha,
    explicit: argValue("--base"),
    run,
  });
  if ("error" in resolved) return { findings: [{ rule: "journey-base", message: resolved.error }] };
  return { base: resolved.base, findings: checkHistory(ROOT, resolved.base) };
}

function main() {
  if (process.argv.includes("--write-count")) return writeCount();
  const journeys = loadCatalogue(ROOT);
  const history = checkAgainstBase();
  const findings = [...checkCatalogue(ROOT), ...checkManifests(journeys), ...history.findings];

  const ids = journeys.map((j) => j.meta?.id ?? j.name).join(", ") || "none";
  console.log(`journeys:check: ${journeys.length} journey(s) [${ids}], base ${history.base?.slice(0, 7) ?? "unresolved"}`);
  for (const f of findings) console.log(`  ${f.rule}${f.file ? ` ${f.file}` : ""}: ${f.message}`);
  console.log(findings.length === 0 ? "journeys:check: OK" : `journeys:check: ${findings.length} finding(s)`);
  return findings.length === 0 ? 0 : 1;
}

process.exit(main());
