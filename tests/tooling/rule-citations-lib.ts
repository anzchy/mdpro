/**
 * Purpose: the citation half of the ADR-0147 checker (decision 4): the section map, citation and pointer parsing, and
 * resolution against rules 70 and 71.
 *
 * Key decisions: a citation label resolves within the cited rule only: map row first, then the longest word-prefix of
 * the label that is an exact heading or the prefix of exactly one heading. Two headings → ambiguous, never a guess.
 *
 * @coordinates-with tests/tooling/rules-lib-core.ts, tests/tooling/rule-citations.test.ts,
 *   docs/reference/adr-0147-rule-section-map.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  anchorExists, headingsAt, lineAt, RULE_FILES, SECTION_MAP, trackedFiles,
} from "./rules-lib-core";

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
