#!/usr/bin/env node
/** Purpose: Enforce ADR-0128's configured per-file critical coverage floors. */
import fs from "node:fs";
import path from "node:path";

function regexForGlob(glob) {
  const source = glob.replaceAll("\\", "/");
  let expression = "";
  for (let i = 0; i < source.length; i++) {
    if (source.slice(i, i + 3) === "**/") { expression += "(?:[^/]+/)*"; i += 2; }
    else if (source[i] === "*") expression += "[^/]*";
    else expression += source[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`(?:^|/)${expression}$`);
}

export function checkCriticalCoverage(summary, config) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw Error("Malformed coverage summary");
  if (!Array.isArray(config?.criticalPaths) || !config.criticalPaths.length) throw Error("Missing criticalPaths");
  const files = Object.entries(summary).filter(([key]) => key !== "total");
  for (const rule of config.criticalPaths) {
    if (typeof rule.glob !== "string" || !rule.thresholds || typeof rule.thresholds !== "object") throw Error("Malformed critical path rule");
    const pattern = regexForGlob(rule.glob);
    const matches = files.filter(([file]) => pattern.test(file.replaceAll("\\", "/")));
    if (!matches.length) throw Error(`Critical path glob matched no file: ${rule.glob}`);
    for (const [file, metrics] of matches) {
      for (const [name, floor] of Object.entries(rule.thresholds)) {
        const pct = metrics?.[name]?.pct;
        if (typeof floor !== "number" || !Number.isFinite(floor) || typeof pct !== "number" || !Number.isFinite(pct)) throw Error(`Malformed ${name} coverage for ${file}`);
        if (pct < floor) throw Error(`${file}: ${name} ${pct}% below ${floor}%`);
      }
    }
  }
  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [report = "coverage/coverage-summary.json", settings = ".claude/tdd-guardian/config.json"] = process.argv.slice(2);
  try {
    const count = checkCriticalCoverage(JSON.parse(fs.readFileSync(report, "utf8")), JSON.parse(fs.readFileSync(settings, "utf8")));
    process.stdout.write(`Critical coverage PASS (${count} covered files)\n`);
  } catch (error) {
    process.stderr.write(`Critical coverage FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
