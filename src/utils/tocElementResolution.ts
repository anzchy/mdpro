/**
 * Purpose: the single normative way the TOC turns a `TOCEntry` into the **DOM element**
 * that heading currently occupies — `resolveHeadingElements`, plus the two helpers it is
 * built from (`collectHeadingElements`, `normalizeHeadingText`) and the scroll-spy
 * selector (`pickActiveKey`) that reads its output.
 *
 * This is an **allocation, not a lookup**. Each DOM heading is consumed at most once, so
 * injectivity — no two headings sharing an element, ever — is a property of construction
 * rather than of a check somebody can forget to run. That is the whole reason the module
 * exists: the defect it replaces (`useTOC.ts`'s id lookup followed by a first-text-match
 * `break`) mapped every duplicate heading onto the first one that shared its text.
 *
 * Pure by construction and by requirement: no React, no Tauri, no globals, no
 * module-scope mutable state, nothing read from or written to the DOM beyond
 * `querySelector`/`textContent`/`tagName`. Two calls with the same arguments return the
 * same element references. The precedent for spelling this out is `tocService.ts`'s slug
 * allocator, which held module-scope state and produced cross-document collisions.
 *
 * ---------------------------------------------------------------------------
 * The measured Milkdown face (plan D6 / P1-P3) — do not re-derive this
 * ---------------------------------------------------------------------------
 * Heading DOM ids in the WYSIWYG surface are produced by
 * `@milkdown/preset-commonmark@7.18.0`'s `syncHeadingIdPlugin` (`lib/index.js:2119-2161`)
 * on top of `defaultHeadingIdGenerator` (`:521-523`, lowercase + whitespace→hyphen,
 * punctuation preserved). Three properties were **measured** by mounting a real editor in
 * jsdom, and they are why nothing below reads an id:
 *
 *   P1 — ids are recomputed for the WHOLE document on view init and on EVERY doc change
 *        (`:2127-2146`), via an `idMap` counter appending `-#n` from the second
 *        occurrence (`:2132-2137`).
 *   P2 — they are written with `setNodeMarkup` and DISPATCHED AS A TRANSACTION
 *        (`addToHistory: false`, `:2140-2147`). Heading ids are asynchronously mutating
 *        document state, not a render-time function of the text.
 *   P3 — `:2129`: an empty heading is skipped and gets NO id attribute at all, while
 *        still rendering as an `<hN>`.
 *
 * Consequence, measured: our allocator names the second `# Intro` `intro-1`; Milkdown
 * names it `intro-#2`. Two dedupe algorithms, two suffix schemes, so a `#intro-1` lookup
 * misses **deterministically**. `data-heading-id` is `null` on every editor-surface
 * heading. Milkdown's ids are an unowned namespace; after WI-3.6 no mdpro code reads
 * them. **If any editor-surface code begins reading or writing heading DOM ids, the
 * decision recorded in ADR-0014 is revisited.**
 *
 * ---------------------------------------------------------------------------
 * The algorithm, and the trade-off it accepts (plan D1)
 * ---------------------------------------------------------------------------
 * Root: `container.querySelector(".ProseMirror")` **only**. There is deliberately no
 * `proseMirror || container` fallback: `MilkdownEditor.tsx:302-313` renders
 * `LinkInsertModal` / `TableInsertModal` / `TableContextMenu` *inside*
 * `#milkdown-container`, and each emits an `<h3 class="dialog-title">` when open. During
 * a document switch `MilkdownProvider` is re-keyed and torn down while the container — and
 * any open modal — survives, so a container-wide scan in that window would count a modal
 * title as a document heading. No `.ProseMirror` ⇒ resolve nothing.
 *
 *   Tier 1 — `domHeadings.length === entries.length` ⇒ zip by index. Exhaustive, and the
 *            common case. It consults neither text nor level; count equality alone.
 *   Tier 2 — on count mismatch, forward-only greedy allocation: for entry `i`, scan from
 *            the cursor left by entry `i-1` and take the first unconsumed heading whose
 *            level AND normalized text match. **The cursor advances only on a successful
 *            match** — an unmatchable entry consumes nothing and is simply absent.
 *   Tier 3 — unmapped entries do not navigate and cannot become active. The caller logs
 *            the mismatch once per changed signature (D7); this module stays silent.
 *
 * **Trade-off, stated rather than discovered later**: tier 1 is correct only while the
 * Lezer parser and Milkdown's remark parse produce the same heading sequence. Known
 * breakers are `> #⇥Title` (Milkdown renders it, our parser misses it), raw HTML `<h2>`
 * in source, and future Lezer-vs-CommonMark drift. Blockquote/list-item headings, setext
 * headings and `#` inside fenced code are NOT breakers — our parser handles all three and
 * Milkdown agrees. Tier 2 carries its own limit: heading text is not inline-markup
 * stripped, so `## [x](url) tail` yields literal source text that can never text-match
 * Milkdown's rendered `x tail`. The cost of both is a **no-op**, never a wrong target.
 *
 * Nothing here is persisted. The correspondence is recomputed every pass, which is what
 * keeps `HeadingPosition`'s "随修订更新，不充当稳定身份" rule (`src/types/toc.ts:97-112`)
 * true, and what stops P2's asynchronously-rewritten ids from ever becoming an address.
 *
 * @coordinates-with src/hooks/useTOC.ts — its only caller (WI-3.6.2/3)
 * @coordinates-with src/types/toc.ts — owns `HeadingKey` and the identity contract
 */
