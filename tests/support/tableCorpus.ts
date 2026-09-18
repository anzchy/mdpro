/**
 * @module tests/support/tableCorpus
 * Purpose: Deterministic, dependency-free document corpus for the
 * table-parser property cases (WI-2 `tests/table-line-index.test.ts`,
 * later WI-3 / WI-3B files).
 *
 * Gate G0 forbids a new dependency, so there is no `fast-check` here.
 * `mulberry32(SEED)` is the ONLY entropy source in this file —
 * `Math.random` is never called, which is what makes every property
 * case reproducible and every red receipt meaningful.
 *
 * Eleven generator dimensions, each tagged on the document that carries
 * it so cases can scope assertions by class:
 *
 *   1. prose-only paragraphs
 *   2. valid tables
 *   3. broken-header tables (an ADDED header cell)
 *   4. broken-delimiter tables (joined `---  ---`)
 *   5. fenced blocks containing table-shaped lines
 *   6. blank runs of 1-3
 *   7. CJK + astral-plane cells
 *   8. a pipe at column 60
 *   9. documents with and without a trailing newline
 *  10. CRLF rewrites of a subset
 *  11. a delimiter row that is NOT a candidate line, in both reachable
 *      sub-shapes: pipe-less (`---`, `:-:`) and 4+-space indent
 *      (`    | - | - |`)
 *
 * Dimension 11 exists because no other dimension can produce a
 * delimiter that is not a candidate line, which is the class where a
 * model's line span exceeds its candidate run.
 *
 * WI-C1 / WI-C2 (2026-09-18) narrowed what the DETECTOR does with
 * dimension 11 without changing a byte of what this file GENERATES. The
 * `---` spelling now loses to the setext H2 underline and the indented
 * spelling is rejected on CommonMark columns, so of the three pipe-less
 * literals only `:-:` still yields a table; see
 * `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` §5.1. The
 * documents are unchanged and so is `CORPUS_TOTAL_BYTES`; the expected
 * enumerations over them moved, and live in the suites, not here.
 *
 * Documents are capped well under 60 lines: `LINEIDX-oracle` sweeps
 * every offset of every document, so the corpus must stay small enough
 * that an O(L^2) sweep is sub-second.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

/** The one seed. Changing it changes every property case's domain. */
export const SEED = 0x5eed_1234;

/**
 * mulberry32 — a 32-bit PRNG in ~10 lines. Deterministic for a given
 * seed, adequate for structural sampling (it is not, and does not need
 * to be, cryptographic).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CorpusTags {
  /** dim 1 */ prose: boolean;
  /** dim 2 */ validTable: boolean;
  /** dim 3 */ brokenHeader: boolean;
  /** dim 4 */ brokenDelimiter: boolean;
  /** dim 5 */ fence: boolean;
  /** dim 6 */ blankRun: boolean;
  /** dim 7 */ cjk: boolean;
  /** dim 8 */ pipeAtColumn60: boolean;
  /** dim 9 */ trailingNewline: boolean;
  /** dim 10 */ crlf: boolean;
  /** dim 11 */ hasNonCandidateDelimiter: boolean;
  /** dim 11, sub-shape a */ nonCandidateDelimiterPipeless: boolean;
  /** dim 11, sub-shape b */ nonCandidateDelimiterIndented: boolean;
}

export interface CorpusDoc {
  /** Position in the corpus — printed in property-case failure messages. */
  index: number;
  /** The document text. */
  source: string;
  /** Which of the eleven dimensions this document carries. */
  tags: CorpusTags;
}

type BlockKind =
  | "prose"
  | "validTable"
  | "brokenHeader"
  | "brokenDelimiter"
  | "fence"
  | "blankRun"
  | "cjk"
  | "pipeAtColumn60"
  | "ncdPipeless"
  | "ncdIndented";

/**
 * Every block kind, in a fixed order. Document `i` is guaranteed a
 * block of `BLOCK_KINDS[i % BLOCK_KINDS.length]`, so no dimension can
 * be declared-but-absent no matter how the PRNG falls.
 */
const BLOCK_KINDS: readonly BlockKind[] = [
  "prose",
  "validTable",
  "brokenHeader",
  "brokenDelimiter",
  "fence",
  "blankRun",
  "cjk",
  "pipeAtColumn60",
  "ncdPipeless",
  "ncdIndented",
];

const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "elit"];
const CJK_CELLS = ["汉字", "𝄞 音", "café", "👍🏽", "日本語", "한글"];

