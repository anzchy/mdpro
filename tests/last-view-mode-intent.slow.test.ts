/**
 * D24 WI-3, slow tier (ADR-0050) — LVI-09s: the erasure and closed-form law of
 * `tests/last-view-mode-intent.test.ts` LVI-09, extended to every set-only
 * command sequence of length 1..6 with `stored` in {wysiwyg, source}:
 * 2 × Σ 4^k (k = 1..6) = 2 × 5,460 = 10,920 rows, each mounted twice (full and
 * with the programmatic commands erased). The domain comes from
 * `tests/support/viewModeCommandSequences.ts` and the runner from
 * `tests/support/lastViewModeLaw.ts`, never copied.
 *
 * One `it` per (sequence length × first command), 24 chunks, so each stays
 * inside the slow tier's default per-test budget without raising it.
 *
 * jsdom (`renderHook`; the editor store's import graph needs a window).
 * Logging is disabled for speed: `preferences.last_view_mode` is not under
 * test here (LVI-07 / LVI-07b pin it).
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke`, routed to the harness backend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { answer } from "./support/lastViewModeHarness";
import { checkLastViewModeLaw } from "./support/lastViewModeLaw";
import { setOnlySequences } from "./support/viewModeCommandSequences";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
});

describe("LVI-09s erasure and closed-form law, every set-only sequence of length <= 6", () => {
  const sequences = setOnlySequences(6);

  it("enumerates 5,460 sequences (10,920 rows with both stored values)", () => {
    expect(sequences).toHaveLength(4 + 16 + 64 + 256 + 1024 + 4096);
  });

  it.each([1, 2, 3, 4, 5, 6])("enumerates 4^%i sequences of that length", (length) => {
    expect(sequences.filter((s) => s.length === length)).toHaveLength(4 ** length);
  });

  // Chunked by length × first command: the whole length-6 layer measured
  // 176 s against the tier's 180 s per-test floor, and timeouts are not raised.
  // `sequences` is shortest-first, so its first four entries are the four
  // single commands; each chunk is the sequences that begin with one of them.
  const chunks = [1, 2, 3, 4, 5, 6].flatMap((length) =>
    [0, 1, 2, 3].map((first) => ({ length, first, head: sequences[first]?.[0] })),
  );

  it.each(chunks)("holds for every sequence of length $length starting with command #$first", async ({ length, head }) => {
    expect(head).toBeDefined();
    const chunk = sequences.filter(
      (s) => s.length === length && s[0].intent === head?.intent && s[0].mode === head?.mode,
    );
    expect(chunk).toHaveLength(4 ** (length - 1));
    expect(await checkLastViewModeLaw(chunk, { logging: false })).toEqual([]);
  });
});
