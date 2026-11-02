/**
 * Purpose: the checker behind ADR-0147's two gates, rule-citations (decision 4) and always-on-budget (decision 5).
 * This file holds the budget half (always-on set, read blocks, routes, read directives) and re-exports the base
 * (rules-lib-core.ts) and the citation half (rule-citations-lib.ts), so tests import from here alone. Every function
 * takes a repository root, so the tests run it on throwaway fixture trees and on the live tree alike.
 *
 * Key decisions:
 * - Read blocks are the only mandatory reads. A route is the runtime's shared set, the role file, the whole template,
 *   and every file reached through a read block, transitively, deduplicated by resolved path.
 * - A read-block entry must be Markdown, because land-guard runs the rule tests only for ranges touching Markdown or
 *   the section map.
 *
 * @coordinates-with tests/tooling/rule-citations.test.ts, tests/tooling/always-on-budget.test.ts,
 *   scripts/codex-rules/land-guard.mjs (runs both tests on docs-only ranges), docs/reference/adr-0147-rule-section-map.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  anchorExists, BLOCK_BEGIN, BLOCK_END, bytesOf, lineAt, readRel, resolveRel, trackedFiles,
} from "./rules-lib-core";

export * from "./rules-lib-core";
export * from "./rule-citations-lib";

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
      } else if (!r.endsWith(".md")) {
        // land-guard runs the rule tests only for ranges touching Markdown or the section map (ruleTestsTriggered).
        errors.push(`${rel}:${startLine + i}: read-block entry is not a Markdown file: ${line.trim()}`);
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
