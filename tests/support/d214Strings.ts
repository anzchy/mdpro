/**
 * D214-WI-1 S4 domain: every string of length 0–3 over the alphabet {a, b, \n}.
 * 1 + 3 + 9 + 27 = 40 strings, enumerated (no generator library), so the law
 * `isModified === (content !== savedContent)` is checked over the whole domain,
 * including the empty string, same-length permutations and newline-only edits.
 */
export const D214_ALPHABET = ["a", "b", "\n"] as const;
export const D214_MAX_LENGTH = 3;

function enumerate(alphabet: readonly string[], maxLength: number): string[] {
  const out: string[] = [""];
  let layer: string[] = [""];
  for (let length = 1; length <= maxLength; length += 1) {
    layer = layer.flatMap((prefix) => alphabet.map((ch) => prefix + ch));
    out.push(...layer);
  }
  return out;
}

/** The 40-string domain Σ. */
export const D214_STRINGS: readonly string[] = enumerate(D214_ALPHABET, D214_MAX_LENGTH);
