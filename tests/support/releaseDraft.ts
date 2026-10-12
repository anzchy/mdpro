/**
 * Draft-release fixtures for the D127 tests: a verified release set built by
 * the real verify-assets CLI, a way to re-derive `manifest.json` after a test
 * edits the set (so the manifest is not what fails), the draft release object
 * GitHub returns, and a fake `gh` that records every call. `gh` is the one
 * boundary verify-release crosses; everything else runs for real.
 */
import fs from "node:fs";
import path from "node:path";
import { type MinisignKey, signTauri } from "./minisignFixture";
import { FIXTURE_SHA, REPO, writeSet, type AssetFile } from "./releaseSet";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildManifest } from "../../scripts/release/assetSet.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../../scripts/release/verify-assets.mjs";

export type Gh = { status: number; stdout: Buffer | string; stderr: string };

export const SHA = FIXTURE_SHA;
export const REHEARSAL_TAG = `rehearsal-d76-${SHA.slice(0, 7)}`;

/** The three Linux installers and their signatures, signed by `key`. */
export function linuxFiles(key: MinisignKey, version: string): AssetFile[] {
  const names = [`mdpro_${version}_amd64.deb`, `mdpro-${version}-1.x86_64.rpm`, `mdpro_${version}_amd64.AppImage`];
  return names.flatMap((name) => {
    const data = Buffer.from(`linux ${name}`);
    return [
      { name, data },
      { name: `${name}.sig`, data: Buffer.from(signTauri(key, data)) },
    ];
  });
}

/**
 * Run the real verify-assets CLI over `files` with `--out`; returns what it
 * wrote (assets + latest.json + manifest.json). Throws if it refused.
 */
export function verifiedSet(root: string, files: AssetFile[], version: string, mode: string): AssetFile[] {
  const art = path.join(root, "artifacts");
  const outDir = path.join(root, "release-set");
  writeSet(art, files);
  const code = verifyAssetsMain(["--dir", art, "--version", version, "--repo", REPO, "--mode", mode, "--out", outDir], {
    cwd: root,
    out: () => {},
    err: () => {},
  });
  if (code !== 0) throw new Error(`fixture: verify-assets refused the set (exit ${code})`);
  const out = fs.readdirSync(outDir).map((name) => ({ name, data: fs.readFileSync(path.join(outDir, name)) }));
  fs.rmSync(art, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  return out;
}

/** Replace `manifest.json` with one recomputed over the other files, as verify-assets writes it. */
export function withFreshManifest(files: AssetFile[]): AssetFile[] {
  const rest = files.filter((f) => f.name !== "manifest.json");
  const manifest = buildManifest(rest);
  return [...rest, { name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }];
}

/** The draft release object for `tag`, pinned to SHA, holding `files` (asset ids from 1000). */
export const draftRelease = (tag: string, files: AssetFile[], over: Record<string, unknown> = {}) => ({
  id: 77,
  tag_name: tag,
  draft: true,
  target_commitish: SHA,
  assets: files.map((f, i) => ({ id: 1000 + i, name: f.name, size: f.data.length })),
  ...over,
});

/** Fake gh: the release list (NDJSON) and asset downloads by id. Every call is pushed onto `calls`. */
export const fakeGh =
  (calls: string[][], releases: object[], files: AssetFile[]) =>
  (args: string[]): Gh => {
    calls.push(args);
    const assetPath = args.find((a) => /releases\/assets\/\d+$/.test(a));
    if (assetPath) {
      const f = files[Number(assetPath.split("/").pop()) - 1000];
      return f ? { status: 0, stdout: f.data, stderr: "" } : { status: 1, stdout: "", stderr: "HTTP 404" };
    }
    return { status: 0, stdout: releases.map((r) => JSON.stringify(r)).join("\n"), stderr: "" };
  };
