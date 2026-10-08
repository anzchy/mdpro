// @vitest-environment node
/**
 * ADR-0047 WI-002 / WI-1: the verify overlay `src-tauri/tauri.verify.conf.json`.
 * Matrix: `.claude/tdd-guardian/tests-20261003-061500.md` (r1), WI1-T01..T06.
 *
 * Reads the two real config files; no mocks. The merge is RFC 7396 (what
 * `tauri build --config` applies), written in `helpers/jsonMergePatch.ts` and
 * self-checked here (T03) so a shallow helper cannot make T04 vacuous.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dotted,
  getPath,
  isObject,
  isUnder,
  leafPaths,
  leafValues,
  mergePatch,
  type Json,
} from "./helpers/jsonMergePatch";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_PATH = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");
const OVERLAY_PATH = path.join(REPO_ROOT, "src-tauri", "tauri.verify.conf.json");

/** Read and parse a JSON file that must exist; the existence check fails first, by assertion. */
function readJson(p: string): Json {
  expect(fs.existsSync(p), `${path.relative(REPO_ROOT, p)} exists`).toBe(true);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Json;
}

const EXPECTED_OVERLAY = {
  identifier: "com.mdpro.app.verify",
  productName: "mdpro-verify",
  bundle: { fileAssociations: [], createUpdaterArtifacts: false },
  plugins: { updater: { endpoints: [] } },
};
const OVERLAY_PATHS = [
  "identifier",
  "productName",
  "bundle.fileAssociations",
  "bundle.createUpdaterArtifacts",
  "plugins.updater.endpoints",
];
const PATH_LIKE = [/^\//, /^~/, /\/Users\//, /^[A-Za-z]:\\/];

describe("WI-1 verify overlay", () => {
  it("WI1-T01 has exactly the allowlisted shape", () => {
    const overlay = readJson(OVERLAY_PATH);
    expect(isObject(overlay)).toBe(true);
    const { $schema: _schema, ...rest } = overlay as Record<string, Json>;
    expect(rest).toEqual(EXPECTED_OVERLAY);
  });

  it("WI1-T02 no leaf is null and no string is path-like", () => {
    const leaves = leafValues(readJson(OVERLAY_PATH));
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(leaf).not.toBeNull();
      if (typeof leaf !== "string") continue;
      for (const re of PATH_LIKE) expect(leaf, `${JSON.stringify(leaf)} vs ${re}`).not.toMatch(re);
    }
  });

  it("WI1-T03 mergePatch reproduces the RFC 7396 Appendix A vectors", () => {
    const vectors: [Json, Json, Json][] = [
      [{ a: "b" }, { a: "c" }, { a: "c" }],
      [{ a: "b" }, { b: "c" }, { a: "b", b: "c" }],
      [{ a: "b" }, { a: null }, {}],
      [{ a: "b", b: "c" }, { a: null }, { b: "c" }],
      [{ a: ["b"] }, { a: "c" }, { a: "c" }],
      [{ a: "c" }, { a: ["b"] }, { a: ["b"] }],
      [{ a: { b: "c" } }, { a: { b: "d", c: null } }, { a: { b: "d" } }],
      [{ a: [{ b: "c" }] }, { a: [1] }, { a: [1] }],
      [["a", "b"], ["c", "d"], ["c", "d"]],
      [{ a: "b" }, ["c"], ["c"]],
      [{ a: "foo" }, null, null],
      [{ a: "foo" }, "bar", "bar"],
      [{ e: null }, { a: 1 }, { e: null, a: 1 }],
      [[1, 2], { a: "b", c: null }, { a: "b" }],
      [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
    ];
    for (const [target, patch, result] of vectors) {
      expect(mergePatch(target, patch), JSON.stringify([target, patch])).toEqual(result);
    }
  });

  it("WI1-T04 every base leaf the overlay does not name is preserved", () => {
    const base = readJson(BASE_PATH);
    const overlay = readJson(OVERLAY_PATH);
    const merged = mergePatch(base, overlay);
    const overlayLeaves = leafPaths(overlay);
    const baseLeaves = leafPaths(base);

    const named = baseLeaves.filter((p) => overlayLeaves.some((o) => isUnder(p, o)));
    const preserved = baseLeaves.filter((p) => !overlayLeaves.some((o) => isUnder(p, o)));
    for (const p of preserved) {
      expect(getPath(merged, p), `merged ${dotted(p)}`).toEqual(getPath(base, p));
    }
    // Every overridden leaf exists in base; nothing else is dropped.
    expect(named.map(dotted).sort()).toEqual([...OVERLAY_PATHS].sort());
    expect(preserved.length).toBe(baseLeaves.length - OVERLAY_PATHS.length);

    const pubkey = getPath(merged, ["plugins", "updater", "pubkey"]);
    expect(typeof pubkey === "string" && pubkey.length > 0).toBe(true);
    expect(pubkey).toBe(getPath(base, ["plugins", "updater", "pubkey"]));
    for (const key of ["version", "app", "build"]) expect(getPath(merged, [key])).toEqual(getPath(base, [key]));
    for (const key of ["externalBin", "icon"]) {
      expect(getPath(merged, ["bundle", key])).toEqual(getPath(base, ["bundle", key]));
    }
    for (const o of overlayLeaves) expect(getPath(merged, o), `merged ${dotted(o)}`).toEqual(getPath(overlay, o));
  });

  it("WI1-T05 merging the overlay twice equals merging it once", () => {
    const overlay = readJson(OVERLAY_PATH);
    const merged = mergePatch(readJson(BASE_PATH), overlay);
    expect(mergePatch(merged, overlay)).toEqual(merged);
  });

  it("WI1-T06 verify differs from release only on the overlay's paths", () => {
    const base = readJson(BASE_PATH);
    const merged = mergePatch(base, readJson(OVERLAY_PATH));
    const all = new Map([...leafPaths(base), ...leafPaths(merged)].map((p) => [dotted(p), p]));
    const differing = [...all.entries()]
      .filter(([, p]) => JSON.stringify(getPath(base, p)) !== JSON.stringify(getPath(merged, p)))
      .map(([key]) => key);
    for (const key of differing) expect(OVERLAY_PATHS, key).toContain(key);
    expect(differing).toContain("identifier");
    expect(differing).toContain("productName");
  });
});
