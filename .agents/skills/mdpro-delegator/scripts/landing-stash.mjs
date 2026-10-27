#!/usr/bin/env node
// Path-scoped landing stash. Resolve a fresh UUID marker to an immutable OID;
// apply that OID directly and retain every shared-stack entry.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const oidPattern = /^[0-9a-f]{40}$/;

function git(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { env: { ...process.env, LC_ALL: "C" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part) => { stdout += part.toString(); });
    child.stderr.on("data", (part) => { stderr += part.toString(); });
    child.on("error", (error) => reject(new Error(`git ${args[0]} could not start: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`git ${args[0]} failed (${code}): ${(stderr || stdout).trim()}`)));
  });
}

async function entries() {
  const lines = (await git(["stash", "list", "--format=%H%x09%gs"])).split("\n").filter(Boolean);
  return lines.map((line) => {
    const tab = line.indexOf("\t");
    const oid = line.slice(0, tab);
    if (tab < 0 || !oidPattern.test(oid)) throw new Error("git stash list returned an invalid entry");
    return { oid, subject: line.slice(tab + 1) };
  });
}

function testPath(value) {
  if (!value || !path.isAbsolute(value)) throw new Error("test barrier needs an absolute path");
  const temp = fs.realpathSync(os.tmpdir());
  const parent = fs.realpathSync(path.dirname(value));
  if (!parent.startsWith(`${temp}${path.sep}`)) throw new Error("test barrier must resolve under tmpdir");
  if (fs.existsSync(value) && fs.lstatSync(value).isSymbolicLink()) throw new Error("test barrier symlink refused");
  return value;
}

async function testBarrier(readyKey, gateKey) {
  if (process.env.MDPRO_GUARD_TEST !== "1") return;
  const ready = process.env[readyKey], gate = process.env[gateKey];
  if (!ready && !gate) return;
  const readyPath = testPath(ready), gatePath = testPath(gate);
  fs.writeFileSync(readyPath, "ready\n", { flag: "wx" });
  const deadline = Date.now() + 8000;
  while (fs.existsSync(gatePath)) {
    if (Date.now() >= deadline) throw new Error("test barrier timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function save(paths) {
  if (paths.length === 0) throw new Error("save needs one or more paths after --");
  const marker = `mdpro-land-${randomUUID()}`;
  try {
    const before = await entries();
    const output = await git(["stash", "push", "-m", marker, "--", ...paths]);
    if (!output.startsWith("Saved working directory and index state")) {
      throw new Error(`no stash created: ${output.trim() || "no save confirmation"}`);
    }
    await testBarrier("MDPRO_STASH_AFTER_PUSH_READY", "MDPRO_STASH_AFTER_PUSH_GATE");
    const matches = (await entries()).filter((entry) => entry.subject.endsWith(`: ${marker}`));
    if (matches.length !== 1 || before.some((entry) => entry.oid === matches[0]?.oid)) {
      throw new Error("ambiguous stash identity; inspect the shared stack before landing");
    }
    process.stdout.write(`${matches[0].oid}\n`);
  } catch (error) {
    throw new Error(`${error.message}; save marker ${marker}`);
  }
}

async function apply(oid) {
  if (!oidPattern.test(oid ?? "")) throw new Error("apply needs an exact 40-character stash OID");
  const matches = (await entries()).filter((entry) => entry.oid === oid);
  if (matches.length !== 1) throw new Error(`stash OID ${oid} is absent or ambiguous; no apply attempted`);
  await testBarrier("MDPRO_STASH_BEFORE_APPLY_READY", "MDPRO_STASH_BEFORE_APPLY_GATE");
  try {
    await git(["stash", "apply", oid]);
  } catch (error) {
    throw new Error(`stash apply failed for ${oid}; entry retained: ${error.message}`);
  }
  process.stdout.write(`APPLIED ${oid}; retained in shared stash stack\n`);
}

try {
  const [action, ...args] = process.argv.slice(2);
  if (action === "save" && args[0] === "--") await save(args.slice(1));
  else if (action === "apply" && args.length === 1) await apply(args[0]);
  else throw new Error("usage: landing-stash.mjs save -- <path>... | apply <oid>");
} catch (error) {
  process.stderr.write(`FAIL landing stash: ${error.message}\n`);
  process.exitCode = 1;
}
