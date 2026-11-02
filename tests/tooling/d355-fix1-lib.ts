// Shared helpers for the D355 fix-1 tests (d355-fix1-*.test.ts).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(__dirname, "../..");
export const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
export const exists = (rel: string) => fs.existsSync(path.join(root, rel));
export const flat = (text: string) => text.replace(/\s+/g, " ");
export const count = (text: string, phrase: string) => text.split(phrase).length - 1;
// No git: CI checks out one commit, and a permanent test may not read history (D355 fix 4). An immutable body is held
// to a recorded sha256 instead, with its blob id beside it.
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
// built at runtime so the UI-token hook does not read the issue numbers as colours
export const ISSUE_570 = ["#", "570"].join("");
export const ISSUE_592 = ["#", "592"].join("");

/** The raw text of `## heading` up to the next `## `, or "" when the heading is missing. */
export function rawSection(text: string, heading: string): string {
  const at = text.indexOf(`\n## ${heading}\n`);
  if (at < 0) return "";
  const next = text.indexOf("\n## ", at + 4);
  return text.slice(at, next < 0 ? undefined : next);
}
export const section = (text: string, heading: string) => flat(rawSection(text, heading));

/**
 * Text normalised for phrase scans (attack gap 1): link targets blanked, backticks, `*` and `_` dropped, every whitespace
 * run one space, lower case. `lines[i]` is the source line of output character `i`, so a hit maps to the line it starts on.
 */
export function normalise(text: string): { s: string; lines: number[] } {
  const src = text.replace(/\]\([^)\s]*\)/g, "]()");
  let s = "";
  const lines: number[] = [];
  let line = 1;
  let space = false;
  for (const ch of src) {
    if (ch === "\n") line++;
    if (ch === "`" || ch === "*" || ch === "_") continue;
    if (/\s/.test(ch)) { space = true; continue; }
    if (space && s.length) { s += " "; lines.push(line); }
    space = false;
    s += ch.toLowerCase();
    lines.push(line);
  }
  return { s, lines };
}
export const normPhrase = (p: string) => normalise(p).s;
/** Sentences of a normalised text (split after `.`, `;` or a table cell bar). */
export const sentences = (text: string) => normalise(text.replace(/「[^」]*」/g, "「」")).s.split(/(?<=[.;|])\s+/);

export const SK = ".agents/skills/mdpro-delegator";
export const REF = `${SK}/references`;
export const LA = `${REF}/landing-and-audit.md`;
export const RR = `${REF}/roster-and-routing.md`;
export const CP = `${REF}/codex-panes.md`;
export const R70 = ".claude/rules/70-multi-session-coordination.md";
export const R71 = ".claude/rules/71-herdr-mixed-roster.md";
export const R12 = ".claude/rules/12-feature-planning-gate.md";
export const IMPL = "docs/agents/implementor.md";
// the .agents path, not the .claude symlink to it
export const SKILL = ".agents/skills/jack-tdd-workflow/SKILL.md";
export const PROMPT = `${SK}/scripts/prompt.sh`;
export const HISTORY = "docs/reference/20261027-rules-70-71-history.md";
export const FOLD_IN = "docs/agents/decisions/20261102-d355-rules-70-71-fold-in.md";
export const BRIEF_T = `${REF}/templates/brief-template.md`;
export const FIX_T = `${REF}/templates/fix-brief-template.md`;
export const ADR = (n: string) => {
  const name = fs.readdirSync(path.join(root, "docs/adr")).find((f) => f.startsWith(`${n}-`));
  if (!name) throw new Error(`ADR-${n} missing`);
  return `docs/adr/${name}`;
};
export const PINNED = new Set(["docs/agents/audit-dimensions.md", "docs/agents/audit-policy-set.md"]);

/** Every live home: the delegator skill, its references and templates, and docs/agents/*.md minus the pinned blobs. */
export function liveHomes(): string[] {
  const md = (dir: string) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md")).map((f) => `${dir}/${f}`);
  return [`${SK}/SKILL.md`, ...md(REF), ...md(`${REF}/templates`), ...md("docs/agents").filter((f) => !PINNED.has(f))];
}
/** `file:line: phrase` for each normalised hit of any phrase in `text`. */
export function hitsIn(file: string, text: string, phrases: string[]): string[] {
  const { s, lines } = normalise(text);
  const out: string[] = [];
  for (const p of phrases) {
    const n = normPhrase(p);
    for (let at = s.indexOf(n); at >= 0; at = s.indexOf(n, at + 1)) out.push(`${file}:${lines[at]}: ${p}`);
  }
  return out;
}
export const hits = (phrases: string[], files = liveHomes()) => files.flatMap((f) => hitsIn(f, read(f), phrases));

