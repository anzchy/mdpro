// Purpose: shared helpers for the D355 fix-1 tests (d355-fix1-*.test.ts) and the ADR readers: `adrFiles`/`findAdr`/`ADR`
// read `NNNN-*.md` records only; `isForwardLink` recognises a Status paragraph only in a form docs/adr/README.md permits;
// `heldBody` is an accepted record's pin, its body plus its existing forward links held as a set, so only well-formed
// additions are free; `unresolvedCurrentText` checks every Current text target (#629 and its fix 1; their own tests are
// adr-forward-links.test.ts).
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
export const ADR_DIR = path.join(root, "docs/adr");
/** The ADR record file names in `dir`, sorted: `NNNN-*.md` files only, so README.md or a directory is never read (#629). */
export const adrFiles = (dir = ADR_DIR): string[] =>
  fs.readdirSync(dir).filter((f) => /^\d{4}-.+\.md$/.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
/** The file name of ADR `n` in `dir`, or undefined when there is none. */
export const findAdr = (dir: string, n: string): string | undefined => adrFiles(dir).find((f) => f.startsWith(`${n}-`));
export const ADR = (n: string) => {
  const name = findAdr(ADR_DIR, n);
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
// The forward-link paragraphs docs/adr/README.md lets an accepted ADR gain, each recognised only in its README form
// (#629 fix 1): `Superseded by ADR-NNNN`; `partially superseded: <clause> by ADR-NNNN`; a dated `Current text:
// <file>#<anchor>[; <file>#<anchor>…]; folded by ADR-0165` or `…; folded and changed by docs/agents/decisions/<file>`;
// and `Drifted` / `False in practice`, dated, with a link to the evidence. An optional leading `**`, `Status note**:` or
// date is allowed. Anything else, the `**Status**:` line and a backward `Supersedes …` included, is not a forward link.
const DATE = String.raw`\(?\d{4}-\d{2}-\d{2}\)?`;
const LEAD = String.raw`^(?:\*\*)?(?:status note\*\*:\s*)?(?:(?<date>${DATE})[,:]?\s+)?(?:\*\*)?`;
const ADR_REF = String.raw`(?:\*\*)?\[?ADR-\d{4}\b`;
const TARGET = "`[^`\\s#]+#[^`\\s#]+`";
const DECISION = "`docs/agents/decisions/[^`\\s]+\\.md`";
const FORMS: RegExp[] = [
  new RegExp(String.raw`${LEAD}superseded(?:\*\*)?(?:,?\s+${DATE})?\s+by\s+${ADR_REF}`, "i"),
  new RegExp(String.raw`${LEAD}partially superseded(?:\*\*)?:\s+\S[\s\S]*?\s+by\s+${ADR_REF}`, "i"),
  new RegExp(String.raw`${LEAD}current text: ${TARGET}(?:[;,] ${TARGET})*; folded (?:by ADR-0165\b|and changed by (?:\[${DECISION}\]\(\.\./agents/decisions/[^)\s]+\.md\)|${DECISION}))(?:\*\*)?(?:,\s+(?<date2>\d{4}-\d{2}-\d{2}))?`, "i"),
  new RegExp(String.raw`${LEAD}(?:drifted|false in practice)(?:\*\*)?(?:,?\s+(?<date2>${DATE}))?[:,][\s\S]*\]\([^)\s]+\)`, "i"),
];
const DATED = [false, false, true, true]; // the Current text and Drifted / False in practice forms must carry a date
/** True when `p` is one forward-link paragraph in a form docs/adr/README.md permits. */
export function isForwardLink(p: string): boolean {
  return FORMS.some((re, i) => {
    const m = p.match(re);
    return !!m && (!DATED[i] || !!(m.groups?.date || m.groups?.date2));
  });
}
/**
 * The paragraphs of the Status block: those before the first `## ` heading other than `## Status`. A text with no such
 * heading has no Status block, so nothing in it is ever stripped (opus-auditor L2).
 */
export function statusParagraphs(text: string): string[] {
  const paras = text.split("\n\n");
  const end = paras.findIndex((p) => /^## (?!Status\n|Status$)/.test(p));
  return end < 0 ? [] : paras.slice(0, end);
}
/** `text` less the Status paragraphs `drop` selects; the rest, the Status line and the body included, byte for byte. */
function stripStatus(text: string, drop: (p: string) => boolean): string {
  const n = statusParagraphs(text).length;
  return text.split("\n\n").filter((p, i) => i >= n || !drop(p)).join("\n\n");
}
/** The ADR's text with every correctly formed forward-link paragraph of its Status block removed (#629). */
export const withoutForwardLinks = (text: string) => stripStatus(text, isForwardLink);
/**
 * The pin of an accepted record (#629 fix 1). `base` is the sha256 of each forward-link paragraph the record had when
 * its pin was recorded. `body` is the text less those paragraphs and less any correctly formed one added since, so a
 * hash of it holds the accepted record; `missing` lists each base paragraph no longer present byte for byte, so
 * deleting, rewriting or repointing an existing forward link fails the pin while adding a well-formed one does not.
 */
export function heldBody(text: string, base: readonly string[]): { body: string; missing: string[] } {
  const present = new Set(statusParagraphs(text).map(sha));
  return {
    body: stripStatus(text, (p) => base.includes(sha(p)) || isForwardLink(p)),
    missing: base.filter((h) => !present.has(h)),
  };
}
/**
 * `file: target: file missing|anchor missing` for each Current text target in `text` that does not resolve, and the
 * number of targets seen. It scans every Status paragraph that says `Current text:`, whatever its prefix (gpt-auditor
 * H1), and any line starting `**Current text:`; a `folded and changed by` decision file must exist too.
 */
export function unresolvedCurrentText(file: string, text: string): { bad: string[]; seen: number } {
  const paras = new Set([...statusParagraphs(text), ...text.split("\n").filter((l) => l.startsWith("**Current text:"))]);
  const bad: string[] = [];
  let seen = 0;
  for (const p of [...paras].filter((q) => /current text:/i.test(q))) {
    const span = p.match(/current text:([\s\S]*?); folded/i)?.[1] ?? "";
    const targets = [...span.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const route = p.match(/folded and changed by \[?`(docs\/agents\/decisions\/[^`]+)`/i)?.[1];
    if (!targets.length) bad.push(`${file}: ${p.slice(0, 60)}: no target`);
    for (const t of [...targets, ...(route ? [route] : [])]) {
      seen++;
      const [f, anchor] = t.split("#");
      if (!exists(f)) bad.push(`${file}: ${t}: file missing`);
      else if (anchor && !anchorExists(f, anchor)) bad.push(`${file}: ${t}: anchor missing`);
    }
  }
  return { bad, seen };
}
/** `text` with `para` added as the last paragraph before `## Context`: a Status annotation, as a fold would add it. */
export const addStatusParagraph = (text: string, para: string) => text.replace("\n\n## Context\n", `\n\n${para}\n\n## Context\n`);
/** A permitted forward-link paragraph a later fold could add; the pins below must still pass with it. */
export const LATER_FOLD = "**Current text: `docs/guide/load-guard.md#admission`; folded by ADR-0165**, 2026-11-04 (#629 fixture).";
export const currentText = (rel: string) => read(rel).split("\n").find((l) => l.startsWith("**Current text:")) ?? "";

export const SUPERSEDED = [
  "three rounds", "two confirms", "audit + 2 confirms", "no fourth round", "round three", "Opus is never required",
  "optional `opus-auditor`", "optional Opus audit", "opus-auditor is optional", "Optional auditor", "/cc-suite:continue",
  "/cc-suite:review-plan", "only when the user explicitly requests it", "single-auditor verdict unless",
  "`gpt-auditor` is required", "remains the required auditor", "ADR-0143 wins",
];
export const CONDITIONAL = /\b(optional|only when|only if|unless|may add|may (skip|omit)|skip|omit|(if|when) (claude )?usage|alone|without|discretion|not required|never required|does not block|do not (reset|prompt|wait))\b/;

