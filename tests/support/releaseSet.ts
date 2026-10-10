/**
 * Release asset-set fixtures for the D76 tests (WI-3 verify, WI-4 signatures,
 * WI-5 gate). A "set" is the flat list of files the verify job sees after it
 * downloads every build artifact. Signatures are real minisign signatures
 * over the archive bytes (see minisignFixture.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { type MinisignKey, signTauri } from "./minisignFixture";

export type AssetFile = { name: string; data: Buffer };

export const REPO = "anzchy/mdpro";

/** Archive bytes per arch; distinct so a swapped signature is detectable. */
export const archiveBytes = (arch: string): Buffer => Buffer.from(`\u001f\u008b fake ${arch} app tarball`);

/** The six macOS files of a complete two-platform set, signed by `key`. */
export function completeSet(key: MinisignKey, version: string): AssetFile[] {
  const files: AssetFile[] = [];
  for (const arch of ["aarch64", "x64"]) {
    const archive = archiveBytes(arch);
    files.push({ name: `mdpro_${arch}.app.tar.gz`, data: archive });
    files.push({ name: `mdpro_${arch}.app.tar.gz.sig`, data: Buffer.from(signTauri(key, archive)) });
    files.push({ name: `mdpro_${version}_${arch}.dmg`, data: Buffer.from(`dmg ${arch} ${version}`) });
  }
  return files;
}

/** The two Windows files, signed by `key`. */
export function windowsFiles(key: MinisignKey, version: string): AssetFile[] {
  const exe = Buffer.from(`MZ windows ${version}`);
  return [
    { name: `mdpro_${version}_x64-setup.exe`, data: exe },
    { name: `mdpro_${version}_x64-setup.exe.sig`, data: Buffer.from(signTauri(key, exe)) },
  ];
}

export const without = (files: AssetFile[], name: string): AssetFile[] => files.filter((f) => f.name !== name);

export const replace = (files: AssetFile[], name: string, data: Buffer | string): AssetFile[] =>
  files.map((f) => (f.name === name ? { name, data: Buffer.from(data) } : f));

/** Write files into `dir`, split across per-platform subdirs as download-artifact lays them out. */
export function writeSet(dir: string, files: AssetFile[]): void {
  for (const f of files) {
    const sub = /aarch64/.test(f.name) ? "darwin-aarch64" : /x64|amd64|x86_64/.test(f.name) ? "other" : "";
    const p = path.join(dir, sub, f.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
}

/** A CHANGELOG.md with one section per version. */
export function changelog(sections: Record<string, string>): string {
  const body = Object.entries(sections)
    .map(([v, text]) => `## [${v}] - 2026-10-10\n\n${text}\n\n---\n`)
    .join("\n");
  return `# Changelog\n\n## [Unreleased]\n\n- pending\n\n${body}`;
}

/** Repo-root files verify-assets reads: CHANGELOG.md and src-tauri/tauri.conf.json (pubkey). */
export function writeRepoFiles(root: string, key: MinisignKey, sections: Record<string, string>): void {
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), changelog(sections));
  fs.mkdirSync(path.join(root, "src-tauri"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src-tauri", "tauri.conf.json"),
    JSON.stringify({ productName: "mdpro", plugins: { updater: { pubkey: key.tauriPubkey } } }, null, 2),
  );
}