import type { HeadingKey, TOCEntry } from "../types/toc";

/** The `(entryCount, domCount)` signature of a tier-2 degradation. */
export interface HeadingCountMismatch {
  entryCount: number;
  domCount: number;
}

/** The output of one resolution pass. `byElement` is the exact inverse of `byKey`. */
export interface HeadingResolution {
  /** Entry key → the heading element it currently occupies. Injective. */
  byKey: Map<HeadingKey, Element>;
  /** The inverse, for the IntersectionObserver callback, which is handed elements. */
  byElement: Map<Element, HeadingKey>;
  /** `null` iff the counts agreed and tier 1 ran. */
  mismatch: HeadingCountMismatch | null;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/**
 * Collapse every whitespace run to a single space and trim the ends.
 *
 * Both sides of tier 2's text predicate go through this, and both must: rendered
 * `textContent` carries the editor's incidental newlines and indentation, while entry
 * text carries the source's. A projection — `n(n(x)) === n(x)` — so the predicate cannot
 * depend on how many times it has been applied.
 *
 * Note `\s` matches U+00A0 in JS, so a non-breaking space collapses like any other.
 */
export function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Every `h1`…`h6` inside the editor surface, in document order.
 *
 * Returns `[]` when `.ProseMirror` is absent — the remount window described in the header.
 * The scan is `querySelectorAll`, not a direct-children walk, because headings nested in
 * blockquotes and list items are ordinary document headings that our parser also reports.
 */
export function collectHeadingElements(root: Element): Element[] {
  const proseMirror = root.querySelector(".ProseMirror");
  if (!proseMirror) return [];
  return Array.from(proseMirror.querySelectorAll(HEADING_SELECTOR));
}

/** `"H3"` → `3`. Only ever called on elements `HEADING_SELECTOR` matched. */
function headingLevel(element: Element): number {
  return Number(element.tagName.charAt(1));
}

/**
 * Map each entry to the DOM heading it occupies, by document-order correspondence.
 *
 * See the module header for the two tiers and the trade-off tier 1 accepts. The result is
 * injective in both tiers by construction: tier 1 zips two equal-length sequences, and
 * tier 2's cursor never revisits a consumed element.
 */
export function resolveHeadingElements(
  entries: readonly TOCEntry[],
  root: Element,
): HeadingResolution {
  const domHeadings = collectHeadingElements(root);
  const entryCount = entries.length;
  const domCount = domHeadings.length;

  const byKey = new Map<HeadingKey, Element>();
  const byElement = new Map<Element, HeadingKey>();

  const claim = (entry: TOCEntry, element: Element): void => {
    byKey.set(entry.key, element);
    byElement.set(element, entry.key);
  };

  // Tier 1 — count equality alone. Text and level are deliberately not consulted: a
  // heading whose rendered text differs from its source text (inline markup) still zips
  // to the right element, and gating on agreement would lose a navigation that works.
  if (entryCount === domCount) {
    for (let i = 0; i < entryCount; i++) claim(entries[i], domHeadings[i]);
    return { byKey, byElement, mismatch: null };
  }

  // Tier 2 — forward-only greedy allocation on (level, normalized text).
  let cursor = 0;
  for (const entry of entries) {
    const wanted = normalizeHeadingText(entry.text);
    for (let i = cursor; i < domCount; i++) {
      const candidate = domHeadings[i];
      if (headingLevel(candidate) !== entry.level) continue;
      if (normalizeHeadingText(candidate.textContent ?? "") !== wanted) continue;
      claim(entry, candidate);
      // Only a successful match advances the cursor. An entry that matches nothing
      // consumes nothing — `cursor += 1` on failure would hand the next entry the
      // element this one skipped, which is a wrong target rather than a no-op.
      cursor = i + 1;
      break;
    }
  }

  return { byKey, byElement, mismatch: { entryCount, domCount } };
}

/**
 * The first entry in **document order** whose key is currently visible, or `null`.
 *
 * Iterating `entries` rather than `visibleKeys` is the load-bearing choice: a `Set`'s
 * iteration order is insertion order, which for the scroll-spy is the arrival order of
 * IntersectionObserver records — i.e. scroll direction. Reading it would make the active
 * heading depend on which way the user scrolled into view.
 *
 * Keys absent from `entries` (stale elements from a superseded pass) are ignored rather
 * than thrown on. What a caller does with `null` is a caller decision, kept out of here.
 */
export function pickActiveKey(
  entries: readonly TOCEntry[],
  visibleKeys: ReadonlySet<HeadingKey>,
): HeadingKey | null {
  for (const entry of entries) {
    if (visibleKeys.has(entry.key)) return entry.key;
  }
  return null;
}
