/**
 * Purpose: test-only schemas, builders, edits and bounded domains for the D37 WI-2
 * caret-anchor tests (`tests/caret-anchor.test.ts`, `tests/caret-anchor-law.test.ts`).
 *
 * Why this file is NOT a `*.test.ts`: `vitest.config.ts` collects
 * `tests/**\/*.test.{ts,tsx}`; importing one test file from another re-registers its
 * suites.
 *
 * Key decisions:
 * - `schemaA` and `schemaB` are two `new Schema(SPEC)` from ONE spec. That is the
 *   hazard under test: the live and rebuilt Milkdown editors hold separate schema
 *   instances, and `findDiffStart` compares node types by identity (`sameMarkup`).
 *   Old docs are built in A, new docs in B.
 * - `schemaNarrow` lacks `heading`, so a doc holding a heading cannot be rebuilt in it
 *   (CA-11's genuine `nodeFromJSON` RangeError; no mocks).
 * - `blockquote` is the non-textblock container CA-17 needs; `horizontal_rule` is the
 *   atom block CA-16 needs.
 * - Every edit is a real `Node.replace`, so the oracle is computed from the edit, never
 *   from the implementation.
 */
import { Fragment, Schema, Slice, type Node, type SchemaSpec } from "@milkdown/kit/prose/model";
import { createLcg } from "./headingCorpus";

const SPEC: SchemaSpec = {
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: { group: "block", content: "text*" },
    horizontal_rule: { group: "block" },
    blockquote: { group: "block", content: "block+" },
    text: {},
  },
};

export const schemaA = new Schema(SPEC);
export const schemaB = new Schema(SPEC);
export const schemaNarrow = new Schema({
  nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "text*" }, text: {} },
});

/** A block: a string is a paragraph; the objects are the other node kinds. */
export type Block = string | { hr: true } | { h: string } | { bq: Block[] };

function textContent(schema: Schema, text: string): Node[] {
  return text ? [schema.text(text)] : [];
}

export function block(schema: Schema, b: Block): Node {
  if (typeof b === "string") return schema.node("paragraph", null, textContent(schema, b));
  if ("hr" in b) return schema.node("horizontal_rule");
  if ("h" in b) return schema.node("heading", null, textContent(schema, b.h));
  return schema.node("blockquote", null, b.bq.map((c) => block(schema, c)));
}

export function docOf(schema: Schema, blocks: Block[]): Node {
  return schema.node("doc", null, blocks.map((b) => block(schema, b)));
}