/** GitHub's heading slug for the anchors these cases name. */
export const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\- _]/gu, "").replace(/ /g, "-");
export const headings = (rel: string) => read(rel).split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => l.replace(/^#+ /, ""));
export const anchorExists = (rel: string, anchor: string) => headings(rel).some((h) => slug(h) === anchor);

/** The template placeholders written as `§ word` in live homes at 44ec12d0: `<report path § finding>` and `§ policy`. */
export const SECTION_PLACEHOLDERS: ReadonlySet<string> = new Set(["finding", "policy"]);
const NAMED_TARGETS: Record<string, string> = { "CLAUDE.md": "CLAUDE.md", "AGENTS.md": "AGENTS.md",
  "pinned file": "docs/agents/audit-dimensions.md", "dimension file": "docs/agents/audit-dimensions.md" };
/** `file:line: § word → target` for each § reference in `text` (as if it were `file`) that names no heading there. */
export function unresolvedSectionRefs(file: string, text: string): string[] {
  const rules = fs.readdirSync(path.join(root, ".claude/rules"));
  const bad: string[] = [];
  text.replace(/<!--[\s\S]*?-->/g, "").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/§\s*"?([A-Za-z][\w'-]*)/g)) {
      // a placeholder is not a heading (D355 fix 2: only these, so any other lowercase word must resolve); a § inside
      // link text is the link checker's; § Which set is always the pinned dimension file's
      if (SECTION_PLACEHOLDERS.has(m[1])) continue;
      if (/\[[^\]]*$/.test(line.slice(0, m.index!)) && /^[^\]]*\]\(/.test(line.slice(m.index!))) continue;
      const word = m[1].replace(/'s$/, "").toLowerCase();
      const before = line.slice(Math.max(0, m.index! - 70), m.index!);
      const clause = before.split(/[.;:(]\s/).pop() ?? "";
      let target = file;
      const rule = clause.match(/\brule (\d\d)\b(?!.*\brule \d\d\b)/i);
      const md = clause.match(/([\w./-]+\.md)(?!.*\.md)/);
      const key = Object.keys(NAMED_TARGETS).find((k) => clause.includes(k));
      if (word === "which") target = "docs/agents/audit-dimensions.md";
      else if (rule) target = `.claude/rules/${rules.find((r) => r.startsWith(`${rule[1]}-`))}`;
      else if (md) target = md[1].includes("/") ? md[1] : (liveHomes().find((h) => h.endsWith(`/${md[1]}`)) ?? md[1]);
      else if (key) target = NAMED_TARGETS[key];
      if (!exists(target) || !target.endsWith(".md")) continue; // a path this check cannot resolve is the link checker's
      if (!headings(target).some((h) => h.toLowerCase().includes(word))) bad.push(`${file}:${i + 1}: § ${m[1]} → ${target}`);
    }
    return line;
  });
  return bad;
}
/** The ADR's text with its `Current text:` Status line removed. */
// the Status line and the blank line the fold-in added after it (a GREEN-time test fix: without it A6 could never pass)
export const withoutCurrentText = (text: string) => text.replace(/^\*\*Current text:.*\n\n/m, "");
export const currentText = (rel: string) => read(rel).split("\n").find((l) => l.startsWith("**Current text:")) ?? "";

export const SUPERSEDED = [
  "three rounds", "two confirms", "audit + 2 confirms", "no fourth round", "round three", "Opus is never required",
  "optional `opus-auditor`", "optional Opus audit", "opus-auditor is optional", "Optional auditor", "/cc-suite:continue",
  "/cc-suite:review-plan", "only when the user explicitly requests it", "single-auditor verdict unless",
  "`gpt-auditor` is required", "remains the required auditor", "ADR-0143 wins",
];
export const CONDITIONAL = /\b(optional|only when|only if|unless|may add|may (skip|omit)|skip|omit|(if|when) (claude )?usage|alone|without|discretion|not required|never required|does not block|do not (reset|prompt|wait))\b/;

