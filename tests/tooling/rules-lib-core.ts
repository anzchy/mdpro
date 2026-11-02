/**
 * Purpose: the shared base of the ADR-0147 checker (D355): constants, tracked-file access, path resolution and GitHub
 * heading slugs. rule-citations-lib.ts and rules-budget-lib.ts build on it; tests import everything from
 * rules-budget-lib.ts.
 *
 * Key decisions: only tracked files are scanned (`git ls-files -z`), so CJK paths come back unquoted and a stray
 * untracked file cannot break the gate.
 *
 * @coordinates-with tests/tooling/rules-budget-lib.ts, tests/tooling/rule-citations-lib.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const RULE_FILES: Record<string, string> = {
  "70": ".claude/rules/70-multi-session-coordination.md",
  "71": ".claude/rules/71-herdr-mixed-roster.md",
};
export const SECTION_MAP = "docs/reference/adr-0147-rule-section-map.json";
export const BLOCK_BEGIN = "<!-- read-every-session:begin -->";
export const BLOCK_END = "<!-- read-every-session:end -->";
// ---------- files ----------

export function trackedFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return out.split("\0").filter(Boolean);
}

export function readRel(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

export function bytesOf(root: string, rel: string): number {
  return fs.statSync(path.join(root, rel)).size;
}

/** Resolve `target` (a link or path, anchor stripped) against the directory of `fromRel`; null if outside root. */
export function resolveRel(root: string, fromRel: string, target: string): string | null {
  const raw = target.split("#")[0];
  let clean = raw;
  try { clean = decodeURIComponent(raw); } catch { /* a malformed `%` names the file literally, so the scan reports it */ }
  const abs = path.resolve(root, path.dirname(fromRel), clean);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

// ---------- headings ----------

/** GitHub slugs the rendered text: emphasis markers go, but `_` inside a word or a code span stays (its slugger keeps
 *  connector punctuation). */
export function githubSlug(heading: string): string {
  const rendered = heading
    .trim()
    .replace(/<[^>]+>/g, "")
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part.slice(1, -1)
      : part.replace(/[*~]/g, "").replace(/(^|[^\p{L}\p{N}_])_+|_+(?=[^\p{L}\p{N}_]|$)/gu, "$1")))
    .join("");
  return rendered
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export interface Heading { text: string; slug: string; level: number }

/** Headings outside code fences, with GitHub's duplicate-slug suffixes. */
export function headingsOf(text: string): Heading[] {
  const result: Heading[] = [];
  const seen = new Map<string, number>();
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = githubSlug(m[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    result.push({ text: m[2].replace(/[`*]/g, "").trim(), slug: n === 0 ? base : `${base}-${n}`, level: m[1].length });
  }
  return result;
}

const headingCache = new Map<string, Heading[] | null>();
export function headingsAt(root: string, rel: string): Heading[] | null {
  const key = `${root}\0${rel}`;
  if (!headingCache.has(key)) {
    const abs = path.join(root, rel);
    headingCache.set(key, fs.existsSync(abs) && fs.statSync(abs).isFile() ? headingsOf(fs.readFileSync(abs, "utf8")) : null);
  }
  return headingCache.get(key)!;
}
export function clearCaches(): void { headingCache.clear(); }

/** `path#anchor` (repo-relative) exists as a file with that heading. */
export function anchorExists(root: string, rel: string, anchor: string): boolean {
  const hs = headingsAt(root, rel);
  return !!hs && hs.some((h) => h.slug === anchor.toLowerCase());
}

export function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