/** Soft cap: stop adding blocks once the document reaches this many lines. */
const MAX_LINES = 55;

function makeBlock(kind: BlockKind, rnd: () => number): string[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const count = (lo: number, hi: number): number =>
    lo + Math.floor(rnd() * (hi - lo + 1));

  switch (kind) {
    case "prose": {
      const n = count(1, 3);
      const out: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const w = count(3, 7);
        const words: string[] = [];
        for (let j = 0; j < w; j += 1) words.push(pick(WORDS));
        out.push(words.join(" "));
      }
      return out;
    }
    case "validTable": {
      const cols = count(2, 3);
      const header = row(cols, (c) => `h${c}`);
      const delim = row(cols, () => pick(["---", ":--", "--:", ":-:"]));
      const out = [header, delim];
      const bodyRows = count(1, 5);
      for (let r = 0; r < bodyRows; r += 1) {
        out.push(row(cols, (c) => `r${r}c${c}`));
      }
      return out;
    }
    case "brokenHeader": {
      // One ADDED header cell: header has cols + 1, delimiter has cols.
      const cols = count(2, 3);
      return [
        row(cols + 1, (c) => `h${c}`),
        row(cols, () => "---"),
        row(cols, (c) => `b${c}`),
      ];
    }
    case "brokenDelimiter": {
      // A JOINED delimiter cell (`---  ---`) — accepted by neither the
      // cell regex nor the column count.
      const cols = count(2, 3);
      return [
        row(cols, (c) => `h${c}`),
        `| ${"---  ---"} |`,
        row(cols, (c) => `b${c}`),
      ];
    }
    case "fence": {
      return [
        pick(["```", "~~~", "```markdown"]),
        "| fenced | header |",
        "| ------ | ------ |",
        "| inside | fence  |",
        "```",
      ];
    }
    case "blankRun": {
      const n = count(1, 3);
      return new Array<string>(n).fill("");
    }
    case "cjk": {
      const cols = count(2, 3);
      return [
        row(cols, () => pick(CJK_CELLS)),
        row(cols, () => "---"),
        row(cols, () => pick(CJK_CELLS)),
      ];
    }
    case "pipeAtColumn60": {
      // A line whose character at index 60 is exactly `|`.
      const filler = "lorem ipsum dolor sit amet consectetur elit sed do eiusmod t";
      return [`${filler.slice(0, 60)}| tail ${pick(WORDS)}`];
    }
    case "ncdPipeless": {
      // Pipe-less delimiter: `isDelimiterLine` accepts (edge pipes are
      // optional in GFM) while `isTableCandidateLine` rejects (no pipe).
      // Of the three literals only `:-:` is a delimiter GFM would accept
      // here; `---` and `----` are setext H2 underlines and are rejected
      // by `parse.ts` as of WI-C1.
      const cols = count(2, 3);
      return [
        row(cols, (c) => `h${c}`),
        pick(["---", ":-:", "----"]),
        row(cols, (c) => `b${c}`),
      ];
    }
    case "ncdIndented": {
      // 4+ spaces of indent. It used to be accepted because
      // `isDelimiterLine` trimmed before splitting while
      // `isTableCandidateLine` rejected on MAX_INDENT. WI-C2 moved the
      // indent check ahead of the trim, so both predicates now reject it
      // and this block yields no table at all — the shape is kept because
      // the suites assert that absence.
      const cols = count(2, 3);
      return [
        row(cols, (c) => `h${c}`),
        `    ${row(cols, () => "-")}`,
        row(cols, (c) => `b${c}`),
      ];
    }
  }
}

function row(cols: number, cell: (c: number) => string): string {
  const parts: string[] = [];
  for (let c = 0; c < cols; c += 1) parts.push(cell(c));
  return `| ${parts.join(" | ")} |`;
}

function emptyTags(): CorpusTags {
  return {
    prose: false,
    validTable: false,
    brokenHeader: false,
    brokenDelimiter: false,
    fence: false,
    blankRun: false,
    cjk: false,
    pipeAtColumn60: false,
    trailingNewline: false,
    crlf: false,
    hasNonCandidateDelimiter: false,
    nonCandidateDelimiterPipeless: false,
    nonCandidateDelimiterIndented: false,
  };
}

function tagBlock(tags: CorpusTags, kind: BlockKind): void {
  if (kind === "ncdPipeless") {
    tags.hasNonCandidateDelimiter = true;
    tags.nonCandidateDelimiterPipeless = true;
    return;
  }
  if (kind === "ncdIndented") {
    tags.hasNonCandidateDelimiter = true;
    tags.nonCandidateDelimiterIndented = true;
    return;
  }
  tags[kind] = true;
}

