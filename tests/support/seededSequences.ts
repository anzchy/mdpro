/**
 * @module tests/support/seededSequences
 * Purpose: seeded sequence generators for determinism and property cases:
 * `genSequence` draws a sequence of 1..maxLen elements from an alphabet, and
 * `seededShuffle` permutes a list (Fisher-Yates). Both draw from
 * `mulberry32(seed)`, re-exported from `seededRandom.ts` rather than copied
 * (ADR-0050), so a failing case reproduces from the seed in its title.
 *
 * No `src/` imports. Not a `*.test.ts`, so vitest does not collect it.
 *
 * @coordinates-with tests/support/seededRandom.ts — the PRNG
 */
import { int, type Rng } from "./seededRandom";

export { mulberry32, type Rng } from "./seededRandom";

/** A sequence of 1..maxLen elements, each drawn from `alphabet` (non-empty). */
export function genSequence<T>(rng: Rng, alphabet: readonly T[], maxLen: number): T[] {
  const length = int(rng, 1, maxLen);
  return Array.from({ length }, () => alphabet[int(rng, 0, alphabet.length - 1)]);
}

/** A seeded Fisher-Yates permutation of `xs`; `xs` itself is not changed. */
export function seededShuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
