// @vitest-environment node
/**
 * ADR-0047 WI-002 WI-7: the checked-in persistence-roots registry
 * (`src-tauri/persistence-roots.json`) against the live `src-tauri/src`, and
 * the scanner's laws. Matrix: `.claude/tdd-guardian/tests-20261003-061500.md`
 * (r1), WI-7 T01 (live equality), T06 (metamorphic: monotonic,
 * comment-invariant), T07 (conservation under scope moves), T08 (privacy
 * walk), T09 (production roots well-formed). Reads the repo only, never `~`.
 *
 * Law: the scan is invariant under comment edits and +1 monotonic in call
 * sites (T06, S6); the total is conserved when a site moves scope (T07, S5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  check,
  mkTree,
  mulberry32,
  rel,
  scanTree,
  writeFiles,
  type Registry,
  type Site,
} from "./helpers/persistenceRootsTree";

const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "src-tauri", "src");
const registry = (): Registry =>
  JSON.parse(fs.readFileSync(path.join(REPO, "src-tauri", "persistence-roots.json"), "utf8"));

const GUARD_FILE = "src-tauri/src/services/verify_run.rs";
const key = (s: Record<string, unknown>) =>
  `${s.file}|${s.call}|${s.scope === "production-guard" ? "production" : s.scope}|${s.count}`;

describe("WI7-T01 live tree equals registry", () => {
  it("checkRegistry is empty and the (file, call, count, scope) sets are equal", () => {
    const reg = registry();
    const scan = scanTree(SRC);
    const vs = check(reg, scan);
    expect(vs, `violations:\n${vs.map((v) => JSON.stringify(v)).join("\n")}`).toEqual([]);
    expect(scan.sites.map(key).sort()).toEqual(reg.sites.map(key).sort());
    expect(scan.sites.length).toBeGreaterThan(0);
  });
});

describe("WI7-T08 registry privacy walk", () => {
  it("no leaf is absolute, ~-relative, under /Users/ or names the user", () => {
    const user = os.userInfo().username;
    const leaves: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(String(v));
    };
    walk(registry());
    expect(leaves.length).toBeGreaterThan(0);
    const bad = leaves.filter(
      (l) => l.startsWith("/") || l.startsWith("~") || l.includes("/Users/") || l.includes(user),
    );
    expect(bad).toEqual([]);
  });
});

describe("WI7-T09 production roots well-formed", () => {
  const ROOT = /^(home\/\.mdpro(\/drafts)?|data\/mdpro(\/drafts)?|mcp-client\/[a-z_]+)$/;
  it("every production root id matches; production-guard has no root and lives in verify_run.rs", () => {
    const sites = registry().sites;
    const prod = sites.filter((s) => s.scope === "production");
    expect(prod.length).toBeGreaterThan(0);
    for (const s of prod) {
      const roots = Array.isArray(s.root) ? s.root : [s.root];
      expect(roots.length, JSON.stringify(s)).toBeGreaterThan(0);
      for (const r of roots) expect(String(r), JSON.stringify(s)).toMatch(ROOT);
    }
    const guard = sites.filter((s) => s.scope === "production-guard");
    expect(guard.length).toBeGreaterThan(0);
    for (const s of guard) {
      expect("root" in s, JSON.stringify(s)).toBe(false);
      expect(s.file).toBe(GUARD_FILE);
    }
  });
});

// ---------------------------------------------------------------------------
// Laws on a fixture tree. Files are lists of top-level items; inserting a new
// item between two of them, before the test module, is a production region.
// ---------------------------------------------------------------------------
const BASE: Record<string, string[]> = {
  "a.rs": ["fn a() { dirs::home_dir(); }", "fn b() {}", "#[cfg(test)]\nmod tests {\n    fn t() { dirs::data_dir(); }\n}"],
  "svc/b.rs": [
    "use std::path::PathBuf;",
    'fn w() {\n    #[cfg(target_os = "windows")]\n    {\n        dirs::config_dir();\n    }\n}',
    "fn c() { let _ = dirs::data_dir(); }",
  ],
  "svc/c_tests.rs": ["fn t() { dirs::home_dir(); }"],
};
const PROD_SLOTS: Record<string, number> = { "a.rs": 2, "svc/b.rs": 3 };
const join = (items: string[]) => `${items.join("\n")}\n`;
const textOf = (tree: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(tree).map(([f, items]) => [f, join(items)]));
const asMap = (sites: Site[]) => new Map(sites.map((s) => [`${s.file}|${s.call}|${s.scope}`, s.count]));

describe("WI7-T06 metamorphic: +1 monotonic and comment-invariant", () => {
  it("seed 20261009, 100 trials", () => {
    const SEED = 20261009;
    const r = mulberry32(SEED);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const name = () =>
      pick(["home_dir", "data_dir", "cache_dir", "config_dir", ""]) ||
      Array.from({ length: 3 + Math.floor(r() * 8) }, () => pick([..."abcdefghij_"])).join("");
    const src = mkTree(textOf(BASE));
    const base = asMap(scanTree(src).sites);
    for (let trial = 0; trial < 100; trial++) {
      const file = pick(Object.keys(PROD_SLOTS));
      const at = Math.floor(r() * (PROD_SLOTS[file] + 1));
      const call = name();
      const comment = r() < 0.5;
      const line = comment
        ? pick([`// dirs::${call}()`, `/* dirs::${call}() */`, `/// dirs::${call}()`, `/* a /* dirs::${call}() */ b */`])
        : `fn gen_${trial}() { let _ = dirs::${call}(); }`;
      const items = [...BASE[file]];
      items.splice(at, 0, line);
      writeFiles(src, { [file]: join(items) });
      const got = asMap(scanTree(src).sites);
      const expected = new Map(base);
      if (!comment) {
        const k = `${rel(file)}|${call}|production`;
        expected.set(k, (expected.get(k) ?? 0) + 1);
      }
      expect(got, `seed ${SEED} trial ${trial}: ${file}@${at} ${JSON.stringify(line)}`).toEqual(expected);
      writeFiles(src, { [file]: join(BASE[file]) });
    }
  });
});

describe("WI7-T07 conservation under scope moves", () => {
  it("moving a call into `mod tests` is production -1, test +1, total unchanged", () => {
    const call = "fn moved() { dirs::cache_dir(); }";
    const before = ["fn a() {}", call, "#[cfg(test)]\nmod tests {\n    fn t() {}\n}"];
    const after = ["fn a() {}", `#[cfg(test)]\nmod tests {\n    fn t() {}\n    ${call}\n}`];
    const count = (items: string[], scope: string) =>
      scanTree(mkTree({ "m.rs": join(items) }))
        .sites.filter((s) => s.call === "cache_dir" && s.scope === scope)
        .reduce((n, s) => n + s.count, 0);
    expect([count(before, "production"), count(before, "test")]).toEqual([1, 0]);
    expect([count(after, "production"), count(after, "test")]).toEqual([0, 1]);
    const total = (items: string[]) =>
      scanTree(mkTree({ "m.rs": join(items) })).sites.reduce((n, s) => n + s.count, 0);
    expect(total(after)).toBe(total(before));
  });
});
