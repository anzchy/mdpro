/**
 * Purpose: the seeded *document* generator behind the WI-1 position-law harness
 * (`tests/toc-position-laws.test.ts`). Where `headingCorpus.ts` generates heading
 * *texts*, this file generates whole Markdown *documents* whose heading count is
 * known independently of any parser.
 *
 * Why this file is NOT a `*.test.ts`: `vitest.config.ts:11` collects
 * `tests/**\/*.test.{ts,tsx}` only. A helper here is typechecked by
 * `tsconfig.test.json` (`include: ["src", "tests"]`) but never registered as a
 * suite — the same arrangement, and the same reason, as `headingCorpus.ts`.
 *
 * G0 compliance: **no `fast-check`, no new dependency.** The PRNG is
 * `createLcg` from `headingCorpus.ts`, reused rather than re-rolled so both
 * corpora stay reproducible from one seed constant.
 *
 * THE LOAD-BEARING PROPERTY: `expectedHeadingCount` is computed from the block
 * template the generator *selected*, never by calling `parseHeadingsFromContent`.
 * An oracle derived from the unit under test would make every law in the harness
 * vacuous — `return []` satisfies all of P1-P5. Case L0 is what kills `return []`,
 * and it can only do that because this count is independent.
 */
import { DEFAULT_SEED, createLcg } from "./headingCorpus";

export interface LawDocument {
  /** Stable identifier printed by every property failure. */
  name: string;
  /** The document in LF form. CRLF variants are derived with `toCRLF`. */
  markdown: string;
  /**
   * The number of headings the document contains, derived from the block
   * templates that built it — NOT from `parseHeadingsFromContent`.
   */
  expectedHeadingCount: number;
}

/**
 * Line-ending metamorphic transform (P3). Idempotent: `\r\n` is collapsed to `\n`
 * first so an already-CRLF input is not doubled. A **lone `\r` is left lone** —
 * that is deliberate, and it is what keeps the `lone-cr*` documents meaningful
 * on both sides of the relation.
 */
