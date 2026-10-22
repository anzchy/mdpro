#!/usr/bin/env node
/** Purpose: Compare Vitest's per-test JSON results with ADR-0128's inventory. */
import fs from "node:fs";
import path from "node:path";

const tags = new Set(["plugin", "macos", "hook-token", "rustfmt"]);
const key = (id) => JSON.stringify(id);
function validId(id) {
  return Array.isArray(id) && id.length >= 2 && id.every((part) => typeof part === "string" && part.length > 0) && id[0].startsWith("tests/");
}

export function parseInventory(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.tests) || !Array.isArray(value.exclusions)) throw Error("Malformed inventory");
  const seen = new Set();
  for (const item of value.tests) {
    if (!validId(item?.id) || !tags.has(item.prerequisite)) throw Error("Malformed inventory test");
    if (seen.has(key(item.id))) throw Error(`Duplicate inventory id: ${key(item.id)}`);
    seen.add(key(item.id));
  }
  for (const item of value.exclusions) {
    if (!validId(item?.id) || typeof item.reason !== "string" || !item.reason.trim()) throw Error("Malformed inventory exclusion");
    if (seen.has(key(item.id))) throw Error(`Duplicate inventory id: ${key(item.id)}`);
    seen.add(key(item.id));
  }
  return value;
}

export function parseReport(value, root) {
  if (value?.success !== true || !Array.isArray(value.testResults)) throw Error("Missing or malformed Vitest report");
  const results = [];
  for (const file of value.testResults) {
    if (typeof file?.name !== "string" || !Array.isArray(file.assertionResults) || !["passed", "failed"].includes(file.status)) throw Error("Malformed Vitest file result");
    const relative = path.relative(root, file.name).replaceAll("\\", "/");
    if (!relative.startsWith("tests/") || relative.startsWith("../")) throw Error(`Report file outside tests: ${file.name}`);
    for (const assertion of file.assertionResults) {
      if (!Array.isArray(assertion?.ancestorTitles) || typeof assertion.title !== "string" || !["passed", "failed", "skipped", "pending", "todo"].includes(assertion.status)) throw Error("Malformed Vitest assertion");
      const id = [relative, ...assertion.ancestorTitles, assertion.title];
      if (!validId(id)) throw Error(`Malformed report id: ${key(id)}`);
      results.push({ id, status: assertion.status });
    }
  }
  if (!results.length) throw Error("Empty Vitest report");
  return results;
}

export function profileFor(name) {
  if (!/^(ubuntu|macos)(\+rustfmt)?$/.test(name)) throw Error(`Unknown runner profile: ${name}`);
  const available = new Set();
  if (name.startsWith("macos")) available.add("macos");
  if (name.endsWith("+rustfmt")) available.add("rustfmt");
  return available;
}

export function compare(mode, report, inventory, profile, root) {
  const list = parseInventory(inventory);
  const results = parseReport(report, root);
  const reported = new Map(results.map((result) => [key(result.id), result]));
  const required = new Map(list.tests.map((item) => [key(item.id), item]));
  const excluded = new Set(list.exclusions.map((item) => key(item.id)));
  const findings = [];
  const repeated = new Map();
  for (const result of results) repeated.set(key(result.id), (repeated.get(key(result.id)) ?? 0) + 1);
  for (const [id, count] of repeated) {
    // Existing ungated parameterized suites contain repeated passing titles.
    // A gated or skipped identity must remain unambiguous on every runner.
    if (count > 1 && (required.has(id) || excluded.has(id) || results.some((result) => key(result.id) === id && result.status !== "passed"))) findings.push(`Duplicate gated report id: ${id}`);
  }
  const available = profileFor(profile);
  for (const item of list.tests) {
    const result = reported.get(key(item.id));
    if (!result) { findings.push(`Inventory test not collected: ${key(item.id)}`); continue; }
    if (mode === "verify" && result.status !== "passed") findings.push(`Inventory test did not pass: ${key(item.id)} (${result.status})`);
    if (mode === "ci") {
      if (result.status === "skipped" && available.has(item.prerequisite)) findings.push(`Unexpected skip: ${key(item.id)}`);
      if (result.status === "passed" && !available.has(item.prerequisite)) findings.push(`Stale inventory entry: ${key(item.id)}`);
      if (!["passed", "skipped"].includes(result.status)) findings.push(`Inventory test incomplete: ${key(item.id)} (${result.status})`);
    }
  }
  for (const result of results) {
    if (result.status === "pending" || result.status === "failed") findings.push(`Incomplete or failed test: ${key(result.id)} (${result.status})`);
    if (result.status === "skipped" && !required.has(key(result.id)) && !excluded.has(key(result.id))) findings.push(`Unexplained skip: ${key(result.id)}`);
  }
  if (findings.length) throw Error(findings.sort().join("\n"));
  return { total: results.length, passed: results.filter((result) => result.status === "passed").length };
}

/** Every non-excluded collected test must have passed on CI or locally. */
export function proveParity(ciReport, localReport, inventory, ciRoot, localRoot = ciRoot, ciProfile) {
  if (!ciProfile) throw Error("CI profile required for parity");
  const list = parseInventory(inventory);
  compare("ci", ciReport, list, ciProfile, ciRoot);
  compare("verify", localReport, list, "macos", localRoot);
  const excluded = new Set(list.exclusions.map((item) => key(item.id)));
  const ci = parseReport(ciReport, ciRoot), local = parseReport(localReport, localRoot);
  const required = new Set(ci.filter((item) => item.status !== "todo" && !excluded.has(key(item.id))).map((item) => key(item.id)));
  const executed = new Set([...ci, ...local].filter((item) => item.status === "passed" && !excluded.has(key(item.id))).map((item) => key(item.id)));
  const missing = [...required].filter((id) => !executed.has(id));
  const extra = [...executed].filter((id) => !required.has(id));
  if (missing.length || extra.length) throw Error(`Parity mismatch: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`);
  return { executed: executed.size, required: required.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [mode, reportPath, inventoryPath = "tests/ci-inventory.json", profile = "ubuntu", root = process.cwd(), localRoot = root, ciProfile] = process.argv.slice(2);
  try {
    if (mode === "parity") {
      const ci = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      const local = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
      const inventory = JSON.parse(fs.readFileSync(profile, "utf8"));
      const result = proveParity(ci, local, inventory, root, localRoot, ciProfile);
      process.stdout.write(`PARITY PASS (${result.executed}/${result.required} required IDs executed)\n`);
    } else {
      if (!["ci", "verify"].includes(mode)) throw Error("Expected ci, verify or parity mode");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
      const result = compare(mode, report, inventory, profile, root);
      process.stdout.write(`${mode} inventory PASS (${result.passed}/${result.total} tests passed)\n`);
    }
  } catch (error) {
    process.stderr.write(`${mode || "report"} inventory FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
