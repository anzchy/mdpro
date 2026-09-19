/**
 * Purpose: the single normative implementation of heading **key coordination** —
 * `coordinateHeadingKeys`, which decides, for one revision of a document, which headings
 * in the new heading list are "the same heading" as one in the old list and therefore
 * inherit its {@link HeadingKey}.
 *
 * This is the executable half of the `headingKey` contract written in
 * `src/types/toc.ts` (the edit-kind table and the RESET clauses). That file states what
 * must happen; this file is the only place it happens.
 *
 * Pure by construction and by requirement: no imports from `stores/`, `hooks/` or
 * `services/`, no module-scope mutable state, and key minting is **injected** as the
 * `mint` parameter rather than reached for. Two calls with the same arguments return
 * equal results, and an interleaved unrelated call cannot perturb either. The precedent
 * — and the reason it is spelled out — is `tocService.ts`'s slug allocator, which held
 * module-scope state and produced cross-document collisions.
 *
 * ---------------------------------------------------------------------------
 * Algorithm
 * ---------------------------------------------------------------------------
 * Two passes over `next`, then a fallthrough. Output is positional: one key per entry of
 * `next`, in order.
 *
 * **Pass 1 — exact match.** Group both sides by the pair `(level, text)`. Within a group,
 * pair by *occurrence index*: the 1st previous heading of that pair with the 1st next
 * heading of that pair, 2nd with 2nd, and so on; when one side's group runs out, the
 * surplus on the other side is simply unpaired. Pairing deliberately does **not** consult
 * absolute position — that is what makes an insert at the top leave every following
 * heading's key alone, and what makes a pure move carry state with the heading.
 *
 * Pass 1 alone settles five rows of the contract table: a non-heading edit (nothing about
 * headings changed, so everything pairs), insert (pre-existing headings pair despite
 * shifted ordinals), delete (the unpaired previous key is never handed out, i.e. retired),
 * move (text and level unchanged, so it pairs), and duplicates (occurrence-index pairing
 * keeps the second from inheriting the first's key).
 *
 * The group key includes **`level`**, not just `text`. Dropping the level is the single
 * most tempting simplification here and it is wrong: a document with `## Intro` and
 * `### Intro` would let a deletion hand the H3's key to the H2's slot. Pinned by matrix
 * case M15.
 *
 * **Pass 2 — rename.** Among the leftovers of pass 1 only: a previous leftover pairs with
 * a next leftover **iff they sit at the same absolute index in their respective lists and
 * have the same level**. Text may differ freely — that is the whole point, and it is what
 * makes `key ≠ anchorSlug` executable rather than aspirational.
 *
 * **Fallthrough — `mint()`.** Anything still unpaired gets a fresh key.
 *
 * ---------------------------------------------------------------------------
 * Why RESET case (a) needs no branch
 * ---------------------------------------------------------------------------
 * Contract case (a) is "text *and* relative order both change → reset, do not guess".
 * Changed text means pass 1 cannot match; a changed ordinal means pass 2's index test
 * fails. The heading falls through to `mint()` with no code written for the case. There
 * is no `if` to forget, and no threshold to tune.
 *
 * ---------------------------------------------------------------------------
 * Pass 2 is an explicit ambiguity policy, NOT a structural consequence
 * ---------------------------------------------------------------------------
 * An earlier draft of the plan claimed pass 2 also made contract case (c) — "anything the
 * matcher cannot attribute unambiguously resets" — fall out for free. **That claim is
 * false.** Pass 2 is a decision, stated here so it is not mistaken for an emergent
 * property:
 *
 *   > When one previous leftover and one next leftover occupy the same ordinal and the
 *   > same level, interpret the change as continuity — a rename.
 *
 * Deleting a heading and inserting a different one at the same index and level produces a
 * `(previous, next)` pair that is byte-identical to the pair produced by renaming it. No
 * deterministic function of these two arrays can separate them. The contract lists rename
 * as preserving, and pass 2 exists solely to serve that row, so the tie is resolved in
 * favour of rename; the alternative degrades every ordinary rename to fix a rare
 * collision. A text-similarity threshold was examined and declined (headings are too
 * short for edit distance to carry confidence, and `Q1` → `Q2` behaves discontinuously),
 * as was body/subtree matching (renaming *while* editing the body would then lose state).
 *
 * ---------------------------------------------------------------------------
 * Known and accepted limitations
 * ---------------------------------------------------------------------------
 * 1. **Duplicate swap.** Two headings with identical text *and* level that swap places are
 *    paired 1↔1, not 1↔2. There is no observable difference — they differ only in
 *    position, which `src/types/toc.ts` forbids as an identity — so this is
 *    indistinguishable, not wrong.
 * 2. **Same-index same-level delete-then-insert inherits.** Per the policy above, deleting
 *    a section and typing a brand-new one in its slot gives the new heading the deleted
 *    one's key, and with it the deleted one's collapse / active state. Unlike (1) this
 *    **is** observable: a heading the user just typed can appear already-collapsed.
 *    Severity SHOULD / NOTE — session-local, no content lost, one click to recover.
 *    Pinned deliberately by matrix case M16, which asserts the inheriting outcome.
 *
 * Higher-confidence identity is available in principle — CodeMirror `ChangeSet`/`mapPos`
 * and ProseMirror `Mapping` both carry survival evidence through an edit. It is declined
 * here because this TOC is shared by two editor models plus mutation paths that carry no
 * transaction at all (MCP writes, file reload). If it is ever added, the normalized shape
 * that would keep this module pure is
 * `{ oldKey, nextIndex, status: "survived" } | { oldKey, status: "deleted" }`.
 */
