/**
 * Purpose: the checker behind ADR-0147's two gates, rule-citations (decision 4) and always-on-budget (decision 5).
 * Every function takes a repository root, so the tests run it on throwaway fixture trees and on the live tree alike.
 *
 * Key decisions:
 * - Only tracked files are scanned (`git ls-files -z`), so CJK paths come back unquoted and a stray untracked file
 *   cannot break the gate.
 * - A citation label resolves within the cited rule only: map row first, then the longest word-prefix of the label
 *   that is an exact heading or the prefix of exactly one heading. Two headings → ambiguous, never a guess.
 * - Read blocks are the only mandatory reads. A route is the runtime's shared set, the role file, the whole template,
 *   and every file reached through a read block, transitively, deduplicated by resolved path.
 *
 * @coordinates-with tests/tooling/rule-citations.test.ts, tests/tooling/always-on-budget.test.ts,
 *   scripts/codex-rules/land-guard.mjs (runs both tests on docs-only ranges), docs/reference/adr-0147-rule-section-map.json
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
  const clean = decodeURIComponent(target.split("#")[0]);
  const abs = path.resolve(root, path.dirname(fromRel), clean);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

// ---------- headings ----------

export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
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

// ---------- section map ----------

export interface MapRow { cite: string; targets: string[] }

export function loadMap(root: string): MapRow[] {
  const abs = path.join(root, SECTION_MAP);
  if (!fs.existsSync(abs)) return [];
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as { rows?: MapRow[] };
  return parsed.rows ?? [];
}

export function normCite(s: string): string {
  return s.replace(/\s+/g, " ").replace(/'s\b/i, "").trim().toLowerCase();
}

/** Every problem with the map itself: empty targets, a missing file, a dead anchor, a duplicate cite. */
export function validateMap(root: string, rows: MapRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = normCite(row.cite);
    if (seen.has(key)) problems.push(`map: duplicate row "${row.cite}"`);
    seen.add(key);
    if (!/^rule 7[01] (§ .+|item \d+)$/.test(key)) problems.push(`map: row "${row.cite}" is not "rule 7x § label" or "rule 7x item n"`);
    if (!Array.isArray(row.targets) || row.targets.length === 0) {
      problems.push(`map: row "${row.cite}" has no targets`);
      continue;
    }
    for (const t of row.targets) {
      const [file, anchor] = t.split("#");
      if (!fs.existsSync(path.join(root, file))) problems.push(`map: row "${row.cite}" target ${t}: file missing`);
      else if (!anchor) problems.push(`map: row "${row.cite}" target ${t}: no anchor`);
      else if (!anchorExists(root, file, anchor)) problems.push(`map: row "${row.cite}" target ${t}: anchor missing`);
    }
  }
  return problems;
}

// ---------- citations ----------

export interface Citation {
  file: string;
  line: number;
  rule: "70" | "71";
  kind: "label" | "item" | "anchor" | "pointer";
  label?: string;
  item?: number;
  target?: string; // anchor and pointer kinds: repo-relative path#anchor, or the raw text when unresolvable
  raw: string;
}

