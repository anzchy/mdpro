// @vitest-environment node
/**
 * D37 WI-2 — `anchorCaretAcrossReplace` laws P1..P4 over a bounded domain.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit:
 * src/utils/caretAnchor.ts#anchorCaretAcrossReplace" (P1..P4) as amended by
 * §"Adversary round 1 — resolutions" (P2's equivalence: ANY insert of the same kind —
 * inline or block — that turns old into new, mirroring the brute-force checker p2.mjs).
 *
 * Domain: exhaustive 1–2 paragraphs over {a,b} of length 0–3 (240 docs), plus
 * `LCG_SAMPLES` seeded 3-paragraph (doc, edit) samples from `createLcg`; the seed is in
 * every failure message. Oracles are computed from the edit, never from the function.
 * Failures are collected and the first `MAX_REPORTED_FAILURES` reported.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "@milkdown/kit/prose/model";
import { anchorCaretAcrossReplace, CARET_ANCHOR_MAX_DOC_SIZE } from "../src/utils/caretAnchor";
import {
  applyEdit,
  deletionEdits,
  docOf,
  lcgSamples,
  LCG_SEED,
  MAX_REPORTED_FAILURES,
  p1Edits,
  p2Edits,
  REWRITE_TO_EMPTY,
  schemaA,
  schemaB,
  schemaNarrow,
  smallDocTexts,
  textblockHeads,
  typeAt,
  type Edit,
} from "./helpers/caretAnchorSchemas";

const SLOW = { timeout: 60_000 };
const DOCS = smallDocTexts();

interface Failure {
  texts: string[];
  edit: Edit;
  h: number;
  got: number;
  want?: number;
  detail?: string;
}

/** Old in schemaA, new = the edit applied to the same texts built in schemaB. */
function pairOf(texts: string[], e: Edit): { oldDoc: Node; newDoc: Node } | null {
  const newDoc = applyEdit(docOf(schemaB, texts), e);
  return newDoc ? { oldDoc: docOf(schemaA, texts), newDoc } : null;
}

function expectNoFailures(label: string, failures: Failure[], seed?: number): void {
  const where = seed === undefined ? "exhaustive" : `LCG seed=0x${seed.toString(16)}`;
  expect(failures.slice(0, MAX_REPORTED_FAILURES), `${label} (${where}): ${failures.length} failing tuples`).toEqual([]);
}

type EditFilter = (e: Edit, oldDoc: Node) => boolean;
const ANY: EditFilter = () => true;
const AT_DOC_START: EditFilter = (e) => (e.kind === "inline" && e.at === 1) || (e.kind === "block" && e.at === 0);
const AT_DOC_END: EditFilter = (e, d) =>
  (e.kind === "inline" && e.at === d.content.size - 1) || (e.kind === "block" && e.at === d.content.size);

