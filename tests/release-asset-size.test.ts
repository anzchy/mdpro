// @vitest-environment node
/**
 * D127-WI-2: a zero-byte release asset fails the set, signed or not. Before
 * the fix nothing checked size, and an unsigned file (the DMG) hit `continue`
 * before any other check, so an empty DMG verified.
 *
 * Law (S4, exhaustive): for every non-signature file of a complete set —
 * required macOS files and every optional Windows/Linux installer — replacing
 * its bytes with zero bytes fails the set with an error naming that file, and
 * one byte is enough to pass the size check.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMinisignKey } from "./support/minisignFixture";
import { REPO, completeSet, replace, windowsFiles, writeRepoFiles, writeSet, type AssetFile } from "./support/releaseSet";
import { linuxFiles } from "./support/releaseDraft";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { verifyAssetSet } from "../scripts/release/assetSet.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../scripts/release/verify-assets.mjs";

type SetResult = { ok: boolean; errors: string[] };
const key = makeMinisignKey();
const V = "0.3.1";
const MAC = completeSet(key, V);
const FULL = [...MAC, ...windowsFiles(key, V), ...linuxFiles(key, V)];
const verify = (files: AssetFile[]): SetResult => verifyAssetSet(files, V);
const msg = (r: SetResult) => r.errors.join("\n");

describe("verifyAssetSet: zero-byte assets", () => {
  it("control: the full set (macOS + Windows + Linux) verifies", () => {
    expect(verify(FULL)).toMatchObject({ ok: true, errors: [] });
  });

  it("a zero-byte unsigned DMG → not ok, naming it as empty", () => {
    const r = verify(replace(MAC, `mdpro_${V}_aarch64.dmg`, Buffer.alloc(0)));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(`darwin-aarch64: mdpro_${V}_aarch64.dmg is empty (0 bytes)`);
  });

  it("a zero-byte DMG given as an empty string (AssetFile data may be a string) → not ok", () => {
    const r = verify(MAC.map((f) => (f.name === `mdpro_${V}_x64.dmg` ? { name: f.name, data: "" as unknown as Buffer } : f)));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(`darwin-x86_64: mdpro_${V}_x64.dmg is empty (0 bytes)`);
  });

  it("a zero-byte signed updater archive with a non-empty .sig → not ok, naming it as empty", () => {
    const r = verify(replace(MAC, "mdpro_aarch64.app.tar.gz", Buffer.alloc(0)));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain("darwin-aarch64: mdpro_aarch64.app.tar.gz is empty (0 bytes)");
  });

  it("a zero-byte signed optional installer (Windows) → not ok, naming it as empty", () => {
    const r = verify(replace(FULL, `mdpro_${V}_x64-setup.exe`, Buffer.alloc(0)));
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(`windows-x86_64: mdpro_${V}_x64-setup.exe is empty (0 bytes)`);
  });

  it("boundary: a one-byte DMG passes the size check (the set still verifies)", () => {
    const r = verify(replace(MAC, `mdpro_${V}_aarch64.dmg`, Buffer.from([0])));
    expect(r).toMatchObject({ ok: true, errors: [] });
  });

  it("property: zeroing any one non-signature file of the full set fails it, naming that file (exhaustive)", () => {
    const targets = FULL.filter((f) => !f.name.endsWith(".sig"));
    expect(targets.length).toBe(8);
    for (const f of targets) {
      const r = verify(replace(FULL, f.name, Buffer.alloc(0)));
      expect(r.ok, f.name).toBe(false);
      expect(msg(r), f.name).toContain(`${f.name} is empty (0 bytes)`);
    }
  });
});

describe("verify-assets CLI: a zero-byte DMG", () => {
  let root: string;
  let err: string[];
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d127-wi2-")));
    err = [];
    writeRepoFiles(root, key, { [V]: "### Fixed\n- a fix" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("→ exit 1 naming the DMG, and nothing written to --out", () => {
    const dir = path.join(root, "artifacts");
    const outDir = path.join(root, "release-set");
    writeSet(dir, replace(MAC, `mdpro_${V}_x64.dmg`, Buffer.alloc(0)));
    const code = verifyAssetsMain(["--dir", dir, "--version", V, "--repo", REPO, "--out", outDir], {
      cwd: root,
      out: () => {},
      err: (s: string) => err.push(s),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain(`mdpro_${V}_x64.dmg is empty (0 bytes)`);
    expect(fs.existsSync(outDir)).toBe(false);
  });
});
