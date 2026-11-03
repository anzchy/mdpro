#!/usr/bin/env node
/** Purpose: Write a best-effort CI failure summary without affecting ci-gate. */
import fs from "node:fs";
import path from "node:path";

const reportName = ".ci-vitest-results.json";
const safeLine = (value) => String(value).replace(/[\r\n]+/g, " ").trim();

function findReports(location) {
  try {
    const stat = fs.statSync(location);
    if (stat.isFile()) return [location];
    if (!stat.isDirectory()) return [];
    return fs.readdirSync(location, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((item) => {
        const child = path.join(location, item.name);
        if (item.isDirectory()) return findReports(child);
        return item.isFile() && item.name === reportName ? [child] : [];
      });
  } catch {
    return [];
  }
}

function failedJobs(raw) {
  try {
    const needs = JSON.parse(raw ?? "");
    if (!needs || typeof needs !== "object" || Array.isArray(needs)) return [];
    return Object.entries(needs)
      .filter(([, value]) => value && typeof value === "object" && typeof value.result === "string" && value.result !== "success")
      .map(([name, value]) => `${safeLine(name)}: ${safeLine(value.result)}`);
  } catch {
    return [];
  }
}

function fileName(name) {
  const normalized = name.replaceAll("\\", "/");
  const marker = normalized.lastIndexOf("/tests/");
  return marker >= 0 ? normalized.slice(marker + 1) : normalized;
}

function failedTests(file) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(report?.testResults)) throw Error("missing testResults");
  const names = [];
  for (const result of report.testResults) {
    if (typeof result?.name !== "string" || !Array.isArray(result.assertionResults)) throw Error("malformed test result");
    for (const assertion of result.assertionResults) {
      if (assertion?.status !== "failed") continue;
      if (!Array.isArray(assertion.ancestorTitles) || typeof assertion.title !== "string") throw Error("malformed assertion");
      names.push([fileName(result.name), ...assertion.ancestorTitles, assertion.title].map(safeLine).join(" > "));
    }
  }
  return names;
}

function summary(needs, location) {
  const lines = ["## CI failure summary", "", "### Jobs"];
  const jobs = failedJobs(needs);
  lines.push(...(jobs.length ? jobs.map((job) => `- ${job}`) : ["- no non-success jobs"]));
  lines.push("", "### Failed tests");
  const files = findReports(location);
  if (!files.length) lines.push("- no test results");
  for (const file of files) {
    try {
      const tests = failedTests(file);
      lines.push(...(tests.length ? tests.map((test) => `- ${test}`) : ["- no failed tests"]));
    } catch {
      lines.push(`- no test results (${safeLine(path.basename(path.dirname(file)))})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

try {
  const output = summary(process.env.NEEDS, process.argv[2] ?? ".ci-vitest-artifacts");
  process.stdout.write(output);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} catch (error) {
  // A diagnostic must not turn an otherwise green gate red.
  process.stdout.write(`CI summary unavailable: ${safeLine(error instanceof Error ? error.message : error)}\n`);
}
