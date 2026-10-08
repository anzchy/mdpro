/**
 * Purpose: Find every `dirs::` call site under `src-tauri/src` and check the
 * set against the checked-in registry `src-tauri/persistence-roots.json`
 * (ADR-0047 WI-002 WI-7, acceptance 1's second half). A new call site that
 * nobody registered fails `tests/control-persistence-roots.test.ts`, so every
 * path the app can persist to is named, scoped and (for production) mapped to
 * a root id that `services/run_isolation_tests.rs` (WI-8) resolves under a
 * temp HOME.
 *
 * Pipeline: read `*.rs` → `blankComments` (comments never count; string
 * mentions do, conservatively) → `use` / `extern crate` statements naming the
 * `dirs` crate are `forbidden-import` (they would let a bare call evade the
 * scan) → `\bdirs\s*::\s*(\w+)` outside those statements → scope from the
 * file name or `rustScopes.regions` → count per `(file, call, scope)`.
 *
 * Key decisions:
 * - Registry entries are `{ file, call, count, scope, root?, note? }`; `file`
 *   is repo-relative under `src-tauri/src`; no line numbers. `scope` is one of
 *   `production`, `production-other-os`, `production-guard`, `test`.
 * - `root` is required on `production` and allowed nowhere else. It is a root
 *   id or a non-empty array of them, for one call that feeds several roots
 *   (`commands/mcp.rs`'s `home_dir()` builds all four MCP client paths).
 * - `production-guard` is only for the launch guard's own reads in
 *   `services/verify_run.rs`: no `root`, and it stands for a derived
 *   `production` site. Any other use is `bad-entry`.
 * - A bad entry is reported and then ignored, so the site it meant to cover
 *   is also reported as unregistered.
 * - Per `(file, call)`: scopes that disagree with the registry are one
 *   `scope-mismatch`; otherwise a count above the registry is `unregistered`
 *   and a count below it (or no site at all) is `stale`.
 *
 * @module scripts/control/persistenceRoots
 * @coordinates-with scripts/control/rustScopes.mjs (regions)
 * @coordinates-with scripts/control/commentBlanker.mjs (blankComments)
 * @coordinates-with src-tauri/persistence-roots.json (the registry)
 * @coordinates-with src-tauri/src/services/run_isolation_tests.rs (WI-8 resolvers)
 */

import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./commentBlanker.mjs";
import { blankLiterals, regions } from "./rustScopes.mjs";

export const SCOPES = ["production", "production-other-os", "production-guard", "test"];
export const GUARD_FILE = "src-tauri/src/services/verify_run.rs";
const SRC_PREFIX = "src-tauri/src/";
const ENTRY_KEYS = new Set(["file", "call", "count", "scope", "root", "note"]);
const TEST_FILE = /(?:_tests|test_support[^/]*|_fixtures?|test_home[^/]*)\.rs$/;
const SITE = /\bdirs\s*::\s*(\w+)/g;
const USE_STMT = /\buse\s+([^;]*);/g;
const DIRS_ROOT = /(?:^|[{,])\s*(?:::\s*)?dirs\b/;
const EXTERN_DIRS = /\bextern\s+crate\s+dirs\b[^;]*;/g;

/**
 * Sites and forbidden imports of one file.
 * @param {string} file registry spelling, `src-tauri/src/...`
 * @param {string} text Rust source
 */
export function scanRustText(file, text) {
  const code = blankComments(text, "rust");
  const structural = blankLiterals(code);
  /** @type {{file: string, found: string}[]} */ const forbiddenImports = [];
  /** @type {[number, number][]} */ const useSpans = [];
  for (const m of structural.matchAll(USE_STMT)) {
    useSpans.push([m.index, m.index + m[0].length]);
    if (DIRS_ROOT.test(m[1])) forbiddenImports.push({ file, found: m[0].replace(/\s+/g, " ") });
  }
  for (const m of structural.matchAll(EXTERN_DIRS)) {
    forbiddenImports.push({ file, found: m[0].replace(/\s+/g, " ") });
  }
  const { test, otherOs } = regions(code);
  const inAny = (/** @type {[number, number][]} */ spans, /** @type {number} */ at) =>
    spans.some(([a, b]) => at >= a && at < b);
  const scopeAt = (/** @type {number} */ at) =>
    TEST_FILE.test(file) || inAny(test, at) ? "test" : inAny(otherOs, at) ? "production-other-os" : "production";
  /** @type {Map<string, {file: string, call: string, count: number, scope: string}>} */
  const counts = new Map();
  for (const m of code.matchAll(SITE)) {
    if (inAny(useSpans, m.index)) continue;
    const scope = scopeAt(m.index);
    const k = `${m[1]}|${scope}`;
    const prev = counts.get(k);
    if (prev) prev.count++;
    else counts.set(k, { file, call: m[1], count: 1, scope });
  }
  return { sites: [...counts.values()].sort(bySite), forbiddenImports };
}

/** @param {{file: string, call: string, scope: string}} a @param {{file: string, call: string, scope: string}} b */
function bySite(a, b) {
  return a.file.localeCompare(b.file) || a.call.localeCompare(b.call) || a.scope.localeCompare(b.scope);
}

/**
 * Every `*.rs` under `srcRoot` (a `.../src-tauri/src` directory).
 * @param {string} srcRoot
 */
export function scanSites(srcRoot) {
  /** @type {string[]} */ const files = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith(".rs")) files.push(abs);
    }
  };
  walk(srcRoot);
  const sites = [];
  const forbiddenImports = [];
  for (const abs of files.sort()) {
    const file = SRC_PREFIX + path.relative(srcRoot, abs).split(path.sep).join("/");
    const r = scanRustText(file, fs.readFileSync(abs, "utf8"));
    sites.push(...r.sites);
    forbiddenImports.push(...r.forbiddenImports);
  }
  return { sites: sites.sort(bySite), forbiddenImports };
}

