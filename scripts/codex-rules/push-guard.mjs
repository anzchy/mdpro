#!/usr/bin/env node
/** Purpose: check delegator identity, remote, PR state and destination before a branch push. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mainCheckout, underTmp } from "./install-role.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APPROVED = new Set(["https://github.com/anzchy/mdpro.git", "git@github.com:anzchy/mdpro.git"]);
export function fail(message) { throw Error(message); }
export function run(file, args, cwd = ROOT) {
  const r = spawnSync(file, args, { cwd, encoding: "utf8" });
  if (r.error) fail(`${file}: ${r.error.message}`);
  return r;
}
export function git(...args) {
  const r = run("git", args);
  if (r.status !== 0) fail(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout.trim();
}
export function checkedContext() {
  mainCheckout(ROOT);
  if (fs.realpathSync(process.cwd()) !== ROOT || fs.realpathSync(git("rev-parse", "--show-toplevel")) !== ROOT) {
    fail("run from the worktree that contains this script");
  }
  const overlay = path.join(ROOT, ".codex/rules/mdpro-role.rules");
  if (!fs.existsSync(overlay) || !fs.lstatSync(overlay).isFile() || fs.lstatSync(overlay).isSymbolicLink() ||
      !fs.readFileSync(overlay, "utf8").startsWith("# Local mdpro role: delegator\n")) {
    fail("delegator role overlay required");
  }
  if (Object.hasOwn(process.env, "GIT_CONFIG_COUNT") || Object.hasOwn(process.env, "GIT_CONFIG_PARAMETERS")) {
    fail("GIT_CONFIG_* overrides are not allowed");
  }
  const rewrites = run("git", ["config", "--get-regexp", "^url\\..*\\.(push)?insteadof$"]);
  if (rewrites.status === 0 && rewrites.stdout.trim()) fail("url.insteadOf and pushInsteadOf are not allowed");
  if (rewrites.status !== 1) fail("cannot verify URL rewrite config");
  const urls = git("remote", "get-url", "--push", "--all", "origin").split("\n").filter(Boolean);
  if (urls.length !== 1) fail("origin must have exactly one push URL");
  const url = urls[0];
  if (process.env.MDPRO_GUARD_TEST === "1") {
    const testOrigin = process.env.MDPRO_GUARD_TEST_ORIGIN;
    if (!testOrigin || !path.isAbsolute(testOrigin) || !underTmp(testOrigin) || !underTmp(url) ||
        fs.realpathSync(url) !== fs.realpathSync(testOrigin)) fail("test origin must be one local bare repository under tmpdir");
    if (git("--git-dir", url, "rev-parse", "--is-bare-repository") !== "true") fail("test origin must be bare");
  } else if (!APPROVED.has(url)) fail("unapproved origin push URL");
  return url;
}
export function commitOid(input) {
  if (!input || input.startsWith("-")) fail("commit SHA required");
  const r = run("git", ["rev-parse", "--verify", `${input}^{commit}`]);
  if (r.status !== 0) fail("SHA must resolve to a commit");
  return r.stdout.trim();
}
export function prList(branch) {
  const r = run("gh", ["pr", "list", "--repo", "anzchy/mdpro", "--head", branch, "--state", "open", "--json", "headRefOid"]);
  if (r.status !== 0) fail("open PR lookup failed");
  let prs;
  try { prs = JSON.parse(r.stdout); } catch { fail("open PR lookup returned malformed JSON"); }
  if (!Array.isArray(prs) || prs.some(pr => !pr || typeof pr.headRefOid !== "string")) fail("open PR lookup returned invalid shape");
  return prs;
}
function parse(argv) {
  const [sha, branch, ...rest] = argv;
  if (!sha || !branch) fail("usage: push-guard.mjs <sha> <branch> [--expected-remote-oid <oid>] [--dry-run]");
  let lease, dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--dry-run" && !dryRun) dryRun = true;
    else if (rest[i] === "--expected-remote-oid" && lease === undefined && rest[i + 1]) lease = rest[++i];
    else fail("unknown or duplicate push argument");
  }
  return { sha, branch, lease, dryRun };
}
export function push(argv = process.argv.slice(2)) {
  const { sha, branch, lease, dryRun } = parse(argv);
  const url = checkedContext();
  if (branch === "master" || branch === "frontend-backend-redesign" || branch.startsWith("release/") ||
      branch.startsWith("-") || branch.startsWith("refs/")) fail("protected push destination");
  const branchCheck = run("git", ["check-ref-format", "--branch", branch]);
  if (branchCheck.status !== 0) fail("invalid branch name");
  const oid = commitOid(sha);
  if (lease && !/^(?:[\da-fA-F]{40}|[\da-fA-F]{64})$/.test(lease)) fail("lease requires a full OID");
  const before = prList(branch);
  if (lease && (before.length !== 1 || before[0].headRefOid.toLowerCase() !== lease.toLowerCase())) {
    fail("leased push requires exactly one open PR at the expected remote OID");
  }
  const ref = `refs/heads/${branch}`;
  const args = ["push", "--no-follow-tags", ...(dryRun ? ["--dry-run"] : []),
    ...(lease ? [`--force-with-lease=${ref}:${lease.toLowerCase()}`] : []), url, `${oid}:${ref}`];
  const result = run("git", args);
  if (result.status !== 0) fail(result.stderr.trim() || "push failed");
  if (dryRun) { process.stdout.write(`dry run passed: ${sha} -> ${ref}; no ref changed\n`); return; }
  let after;
  try { after = prList(branch); }
  catch (error) { fail(`push may already have happened: ${error.message}`); }
  if ((lease && (after.length !== 1 || after[0].headRefOid.toLowerCase() !== oid.toLowerCase())) ||
      (!lease && after.some(pr => pr.headRefOid.toLowerCase() !== oid.toLowerCase()))) {
    fail("push may already have happened: PR head did not match the pushed SHA");
  }
  process.stdout.write(`pushed ${oid} to ${ref}; PR head checked\n`);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { push(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
