/**
 * Purpose: Corpus G — the hand-rolled, seeded heading-text generator shared by the
 * WI-3.1 heading-identity property tests (and, later, by the WI-3.2 face tests).
 *
 * Why this file is NOT a `*.test.ts`: `vitest.config.ts` collects
 * `tests/**\/*.test.{ts,tsx}`. Importing one test file from another re-registers its
 * suites, so the generator lives outside that glob while `tsconfig.test.json`
 * (`include: ["src", "tests"]`) still typechecks it.
 *
 * G0 compliance: no `fast-check`, no new dependency. The PRNG is a hand-rolled LCG
 * whose recurrence is deliberately expressible in Rust as
 * `s.wrapping_mul(1664525).wrapping_add(1013904223)` so the WI-3.2 Rust parity port
 * can generate the identical corpus.
 */

/** Default corpus seed. Printed by every property failure so a red is reproducible. */
export const DEFAULT_SEED = 0x5eed;

/**
 * Adversarial alphabet: one token per class the plan names — already-suffixed forms,
 * the empty-base literal and its suffixed form, emoji-only (empty after
 * normalization), CJK, CJK + digit + punctuation, punctuation-only, mixed case, and
 * a very long token.
 */
export const CORPUS_ALPHABET: readonly string[] = [
  "x",
  "x-1",
  "x-1-1",
  "heading",
  "heading-1",
  "🎉",
  "🎊",
  "架构",
  "第1章: 架构",
  "---",
  "Title",
  "INTRO",
  "架构".repeat(50),
];

/**
 * The closed output shape every slug must have: non-empty, only `\p{L}`/`\p{N}`
 * separated by single hyphens, no leading/trailing hyphen, no doubled hyphen.
 */
export const SHAPE_RE = /^(?:[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)$/u;

/**
 * Linear congruential generator (Numerical Recipes constants).
 *
 * `s * 1664525` peaks at `2**32 * 1664525 ≈ 7.15e15`, below `Number.MAX_SAFE_INTEGER`
 * (`≈ 9.01e15`), so the multiply is exact and `>>> 0` reproduces Rust's
 * `wrapping_mul` exactly.
 */
export function createLcg(seed: number = DEFAULT_SEED): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

export interface CorpusDocument {
  /** The heading texts, in document order. */
  headings: string[];
  /** The same document as ATX markdown — one `# <token>` per line, no blank lines. */
  markdown: string;
}

export interface Corpus {
  seed: number;
  documents: CorpusDocument[];
}

/**
 * Generate `documentCount` documents of 1–`maxHeadings` ATX headings drawn from
 * `CORPUS_ALPHABET`.
 *
 * Shape is deliberately narrow: no blank lines and no markup characters, so
 * `stripFrontmatter` never fires and the pinned `exportFallback` markup-leak
 * degradations (decision A1) stay out of the generated domain by construction.
 */
export function generateCorpus(
  seed: number = DEFAULT_SEED,
  documentCount = 200,
  maxHeadings = 50,
): Corpus {
  const next = createLcg(seed);
  const documents: CorpusDocument[] = [];

  for (let d = 0; d < documentCount; d++) {
    const count = 1 + (next() % maxHeadings);
    const headings: string[] = [];
    for (let h = 0; h < count; h++) {
      headings.push(CORPUS_ALPHABET[next() % CORPUS_ALPHABET.length]);
    }
    documents.push({
      headings,
      markdown: headings.map((t) => `# ${t}`).join("\n") + "\n",
    });
  }

  return { seed, documents };
}

/** Every alphabet token, every pairwise concatenation, plus the Unicode hazard list. */
export function unicodeHazards(): string[] {
  return [
    "İ", // İ — lowercases to "i" + U+0307 COMBINING DOT ABOVE (Mn, not \p{L})
    "ǅ", // ǅ — titlecase letter
    "ẞ", // ẞ — capital sharp s
    "Ⅷ", // Ⅷ — Nl, a number outside \p{Nd}
    "①", // ① — No
    "½", // ½ — No
    "á", // a + COMBINING ACUTE (Mn)
    "\u{1f468}‍\u{1f469}‍\u{1f467}", // ZWJ family sequence
    "​", // ZERO WIDTH SPACE
  ];
}

/** The A3/A4 domain: alphabet ∪ pairwise concatenations ∪ Unicode hazards. */
export function shapeDomain(): string[] {
  const domain: string[] = [...CORPUS_ALPHABET];
  for (const a of CORPUS_ALPHABET) {
    for (const b of CORPUS_ALPHABET) domain.push(a + b);
  }
  domain.push(...unicodeHazards());
  return domain;
}
