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

const STRUCK = /^~~[^~]+~~$/;

/**
 * The rows of rule 31 § Z-index hierarchy. Every table line must have
 * exactly three cells, and anything malformed throws rather than being
 * skipped (D277-FIX-2). A row is retired when its layer and value cells are
 * each wrapped whole in `~~`; any other `~~` throws. The value is `auto` or
 * a whole number. Every other row must name at least one backticked
 * selector, except the layer named Base and a row whose Used by is
 * `(reserved)`; those two pin nothing.
 */
export function zIndexTable(markdown: string): Layer[] {
  const start = markdown.indexOf("## Z-index hierarchy");
  if (start < 0) throw new Error("rule 31 has no § Z-index hierarchy");
  const next = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const layers: Layer[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    if (!line.endsWith("|")) throw new Error(`rule 31 z-index row does not end in |: ${line}`);
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3) throw new Error(`rule 31 z-index row has ${cells.length} cells, not 3 cells: ${line}`);
    if (cells.join("|") === "Layer|z-index|Used by" || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (line.includes("~~")) {
      const retired = STRUCK.test(cells[0]) && STRUCK.test(cells[1]) && !cells[2].includes("~~");
      if (!retired) throw new Error(`rule 31 z-index row has a ~~ that does not wrap its layer and value cells whole: ${line}`);
      continue;
    }
    const value = cells[1].replace(/`/g, "");
    if (!/^(auto|\d+)$/.test(value)) throw new Error(`rule 31 z-index row "${cells[0]}" has value ${cells[1]}, not auto or a whole number`);
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

/** At-rules the walk models: blocks it reads into, and the one statement it skips (D277-FIX-2). */
const BLOCK_AT_RULES = new Set(["media", "keyframes"]);
const STATEMENT_AT_RULES = new Set(["import"]);

const atRuleName = (text: string) => (/^@([\w-]*)/.exec(text)?.[1] ?? "").toLowerCase();

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
      if (prelude.startsWith("@") && !BLOCK_AT_RULES.has(atRuleName(prelude))) {
        throw new Error(`${file}:${line}: at-rule \`${prelude}\` not supported by this guard (only @media and @keyframes blocks)`);
      }
      const parent = stack.filter((s) => !s.startsWith("@")).pop();
      if (parent !== undefined) {
        throw new Error(`${file}:${line}: nested CSS not supported by this guard (\`${prelude}\` inside \`${parent}\`)`);
      }
      stack.push(prelude);
      buf = "";
    } else if (ch === "}") {
      if (buf.trim().startsWith("@")) throw new Error(`${file}:${line}: at-rule \`${buf.trim()}\` not supported by this guard`);
      if (buf.trim()) flush();
      buf = "";
      stack.pop();
    } else if (ch === ";") {
      const statement = buf.trim();
      if (statement.startsWith("@") && !(stack.length === 0 && STATEMENT_AT_RULES.has(atRuleName(statement)))) {
        throw new Error(`${file}:${line}: at-rule \`${statement}\` not supported by this guard (only a top-level @import statement)`);
      }
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

const Z_INDEX = /z-?index/i;

/** The string an expression always evaluates to, when it is built only from literals; otherwise undefined. */
function fold(n: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return n.text;
  if (ts.isParenthesizedExpression(n)) return fold(n.expression);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const [l, r] = [fold(n.left), fold(n.right)];
    return l === undefined || r === undefined ? undefined : l + r;
  }
  if (ts.isTemplateExpression(n)) {
    let out = n.head.text;
    for (const span of n.templateSpans) {
      const v = fold(span.expression);
      if (v === undefined) return undefined;
      out += v + span.literal.text;
    }
    return out;
  }
  return undefined;
}

const isStyle = (n: ts.Expression) => (ts.isIdentifier(n) && n.text === "style") || (ts.isPropertyAccessExpression(n) && n.name.text === "style");

/**
 * Where a TS or TSX source may set a z-index inline. Fails closed
 * (D277-FIX-2): a file that does not parse; any identifier, property key,
 * string or template text matching `z-index` or `zIndex` (any case); any
 * string built from literals (`"z-" + "index"`, `` `z-${"index"}` ``) that
 * does; any `setProperty(` whose name is not a plain string literal; and
 * any `style[…]` whose key is not a literal.
 */
export function inlineZIndex(source: string, file: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (!Array.isArray(diagnostics)) throw new Error("typescript no longer exposes parseDiagnostics; the guard cannot tell a file parsed");
  for (const d of diagnostics) hits.push(`${file}: does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const visit = (n: ts.Node) => {
    if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && Z_INDEX.test(n.text)) hits.push(`${at(n)} ${n.text}`);
    if ((ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) && Z_INDEX.test(n.text)) hits.push(`${at(n)} "${n.text}"`);
    if ((ts.isBinaryExpression(n) || ts.isTemplateExpression(n)) && Z_INDEX.test(fold(n) ?? "")) hits.push(`${at(n)} builds "${fold(n)}"`);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "setProperty") {
      const name = n.arguments[0];
      if (!name || !(ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) hits.push(`${at(n)} setProperty with a non-literal name`);
    }
    if (ts.isElementAccessExpression(n) && isStyle(n.expression)) {
      const key = n.argumentExpression;
      if (!(ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) || ts.isNumericLiteral(key))) hits.push(`${at(n)} style[…] with a non-literal key`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** Files under src/ sorted by how the guard reads them; any other extension is rejected (D277-FIX-2). */
export interface SourceInventory { ts: string[]; css: string[]; svg: string[]; rejected: string[] }

export function sourceInventory(files: string[]): SourceInventory {
  const inv: SourceInventory = { ts: [], css: [], svg: [], rejected: [] };
  for (const f of files) {
    if (/\.tsx?$/.test(f) && !/\.[mc]tsx?$/.test(f)) inv.ts.push(f);
    else if (f.endsWith(".css")) inv.css.push(f);
    else if (f.endsWith(".svg")) inv.svg.push(f);
    else inv.rejected.push(f);
  }
  return inv;
}

/** An inventory that found nothing to scan is a defect, not a pass. */
export function inventoryDefects(inv: SourceInventory): string[] {
  return [...(inv.ts.length === 0 ? ["no TS or TSX source found"] : []), ...(inv.css.length === 0 ? ["no CSS found"] : [])];
}