// `rule 70 § Label`, `rule 70 item 4`, `rule 70 items 2 and 4` (case-insensitive) ...
const CITE_RE = /\brule\s+(7[01])(?!\d)(?:'s)?\s*(?:(§)|items?\s+(\d{1,2}(?:(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+)\d{1,2}(?!\d))*)(?!\d))/gi;
// ... and `rule 70 Commits item 4` (ADR-0147 d4's `<label> item <n>`): the label must be capitalised, so prose such as
// "rule 70 says item 4" is not a citation (H1).
const LABEL_ITEM_RE = /\b[Rr]ule\s+(7[01])(?!\d)(?:'s)?\s+([A-Z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}?)\s+items?\s+(\d{1,2}(?:(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+)\d{1,2}(?!\d))*)(?!\d)/g;
const itemList = (s: string): number[] => s.split(/\s*,\s*and\s+|\s*,\s*|\s+and\s+/).map(Number);
const LABEL_STOP = /[,.;:)(|`"“”「」『』*\]\[—–。，；：、（）§]|\s{2,}|\bitems?\s+\d+|\brule\s+\d/i;

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The citations in one file's text. Labels may wrap across one line break (G5). */
export function findCitations(file: string, text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(LABEL_ITEM_RE)) {
    for (const n of itemList(m[3])) {
      out.push({ file, line: lineAt(text, m.index!), rule: m[1] as "70" | "71", kind: "label", label: m[2], item: n, raw: m[0].trim() });
    }
  }
  for (const m of text.matchAll(CITE_RE)) {
    const rule = m[1] as "70" | "71";
    const line = lineAt(text, m.index!);
    if (m[3]) {
      for (const n of itemList(m[3])) out.push({ file, line, rule, kind: "item", item: n, raw: m[0].trim() });
      continue;
    }
    // the label is read from the text after `§`, without consuming it, so a citation on the next line is still found;
    // it may wrap across one line break (G5)
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 240);
    const twoLines = after.split("\n").slice(0, 2);
    let rest = (twoLines[0].trim() ? twoLines.join("\n") : twoLines.join(" ")).replace(/\n[\s>*-]*/g, " ").trimStart();
    rest = rest.replace(/^["“「]/, "");
    const stop = LABEL_STOP.exec(rest);
    const label = (stop ? rest.slice(0, stop.index) : rest).trim().replace(/['’]s?$/, "");
    if (label.startsWith("<")) continue; // a template placeholder such as `rule 70 § <name>`, not a citation
    const itemAfter = /^\s*item\s+(\d+)/i.exec(rest.slice(stop ? stop.index : rest.length));
    out.push({
      file, line, rule, kind: "label", label, raw: m[0].replace(/\s+/g, " ").slice(0, 80),
      item: itemAfter ? Number(itemAfter[1]) : undefined,
    });
  }
  // links to a rule 70/71 anchor, resolved from the citing file (G4)
  for (const m of text.matchAll(/\]\(([^)\s]*?(7[01])-[a-z0-9-]+\.md)#([^)\s]+)\)/g)) {
    const rel = resolveRel_(file, m[1]);
    out.push({ file, line: lineAt(text, m.index!), rule: m[2] as "70" | "71", kind: "anchor", target: `${rel}#${m[3]}`, raw: m[0] });
  }
  return out.sort((x, y) => x.line - y.line);
}

/** Backticked binding pointers and Governing-text links: `path.md#anchor` (G8, R12, R26). */
export function findPointers(file: string, text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(/`([A-Za-z0-9_./-]+\.md)#([A-Za-z0-9_\p{L}-]+)`/gu)) {
    out.push({ file, line: lineAt(text, m.index!), rule: "70", kind: "pointer", target: `${m[1]}#${m[2]}`, raw: m[0] });
  }
  return out;
}

// plain path math without a root, used before the root is known
function resolveRel_(fromRel: string, target: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), target));
}

export interface Resolution { ok: boolean; reason?: string; via?: string }

function labelCandidates(label: string): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let k = words.length; k >= 1; k--) out.push(words.slice(0, k).join(" "));
  return out;
}

