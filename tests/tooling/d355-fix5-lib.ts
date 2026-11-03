// D355 fix 5 RED stub: the file-level history rule's API, still backed by fix 4's line detector.
import fs from "node:fs";
import path from "node:path";
import { historyReads } from "./d355-fix4-lib";

/** Reads a repo-relative posix path; undefined when the file does not exist. */
export type Read = (rel: string) => string | undefined;
export interface AllowEntry { file: string; reason: string; scope: string; argv?: string[][] }

export const HISTORY_ALLOWLIST: readonly AllowEntry[] = [];

export const fsRead = (root: string): Read => (rel) => {
  const p = path.join(root, rel);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : undefined;
};

export function closure(file: string, _read: Read): string[] { return [file]; }

export function flagged(files: readonly string[], read: Read): string[] {
  return files.filter((f) => historyReads(read(f) ?? "").length > 0).map((f) => `${f}: show`);
}

export function allowProblems(_entry: AllowEntry, _scanned: readonly string[], _read: Read): string[] { return []; }

export function historyOffenders(files: readonly string[], read: Read, allow: readonly AllowEntry[] = HISTORY_ALLOWLIST): string[] {
  return flagged(files, read).filter((l) => !allow.some((e) => l.startsWith(`${e.file}: `)));
}
