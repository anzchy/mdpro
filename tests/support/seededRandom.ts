/**
 * Seeded property-test generator for the ADR-0047 launcher tests (WI-003).
 * The repo does not use fast-check by design; properties draw from
 * `mulberry32(seed)` and name the seed in the test title. Shared here so the
 * launcher test files never copy it (ADR-0050).
 */

export type Rng = () => number;

/** mulberry32: a small, fast, seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [lo, hi], inclusive. */
export const int = (r: Rng, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));

/** One element of a non-empty list. */
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)];

/** A string of `lo..hi` characters drawn from `alphabet` (code points). */
export const str = (r: Rng, alphabet: string, lo: number, hi: number): string =>
  Array.from({ length: int(r, lo, hi) }, () => pick(r, [...alphabet])).join("");

/** `n` seeded bytes. */
export function bytes(r: Rng, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = int(r, 0, 255);
  return out;
}
