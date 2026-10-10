// @vitest-environment node
/**
 * D76-WI-3: `verifyAssetSet` — the verify job's closed-set check (requirement ③)
 * and the `verify-assets.mjs` CLI that writes `latest.json` + `manifest.json`
 * only when every check passes. Plan cases A1..A7.
 *
 * Law: the release set is closed — any file outside the expected names fails
 * the set, and removing any required file fails it (A-property, exhaustive
 * over the six required files).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMinisignKey } from "./support/minisignFixture";
import {
  REPO,
  completeSet,
  replace,
  windowsFiles,
  without,
  writeRepoFiles,
  writeSet,
  type AssetFile,
} from "./support/releaseSet";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildManifest, verifyAssetSet } from "../scripts/release/assetSet.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../scripts/release/verify-assets.mjs";

type SetResult = { ok: boolean; errors: string[] };
const verify = (files: AssetFile[], v = "0.3.1"): SetResult => verifyAssetSet(files, v);
const key = makeMinisignKey();
const SET = completeSet(key, "0.3.1");
const msg = (r: SetResult) => r.errors.join("\n");

describe("verifyAssetSet", () => {
  it("A1 complete two-platform set → ok", () => {
    expect(verify(SET)).toMatchObject({ ok: true, errors: [] });
  });

  it("A2 missing mdpro_x64.app.tar.gz.sig → error naming darwin-x86_64", () => {
    const r = verify(without(SET, "mdpro_x64.app.tar.gz.sig"));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("darwin-x86_64");
    expect(msg(r)).toContain("mdpro_x64.app.tar.gz.sig");
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "  \n\n"],
  ])("A3 %s sig → error", (_l, content) => {
    const r = verify(replace(SET, "mdpro_aarch64.app.tar.gz.sig", content));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("mdpro_aarch64.app.tar.gz.sig");
  });

  it("A4 two archives for darwin-aarch64 → error naming the second", () => {
    const r = verify([...SET, { name: "mdpro_aarch64-1.app.tar.gz", data: Buffer.from("x") }]);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("mdpro_aarch64-1.app.tar.gz");
  });

  it("A5 sig present, archive missing → error", () => {
    const r = verify(without(SET, "mdpro_aarch64.app.tar.gz"));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("darwin-aarch64");
  });

  it("A6 an unexpected extra file → error naming it", () => {
    const r = verify([...SET, { name: "notes.txt", data: Buffer.from("hi") }]);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("notes.txt");
  });

  it("A6b a dmg for another version is an unexpected file", () => {
    const r = verify([...SET, { name: "mdpro_0.3.0_x64.dmg", data: Buffer.from("old") }]);
    expect(r.ok).toBe(false);
  });

  it("A6c the same name twice → error", () => {
    const r = verify([...SET, SET[0]]);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(SET[0].name);
  });

  it("A7 Windows present with its sig → ok; Windows absent → ok", () => {
    expect(verify([...SET, ...windowsFiles(key, "0.3.1")]).ok).toBe(true);
    expect(verify(SET).ok).toBe(true);
  });

  it("A7 Windows installer present without its sig → error", () => {
    const r = verify([...SET, windowsFiles(key, "0.3.1")[0]]);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("mdpro_0.3.1_x64-setup.exe.sig");
  });

  it("A7b Windows sig present without its installer → error", () => {
    expect(verify([...SET, windowsFiles(key, "0.3.1")[1]]).ok).toBe(false);
  });

  it("A-property: removing any one required file fails the set (exhaustive)", () => {
    for (const f of SET) {
      expect(verify(without(SET, f.name)).ok, f.name).toBe(false);
    }
  });

  it("A-property: the same set under another version fails (names carry the version)", () => {
    expect(verify(SET, "0.3.2").ok).toBe(false);
  });

  it.each([null, undefined, "x", [{ name: 1 }]])("malformed input %j → not ok, no throw", (files) => {
    expect(verifyAssetSet(files, "0.3.1").ok).toBe(false);
  });
});

describe("buildManifest", () => {
  it("lists name, size and sha256 for every file, sorted by name", () => {
    const m = buildManifest(SET);
    expect(m.map((e: { name: string }) => e.name)).toEqual(SET.map((f) => f.name).sort());
    for (const f of SET) {
      const e = m.find((x: { name: string }) => x.name === f.name);
      expect(e).toEqual({
        name: f.name,
        size: f.data.length,
        sha256: crypto.createHash("sha256").update(f.data).digest("hex"),
      });
    }
  });
});

// ---------------------------------------------------------------------------

describe("verify-assets CLI", () => {
  let root: string;
  let dir: string;
  let outDir: string;
  let out: string[];
  let err: string[];
  const run = (extra: string[] = [], files = SET): number => {
    writeSet(dir, files);
    return verifyAssetsMain(
      ["--dir", dir, "--version", "0.3.1", "--repo", REPO, "--pub-date", "2026-10-10T00:00:00Z", ...extra],
      { cwd: root, out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
    );
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-verify-")));
    dir = path.join(root, "artifacts");
    outDir = path.join(root, "release-set");
    out = [];
    err = [];
    writeRepoFiles(root, key, { "0.3.1": "### Fixed\n- a fix" });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("A1 complete set → exit 0; out holds the 6 files, latest.json and manifest.json with sha256", () => {
    expect(run(["--out", outDir])).toBe(0);
    const names = fs.readdirSync(outDir).sort();
    expect(names).toEqual([...SET.map((f) => f.name), "latest.json", "manifest.json"].sort());
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest).toHaveLength(7);
    for (const e of manifest) {
      const bytes = fs.readFileSync(path.join(outDir, e.name));
      expect(e.size).toBe(bytes.length);
      expect(e.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    }
    const latest = JSON.parse(fs.readFileSync(path.join(outDir, "latest.json"), "utf8"));
    expect(latest.version).toBe("0.3.1");
    expect(latest.notes).toContain("a fix");
    expect(Object.keys(latest.platforms).sort()).toEqual(["darwin-aarch64", "darwin-x86_64"]);
  });

  it("A2 missing mdpro_x64.app.tar.gz.sig → exit 1 naming darwin-x86_64; neither latest.json nor manifest.json written", () => {
    expect(run(["--out", outDir], without(SET, "mdpro_x64.app.tar.gz.sig"))).toBe(1);
    expect(err.join("\n")).toContain("darwin-x86_64");
    expect(fs.existsSync(path.join(outDir, "latest.json"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(false);
  });

  it("A6 CLI: an extra file in the artifacts → exit 1, nothing written", () => {
    expect(run(["--out", outDir], [...SET, { name: "stray.zip", data: Buffer.from("z") }])).toBe(1);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("L7 CLI: no CHANGELOG section in draft mode → exit 1, nothing written", () => {
    writeRepoFiles(root, key, { "0.3.0": "old" });
    expect(run(["--out", outDir, "--mode", "draft"])).toBe(1);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("L7 CLI: no CHANGELOG section in build-only → exit 0, warning, notes empty", () => {
    writeRepoFiles(root, key, { "0.3.0": "old" });
    expect(run(["--out", outDir])).toBe(0);
    expect(err.join("\n")).toMatch(/warning/);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "latest.json"), "utf8")).notes).toBe("");
  });

  it("check-only (no --out) re-verifies a downloaded release-set, including its latest.json", () => {
    expect(run(["--out", outDir])).toBe(0);
    out = [];
    const code = verifyAssetsMain(["--dir", outDir, "--version", "0.3.1", "--repo", REPO], {
      cwd: root,
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
    });
    expect(code).toBe(0);
  });

  it("check-only: a tampered latest.json in the input → exit 1", () => {
    expect(run(["--out", outDir])).toBe(0);
    const p = path.join(outDir, "latest.json");
    const latest = JSON.parse(fs.readFileSync(p, "utf8"));
    latest.platforms["darwin-x86_64"].url = latest.platforms["darwin-x86_64"].url.replace("v0.3.1", "v0.3.0");
    fs.writeFileSync(p, JSON.stringify(latest));
    const code = verifyAssetsMain(["--dir", outDir, "--version", "0.3.1", "--repo", REPO], {
      cwd: root,
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
    });
    expect(code).toBe(1);
  });

  it("missing required arguments → exit 1 with usage", () => {
    const code = verifyAssetsMain(["--dir", dir], { cwd: root, out: () => {}, err: (s: string) => err.push(s) });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/usage/);
  });
});
