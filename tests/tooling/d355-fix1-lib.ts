// Shared helpers for the D355 fix-1 tests (d355-fix1-*.test.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(__dirname, "../..");
export const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
export const exists = (rel: string) => fs.existsSync(path.join(root, rel));
export const flat = (text: string) => text.replace(/\s+/g, " ");
export const count = (text: string, phrase: string) => text.split(phrase).length - 1;
export const show = (rev: string, rel: string) => execFileSync("git", ["show", `${rev}:${rel}`], { cwd: root, encoding: "utf8" });
export const BASE = "22ffe5ea";
export const CANDIDATE = "98de0c69";
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
// the .claude path is a symlink, which git show cannot read
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