export function resolveCitation(root: string, c: Citation, rows: MapRow[]): Resolution {
  const byCite = new Map(rows.map((r) => [normCite(r.cite), r]));
  const viaRow = (row: MapRow): Resolution => {
    const dead = row.targets.filter((t) => {
      const [f, a] = t.split("#");
      return !a || !anchorExists(root, f, a);
    });
    return dead.length ? { ok: false, reason: `map row "${row.cite}" has dead target(s) ${dead.join(", ")}` } : { ok: true, via: "map" };
  };
  if (c.kind === "anchor" || c.kind === "pointer") {
    const [file, anchor] = c.target!.split("#");
    const candidates = c.kind === "anchor" ? [file] : [resolveRel_(c.file, file), file];
    for (const f of candidates) {
      if (f.startsWith("..")) continue;
      if (anchorExists(root, f, anchor)) return { ok: true, via: f };
    }
    return { ok: false, reason: `no heading #${anchor} in ${candidates.join(" or ")}` };
  }
  if (c.kind === "item") {
    const row = byCite.get(`rule ${c.rule} item ${c.item}`);
    return row ? viaRow(row) : { ok: false, reason: `no map row for "rule ${c.rule} item ${c.item}"` };
  }
  if (c.item !== undefined) {
    // `<label> item <n>`: the label must resolve in the rule and the item must have its own row (H1)
    const row = byCite.get(`rule ${c.rule} item ${c.item}`);
    if (!row) return { ok: false, reason: `no map row for "rule ${c.rule} item ${c.item}"` };
    const viaItem = viaRow(row);
    if (!viaItem.ok) return viaItem;
    const viaLabel = resolveCitation(root, { ...c, item: undefined }, rows);
    return viaLabel.ok ? viaItem : { ok: false, reason: `label "${c.label}" of item ${c.item}: ${viaLabel.reason}` };
  }
  const headings = headingsAt(root, RULE_FILES[c.rule]) ?? [];
  const label = c.label ?? "";
  if (!label) return { ok: false, reason: "empty label" };
  for (const cand of labelCandidates(label)) {
    const lc = cand.toLowerCase();
    const row = byCite.get(`rule ${c.rule} § ${lc}`);
    if (row) return viaRow(row);
    const exact = headings.filter((h) => h.text.toLowerCase() === lc);
    if (exact.length === 1) return { ok: true, via: `#${exact[0].slug}` };
    const prefix = headings.filter((h) => {
      const t = h.text.toLowerCase();
      return t.startsWith(lc) && (t.length === lc.length || /[\s:]/.test(t[lc.length]));
    });
    if (prefix.length === 1) return { ok: true, via: `#${prefix[0].slug}` };
    if (prefix.length > 1) return { ok: false, reason: `ambiguous: "${cand}" prefixes ${prefix.map((h) => h.text).join(" | ")}` };
  }
  return { ok: false, reason: `no heading or map row in rule ${c.rule} for "${label}"` };
}

/** Files the citation scan reads: tracked *.md, .claude/hooks/*, .claude/agents/* (ADR-0147 d4). */
export function citationScanSet(root: string): string[] {
  return trackedFiles(root).filter((f) => f.endsWith(".md") || f.startsWith(".claude/hooks/") || f.startsWith(".claude/agents/"));
}

/** Files whose backticked `x.md#anchor` pointers must resolve: the routing map and the role destinations. */
export function pointerScanSet(root: string): string[] {
  return trackedFiles(root).filter((f) =>
    f === "CLAUDE.md" || f === "AGENTS.md" || f.startsWith(".claude/rules/") ||
    (f.startsWith("docs/agents/") && f.endsWith(".md") && f !== "docs/agents/audit-dimensions.md") ||
    (f.startsWith(".agents/skills/mdpro-delegator/") && f.endsWith(".md")));
}

export interface Unresolved { where: string; raw: string; reason: string }

export function scanCitations(root: string): { count: number; unresolved: Unresolved[]; mapProblems: string[] } {
  const rows = loadMap(root);
  const unresolved: Unresolved[] = [];
  let count = 0;
  const pointerSet = new Set(pointerScanSet(root));
  for (const f of citationScanSet(root)) {
    const abs = path.join(root, f);
    const text = fs.readFileSync(abs, "utf8"); // an unreadable tracked file throws (G6): never skipped
    const cites = [...findCitations(f, text), ...(pointerSet.has(f) ? findPointers(f, text) : [])];
    for (const c of cites) {
      count++;
      const r = resolveCitation(root, c, rows);
      if (!r.ok) unresolved.push({ where: `${f}:${c.line}`, raw: c.raw, reason: r.reason! });
    }
  }
  return { count, unresolved, mapProblems: validateMap(root, rows) };
}

// ---------- always-on (Claude) ----------

/** The exact patterns a rule may be scoped to and still count as path-scoped (ADR-0147 d5, H8): the union of the
 *  scoped rules' patterns at db04d826 (20, 30–34, 40, 41), ADR-0147 d9's lists for 22 and 50, and rule 10's ruled list
 *  (D355 ruling 1 Q3). Any other pattern makes its rule always-on. A new entry is a reviewed change to this list. */