import type { HeadingKey } from "../types/toc";

/** A heading from the previous revision, already carrying its coordination key. */
export interface KeyedHeading {
  readonly key: HeadingKey;
  readonly level: number;
  readonly text: string;
}

/** A heading as the parser produces it: no key, because minting one is not its job. */
export interface ParsedHeading {
  readonly level: number;
  readonly text: string;
}

/**
 * The pass-1 group key.
 *
 * The separator is a single space, and the encoding is injective *unconditionally*:
 * `level` is a non-negative integer, so its decimal rendering contains no space, so
 * everything before the first space is unambiguously the level and everything after it is
 * unambiguously the text — whatever the text contains. Swapping in a separator that a
 * level could contain would silently merge two groups, and every example test would still
 * pass.
 */
function groupKey(level: number, text: string): string {
  return `${level} ${text}`;
}

/**
 * Decide which key each heading in `next` carries, given the previous revision's keys.
 *
 * Returns exactly `next.length` keys, positionally aligned with `next`, pairwise distinct.
 * Every returned key is either a `previous` key (used at most once across the whole
 * result) or a value returned by `mint`.
 *
 * `mint` is called once per heading that neither pass could pair, and never otherwise —
 * so `mint` call count is itself the count of headings whose state resets.
 */
export function coordinateHeadingKeys(
  previous: readonly KeyedHeading[],
  next: readonly ParsedHeading[],
  mint: () => HeadingKey,
): HeadingKey[] {
  const assigned: Array<HeadingKey | null> = next.map(() => null);
  const previousTaken: boolean[] = previous.map(() => false);

  // Pass 1 — exact match on (level, text), paired by occurrence index.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < previous.length; i += 1) {
    const key = groupKey(previous[i].level, previous[i].text);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [i]);
    } else {
      bucket.push(i);
    }
  }

  // How many members of each group the walk over `next` has already consumed.
  const consumed = new Map<string, number>();
  for (let i = 0; i < next.length; i += 1) {
    const key = groupKey(next[i].level, next[i].text);
    const bucket = groups.get(key);
    if (bucket === undefined) continue;

    const used = consumed.get(key) ?? 0;
    // The group is exhausted: this revision has more copies of the pair than the last
    // one did. The surplus is genuinely new and must not re-use an already-paired key.
    if (used >= bucket.length) continue;

    consumed.set(key, used + 1);
    const previousIndex = bucket[used];
    previousTaken[previousIndex] = true;
    assigned[i] = previous[previousIndex].key;
  }

  // Pass 2 — rename: same absolute index, same level, both sides still unpaired.
  for (let i = 0; i < next.length; i += 1) {
    if (assigned[i] !== null) continue;
    if (i >= previous.length) continue;
    if (previousTaken[i]) continue;
    if (previous[i].level !== next[i].level) continue;

    previousTaken[i] = true;
    assigned[i] = previous[i].key;
  }

  // Fallthrough — reset, do not guess.
  return assigned.map((key) => key ?? mint());
}
