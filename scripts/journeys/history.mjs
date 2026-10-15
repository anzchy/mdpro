/**
 * Purpose: The history rules of the journey gate (plan §4.5, §4.8): against a
 * base commit, REGISTRY.md only grows, no journey file is deleted, and no case
 * id is removed or brought back from retirement. Also resolves that base for
 * each way the gate runs.
 *
 * Key decisions:
 * - The base resolves per event (plan §4.8): a pull request uses its base
 *   sha; a `v*` tag uses the previous `v*` tag, so every commit between two
 *   releases is covered; a manual dispatch must name one; a local run uses
 *   the merge-base with master. In CI a base that cannot be resolved, or that
 *   equals HEAD, is a failure, never a skip: comparing HEAD with itself
 *   proves nothing. Locally, on master itself, HEAD is the honest base.
 * - Renaming a journey file is not a deletion: a file is identified by the
 *   `EJ-NNN` its name starts with.
 * - The working tree is compared, not HEAD, so an uncommitted deletion is
 *   caught before it is committed.
 *
 * @module scripts/journeys/history
 * @coordinates-with scripts/journeys/catalogue.mjs, scripts/journeys/check.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CATALOGUE_DIR, REGISTRY_FILE, loadCatalogue, parseRegistry } from "./catalogue.mjs";
import { parseJourney } from "./parse.mjs";

const CI_EVENTS = new Set(["pull_request", "push", "workflow_dispatch"]);
const finding = (rule, message, file) => ({ severity: "error", rule, message, file });

/** A git runner bound to `root`: returns trimmed stdout, throws on a non-zero exit. */
export function gitIn(root) {
  return (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * @param {{ eventName?: string, payload?: object, ref?: string, headSha: string,
 *           explicit?: string, run: (args: string[]) => string }} ctx
 * @returns {{ base: string } | { error: string }}
 */
export function resolveBase({ eventName = "", payload = {}, ref = "", headSha, explicit, run }) {
  const commit = (rev) => run(["rev-parse", `${rev}^{commit}`]);
  let base;
  try {
    if (explicit) return { base: commit(explicit) };
    if (eventName === "pull_request") {
      base = payload?.pull_request?.base?.sha;
      if (!base) return { error: "pull_request event has no base sha" };
    } else if (eventName === "push" && ref.startsWith("refs/tags/v")) {
      const previous = run(["describe", "--tags", "--abbrev=0", "--match", "v*", `${ref}^`]);
      base = commit(previous);
    } else if (eventName === "workflow_dispatch") {
      const input = payload?.inputs?.base;
      if (!input) return { error: "workflow_dispatch needs the `base` input" };
      base = commit(input);
    } else if (!eventName) {
      return { base: run(["merge-base", "HEAD", "master"]) };
    } else {
      return { error: `no base rule for event "${eventName}"${ref ? ` (${ref})` : ""}` };
    }
  } catch (error) {
    return { error: `cannot resolve the base: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
  }
  if (CI_EVENTS.has(eventName) && base === headSha) return { error: `the base equals HEAD (${headSha}); nothing would be compared` };
  return { base };
}

/** The catalogue as it stood at `base`: registry ids and each journey file's id and metadata. */
function catalogueAt(run, base) {
  const show = (rel) => {
    try {
      return run(["show", `${base}:${rel}`]);
    } catch {
      return null;
    }
  };
  const registry = parseRegistry(show(REGISTRY_FILE) ?? "");
  let names = [];
  try {
    names = run(["ls-tree", "--name-only", `${base}`, `${CATALOGUE_DIR}/`])
      .split("\n")
      .map((p) => p.slice(CATALOGUE_DIR.length + 1))
      .filter((n) => /^EJ-\d{3}-.*\.md$/.test(n));
  } catch {
    names = [];
  }
  const journeys = names.map((name) => ({
    id: name.slice(0, 6),
    meta: parseJourney(show(`${CATALOGUE_DIR}/${name}`) ?? "").meta,
  }));
  return { registry, journeys };
}

/** @returns {object[]} history findings for the working tree at `root` against `base` */
export function checkHistory(root, base) {
  const run = gitIn(root);
  try {
    run(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch {
    return [finding("journey-base", `the base ${base} is not a commit in this repository`)];
  }
  const then = catalogueAt(run, base);
  const now = loadCatalogue(root);
  const out = [];

  const registryPath = path.join(root, REGISTRY_FILE);
  const registryNow = fs.existsSync(registryPath) ? parseRegistry(fs.readFileSync(registryPath, "utf8")) : [];
  for (const id of then.registry) {
    if (!registryNow.includes(id)) out.push(finding("journey-registry-shrank", `${id} was removed from ${REGISTRY_FILE}; the registry only grows`, REGISTRY_FILE));
  }

  const nowById = new Map();
  for (const j of now) {
    const id = /^(EJ-\d{3})-/.exec(j.name)?.[1];
    if (id) nowById.set(id, j);
  }
  for (const old of then.journeys) {
    const current = nowById.get(old.id);
    if (!current) {
      out.push(finding("journey-file-deleted", `the journey file for ${old.id} was deleted; retire it instead`, CATALOGUE_DIR));
      continue;
    }
    if (!old.meta || !current.meta) continue;
    const casesNow = new Map((current.meta.cases ?? []).filter((c) => c?.id).map((c) => [c.id, c]));
    for (const c of old.meta.cases ?? []) {
      if (!c?.id) continue;
      const nowCase = casesNow.get(c.id);
      if (!nowCase) {
        out.push(finding("journey-case-removed", `${old.id}/${c.id} was removed; mark it "status": "retired" instead`, current.rel));
      } else if (c.status === "retired" && nowCase.status !== "retired") {
        out.push(finding("journey-case-reused", `${old.id}/${c.id} was retired and is in use again; case ids are never reused`, current.rel));
      }
    }
  }
  return out;
}
