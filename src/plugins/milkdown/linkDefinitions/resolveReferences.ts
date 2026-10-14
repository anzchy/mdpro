/**
 * @module linkDefinitions/resolveReferences
 * Purpose: The WYSIWYG reader half of ADR-0094 (D194). A remark transformer that
 * inlines resolved link and image references and KEEPS every link reference
 * definition in place, stamped with its exact source text (`raw`).
 *
 * Pipeline: replaces preset-commonmark's `remarkInlineLinkPlugin` (a wrapper of
 * `remark-inline-links`, which splices every `definition` out of the tree) at the same
 * place in the plugin order (`src/plugins/milkdown/commonmarkPreset.ts`). Milkdown's
 * parser calls `remark.runSync(remark.parse(md), md)`, so the source arrives as
 * `file.value`, the same route `emptyParagraph/blankLineGaps.ts` reads. The kept
 * definition is a positioned sibling, so the ADR-0091 gap reader counts blank lines
 * next to it; `linkDefinitionNode.ts` turns it into a `link_definition` block.
 *
 * Key decisions:
 *   - A NEW `$remark` id, so nothing that keys on the preset's id runs by accident.
 *   - Resolution is remark-inline-links': match by the mdast `identifier` (already
 *     normalized; compared upper-cased as mdast-util-definitions does), the FIRST
 *     definition wins, a resolved `linkReference` becomes `link {url,title,children}`
 *     and an `imageReference` becomes `image {url,title,alt}`. Unresolved references
 *     stay as they are (written escaped, ADR-0094 Consequences).
 *   - `raw` is the source slice at the definition's offsets, with the container
 *     prefixes (`>` of a quote, the item indent of a list item) stripped from its
 *     continuation lines, since the writer adds them back.
 *
 * @coordinates-with src/plugins/milkdown/linkDefinitions/linkDefinitionNode.ts — the node
 * @coordinates-with src/plugins/milkdown/commonmarkPreset.ts — swaps this into the preset
 */
import { $remark } from "@milkdown/kit/utils";

/** The mdast shape this transformer touches; positions are unist offsets. */
export interface MdNode {
  type: string;
  identifier?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  raw?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** A container prefix to strip from a definition's continuation lines. */
type Prefix = { kind: "quote" } | { kind: "indent"; width: number };

const LINE_BREAK = /\r\n|\r|\n/;
const QUOTE_PREFIX = /^[ \t]{0,3}>[ ]?/;

const keyOf = (identifier: string | undefined): string => String(identifier ?? "").toUpperCase();

function offsets(node: MdNode): { start: number; end: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? { start, end } : null;
}

/** Every definition by identifier; the first one in document order wins. */
export function collectDefinitions(tree: MdNode): Map<string, MdNode> {
  const found = new Map<string, MdNode>();
  const visit = (node: MdNode): void => {
    if (node.type === "definition") {
      const key = keyOf(node.identifier);
      if (!found.has(key)) found.set(key, node);
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

/** The inline node a resolved reference becomes, or null when it does not resolve. */
function resolve(node: MdNode, defs: Map<string, MdNode>): MdNode | null {
  if (node.type !== "linkReference" && node.type !== "imageReference") return null;
  const def = defs.get(keyOf(node.identifier));
  if (!def) return null;
  if (node.type === "imageReference") {
    return { type: "image", url: def.url, title: def.title, alt: node.alt };
  }
  return { type: "link", url: def.url, title: def.title, children: node.children };
}

/** Remove one container prefix from the start of `line`. */
function stripPrefix(line: string, prefix: Prefix): string {
  if (prefix.kind === "quote") return line.replace(QUOTE_PREFIX, "");
  let cut = 0;
  while (cut < prefix.width && line[cut] === " ") cut += 1;
  return line.slice(cut);
}

/** The definition's source text without the container prefixes of its later lines. */
export function definitionRaw(source: string, node: MdNode, prefixes: Prefix[]): string | null {
  const at = offsets(node);
  if (!at) return null;
  const lines = source.slice(at.start, at.end).split(LINE_BREAK);
  return lines
    .map((line, i) => (i === 0 ? line : prefixes.reduce((rest, prefix) => stripPrefix(rest, prefix), line)))
    .join("\n");
}

/** The width of a list item's marker and spacing: its content's indent. */
function itemIndent(item: MdNode): number {
  const at = offsets(item);
  const first = item.children?.[0] ? offsets(item.children[0]) : null;
  return at && first && first.start > at.start ? first.start - at.start : 0;
}

function walk(node: MdNode, defs: Map<string, MdNode>, source: string | null, prefixes: Prefix[]): void {
  const kids = node.children;
  if (!kids) return;
  let inner = prefixes;
  if (node.type === "blockquote") inner = [...prefixes, { kind: "quote" }];
  if (node.type === "listItem") inner = [...prefixes, { kind: "indent", width: itemIndent(node) }];
  for (let i = 0; i < kids.length; i += 1) {
    const replaced = resolve(kids[i], defs);
    if (replaced) kids[i] = replaced;
    const child = kids[i];
    if (child.type === "definition" && source !== null) {
      const raw = definitionRaw(source, child, inner);
      if (raw !== null) child.raw = raw;
    }
    walk(child, defs, source, inner);
  }
}

/** Run the transformer on an mdast tree parsed from `source` (null: no `raw` stamps). */
export function resolveReferencesKeepDefinitions(tree: MdNode, source: string | null): void {
  walk(tree, collectDefinitions(tree), source, []);
}

/** The `$remark` plugin, under its own id (see Key decisions). */
export const remarkKeepDefinitionsPlugin = $remark(
  "mdpro-keep-link-definitions",
  () => () => (tree: unknown, file: { value?: unknown } | undefined) => {
    const value = file?.value;
    const source =
      typeof value === "string" ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : null;
    resolveReferencesKeepDefinitions(tree as MdNode, source);
  },
);