/** Rebuild `node` in `schema` — used only to state diff preconditions in the tests. */
export function rebuildIn(schema: Schema, node: Node): Node {
  return schema.nodeFromJSON(node.toJSON());
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export type EditKind = "inline" | "block" | "delete" | "rewrite";

/** `at` is the insert position (inline) or block boundary (block); `to` ends a delete. */
export interface Edit {
  kind: EditKind;
  at: number;
  text: string;
  to?: number;
}

/** Apply `e` to `doc` in doc's own schema; `null` when the edit is not legal there. */
export function applyEdit(doc: Node, e: Edit): Node | null {
  const schema = doc.type.schema;
  try {
    switch (e.kind) {
      case "inline":
        if (!doc.resolve(e.at).parent.isTextblock) return null;
        return doc.replace(e.at, e.at, new Slice(Fragment.from(schema.text(e.text)), 0, 0));
      case "block": {
        const para = schema.node("paragraph", null, textContent(schema, e.text));
        return doc.replace(e.at, e.at, new Slice(Fragment.from(para), 0, 0));
      }
      case "delete":
        return doc.replace(e.at, e.to ?? e.at, Slice.empty);
      case "rewrite":
        return schema.node("doc", null, [schema.node("paragraph")]);
    }
  } catch {
    return null;
  }
}

/** The doc after typing `c` at `pos`; `null` if `pos` is not inside a textblock. */
export function typeAt(doc: Node, pos: number, c = "Z"): Node | null {
  if (pos < 0 || pos > doc.content.size) return null;
  if (!doc.resolve(pos).parent.isTextblock) return null;
  return doc.replace(pos, pos, new Slice(Fragment.from(doc.type.schema.text(c)), 0, 0));
}

/** Every position whose parent is a textblock (the legal caret positions). */
export function textblockHeads(doc: Node): number[] {
  const out: number[] = [];
  for (let h = 0; h <= doc.content.size; h++) {
    if (doc.resolve(h).parent.isTextblock) out.push(h);
  }
  return out;
}

/** The top-level block boundaries, `0` through `content.size`. */
export function blockBoundaries(doc: Node): number[] {
  const out = [0];
  let q = 0;
  doc.forEach((child) => {
    q += child.nodeSize;
    out.push(q);
  });
  return out;
}

/** P1's edits: inline `X`/`XY` at every textblock position, `P(X)`/`P(XY)` at every boundary. */
export function p1Edits(doc: Node): Edit[] {
  const out: Edit[] = [];
  for (const at of textblockHeads(doc)) for (const text of ["X", "XY"]) out.push({ kind: "inline", at, text });
  for (const at of blockBoundaries(doc)) for (const text of ["X", "XY"]) out.push({ kind: "block", at, text });
  return out;
}

/** The inline texts P2 inserts: every string of length 1–2 over the old alphabet. */
export const P2_INLINE_TEXTS = ["a", "b", "ab", "ba", "aa", "bb"] as const;

/** P2's edits, mirroring the brute-force checker: old-alphabet inline texts, block `P(ab)`. */
export function p2Edits(doc: Node): Edit[] {
  const out: Edit[] = [];
  for (const at of textblockHeads(doc)) for (const text of P2_INLINE_TEXTS) out.push({ kind: "inline", at, text });
  for (const at of blockBoundaries(doc)) out.push({ kind: "block", at, text: "ab" });
  return out;
}

/** Deletions: 1 and 2 chars inside one textblock, and a whole paragraph when ≥2 remain. */
export function deletionEdits(doc: Node): Edit[] {
  const out: Edit[] = [];
  const bounds = blockBoundaries(doc);
  doc.forEach((child, offset, index) => {
    const contentStart = offset + 1;
    const contentEnd = offset + child.nodeSize - 1;
    for (let from = contentStart; from < contentEnd; from++) {
      for (const len of [1, 2]) {
        if (from + len <= contentEnd) out.push({ kind: "delete", at: from, to: from + len, text: "" });
      }
    }
    if (doc.childCount > 1) out.push({ kind: "delete", at: bounds[index], to: bounds[index + 1], text: "" });
  });
  return out;
}

export const REWRITE_TO_EMPTY: Edit = { kind: "rewrite", at: 0, text: "" };

// ---------------------------------------------------------------------------
// Bounded domains
// ---------------------------------------------------------------------------

/** Every string over {a,b} of length 0–3 (15 strings). */
export function abStrings(maxLen = 3): string[] {
  const out = [""];
  let layer = [""];
  for (let len = 1; len <= maxLen; len++) {
    layer = layer.flatMap((s) => [s + "a", s + "b"]);
    out.push(...layer);
  }
  return out;
}

/** The exhaustive doc domain: 1–2 paragraphs over {a,b}, each of length 0–3 (240 docs). */
export function smallDocTexts(): string[][] {
  const strs = abStrings();
  const out: string[][] = [];
  for (const x of strs) {
    out.push([x]);
    for (const y of strs) out.push([x, y]);
  }
  return out;
}

export const LCG_SAMPLES = 500;
export const LCG_SEED = 0xd37ca;

export interface Sample {
  texts: string[];
  pick: (edits: Edit[]) => Edit;
}

/**
 * `count` seeded samples: a 3-paragraph doc over {a,b} (each 0–3 chars) and a picker
 * that chooses ONE edit from the caller's edit list with the same generator, so a
 * (doc, edit) pair is reproducible from the seed alone.
 */
export function lcgSamples(seed = LCG_SEED, count = LCG_SAMPLES): Sample[] {
  const next = createLcg(seed);
  const out: Sample[] = [];
  for (let i = 0; i < count; i++) {
    const texts: string[] = [];
    for (let p = 0; p < 3; p++) {
      const len = next() % 4;
      let s = "";
      for (let k = 0; k < len; k++) s += next() % 2 === 0 ? "a" : "b";
      texts.push(s);
    }
    const r = next();
    out.push({ texts, pick: (edits) => edits[r % edits.length] });
  }
  return out;
}

/** Failures collected across a property run; the first 10 are reported. */
export const MAX_REPORTED_FAILURES = 10;
