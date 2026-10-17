/**
 * @module tests/support/zIndexGuard
 * Purpose: the z-index guard behind tests/d277-zindex-pin.test.ts (D277):
 * read rule 31's z-index table, collect every z-index declaration in the
 * app's CSS and every inline z-index in its TS and TSX, and report where
 * they disagree with the table.
 *
 * Key decisions (D277-FIX-1, Codex H1-H3 and Fable's Mediums on PR #501):
 * - Every unstruck table row must name a backticked selector, except the
 *   Base row and the `(reserved)` row, so a row cannot silently pin nothing.
 * - The CSS walk is this file's own: a rule nested inside another rule
 *   throws, since its selector depends on the parent and the guard would
 *   otherwise see only the inner part. At-rule wrappers are kept apart from
 *   the selector, and a selector list is checked selector by selector.
 * - TS and TSX are read with the TypeScript parser, so comments are trivia
 *   and a `//` inside a string (a URL) hides nothing.
 */
import * as ts from "typescript";
import { blankComments } from "./cssTokenScan";

/** A z-index outside the table that is not a floating surface, with its reason (tests/css-tokenization.test.ts:130, Q10). */
export const LOCAL_STACKING = [
  {
    file: "components/Editor/MilkdownEditor.css",
    selector: ".milkdown-editor .ProseMirror .column-resize-handle",
    value: "1",
    reason: "local stacking inside the table, not a floating surface",
  },
];

export interface Layer {
  layer: string;
  value: string;
  selectors: string[];
}

/**
 * The rows of rule 31 § Z-index hierarchy. A struck-out row (`~~…~~`) is
 * retired. Every other row must name at least one backticked selector,
 * except the layer named Base and a row whose Used by is `(reserved)`;
 * those two pin nothing.
 */
export function zIndexTable(markdown: string): Layer[] {
  const start = markdown.indexOf("## Z-index hierarchy");
  if (start < 0) throw new Error("rule 31 has no § Z-index hierarchy");
  const next = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const layers: Layer[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3 || cells[0] === "Layer" || /^-+$/.test(cells[0]) || cells[0].startsWith("~~")) continue;
    const value = cells[1].replace(/`/g, "");
    const selectors = [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (selectors.length > 0) layers.push({ layer: cells[0], value, selectors });
    else if (cells[0] !== "Base" && cells[2] !== "(reserved)") {
      throw new Error(`rule 31 z-index row "${cells[0]}" names no backticked selector: ${cells[2]}`);
    }
  }
  return layers;
}

/** One z-index declaration: `selector` is its rule's own selector (a list stays whole), `atRules` the wrappers around it. */
export interface Placed {
  file: string;
  line: number;
  selector: string;
  atRules: string[];
  property: string;
  value: string;
}

/** Every z-index declaration in the given CSS files; throws on a nested rule. */
export function zIndexDeclarations(files: Record<string, string>): Placed[] {
  return Object.entries(files).flatMap(([file, css]) => walk(file, css));
}

function walk(file: string, css: string): Placed[] {
  const text = blankComments(css);
  const out: Placed[] = [];
  const stack: string[] = [];
  let buf = "";
  let bufLine = 1;
  let line = 1;
  let parens = 0;
  let quote: string | null = null;
  const flush = () => {
    const raw = buf;
    buf = "";
    const colon = raw.indexOf(":");
    const rule = stack.filter((s) => !s.startsWith("@")).pop();
    if (colon < 0 || rule === undefined) return;
    const property = raw.slice(0, colon).trim().toLowerCase();
    if (property !== "z-index") return;
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    out.push({
      file,
      line: bufLine + (lead.match(/\n/g)?.length ?? 0),
      selector: rule,
      atRules: stack.filter((s) => s.startsWith("@")),
      property,
      value: raw.slice(colon + 1).replace(/\s+/g, " ").trim(),
    });
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (buf === "") bufLine = line;
    if (ch === "\n") line += 1;
    if (ch === "\\" && i + 1 < text.length) {
      if (text[i + 1] === "\n") line += 1;
      buf += ch + text[i + 1];
      i += 1;
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") parens += 1;
    if (ch === ")") parens -= 1;
    if (parens > 0) {
      buf += ch;
      continue;
    }
    if (ch === "{") {
      const prelude = buf.replace(/\s+/g, " ").trim();
      const parent = stack.filter((s) => !s.startsWith("@")).pop();
      if (parent !== undefined) {
        throw new Error(`${file}:${line}: nested CSS not supported by this guard (\`${prelude}\` inside \`${parent}\`)`);
      }
      stack.push(prelude);
      buf = "";
    } else if (ch === "}") {
      if (buf.trim()) flush();
      buf = "";
      stack.pop();
    } else if (ch === ";") {
      if (stack.length === 0) buf = "";
      else flush();
    } else {
      buf += ch;
    }
  }
  return out;
}

/** The selectors of a list, split on commas outside parentheses and brackets. */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** What disagrees with the table: a pinned selector with another value or none, or a z-index the table does not name. */
export function zIndexDrift(layers: Layer[], decls: Placed[]): string[] {
  const out: string[] = [];
  const pieces = decls.map((d) => ({ d, selectors: splitSelectors(d.selector) }));
  for (const { layer, value, selectors } of layers) {
    for (const selector of selectors) {
      const found = pieces.filter((p) => p.selectors.includes(selector)).map((p) => p.d);
      if (found.length === 0) out.push(`${selector} (${layer}) sets no z-index`);
      for (const d of found) if (d.value !== value) out.push(`${selector} is ${d.value} in ${d.file}:${d.line}; ${layer} is ${value}`);
    }
  }
  const pinned = new Set(layers.flatMap((l) => l.selectors));
  for (const { d, selectors } of pieces) {
    if (d.value === "auto") continue;
    for (const selector of selectors) {
      if (pinned.has(selector)) continue;
      if (LOCAL_STACKING.some((x) => x.file === d.file && x.selector === selector && x.value === d.value)) continue;
      out.push(`${selector} sets z-index ${d.value} in ${d.file}:${d.line}, a surface rule 31's table does not name`);
    }
  }
  return out;
}

/**
 * Where a TS or TSX source sets a z-index inline: any `zIndex` identifier
 * (`style.zIndex =`, `{ zIndex }`, `style={{ zIndex }}`) and any string or
 * template text naming `z-index` (`setProperty("z-index", …)`, `cssText`).
 */
export function inlineZIndex(source: string, file: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === "zIndex") hits.push(`${at(n)} zIndex`);
    if ((ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) && /z-index/i.test(n.text)) hits.push(`${at(n)} "${n.text}"`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