export const SCOPED_PATTERN_ALLOWLIST: readonly string[] = [
  "src-tauri/src/commands/**/*.rs", "src/services/**/*.ts", "src/hooks/**/*.ts", "src/components/**/*.tsx",
  "src/**/*.css", "src/**/*.tsx", "src/plugins/**/*.ts", "src/App.tsx", "src/main.tsx",
  "package.json", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json",
  "src-tauri/src/menu.rs", "src/types/preferences.ts", "src/hooks/useKeyboardShortcuts.ts",
  "src/components/common/settings/KeyboardShortcutsSettings.tsx", "docs/guide/keyboard-shortcuts.md",
  "src/**", "src-tauri/**", "tests/**", "scripts/**", ".claude/hooks/**", ".agents/skills/**/scripts/**",
  "vitest*.ts",
];
export const PROBE_FILES = ["docs/x.md", "docs/agents/x.md", ".agents/skills/x/SKILL.md", "CLAUDE.md", "AGENTS.md"];

/** The `paths:` list of a rule's frontmatter, or null when the frontmatter has no `paths:` key. */
export function frontmatterPaths(text: string): string[] | null {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) return null;
  const lines = fm[1].split("\n");
  const i = lines.findIndex((l) => /^paths:/.test(l));
  if (i < 0) return null;
  const inline = /^paths:\s*\[(.*)\]\s*$/.exec(lines[i]);
  if (inline) return inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && /^\s+-\s/.test(lines[j]); j++) {
    out.push(lines[j].replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
  }
  return out;
}

export function isPathScoped(text: string): boolean {
  const ps = frontmatterPaths(text);
  if (!ps || ps.length === 0) return false;
  return ps.every((p) => SCOPED_PATTERN_ALLOWLIST.includes(p) &&
    !PROBE_FILES.some((probe) => path.posix.matchesGlob(probe, p)));
}

