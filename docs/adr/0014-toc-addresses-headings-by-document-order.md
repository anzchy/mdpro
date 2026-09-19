# 0014. The TOC addresses headings by document-order correspondence, not by DOM id

## Status

Accepted — 2026-09-19

## Context

The outline sidebar has to answer one question every time the user clicks an
entry or scrolls: *which DOM element is this heading?* Until now `useTOC.ts`
answered it in three steps — look up `[data-heading-id="<slug>"]`, then
`#<CSS.escape(slug)>`, then fall back to scanning every `<h1>`–`<h6>` for the
first whose text matches, and `break`.

Every step was measured against the running app on 2026-09-19, by mounting a
real Milkdown editor in jsdom and printing what it actually emits:

- **`data-heading-id` is `null` on every editor-surface heading.** Nothing in
  the WYSIWYG path emits that attribute. Step 1 never matches.
- **The id lookup misses deterministically on duplicates.** Heading ids on that
  surface come from a *composite*: `defaultHeadingIdGenerator`
  (`@milkdown/preset-commonmark@7.18.0/lib/index.js:521-523`; lowercase,
  whitespace→hyphen, punctuation preserved) plus `syncHeadingIdPlugin`
  (`:2119-2161`), which applies its own dedupe with a `-#n` suffix from the
  second occurrence (`:2132-2137`). Our allocator names the second `# Intro`
  `intro-1`; Milkdown names it `intro-#2`. Two dedupe algorithms, two suffix
  schemes. Step 2 cannot match the second duplicate, ever.
- **So step 3 did the real work**, and step 3 maps every duplicate heading onto
  the *first* element sharing its text. That is the defect: clicking the second
  of two identical headings scrolled to the first, and the scroll-spy could
  never highlight anything but the first.

The punctuation-preserving generator also means an id can collide with a
*different* entry's slug. `# foo_bar` followed by `# foo bar` yields our slugs
`foo-bar` / `foo-bar-1` against DOM ids `foo_bar` / `foo-bar` — so an id lookup
for entry 0 hits **heading 2**. The old code's step 2 was not merely useless; on
ordinary documents it was actively wrong.

Two further measured properties constrain any fix:

- **P2** — `syncHeadingIdPlugin` writes ids with `setNodeMarkup` and dispatches
  a transaction (`addToHistory: false`, `:2140-2147`), recomputing them for the
  whole document on view init and on every doc change. Heading ids are
  asynchronously mutating document state, not a render-time function of text.
- **P3** — `:2129` skips empty headings, so `#` alone renders as an `<h1>` with
  no `id` at all while still being a heading our parser reports.

`src/types/toc.ts` already forbids the obvious shortcut: `HeadingPosition` is
documented as "随修订更新，不充当稳定身份" — it updates with each revision and
does not serve as identity.

## Decision

**The TOC addresses headings by document-order correspondence, computed fresh
on every pass and never persisted.** The logic lives in a pure module,
`src/utils/tocElementResolution.ts`, and `useTOC.ts` consumes it.

It is an **allocation, not a lookup**. Each DOM heading is consumed at most
once, so injectivity — no two entries ever sharing an element — is a property of
construction rather than a check someone can forget to run.

1. **Root is `container.querySelector(".ProseMirror")` only.** The previous
   `proseMirror || container` fallback is deleted. `MilkdownEditor.tsx:302-313`
   renders `LinkInsertModal`, `TableInsertModal` and `TableContextMenu` *inside*
   `#milkdown-container`, and each emits an `<h3 class="dialog-title">` when
   open. The fallback engaged only when `.ProseMirror` was absent — which is not
   the steady state but the **remount window**: `MilkdownEditor.tsx:304` keys
   `MilkdownProvider` on `activeDocumentId`, so switching documents tears the
   editor down while the container and any open modal survive. In that window a
   container-wide scan counts a modal title as a document heading. No
   `.ProseMirror` ⇒ resolve nothing.
2. **Tier 1** — when `domHeadings.length === entries.length`, zip by index.
   Exhaustive, and the common case. It consults neither text nor level.
3. **Tier 2** — on a count mismatch, forward-only greedy allocation: for entry
   `i`, scan from the cursor left by entry `i-1` and take the first unconsumed
   heading whose level *and* normalized text match. **The cursor advances only
   on a successful match**, so an unmatchable entry consumes nothing.
