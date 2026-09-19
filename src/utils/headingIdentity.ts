/**
 * Purpose: the single normative implementation of heading `anchorSlug` generation —
 * `slugBase` (text → base slug) and `createAnchorSlugAllocator` (base slug → an id
 * unique within one document).
 *
 * WI-3.1 ships this module **unwired**: `tocService.ts`, `exportService.ts`,
 * `markdown.rs`, `tocStore.ts` and the Sidebar are untouched here. WI-3.2 is the change
 * that replaces the three live mdpro-owned faces with it and hand-ports the same
 * algorithm to Rust.
 *
 * Those three are not every heading-id producer in the running app, and this module is
 * NOT normative for the fourth. Milkdown writes its own heading DOM ids on the WYSIWYG
 * surface (`@milkdown/preset-commonmark@7.18.0`), and its dedupe disagrees with the
 * allocator below by construction — a second `# Intro` is `intro-#2` there and
 * `intro-1` here. That namespace is unowned and, after WI-3.6, read by no mdpro code:
 * the TOC addresses headings by document-order correspondence instead
 * (`src/utils/tocElementResolution.ts`, ADR-0014). Do not try to reconcile the two.
 *
 * Algorithm (normative — the Rust port in WI-3.2 must match it step for step):
 *   1. Lowercase the heading text (full Unicode lowering).
 *   2. Replace each maximal run of characters that are neither Unicode letters nor
 *      Unicode numbers with a single `-` (`/[^\p{L}\p{N}]+/gu`).
 *   3. Trim `-` from both ends.
 *   4. If the result is empty, substitute the literal `"heading"` — **before** any
 *      collision handling.
 *   5. If the candidate is already taken, append `-` and the smallest positive integer
 *      that yields a free id.
 *   6. Register the result in the taken set and return it.
 *
 * Two step orderings are load-bearing and easy to "simplify" away:
 *
 * - **Lowercase before classify (1 before 2).** `"İ"` (U+0130) lowercases to `i` +
 *   U+0307 COMBINING DOT ABOVE, which is `Mn` — not `\p{L}`. Classifying first leaves
 *   the mark in the output.
 * - **Substitute before collide (4 before 5).** Deferring the `|| "heading"` to the
 *   return statement registers `""` in the taken set, so a later literal `# heading`
 *   collides undetected and an emoji-only heading emits the bare id `-1`. Both are
 *   measured defects of the current live faces.
 *
 * Performance, and the invariant that keeps it honest: a naive "smallest free integer"
 * rescan from 1 is O(n²) over a document of n identical headings. This module carries a
 * per-base monotone hint (`lastTriedN`) so the search resumes instead of restarting.
 * That is **output-identical**, not an approximation:
 *
 *   `hint[base] = k` is set only when `base-k` was allocated. Allocating `base-k`
 *   required the search to reject every n in [1, k-1] as taken. The taken set is
 *   monotone non-decreasing — nothing is ever removed — so all of [1, k] remain taken
 *   forever, and resuming the next search at k+1 cannot skip a free slot.
 *
 * The proof rests entirely on "nothing is ever removed". **Do not add a `release()` /
 * `delete()` method, and do not hand out the internal set**: either would make the hint
 * skip free ids while every example test still passed. `taken` is therefore exposed as
 * a `ReadonlySet` snapshot, and the allocator has no removal operation at all.
 */
import { asAnchorSlug, type AnchorSlug } from "../types/toc";

/** Substituted when nothing survives normalization (step 4). */
const EMPTY_BASE_FALLBACK = "heading";

/** Every character that is neither a Unicode letter nor a Unicode number (step 2). */
const NON_ALPHANUMERIC_RUN = /[^\p{L}\p{N}]+/gu;

/** Leading and trailing separators (step 3). */
const EDGE_SEPARATORS = /^-+|-+$/g;

export interface AnchorSlugAllocator {
  /** Allocate a document-unique anchor id for `text` and register it. */
  allocate(text: string): AnchorSlug;
  /**
   * A snapshot of the ids taken so far. Read-only by contract *and* by construction —
   * it is a copy, so mutating it cannot reach the allocator's own state. See the
   * monotone-hint proof in this file's header for why that matters.
   */
  readonly taken: ReadonlySet<string>;
}

/**
 * Steps 1-4: heading text → base slug, with no collision handling and no state.
 *
 * Pure and idempotent: every output is already a fixed point, non-empty, and contains
 * only `\p{L}`/`\p{N}` runs joined by single hyphens.
 */
export function slugBase(text: string): string {
  const base = text
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_RUN, "-")
    .replace(EDGE_SEPARATORS, "");

  return base === "" ? EMPTY_BASE_FALLBACK : base;
}

/**
 * Create a per-document anchor-slug allocator.
 *
 * The taken set is seedable so "collision-free against ids already assigned in this
 * document" stays expressible when ids arrive from more than one producer. Each
 * allocator owns its own state — nothing here is module-scoped, so two allocators over
 * the same input sequence produce identical output and neither sees the other's set.
 */
export function createAnchorSlugAllocator(initialTaken: Iterable<string> = []): AnchorSlugAllocator {
  const taken = new Set<string>(initialTaken);
  // base → the largest suffix n this allocator has already handed out for that base.
  const lastTriedN = new Map<string, number>();

  return {
    allocate(text: string): AnchorSlug {
      const base = slugBase(text);

      if (!taken.has(base)) {
        taken.add(base);
        return asAnchorSlug(base);
      }

      // Resume from the hint (see the header proof), but still re-check membership:
      // a seeded set can already occupy `base-1` without this allocator having
      // handed it out.
      let n = lastTriedN.get(base) ?? 0;
      let candidate: string;
      do {
        n += 1;
        candidate = `${base}-${n}`;
      } while (taken.has(candidate));

      lastTriedN.set(base, n);
      taken.add(candidate);
      return asAnchorSlug(candidate);
    },

    get taken(): ReadonlySet<string> {
      // A copy, not the live set. `ReadonlySet` is a compile-time promise only; a
      // caller that casts it away must still not be able to remove an id, because the
      // monotone-hint proof depends on the taken set never shrinking.
      return new Set(taken);
    },
  };
}