/** `@path.md` imports outside code (fences and inline code), not part of an email (G12). */
export function importsOf(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const noCode = line.replace(/`[^`]*`/g, "");
    for (const m of noCode.matchAll(/(?:^|[\s(])@([A-Za-z0-9_./~-]+\.md)\b/g)) out.push(m[1]);
  }
  return out;
}

export interface SetResult { members: string[]; bytes: number; errors: string[] }

function sumBytes(root: string, members: string[]): number {
  return members.reduce((n, m) => n + bytesOf(root, m), 0);
}

export function claudeAlwaysOn(root: string): SetResult {
  const errors: string[] = [];
  const members: string[] = [];
  const seen = new Set<string>();
  const walk = (rel: string, from: string) => {
    if (seen.has(rel)) return;
    if (!fs.existsSync(path.join(root, rel))) { errors.push(`import ${rel} (from ${from}) does not exist`); return; }
    seen.add(rel);
    members.push(rel);
    for (const imp of importsOf(readRel(root, rel))) {
      if (imp.startsWith("~") || path.isAbsolute(imp)) { errors.push(`import @${imp} in ${rel} is outside the repository`); continue; }
      const r = resolveRel(root, rel, imp);
      if (!r) { errors.push(`import @${imp} in ${rel} is outside the repository`); continue; }
      walk(r, rel);
    }
  };
  walk("CLAUDE.md", "root");
  for (const f of trackedFiles(root).filter((f) => f.startsWith(".claude/rules/") && f.endsWith(".md")).sort()) {
    if (!isPathScoped(readRel(root, f))) walk(f, "always-on rule");
  }
  // a read block in an always-on file is a mandatory read for every Claude session (H4)
  const c = closure(root, members);
  return { members: c.members, bytes: c.bytes, errors: [...errors, ...c.errors] };
}

// ---------- read blocks and routes ----------

export interface Block { entries: string[]; errors: string[] }

/** The path one read-block line names, in any spelling (H5): `[t](p)`, `[t](p#a)`, `<p>`, `` `p` ``, `[t][ref]`, or a
 *  bare path. Returns null for a line that names nothing. */
function blockEntry(line: string, refs: Map<string, string>): string | null {
  const body = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
  if (!body) return null;
  let m = /\]\(([^)\s]+)\)/.exec(body);
  if (m) return m[1];
  m = /\[[^\]]*\]\[([^\]]+)\]/.exec(body);
  if (m) return refs.get(m[1].toLowerCase()) ?? `[${m[1]}]`;
  m = /<([^>\s]+)>/.exec(body);
  if (m) return m[1];
  m = /`([^`\s]+)`/.exec(body);
  if (m) return m[1];
  m = /^([^\s]+\.[A-Za-z0-9]+(?:#[^\s]*)?)/.exec(body);
  return m ? m[1] : body;
}

/** The files listed in every read block of `rel`, resolved from `rel`'s directory; whole files, anchors ignored. */
export function readBlocks(root: string, rel: string): Block {
  const text = readRel(root, rel);
  const entries: string[] = [];
  const errors: string[] = [];
  const refs = new Map<string, string>();
  for (const m of text.matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)/gm)) refs.set(m[1].toLowerCase(), m[2]);
  let at = 0;
  for (;;) {
    const b = text.indexOf(BLOCK_BEGIN, at);
    if (b < 0) break;
    const e = text.indexOf(BLOCK_END, b);
    if (e < 0) { errors.push(`${rel}: unterminated read block at line ${lineAt(text, b)}`); break; }
    const startLine = lineAt(text, b);
    text.slice(b + BLOCK_BEGIN.length, e).split("\n").forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line) || !/^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)) return;
      const entry = blockEntry(line, refs);
      if (!entry || /^[a-z]+:/i.test(entry)) return;
      const r = resolveRel(root, rel, entry);
      if (!r || !fs.existsSync(path.join(root, r)) || !fs.statSync(path.join(root, r)).isFile()) {
        errors.push(`${rel}:${startLine + i}: read-block entry names no existing file: ${line.trim()}`);
      } else entries.push(r);
    });
    at = e + BLOCK_END.length;
  }
  return { entries, errors };
}

/** Text of `rel` with read blocks removed (an unterminated block keeps its tail, so it is still checked: G13). */
export function outsideBlocks(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const b = text.indexOf(BLOCK_BEGIN, at);
    const e = b < 0 ? -1 : text.indexOf(BLOCK_END, b);
    if (b < 0 || e < 0) { out += text.slice(at); break; }
    out += text.slice(at, b) + "\n".repeat(text.slice(b, e).split("\n").length - 1);
    at = e + BLOCK_END.length;
  }
  return out;
}

export function closure(root: string, start: string[]): SetResult {
  const members: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    if (!fs.existsSync(path.join(root, f))) { errors.push(`${f} does not exist`); continue; }
    seen.add(f);
    members.push(f);
    const b = readBlocks(root, f);
    errors.push(...b.errors);
    queue.push(...b.entries);
  }
  return { members, bytes: sumBytes(root, members), errors };
}

export function codexShared(root: string): SetResult {
  const r = closure(root, ["AGENTS.md"]);
  if (!readRel(root, "AGENTS.md").includes(BLOCK_BEGIN)) r.errors.push("AGENTS.md has no read block");
  return r;
}

export type Runtime = "claude" | "codex";
export interface RouteDef { role: "delegator" | "implementor" | "auditor" | "device"; start: string[] }

const T = ".agents/skills/mdpro-delegator/references/templates";
export const ROUTES: Record<string, RouteDef> = {
  "delegator": { role: "delegator", start: [".agents/skills/mdpro-delegator/SKILL.md"] },
  "implementor-brief": { role: "implementor", start: ["docs/agents/implementor.md", `${T}/brief-template.md`] },
  "implementor-fix": { role: "implementor", start: ["docs/agents/implementor.md", `${T}/fix-brief-template.md`] },
  "auditor-audit": { role: "auditor", start: ["docs/agents/auditor.md", `${T}/audit-request-template.md`] },
  "auditor-confirm": { role: "auditor", start: ["docs/agents/auditor.md", `${T}/confirm-request-template.md`] },
  "auditor-challenge": { role: "auditor", start: ["docs/agents/auditor.md", `${T}/challenge-request-template.md`] },
  "auditor-plan": { role: "auditor", start: ["docs/agents/auditor.md", `${T}/plan-review-request-template.md`] },
  "device": { role: "device", start: ["docs/agents/device-tester.md", `${T}/device-brief-template.md`] },
};

export function route(root: string, name: string, runtime: Runtime): SetResult {
  const def = ROUTES[name];
  const shared = runtime === "claude" ? claudeAlwaysOn(root) : codexShared(root);
  const missing = def.start.filter((s) => !fs.existsSync(path.join(root, s)));
  const c = closure(root, [...shared.members, ...def.start]);
  return { members: c.members, bytes: c.bytes, errors: [...shared.errors, ...missing.map((m) => `route ${name}: ${m} missing`), ...c.errors] };
}

// ---------- read directives outside blocks ----------

/** A fixed list (ADR-0147 d5), English and Chinese (G16, provisional). Matched on paragraph-joined text. */
export const READ_DIRECTIVES: RegExp[] = [
  /\bread\b[^.\n]{0,120}?\bbefore (?:you |your )?(?:start|begin|work|any|the first|dispatch)/i,
  /\bread\b[^.\n]{0,120}?\bfirst\b/i,
  /\bread\b[^.\n]{0,120}?\bonce\b/i,
  /\bread\b[^.\n]{0,120}?\bin full\b/i,
  /\bbefore your first\b/i,
  /\bread\b[^.\n]{0,120}?\bevery (?:time|session)\b/i,
  /\b(?:at the start of|on|in) every session\b[^.\n]{0,40}?\bread/i,
  /\bread\b[^.\n]{0,120}?\bat (?:the )?(?:session start|start of (?:the |every |each )?session)\b/i,
  /\bstart by reading\b/i,
  /先读/, /先阅读/, /每次都要读/, /开始前[^。\n]{0,40}读/,
];

export const DOC_REFERENCE = /\.md\b|\]\(|\bguide\b|\brules?\b|\bCLAUDE\b|\bAGENTS\b|\bSKILL\b|\bskill\b|读|文档/;

/** Files the directive and anchorless-link checks cover (ADR-0147 d5; G21: audit-dimensions.md is exempt by name,
 *  because it is ADR-0146's reviewed blob, changed only by its own High-tier PR). */
export function directiveScanSet(root: string): string[] {
  return trackedFiles(root).filter((f) =>
    f === "AGENTS.md" || f === ".agents/skills/mdpro-delegator/SKILL.md" ||
    (f.startsWith(`${T}/`) && f.endsWith(".md")) ||
    (/^docs\/agents\/[^/]+\.md$/.test(f) && f !== "docs/agents/audit-dimensions.md"));
}

export interface Violation { where: string; what: string }

export function readDirectiveViolations(root: string, rel: string): Violation[] {
  const text = outsideBlocks(readRel(root, rel));
  const out: Violation[] = [];
  // strip HTML comments (provenance records are not directives) but keep line count
  const noComments = text.replace(/<!--[\s\S]*?-->/g, (s) => "\n".repeat(s.split("\n").length - 1));
  // paragraph-joined (G15): each paragraph's line breaks become spaces; report the directive's start line
  const paraRe = /(?:^|\n\s*\n)/g;
  const starts: number[] = [0];
  for (const m of noComments.matchAll(paraRe)) if (m.index! > 0) starts.push(m.index! + m[0].length);
  starts.forEach((s, i) => {
    const para = noComments.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined);
    // links and code spans keep their length but lose the dots that end a sentence, so `[x](../x.md#a)` and `x.md`
    // inside a directive do not cut it short
    const joined = para.replace(/\n/g, " ")
      .replace(/\]\([^)\s]*\)/g, (t) => "]" + "_".repeat(t.length - 1))
      .replace(/`[^`]*`/g, (t) => "_".repeat(t.length));
    const flat = para.replace(/\n/g, " ");
    for (const re of READ_DIRECTIVES) {
      const m = re.exec(joined);
      // a directive counts when it names a document (a link, a `.md` path, a guide, rule or skill), so procedure text
      // such as "read every changed file … in full" in an audit request is not a mandatory doc read
      if (m && DOC_REFERENCE.test(flat.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60))) out.push({ where: `${rel}:${lineAt(noComments, s + m.index)}`, what: `read directive outside a read block: "${para.replace(/\n/g, " ").slice(m.index, m.index + 80)}"` });
    }
  });
  // anchorless repository links (B14) and dead anchors (B23)
  noComments.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
      const r = resolveRel(root, rel, target);
      if (!r) continue;
      if (!target.includes("#")) { out.push({ where: `${rel}:${i + 1}`, what: `link without an anchor outside a read block: ${target}` }); continue; }
      const anchor = target.split("#")[1];
      if (fs.existsSync(path.join(root, r)) && r.endsWith(".md") && !anchorExists(root, r, anchor)) {
        out.push({ where: `${rel}:${i + 1}`, what: `dead anchor: ${target}` });
      }
    }
  });
  return out;
}