4. **Tier 3** — unmapped entries do not navigate and cannot become active. A
   no-op plus one `ui.toc.resolve.mismatch` warning, edge-triggered on a change
   of the `(entryCount, domCount)` signature.
5. **No DOM attribute is read or written.** Elements are held by object
   identity. Nothing is stored between passes.

### Rejected: (b) configuring Milkdown's `headingIdGenerator` to our allocator

Two independent killers, either of which is sufficient:

1. **It cannot express the contract even in principle.** `headingIdGenerator` is
   a `$ctx` holding a pure `(node) => string`, and `syncHeadingIdPlugin` applies
   its `-#n` dedupe **on top of whatever it returns** (`:2132-2137`). Overriding
   it yields our base slug with *Milkdown's* suffixes — `intro`, `intro-#2` —
   which is still not our anchor slug.
2. **A pure `(node) => string` cannot carry our allocator.** The allocator is
   stateful per document and its header
   (`src/utils/headingIdentity.ts:38-45`) forbids release, so there is no sound
   per-node reset point. By P1/P2 ids are recomputed and re-dispatched on every
   doc change, and `parseDOM.getAttrs` (`:553-558`) reads `node.id` back, so ids
   round-trip through copy/paste.

### Rejected: (c) a Milkdown plugin stamping our own identity attribute

A *decoration*-based plugin would not fight `syncHeadingIdPlugin`, since
decorations do not touch attributes. But it buys **no better correspondence than
document order does** — its ordinal still comes from Milkdown's parse — while
adding a plugin, a registration point, an attribute name that already means
"export anchor slug" (`exportService.ts:81`, `markdown.rs:643`), and a component
that must coexist with a plugin dispatching a transaction on every doc change.
An *attribute*-writing variant is strictly worse: per P2 it races
`syncHeadingIdPlugin`. Recorded here so it is not re-proposed.

## Consequences

### What this gives up

- **Id-based deep linking into the editor surface is foreclosed.** There is no
  longer any stable, addressable identity on a WYSIWYG heading that outside code
  can target. A future "link to this heading in the editor" feature cannot be
  built on ids and will need its own mechanism. Export anchors are unaffected —
  they are a separate face with their own contract.
- **We take on a correspondence assumption about two parsers.** Tier 1 is
  correct only while our Lezer parser and Milkdown's remark parse produce the
  same heading *sequence*. Known breakers: `> #⇥Title` (Milkdown renders it, our
  parser misses it), raw HTML `<h2>` in source, and future Lezer-vs-CommonMark
  drift. Blockquote and list-item headings, setext headings, and `#` inside
  fenced code are **not** breakers — our parser handles all three and Milkdown
  agrees.
- **Tier 2 carries its own limit.** Heading text is not inline-markup-stripped,
  so `## [x](url) tail` yields literal source text that can never text-match
  Milkdown's rendered `x tail`. That entry simply does not resolve.
- The cost of both is a **no-op — never a wrong target.** That is the deliberate
  trade: a dead click is visible to the user and reportable; scrolling silently
  to the wrong heading is neither.
- **Resolution is recomputed on every navigation and every observe pass**
  instead of being cached. This is a real cost, accepted because P2 makes any
  cached DOM address a lie the moment the editor dispatches its next
  id-rewriting transaction.

### What it buys

- Duplicate headings navigate and highlight independently — the defect is gone
  at its root rather than patched at the `break`.
- Resolution is **byte-identical** whether DOM ids are absent, duplicated,
  Milkdown-shaped, or Milkdown-deduped. This is executable, not aspirational:
  `tests/toc-element-resolution.test.ts` runs one fixture four ways.
- Milkdown's id namespace becomes **unowned**. Their patch releases can change
  the suffix scheme freely and nothing in mdpro notices.

### The failure condition that outlives this record

**If any editor-surface code begins reading or writing heading DOM ids, this
decision is revisited.** That is the precondition the whole design rests on;
once something reads those ids, the correctness dependency on a third party's
undocumented generator is back, and the reasoning above has to be re-run rather
than assumed.

### Not decided here

Whether the Milkdown face should ever join the slug-parity corpus. It is
deliberately excluded today: mdpro neither produces nor consumes it, and pinning
a third party's output with no product contract behind it would break on their
patch releases for no behavioural reason.
