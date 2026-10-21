#!/usr/bin/env node
/** Purpose: Independently execute CI-missing tests on the local verifier. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compare, parseInventory } from "./compare-report.mjs";

export function hasPrerequisite(tag) {
  if (tag === "macos") return process.platform === "darwin";
  if (tag === "plugin") {
    const cache = path.join(os.homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
    return fs.existsSync(cache) && fs.readdirSync(cache).some((name) => fs.existsSync(path.join(cache, name, "scripts/tdd-guardian/receipt.js")));
  }
  if (tag === "hook-token") return fs.existsSync(path.join(os.homedir(), ".mdpro-redesign/hooks/token"));
  if (tag === "rustfmt") {
    const folders = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".cargo/bin")];
    return folders.some((folder) => folder && fs.existsSync(path.join(folder, "rustfmt")));
  }
  return false;
}

function executeReal(files, reportPath, root) {
  return spawnSync(path.join(root, "scripts/heavy-lock.sh"), [
    "pnpm", "exec", "vitest", "run", ...files,
    "--reporter=default", "--reporter=json", `--outputFile=${reportPath}`,
  ], { cwd: root, stdio: "inherit" });
}

export function verifyInventory({ root, inventory, prerequisites = hasPrerequisite, execute = (files, reportPath) => executeReal(files, reportPath, root), reportPath }) {
  try {
    const list = parseInventory(inventory);
    const tags = [...new Set(list.tests.map((item) => item.prerequisite))];
    for (const tag of tags) if (!prerequisites(tag)) throw Error(`Unavailable prerequisite: ${tag}`);
    const files = [...new Set(list.tests.map((item) => item.id[0]))].sort();
    for (const file of files) if (!fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) throw Error(`Inventory file deleted: ${file}`);
    const destination = reportPath ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-inventory-")), "vitest.json");
    if (fs.existsSync(destination)) fs.rmSync(destination);
    const child = execute(files, destination);
    if (child?.status !== 0 || child.error || child.signal) throw Error(`Inventory test process failed: ${child?.status ?? child?.signal ?? child?.error ?? "unknown"}`);
    const report = JSON.parse(fs.readFileSync(destination, "utf8"));
    const result = compare("verify", report, list, "macos", root);
    return { ok: true, reportPath: destination, files: files.length, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const root = process.cwd();
  const result = verifyInventory({ root, inventory: JSON.parse(fs.readFileSync("tests/ci-inventory.json", "utf8")), reportPath: process.env.MDPRO_INVENTORY_REPORT });
  if (result.ok) process.stdout.write(`Verifier inventory PASS (${result.passed}/${result.total}; ${result.files} files); report=${result.reportPath}\n`);
  else { process.stderr.write(`Verifier inventory FAIL: ${result.error}\n`); process.exitCode = 1; }
}
