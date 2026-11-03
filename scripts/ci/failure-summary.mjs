#!/usr/bin/env node
/** Purpose: Write a best-effort CI failure summary without affecting ci-gate. */
import fs from "node:fs";
import path from "node:path";

const reportName = ".ci-vitest-results.json";
const fieldLimit = 160;
const reportLimit = 20;
const reportByteLimit = 1_000_000;
const outputByteLimit = 16_000;
const truncated = "[truncated]";

function safeLine(value) {
  const line = String(value).replace(/[\r\n]+/g, " ").trim();
  const clipped = line.length > fieldLimit ? line.slice(0, fieldLimit) : line;
  const escaped = clipped.replace(/[\\`*_\[\]<>|#!&]/g, "\\$&");
  return line.length > fieldLimit ? `${escaped}${truncated}` : escaped;
}

function findReports(location) {
  const files = [];
  let excess = false;
  function visit(current) {
    if (files.length >= reportLimit) {
      excess = true;
      return;
    }
    try {
      const stat = fs.statSync(current);
      if (stat.isFile()) {
        if (files.length < reportLimit) files.push(current);
        else excess = true;
        return;
      }
      if (!stat.isDirectory()) return;
      for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= reportLimit) {
          excess = true;
          break;
        }
        const child = path.join(current, item.name);
        if (item.isDirectory()) visit(child);
        else if (item.isFile() && item.name === reportName) visit(child);
      }
    } catch {
      // Missing or unreadable artifacts are diagnostic gaps, never gate failures.
    }
  }
  visit(location);
  return { files, excess };
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
  if (fs.statSync(file).size > reportByteLimit) return { tests: [], oversized: true };
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
  return { tests: names, oversized: false };
}

function boundedOutput(lines) {
  const kept = [];
  let bytes = 0;
  for (const line of lines) {
    const next = Buffer.byteLength(`${line}\n`);
    if (bytes + next > outputByteLimit) {
      const marker = `- ${truncated}`;
      while (kept.length && bytes + Buffer.byteLength(`${marker}\n`) > outputByteLimit) {
        bytes -= Buffer.byteLength(`${kept.pop()}\n`);
      }
      kept.push(marker);
      break;
    }
    kept.push(line);
    bytes += next;
  }
  return `${kept.join("\n")}\n`;
}

function summary(needs, location) {
  const lines = ["## CI failure summary", "", "### Jobs"];
  const jobs = failedJobs(needs);
  lines.push(...(jobs.length ? jobs.map((job) => `- ${job}`) : ["- no non-success jobs"]));
  lines.push("", "### Failed tests");
  const { files, excess } = findReports(location);
  if (!files.length) lines.push("- no test results");
  for (const file of files) {
    try {
      const { tests, oversized } = failedTests(file);
      if (oversized) {
        lines.push(`- no test results (${safeLine(path.basename(path.dirname(file)))}) ${truncated}`);
        continue;
      }
      lines.push(...(tests.length ? tests.map((test) => `- ${test}`) : ["- no failed tests"]));
    } catch {
      lines.push(`- no test results (${safeLine(path.basename(path.dirname(file)))})`);
    }
  }
  if (excess) lines.push(`- ${truncated} (additional reports)`);
  return boundedOutput(lines);
}

try {
  const output = summary(process.env.NEEDS, process.argv[2] ?? ".ci-vitest-artifacts");
  process.stdout.write(output);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} catch (error) {
  // A diagnostic must not turn an otherwise green gate red.
  process.stdout.write(`CI summary unavailable: ${safeLine(error instanceof Error ? error.message : error)}\n`);
}