/**
 * Why `e` is malformed, or null.
 * @param {Record<string, unknown>} e
 */
function entryProblem(e) {
  const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.has(k));
  if (extra.length > 0) return `unknown key(s) ${extra.join(", ")}`;
  const { file, call, count, scope } = e;
  if (typeof file !== "string" || !file.startsWith(SRC_PREFIX) || file.split("/").includes("..")) {
    return "file must be repo-relative under src-tauri/src";
  }
  if (typeof call !== "string" || !/^\w+$/.test(call)) return "call must be an identifier";
  if (!Number.isInteger(count) || /** @type {number} */ (count) < 1) return "count must be a positive integer";
  if (typeof scope !== "string" || !SCOPES.includes(scope)) return `scope must be one of ${SCOPES.join(", ")}`;
  if (scope === "production-guard" && file !== GUARD_FILE) return `production-guard is only for ${GUARD_FILE}`;
  if (scope !== "production" && "root" in e) return `root is only allowed on production entries`;
  if ("root" in e) {
    const roots = Array.isArray(e.root) ? e.root : [e.root];
    if (roots.length === 0 || !roots.every((r) => typeof r === "string" && r !== "")) return "root must be a root id or a non-empty array of them";
  }
  if ("note" in e && typeof e.note !== "string") return "note must be a string";
  return null;
}

/**
 * Violations of `registry` against `scan` (from `scanSites`); `[]` means the
 * registry is exact.
 * @param {{sites: Record<string, unknown>[]}} registry
 * @param {{sites: {file: string, call: string, count: number, scope: string}[], forbiddenImports: {file: string, found: string}[]}} scan
 */
export function checkRegistry(registry, scan) {
  /** @type {{kind: string, file: string, call: string | null, found: unknown, registered: unknown}[]} */
  const out = [];
  for (const f of scan.forbiddenImports) {
    out.push({ kind: "forbidden-import", file: f.file, call: null, found: f.found, registered: null });
  }
  /** @type {Map<string, Record<string, number>>} */ const reg = new Map();
  /** @type {Map<string, Record<string, number>>} */ const found = new Map();
  const add = (/** @type {typeof reg} */ m, /** @type {string} */ k, /** @type {string} */ scope, /** @type {number} */ n) => {
    const g = m.get(k) ?? {};
    g[scope] = (g[scope] ?? 0) + n;
    m.set(k, g);
  };
  for (const e of registry.sites ?? []) {
    const problem = entryProblem(e);
    const k = `${e.file}|${e.call}`;
    const effective = e.scope === "production-guard" ? "production" : String(e.scope);
    if (problem === null && reg.get(k)?.[effective] !== undefined) {
      out.push({ kind: "bad-entry", file: String(e.file), call: String(e.call), found: "duplicate entry", registered: e });
    } else if (problem !== null) {
      out.push({ kind: "bad-entry", file: String(e.file), call: String(e.call), found: problem, registered: e });
    } else {
      if (e.scope === "production" && !("root" in e)) {
        out.push({ kind: "missing-root", file: String(e.file), call: String(e.call), found: null, registered: e });
      }
      add(reg, k, effective, /** @type {number} */ (e.count));
    }
  }
  for (const s of scan.sites) add(found, `${s.file}|${s.call}`, s.scope, s.count);
  for (const k of [...new Set([...reg.keys(), ...found.keys()])].sort()) {
    const [file, call] = k.split("|");
    const r = reg.get(k) ?? {};
    const f = found.get(k) ?? {};
    const v = (/** @type {string} */ kind) => ({ kind, file, call, found: f, registered: r });
    const rs = Object.keys(r).sort().join();
    const fs_ = Object.keys(f).sort().join();
    if (rs !== "" && fs_ !== "" && rs !== fs_) out.push(v("scope-mismatch"));
    else if (Object.keys({ ...r, ...f }).some((sc) => (f[sc] ?? 0) > (r[sc] ?? 0))) out.push(v("unregistered"));
    else if (Object.keys(r).some((sc) => (r[sc] ?? 0) > (f[sc] ?? 0))) out.push(v("stale"));
  }
  return out;
}
