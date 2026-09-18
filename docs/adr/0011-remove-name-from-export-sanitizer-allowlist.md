# 0011. Remove `name` from the export sanitizer attribute allowlist

## Status

Accepted — 2026-09-18 (Proposed — 2026-09-18)

Supersedes **ADR-0003 decision point 3 in part**: `ALLOWED_ATTR` only. Every other
part of [ADR-0003](./0003-export-fragment-sanitizer-scope.md) — points 1, 2 and 4,
and both of its load-bearing preconditions — stands unchanged. ADR-0003 is not
edited; it remains the record of why the earlier decision looked right at the time.

This had to be Accepted before WI-3.2 landed the `SANITIZE_DOM: false` flip, the
alternative being to hold the flip rather than land it alone — the flag and the
retained attribute are only dangerous together. Accepted 2026-09-18; WI-3.2's
batch B3 is thereby unblocked and the two land together.

## Context

ADR-0003 set `SANITIZE_DOM: false` on the export sanitizer and kept every other
DOMPurify restriction, including `ALLOWED_ATTR`. Its clobbering analysis
(ADR-0003 lines 73–77) reasoned that this is safe because "clobbering requires an
element to be **in a document tree** before it becomes a named property, and
`mathRender.ts:134`'s detached div is not."

That stated rule is correct. Its application was incomplete.

ADR-0003 was aware of **two** `DOMParser` post-processors — it names them at its
line 85 — and analyzed both, but only for **resource loads**, correctly concluding
that the URL and tag allowlist is what prevents those, not `SANITIZE_DOM`. The
*clobbering* test was applied only to `mathRender.ts:134`. It was never applied to
the second post-processor.

Applying it now:

- `src/services/highlightSyntax.ts:83` calls `DOMParser.parseFromString(...)` and
  then reads `doc.body` and calls `doc.createTreeWalker(...)`. `parseFromString`
  returns a real `Document`, and its content **is** in a document tree. This is
  the condition ADR-0003 named, and it is met.
- `src/services/exportService.ts` routes sanitizer output through that function on
  **both** export faces — the canonical Rust path (`:89`) and the `marked`
  fallback (`:105`).
- `src/services/sanitizerPolicy.ts:95` allowlists `name`, and `:81` allowlists
  `img`. Per the HTML Standard, a non-empty `name` on an `img` makes that element a
  supported property name of `Document`, and `Document` carries
  `[LegacyOverrideBuiltIns]`, so a named property shadows properties inherited
  through the prototype chain. `<img name="body">` can therefore shadow
  `doc.body`, and `<img name="createTreeWalker">` can shadow the method call.
  `document.location` is `[LegacyUnforgeable]` — an own property — and is **not**
  reachable this way; an earlier internal collision list overstated that.
- Reachability is gated: `renderHighlightSyntaxInHtml` returns early unless the
  HTML contains `==`. This narrows the window but does not close it, because the
  opened document controls whether `==` is present.
- `form`, `iframe`, `object` and `embed` — the other `Document` named-property
  elements — are **not** in the tag allowlist. `img` is the only open route.

Separately, this is a JS/Rust policy drift. `src-tauri/src/services/markdown.rs:374`
grants ammonia only `id`, `class`, `aria-label`, `aria-hidden` as generic
attributes; `name` is not among them. The JS allowlist is the more permissive of
the two. `tests/sanitizer-rust-js-parity.test.ts` asserts parity for `MATH_TAGS`,
`SVG_TAGS`, `SVG_ATTRS` and the URI scheme set — **not** for the base attribute
set, so this drift was structurally invisible to the test that exists to catch it.

## Decision

1. **Remove `name` from `BASE_ATTRS`** in `src/services/sanitizerPolicy.ts`.
2. **Pin it with a behavioural policy assertion**, not a source-text check: sanitize
   `<img name="body">`, `<img name="createTreeWalker">` and `<a name="legacy-anchor">`,
   parse the result, and assert `getAttribute("name") === null` on every element.
3. **Do not write the regression test as a clobbering reproduction.** jsdom 26 was
   measured on 2026-09-18 and does **not** implement `[LegacyOverrideBuiltIns]`
   named access on `Document`: across six probes, `doc.body` was never shadowed. A
   behavioural clobbering test would pass in the Vitest lane while the condition
   remained live in WKWebView — the worst possible outcome, a green test asserting
   nothing. A WKWebView probe is the only thing that could prove the defense, and
   WI-3.2 does **not** take on building a native test lane to get it.
4. Base-attribute parity between the JS and Rust allowlists is **not** adopted here.
   Recorded as a known gap, see Consequences.

## Consequences

**What this gives up.** `<a name="x">` legacy anchors no longer survive the JS
export sanitizer. The cost is smaller than it looks: the canonical Rust path
already strips `name`, so preservation was at most `marked`-fallback behaviour and
was never the shipped canonical result. `id="x"` is the supported form, and the
heading pipeline emits `id` already. No test and no renderer in the repo depends on
`name` surviving — verified 2026-09-18, zero matches for a `name=` attribute across
`sanitizer-policy`, `sanitizer-malicious-fixtures` and `render-golden`.

**What it does not fix — and this is the larger hole.** Removing `name` closes the
one reachable instance. It does **not** close the class. The parity test covers
three tag/attribute sets and the scheme set, but not `BASE_ATTRS`, so the next
attribute that drifts from ammonia will be just as invisible as this one was. A
`SVG_ATTRS`-style "JS ⊆ Rust" assertion is **not** a cheap add: `BASE_ATTRS` holds
21 attributes while ammonia's generic set holds 4, with the remainder granted
per-tag via `add_tag_attributes` or supplied by ammonia's defaults. An honest
assertion must compare against the union of those, which is a design task with its
own failure modes. Deferred deliberately, not overlooked.

**What stays load-bearing.** ADR-0003's two preconditions are unchanged and still
apply. The `form` exclusion in particular is now doing *more* work than before,
because it is one of the four remaining named-property elements this decision
relies on being absent from the allowlist.

**Process cost.** This record exists because ADR-0003 point 3 names `ALLOWED_ATTR`
literally. Removing `name` tightens rather than loosens, and is consistent with
point 3's security intent — but treating intent as permission to contradict the
written decision would make the immutability rule advisory. The cost of a short
superseding record is much lower than the cost of that precedent.