export function toCRLF(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

/**
 * The frontmatter block prefixed by the P5/L6 metamorphic law. Four `\n`, so the
 * expected line shift is exactly 4 and the expected offset shift is
 * `FRONTMATTER_BLOCK.length` (or `toCRLF(FRONTMATTER_BLOCK).length` on the CRLF
 * side, which is not the same number — 26 rather than 22).
 */
export const FRONTMATTER_BLOCK = "---\ntitle: T\nn: 3\n---\n";

/**
 * Token alphabet: CJK, astral-plane, combining-hazard and collision-prone
 * (`Title` and `x` recur, so the allocator's suffixing is exercised by L5).
 *
 * No token contains `#`, `|`, `=`, `-` or a backtick, and none is empty or
 * whitespace-only. That is what keeps the per-template heading counts below
 * sound no matter which token is substituted: a token carrying `=` or `-` could
 * turn its own line into a setext underline, and one carrying `#` could open an
 * ATX heading inside a template that declares zero.
 */
export const LAW_TOKEN_ALPHABET: readonly string[] = [
  "Alpha",
  "Beta",
  "架构",
  "第1章 架构",
  "Title",
  "x",
  "🎉 tail",
  "Ünïcödé",
  "𝔘𝔫𝔦",
];

interface BlockTemplate {
  /** Build the block body. No trailing newline — the joiner supplies it. */
  build(token: string): string;
  /** Headings this block contributes. The independent oracle, per template. */
  headings: number;
}

const BACKTICKS = "```";

/**
 * The block templates and their known heading counts.
 *
 * THREE GENERATOR CONSTRAINTS ARE LOAD-BEARING, NOT STYLE. Each is recorded
 * here with the reason it exists, because each one, if relaxed, silently
 * falsifies `expectedHeadingCount` rather than failing loudly:
 *
 * 1. **No block may begin with a leading space.** Indented ATX (`   # t`,
 *    `    # t`) is deliberately excluded from the generator. After a `- # t`
 *    block, a 4-space-indented line sits 2 columns past the list item's content
 *    column, so it is a heading *inside the list item*, not an indented code
 *    block — the count would depend on the preceding block, and indentation has
 *    no unambiguous block-local count. The indented shapes are covered by hand
 *    in case B8 instead.
 *
 * 2. **Blocks are separated by a blank line** (see `joinBlocks`). Without it, a
 *    `${t} paragraph` block followed by a `${t}\n-----` block changes which line
 *    the underline attaches to. It is also what keeps the `#${t}` and
 *    `####### ${t}` templates honest: both produce a *paragraph*, and a
 *    paragraph immediately followed by an underline line becomes a setext
 *    heading whose text starts with `#` — MEASURED, `"#x\n===\n"` parses as a
 *    `SetextHeading1` at `from=0`. The blank line prevents the fusion.
 *
 * 3. **No nested multi-line setext block.** There is deliberately no
 *    `> ${t}\n> ${t}\n> ===` template here. Blockquote and list lazy-continuation
 *    rules make the block-local heading count unsound when such a block abuts a
 *    neighbour; that shape is covered by hand in B11 row 6, where it has no
 *    neighbours. Consequence recorded at the point it matters (L1 clause 4): the
 *    blockquote-prefix stripping there is dead over this domain. It is
 *    deliberate defensive code, and becomes reachable the moment this constraint
 *    is relaxed.
 */
const BLOCK_TEMPLATES: readonly BlockTemplate[] = [
  { build: (t) => `# ${t}`, headings: 1 },
  { build: (t) => `### ${t} ###`, headings: 1 },
  { build: (t) => `${t}\n=====`, headings: 1 },
  { build: (t) => `${t}\n-----`, headings: 1 },
  { build: (t) => `${t}\n${t}\n=====`, headings: 1 },
  { build: (t) => `> # ${t}`, headings: 1 },
  { build: (t) => `- # ${t}`, headings: 1 },
  { build: (t) => `${t} paragraph`, headings: 0 },
  { build: (t) => `${BACKTICKS}\n# ${t}\n${BACKTICKS}`, headings: 0 },
  // No space after the `#` run: a paragraph, not a heading.
  { build: (t) => `#${t}`, headings: 0 },
  // Seven `#`: past the level-6 maximum, so a paragraph.
  { build: (t) => `####### ${t}`, headings: 0 },
];

/** Constraint 2 made executable: blank line between blocks, trailing newline. */
function joinBlocks(blocks: readonly string[]): string {
  return blocks.join("\n\n") + "\n";
}

/**
 * Generate `count` seeded law documents of 1-8 blocks each.
 *
 * Determinism matters as much as coverage: the same seed must reproduce the same
 * corpus, so a red is replayable from the `seed=` printed in the failure message.
 */
export function generateLawDocuments(
  seed: number = DEFAULT_SEED,
  count = 100,
): LawDocument[] {
  const next = createLcg(seed);
  const documents: LawDocument[] = [];

  for (let d = 0; d < count; d++) {
    const blockCount = 1 + (next() % 8);
    const blocks: string[] = [];
    let expectedHeadingCount = 0;

    for (let b = 0; b < blockCount; b++) {
      const template = BLOCK_TEMPLATES[next() % BLOCK_TEMPLATES.length];
      const token = LAW_TOKEN_ALPHABET[next() % LAW_TOKEN_ALPHABET.length];
      blocks.push(template.build(token));
      expectedHeadingCount += template.headings;
    }

    documents.push({
      name: `generated-${d}`,
      markdown: joinBlocks(blocks),
      expectedHeadingCount,
    });
  }

  return documents;
}

/**
 * The hand-written law documents. These ride all six laws and exist so that a
 * generator bug cannot empty the domain silently — if `generateLawDocuments`
 * ever returns headingless noise, these 13 still carry every construct the laws
 * are about.
 *
 * The three `lone-cr` documents are what give L2 its third line-terminator class
 * (`\n`, `\r\n`, lone `\r`); without them a `Text.of(src.split(/\r\n?|\n/))`
 * implementation agrees with `\n`-counting everywhere in the domain.
 * `lone-cr-setext` is the document that forced L1 clause 3 to be normalized on
 * *both* sides; `setext-pair`, `setext-multiline` and `frontmatter-setext` are
 * what make L1 clause 4's operand choice a mass failure rather than a corner.
 */
export const LAW_DOCS: readonly LawDocument[] = [
  { name: "atx-mixed", markdown: "# One\n\ntext\n\n## Two\n\n### Three\n", expectedHeadingCount: 3 },
  { name: "setext-pair", markdown: "Alpha\n=====\n\nBeta\n-----\n", expectedHeadingCount: 2 },
  { name: "setext-multiline", markdown: "Alpha\nBeta\n===\n", expectedHeadingCount: 1 },
  { name: "nested", markdown: "> # Quoted\n\n- # Item\n\n# Top\n", expectedHeadingCount: 3 },
  { name: "frontmatter", markdown: "---\ntitle: T\n---\n# Real\n\n## Sub\n", expectedHeadingCount: 2 },
  { name: "frontmatter-setext", markdown: "---\na: 1\n---\nAlpha\n=====\n", expectedHeadingCount: 1 },
  {
    name: "cjk-astral",
    markdown: "# 架构设计\n\n## 🎉 emoji 标题\n\n### 𝔘𝔫𝔦𝔠𝔬𝔡𝔢\n",
    expectedHeadingCount: 3,
  },
  {
    name: "fenced",
    markdown: `${BACKTICKS}\n# not a heading\n${BACKTICKS}\n\n# after\n`,
    expectedHeadingCount: 1,
  },
  { name: "closing-seq", markdown: "# Title ###\n\n## Sub ##\n", expectedHeadingCount: 2 },
  // No trailing newline: the end-of-document boundary for an ATX heading.
  { name: "heading-only", markdown: "# Solo", expectedHeadingCount: 1 },
  { name: "lone-cr", markdown: "a\rb\n# H\n", expectedHeadingCount: 1 },
  // MEASURED: a lone `\r` is not a line break, so `# H` is mid-paragraph here.
  { name: "lone-cr-no-break", markdown: "a\r# H\n", expectedHeadingCount: 0 },
  { name: "lone-cr-setext", markdown: "a\rb\n===\n", expectedHeadingCount: 1 },
];