/** Run `check` over the exhaustive domain, or over the LCG samples when `seed` is given. */
function forDomain(
  edits: (d: Node) => Edit[],
  filter: EditFilter,
  check: (texts: string[], e: Edit, out: Failure[]) => void,
  seed?: number,
): Failure[] {
  const out: Failure[] = [];
  if (seed === undefined) {
    for (const texts of DOCS) {
      const d = docOf(schemaA, texts);
      for (const e of edits(d).filter((x) => filter(x, d))) check(texts, e, out);
    }
    return out;
  }
  for (const s of lcgSamples(seed)) {
    const d = docOf(schemaA, s.texts);
    const pool = edits(d).filter((x) => filter(x, d));
    if (pool.length > 0) check(s.texts, s.pick(pool), out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// P1 — strict "outside" law with an exact oracle
// ---------------------------------------------------------------------------

function p1Check(texts: string[], e: Edit, out: Failure[]): void {
  const pair = pairOf(texts, e);
  if (!pair) return;
  const { oldDoc, newDoc } = pair;
  const len = newDoc.content.size - oldDoc.content.size;
  for (const h of textblockHeads(oldDoc)) {
    // Inline at o: h<o → h, h>o → h+L, h==o → h (tie left). Block at q: h<q → h, h>q → h+N.
    const want = h <= e.at ? h : h + len;
    const got = anchorCaretAcrossReplace(oldDoc, newDoc, h).pos;
    const strictlyInside = got > e.at && got < e.at + len;
    if (got !== want || strictlyInside) out.push({ texts, edit: e, h, got, want });
  }
}

describe("P1 — the caret maps to the exact equivalent position, never inside the insert", () => {
  describe("insert at doc start (o = 1)", () => {
    it("exhaustive", SLOW, () => {
      expectNoFailures("P1 start", forDomain(p1Edits, AT_DOC_START, p1Check));
    });
    it("LCG samples", SLOW, () => {
      expectNoFailures("P1 start", forDomain(p1Edits, AT_DOC_START, p1Check, LCG_SEED), LCG_SEED);
    });
  });

  describe("insert at doc end (o = last textblock end)", () => {
    it("exhaustive", SLOW, () => {
      expectNoFailures("P1 end", forDomain(p1Edits, AT_DOC_END, p1Check));
    });
    it("LCG samples", SLOW, () => {
      expectNoFailures("P1 end", forDomain(p1Edits, AT_DOC_END, p1Check, LCG_SEED), LCG_SEED);
    });
  });

  it("every insert position (exhaustive)", SLOW, () => {
    expectNoFailures("P1", forDomain(p1Edits, ANY, p1Check));
  });

  it("every insert position (LCG samples, 3-paragraph docs)", SLOW, () => {
    expectNoFailures("P1", forDomain(p1Edits, ANY, p1Check, LCG_SEED), LCG_SEED);
  });
});

// ---------------------------------------------------------------------------
// P2 — typing at the mapped caret commutes with SOME equivalent insert
// ---------------------------------------------------------------------------

function p2Check(texts: string[], e: Edit, out: Failure[]): void {
  const pair = pairOf(texts, e);
  if (!pair) return;
  const { oldDoc, newDoc } = pair;
  const len = newDoc.content.size - oldDoc.content.size;
  const oldB = docOf(schemaB, texts);
  // O′: every insert of the same kind (any P2 text) that turns old into new.
  const equivalents = p2Edits(oldB)
    .filter((e2) => e2.kind === e.kind)
    .map((e2) => ({ e2, doc: applyEdit(oldB, e2) }))
    .filter((x): x is { e2: Edit; doc: Node } => x.doc !== null && x.doc.eq(newDoc));
  for (const h of textblockHeads(oldDoc)) {
    const got = anchorCaretAcrossReplace(oldDoc, newDoc, h).pos;
    const actual = typeAt(newDoc, got);
    const candidates: Node[] = [];
    for (const { e2, doc } of equivalents) {
      const heads = h < e2.at ? [h] : h > e2.at ? [h + len] : [h, h + len];
      for (const hp of heads) {
        const c = typeAt(doc, hp);
        if (c) candidates.push(c);
      }
    }
    if (!actual || !candidates.some((c) => c.eq(actual))) out.push({ texts, edit: e, h, got });
  }
}

describe("P2 — typing at the mapped caret commutes with an equivalent insert", () => {
  it("named example: a|b with 'ab' inserted at text offset 0", () => {
    const out: Failure[] = [];
    p2Check(["ab"], { kind: "inline", at: 1, text: "ab" }, out);
    expectNoFailures("P2 a|b + ab", out);
  });

  it("exhaustive", SLOW, () => {
    expectNoFailures("P2", forDomain(p2Edits, ANY, p2Check));
  });

  it("LCG samples, 3-paragraph docs", SLOW, () => {
    expectNoFailures("P2", forDomain(p2Edits, ANY, p2Check, LCG_SEED), LCG_SEED);
  });
});

// ---------------------------------------------------------------------------
// P3 — totality; P4 — monotonicity
// ---------------------------------------------------------------------------

const ANCHORS = new Set(["diff", "unchanged", "fallback-json", "fallback-size"]);

function totalityFailures(oldDoc: Node, newDoc: Node, heads: number[]): string[] {
  const bad: string[] = [];
  for (const h of heads) {
    const r = anchorCaretAcrossReplace(oldDoc, newDoc, h);
    const ok = Number.isInteger(r.pos) && r.pos >= 0 && r.pos <= newDoc.content.size && ANCHORS.has(r.anchor);
    if (!ok) bad.push(JSON.stringify({ old: oldDoc.toJSON(), h, r }));
  }
  return bad;
}

const IDENTITY: Edit = { kind: "rewrite", at: -1, text: "identity" };
const p3Edits = (d: Node): Edit[] => [...p1Edits(d), ...deletionEdits(d), REWRITE_TO_EMPTY, IDENTITY];

function p3Check(texts: string[], e: Edit, out: Failure[]): void {
  const pair = e === IDENTITY ? { oldDoc: docOf(schemaA, texts), newDoc: docOf(schemaB, texts) } : pairOf(texts, e);
  if (!pair) return;
  const size = pair.oldDoc.content.size;
  const heads = Array.from({ length: size + 4 }, (_, i) => i - 1); // [−1, oldSize + 2]
  const bad = totalityFailures(pair.oldDoc, pair.newDoc, heads);
  if (bad.length > 0) out.push({ texts, edit: e, h: -2, got: -2, detail: bad[0] });
}

describe("P3 — totality: every result is an integer in [0, newSize] with a known anchor", () => {
  it("inline, block, deletion, rewrite and identity edits (exhaustive)", SLOW, () => {
    expectNoFailures("P3", forDomain(p3Edits, ANY, p3Check));
  });

  it("the fallback-json pair (CA-11)", () => {
    const oldDoc = docOf(schemaA, [{ h: "T" }, "ab"]);
    const newDoc = docOf(schemaNarrow, ["ab"]);
    expect(totalityFailures(oldDoc, newDoc, [-1, 0, 3, 5, 9, 11])).toEqual([]);
  });

  it("the fallback-size pair (CA-12, one past the threshold)", { timeout: 30_000 }, () => {
    const M = CARET_ANCHOR_MAX_DOC_SIZE;
    const oldDoc = docOf(schemaA, ["a".repeat(M - 1)]);
    const newDoc = docOf(schemaB, ["a".repeat(M - 1) + "X"]);
    expect(totalityFailures(oldDoc, newDoc, [-1, 0, M, M + 1, M + 3])).toEqual([]);
  });
});

function p4Check(texts: string[], e: Edit, out: Failure[]): void {
  const pair = pairOf(texts, e);
  if (!pair) return;
  let prev = -Infinity;
  for (let h = 0; h <= pair.oldDoc.content.size; h++) {
    const got = anchorCaretAcrossReplace(pair.oldDoc, pair.newDoc, h).pos;
    if (got < prev) out.push({ texts, edit: e, h, got, want: prev });
    prev = Math.max(prev, got);
  }
}

describe("P4 — monotonicity: the mapped position is non-decreasing in head", () => {
  it("inline and block inserts, every head in [0, oldSize] (exhaustive)", SLOW, () => {
    expectNoFailures("P4", forDomain(p1Edits, ANY, p4Check));
  });

  it("inline and block inserts (LCG samples, 3-paragraph docs)", SLOW, () => {
    expectNoFailures("P4", forDomain(p1Edits, ANY, p4Check, LCG_SEED), LCG_SEED);
  });

  // Coordinator decision pending. Under the adversary-round-1 rule (and under the
  // plan's original step 5), deletions and rewrites are NOT monotone, so these are
  // excluded from P4 rather than encoded as a permanent red:
  //   delete  P(abab) → P(ab) (drop "ba"): start 3, a 3, b 1 → h3 ↦ 3 (tie, pre), h4 ↦ 2.
  //   delete  P(ab) P(ba) → P(ba) (drop 1st): start 1, a 4, b 0 → h1 ↦ 1, h4 ↦ 0.
  //   rewrite P() P(ab) → P(): start 2, a 5, b 1 → h3 ↦ 2 (inside), h5 ↦ 1.
  it.todo("P4 over deletion and rewrite edits — needs a new-side (b < start) rule first");
});