/**
 * Build `count` tagged documents from `seed`. Pure: same arguments in,
 * deep-equal (but distinct) documents out, every time, in any process.
 */
export function makeCorpus(seed: number, count: number): CorpusDoc[] {
  const rnd = mulberry32(seed);
  const docs: CorpusDoc[] = [];

  for (let i = 0; i < count; i += 1) {
    const tags = emptyTags();
    const lines: string[] = [];

    const guaranteed = BLOCK_KINDS[i % BLOCK_KINDS.length];
    const extras = 3 + Math.floor(rnd() * 5); // 3-7 extra blocks
    const kinds: BlockKind[] = [guaranteed];
    for (let k = 0; k < extras; k += 1) {
      kinds.push(BLOCK_KINDS[Math.floor(rnd() * BLOCK_KINDS.length)]);
    }

    for (const kind of kinds) {
      const block = makeBlock(kind, rnd);
      if (lines.length + block.length > MAX_LINES) continue;
      lines.push(...block);
      tagBlock(tags, kind);
    }

    const withTrailing = rnd() < 0.8;
    tags.trailingNewline = withTrailing;
    let source = lines.join("\n") + (withTrailing ? "\n" : "");

    if (rnd() < 0.25) {
      source = source.replace(/\n/g, "\r\n");
      tags.crlf = true;
    }

    docs.push({ index: i, source, tags });
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Second generator — the OVERLAP corpus (WI-3C)
//
// `makeCorpus` above is frozen. `CORPUS_TOTAL_BYTES = 64_568` in
// `tests/table-line-index.test.ts` is a fingerprint of its exact
// `mulberry32` stream, so adding a branch or a `BlockKind` inside it
// would silently re-domain every property case in that suite (ADR-0008,
// "the seeded corpus still cannot generate the overlap shape").
//
// So the overlap shape gets its OWN generator, its OWN seed, its OWN
// `mulberry32` instance and its OWN byte total. Nothing below is reached
// by `makeCorpus`; the two streams never touch.
//
// The shape `makeCorpus` provably cannot reach is a CHAIN: a table whose
// delimiter row is not a candidate line, followed by another body row and
// another non-candidate delimiter, so the same body row is a body row of
// table N and the header of table N+1. The canonical measured member is
// ADR-0007's F3 —
//   "| a | b |\n    | - | - |\n| 1 | 2 |\n    | - | - |\n| 3 | 4 |\n"
// — legacy `[[0, 33], [24, 57]]`, WI-3 scanner `[[0, 33]]` as measured on
// 2026-09-17. `makeCorpus` emits each non-candidate-delimiter block in
// isolation, so its 138 dimension-11 documents carry the PREDICATE but
// never the chain, which is exactly what left ADR-0007's tier 2 vacuous.
//
// WI-C2 then took F3 away entirely: its `    | - | - |` rows are 4 indent
// columns, so the live scanner now emits `[]` there while the frozen copy
// still emits both overlapping models. The live overlap the tier-2 rule is
// exercised on today is the `:-:` chain, which is valid GFM. F3 is still
// pinned in `tests/table-scan-overlap-corpus.test.ts` at BOTH its old
// legacy value and its new live value. Nothing in this file changed.
// ---------------------------------------------------------------------------

/** The overlap corpus's one seed. Independent of `SEED`. */
export const OVERLAP_SEED = 0xbeef_5eed;

/** The overlap corpus's one size. */
export const OVERLAP_CORPUS_COUNT = 200;

/**
 * Total byte length of `makeOverlapCorpus(OVERLAP_SEED, OVERLAP_CORPUS_COUNT)`,
 * measured 2026-09-17. The same contract `CORPUS_TOTAL_BYTES` carries for
 * `makeCorpus`: update it DELIBERATELY when this generator changes, because
 * a silent change re-domains every case asserted against it.
 *
 * It fingerprints a DIFFERENT `mulberry32` stream from `CORPUS_TOTAL_BYTES`.
 * Changing either generator must leave the other's total untouched; both
 * are asserted, so a stream that leaked across would fail loudly.
 */
export const OVERLAP_CORPUS_TOTAL_BYTES = 29_563;

/**
 * The two reachable sub-shapes of a delimiter row that `isDelimiterLine`
 * accepts and `isTableCandidateLine` rejects.
 *
 * - `pipeless` — no unescaped `|` at all, so the header it serves must be
 *   single-column (a multi-column pipe-less delimiter such as `--- | ---`
 *   contains pipes and IS a candidate line).
 * - `indented` — 4+ leading spaces. It USED to slip through because
 *   `isDelimiterLine` trimmed before splitting while
 *   `isTableCandidateLine` rejected on `MAX_INDENT`; WI-C2 moved the
 *   indent check ahead of the trim, so both now reject it.
 *
 * ADR-0008 measured the three `PIPELESS_DELIMITERS` literals against
 * `micromark-extension-gfm-table@2.1.2`, and they do NOT all behave
 * alike: `---` and `----` are setext H2 underlines and yield zero GFM
 * tables, but `:-:` is a real delimiter row and yields one. The earlier
 * blanket claim here that neither shape is valid GFM was wrong about
 * `:-:`, and WI-C1 / WI-C2 make the difference observable — after them
 * `:-:` is the only spelling in this corpus that still produces a table.
 */
export type OverlapDelimiterShape = "pipeless" | "indented";

const PIPELESS_DELIMITERS = ["---", ":-:", "----"] as const;

export interface OverlapCorpusDoc {
  /** Position in the overlap corpus — printed in failure messages. */
  index: number;
  /** The document text. */
  source: string;
  /** Which non-candidate delimiter sub-shape every chain here uses. */
  shape: OverlapDelimiterShape;
  /** How many overlap chains the document contains. */
  chains: number;
  /** Non-candidate delimiter rows per chain, in order. */
  delimitersPerChain: readonly number[];
  /** Whether the document ends with a newline. */
  trailingNewline: boolean;
  /** Whether the document was rewritten in CRLF. */
  crlf: boolean;
}

/**
 * One overlap chain: `header`, then `delimiters` repetitions of
 * (non-candidate delimiter, body row). Every row carries the same column
 * count, so each body row is a well-formed header for the delimiter that
 * follows it — which is what makes the legacy re-entry build a second,
 * overlapping model instead of failing the column-count check.
 */
function overlapChain(
  shape: OverlapDelimiterShape,
  delimiters: number,
  chainIdx: number,
  rnd: () => number,
): string[] {
  const cols = shape === "pipeless" ? 1 : 2 + Math.floor(rnd() * 2);
  const delimiterRow = (): string =>
    shape === "pipeless"
      ? PIPELESS_DELIMITERS[Math.floor(rnd() * PIPELESS_DELIMITERS.length)]
      : `    ${row(cols, () => "-")}`;

  const out: string[] = [row(cols, (c) => `c${chainIdx}h${c}`)];
  for (let d = 0; d < delimiters; d += 1) {
    out.push(delimiterRow());
    out.push(row(cols, (c) => `c${chainIdx}r${d}${c}`));
  }
  return out;
}

/**
 * Build `count` overlap-chain documents from `seed`. Pure, in the same
 * sense `makeCorpus` is: same arguments in, deep-equal (but distinct)
 * documents out, in any process.
 *
 * Both sub-shapes are guaranteed present — document `i` uses
 * `i % 2 === 0 ? "pipeless" : "indented"` — so neither can be
 * declared-but-absent no matter how the PRNG falls.
 */
export function makeOverlapCorpus(seed: number, count: number): OverlapCorpusDoc[] {
  const rnd = mulberry32(seed);
  const docs: OverlapCorpusDoc[] = [];

  for (let i = 0; i < count; i += 1) {
    const shape: OverlapDelimiterShape = i % 2 === 0 ? "pipeless" : "indented";
    const chains = 1 + Math.floor(rnd() * 2);
    const delimitersPerChain: number[] = [];
    const lines: string[] = [];

    for (let c = 0; c < chains; c += 1) {
      if (c > 0) {
        // A blank/prose/blank separator: it ends the previous candidate
        // run outright, so each chain's overlap stands on its own.
        lines.push("", `${WORDS[Math.floor(rnd() * WORDS.length)]} separator`, "");
      }
      const delimiters = 2 + Math.floor(rnd() * 3); // 2-4
      delimitersPerChain.push(delimiters);
      lines.push(...overlapChain(shape, delimiters, c, rnd));
    }

    const trailingNewline = rnd() < 0.8;
    let source = lines.join("\n") + (trailingNewline ? "\n" : "");

    const crlf = rnd() < 0.25;
    if (crlf) source = source.replace(/\n/g, "\r\n");

    docs.push({
      index: i,
      source,
      shape,
      chains,
      delimitersPerChain,
      trailingNewline,
      crlf,
    });
  }

  return docs;
}
