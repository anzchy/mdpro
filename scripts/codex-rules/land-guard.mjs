#!/usr/bin/env node
/** Purpose: fast-forward a checked PR head or push validated docs-only commits onto master. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkedContext, commitOid, fail, git, run } from "./push-guard.mjs";

function parse(argv) {
  const [sha, ...rest] = argv;
  if (sha === "--docs-only" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--dry-run"))) {
    return { docsOnly: true, dryRun: rest[0] === "--dry-run" };
  }
  if (!sha || rest.some(arg => arg !== "--dry-run") || rest.length > 1) {
    fail("usage: land-guard.mjs <sha> [--dry-run] | --docs-only [--dry-run]");
  }
  return { sha, dryRun: rest[0] === "--dry-run" };
}
function allowedDocsPath(name) {
  return name.startsWith("docs/") ||
    (name.startsWith("design/") && name.endsWith(".md")) ||
    ["CHANGELOG.md", "CLAUDE.md", "AGENTS.md"].includes(name) ||
    /^\.claude\/(?:rules|agents)\/[^/]+\.md$/.test(name);
}
function protectedDimensionsPath(name) {
  return path.posix.normalize(name.replace(/^(\.\/)+/, "")).toLowerCase() === "docs/agents/audit-dimensions.md";
}
function openPrs() {
  const r = run("gh", ["pr", "list", "--repo", "anzchy/mdpro", "--state", "open", "--json", "headRefOid,statusCheckRollup"]);
  if (r.status !== 0) fail("open PR lookup failed");
  let prs;
  try { prs = JSON.parse(r.stdout); } catch { fail("open PR lookup returned malformed JSON"); }
  if (!Array.isArray(prs) || prs.some(pr => !pr || typeof pr.headRefOid !== "string" || !Array.isArray(pr.statusCheckRollup))) {
    fail("open PR lookup returned invalid shape");
  }
  return prs;
}
function assertCleanIndex() {
  const staged = run("git", ["diff", "--cached", "--quiet"]);
  if (staged.status !== 0) fail("staged changes forbid landing");
}
export function land(argv = process.argv.slice(2)) {
  const { sha, docsOnly, dryRun } = parse(argv);
  const url = checkedContext();
  if (git("symbolic-ref", "--quiet", "--short", "HEAD") !== "master") fail("landing requires local master");
  assertCleanIndex();
  const oid = docsOnly ? git("rev-parse", "HEAD") : commitOid(sha);
  const original = git("rev-parse", "refs/heads/master");
  git("fetch", url, "master");
  const remote = git("rev-parse", "FETCH_HEAD");
  const ancestor = run("git", ["merge-base", "--is-ancestor", remote, oid]);
  if (ancestor.status !== 0) fail("candidate does not descend from fetched remote master");
  if (docsOnly) {
    if (remote === oid) fail("docs-only push requires commits ahead of remote master");
    const diff = run("git", ["diff-tree", "--no-commit-id", "--no-renames", "--name-only", "-z", "-r", `${remote}..${oid}`]);
    if (diff.status !== 0) fail("cannot read docs-only changed paths");
    const changed = diff.stdout.split("\0").filter(Boolean);
    if (changed.some(name => protectedDimensionsPath(name) || /^120000 blob /.test(git("ls-tree", oid, "--", name)))) {
      fail("ADR-0146 decision 1: audit dimensions changes require a High-tier PR under the old pin and both-auditor plan review; docs-only landing also refuses changed symlinks");
    }
    if (!changed.length || changed.some(name => !allowedDocsPath(name))) fail("docs-only range contains a disallowed path");
    process.stdout.write("checked main role, origin, clean index, fetched ancestry and docs-only paths; PR, CI, verifier PASS and audit verdict are not checked\n");
    const result = run("git", ["push", "--no-follow-tags", ...(dryRun ? ["--dry-run"] : []), url, `${oid}:refs/heads/master`]);
    if (result.status !== 0) fail(`non-fast-forward docs-only push rejected: ${result.stderr.trim()}`);
    process.stdout.write(dryRun ? "docs-only dry run passed; remote master unchanged\n" : "docs-only master pushed\n");
    return;
  }
  const matches = openPrs().filter(pr => pr.headRefOid.toLowerCase() === oid.toLowerCase());
  if (matches.length !== 1) fail("exactly one open PR must have the candidate head");
  const ci = matches[0].statusCheckRollup.filter(check => check.name === "ci-gate");
  if (ci.length !== 1 || !["success", "pass"].includes(String(ci[0].conclusion || ci[0].state || "").toLowerCase())) {
    fail("ci-gate must be green for the PR head");
  }
  process.stdout.write("checked main role, origin, clean index, fetched ancestry, one PR head and ci-gate; verifier PASS and audit verdict are not checked\n");
  if (dryRun) {
    const probe = run("git", ["push", "--no-follow-tags", "--dry-run", url, `${oid}:refs/heads/master`]);
    if (probe.status !== 0) fail(probe.stderr.trim() || "dry-run push failed");
    process.stdout.write("dry run passed; local and remote master unchanged\n");
    return;
  }
  const merged = run("git", ["merge", "--ff-only", oid]);
  if (merged.status !== 0) fail(merged.stderr.trim() || "fast-forward merge failed");
  const pushed = run("git", ["push", "--no-follow-tags", url, `${oid}:refs/heads/master`]);
  if (pushed.status !== 0) {
    const rollback = run("git", ["reset", "--keep", original]);
    if (rollback.status !== 0) fail(`non-fast-forward push rejected; local rollback failed: ${rollback.stderr.trim()}`);
    fail(`non-fast-forward push rejected; local master restored: ${pushed.stderr.trim()}`);
  }
  process.stdout.write(`landed ${oid} on master\n`);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { land(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
