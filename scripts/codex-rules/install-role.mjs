#!/usr/bin/env node
/** Purpose: atomically provision a per-worktree Codex role policy. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAIN = "/Users/jack/Documents/mac-app/mdpro";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
function fail(message) { throw Error(message); }
function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) fail(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout.trim();
}
export function underTmp(value) {
  const real = fs.realpathSync(value);
  const temp = fs.realpathSync(os.tmpdir());
  return real.startsWith(`${temp}${path.sep}`);
}
export function mainCheckout(dir) {
  const actual = fs.realpathSync(dir);
  let expected = MAIN;
  if (process.env.MDPRO_GUARD_TEST === "1") {
    const override = process.env.MDPRO_GUARD_TEST_MAIN;
    if (!override || !path.isAbsolute(override) || !underTmp(override)) fail("test main override must resolve under tmpdir");
    expected = fs.realpathSync(override);
  }
  if (actual !== expected) fail("delegator requires the configured main checkout");
  if (fs.realpathSync(git(dir, "rev-parse", "--show-toplevel")) !== actual) fail("worktree top level differs");
  const gitDir = git(dir, "rev-parse", "--path-format=absolute", "--git-dir");
  const commonDir = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (fs.realpathSync(gitDir) !== fs.realpathSync(commonDir)) fail("linked worktree cannot hold delegator role");
  return actual;
}
function parse(argv) {
  let dir, role = "implementor";
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!["--worktree", "--role"].includes(flag) || seen.has(flag) || !value) fail("usage: --worktree <abs> [--role implementor|auditor|delegator]");
    seen.add(flag);
    if (flag === "--worktree") dir = value;
    else role = value;
  }
  if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir)) fail("worktree must be an existing absolute path");
  if (!["implementor", "auditor", "delegator"].includes(role)) fail("unknown role");
  return { dir, role };
}
export function install(argv = process.argv.slice(2)) {
  const { dir, role } = parse(argv);
  const rules = path.join(dir, ".codex/rules");
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(rules, "mdpro.rules"))) fail("worktree lacks shared mdpro.rules");
  if (role === "delegator") mainCheckout(dir);
  const target = path.join(rules, "mdpro-role.rules");
  if (fs.existsSync(target) || fs.lstatSync(rules).isDirectory()) {
    try { if (fs.lstatSync(target).isSymbolicLink()) fail("symlink role overlay refused"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  let body = `# Local mdpro role: ${role}\n`;
  if (role === "delegator") body += 'prefix_rule(\n    pattern = ["gh", "workflow", "run"],\n    decision = "prompt",\n    justification = "Release workflow dispatch requires user approval.",\n)\n';
  else body += fs.readFileSync(path.join(scriptDir, "restricted-role.rules"), "utf8");
  const temp = path.join(rules, `.role-${process.pid}-${Math.random().toString(16).slice(2)}`);
  try {
    fs.writeFileSync(temp, body, { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, target);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  process.stdout.write(`${role}: ${target}\n`);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { install(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
