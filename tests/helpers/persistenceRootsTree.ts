/**
 * Fixture helpers for the persistence-roots scanner tests (ADR-0047 WI-002
 * WI-7): a throwaway `<tmp>/src-tauri/src` tree and typed wrappers over the
 * plain-ESM scanner. Never touches `~`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkRegistry,
  scanRustText,
  scanSites,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/persistenceRoots.mjs";

export type Scope = "production" | "production-other-os" | "production-guard" | "test";
export type Site = { file: string; call: string; count: number; scope: Scope };
export type Scan = { sites: Site[]; forbiddenImports: { file: string; found: string }[] };
export type Entry = Record<string, unknown>;
export type Registry = { sites: Entry[] };
export type Violation = {
  kind: string;
  file: string;
  call: string | null;
  found: unknown;
  registered: unknown;
};

export const scanTree = (srcRoot: string): Scan => scanSites(srcRoot);
export const scanText = (file: string, text: string): Scan => scanRustText(file, text);
export const check = (registry: Registry, scan: Scan): Violation[] => checkRegistry(registry, scan);

/** `file` as the registry spells it: repo-relative under `src-tauri/src`. */
export const rel = (p: string): string => `src-tauri/src/${p}`;

/** A fresh `<tmp>/src-tauri/src` holding `files` (paths relative to it). */
export function mkTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-proots-"));
  const src = path.join(root, "src-tauri", "src");
  fs.mkdirSync(src, { recursive: true });
  writeFiles(src, files);
  return src;
}

export function writeFiles(src: string, files: Record<string, string>): void {
  for (const [p, text] of Object.entries(files)) {
    const abs = path.join(src, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
}

/** Violation kinds, sorted, for exact multiset comparison. */
export const kinds = (vs: Violation[]): string[] => vs.map((v) => v.kind).sort();

/** Scope of the single site found for `call` in a one-file text scan. */
export function scopeOf(file: string, text: string, call: string): Scope[] {
  return scanText(file, text)
    .sites.filter((s) => s.call === call)
    .flatMap((s) => Array.from({ length: s.count }, () => s.scope));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
