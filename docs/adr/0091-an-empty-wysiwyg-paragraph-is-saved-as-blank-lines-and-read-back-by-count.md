# 0091. An empty WYSIWYG paragraph is saved as blank lines and read back by count

**Status**: Accepted (2026-10-13). Form decided by the user, answering the delegator's question after a Codex deliberation: 「E：原始空行 + 读回（Recommended）」. The counting convention and the evidence basis were set by the delegator from competitor research after the user cancelled a first-hand Typora run (「cancel 本机器typora实测，改为看看竞品(typora,marktext)是怎么处理的」). Implementation is [D188](../plans/20260912-frontend-backend-sequencing-order.md#d188) (mdpro-a6); [D192](../plans/20260912-frontend-backend-sequencing-order.md#d192) lands first and separately.

## Context

In WYSIWYG (⌃4) Enter after a paragraph makes an empty paragraph, as in
Typora. `@milkdown/preset-commonmark@7.18.0` writes that paragraph as a line
holding `<br />` (`lib/index.js:455-486`, `remarkPreserveEmptyLinePlugin`),
so Source mode (⌃2) and the saved file show a literal tag (issue #415). The
same preset's reader (`visitEmptyLine`, `lib/index.js:414-434`) deletes
every `<br>` html node wherever it sits, which also destroys inline `<br>`
in paragraphs, list items and table cells on load; that is D192, a data-loss
defect independent of the form chosen here.

Forces, as understood at the time:

- CommonMark has no empty paragraph: a run of blank lines is one separator
  (§4.9). Any persisted form is either content (`<br />`, `&nbsp;`) or a
  reader convention outside the spec.
- Opening a file must not dirty it. The edit-sync baseline (ADR-0067
  consequences) makes any new form apply on the first edit, never on open.
- Typora parity is the product goal (CLAUDE.md). Third-party test files and
  user reports agree that Typora writes an empty paragraph as **two extra
  newlines** (one empty paragraph between `A` and `B` is `A\n\n\n\nB`) and
  reads such runs back in pairs, dropping an odd leftover newline; Typora's
  own documentation says nothing either way. MarkText writes the same bytes
  but cannot read them back. Evidence:
  [`docs/reference/20261013-d188-empty-paragraph-competitors.md`](../reference/20261013-d188-empty-paragraph-competitors.md).
- With the preserve plugin removed, Milkdown's stock writer already emits
  exactly Typora's bytes (measured by mdpro-a6 on 7.18.0: one Enter gives
  `first\n\n\n\nsecond\n`, two give six newlines). Only the reader is missing.
- Every rendered view (HTML export, GitHub, Obsidian reading view) collapses
  blank-line runs. A `<br />` line shows as a gap in some of them and as
  literal text in renderers with HTML off.

## Options considered

- **A. Keep `<br />`** and record #415 as known behaviour. Zero code, lossless
  in mdpro, a visible gap on GitHub. Lost: it is the reported defect, Source
  mode keeps the tag, and renderers with HTML off print it.
- **B. Drop the preserve plugin only.** Writes Typora's bytes, but reopening
  loses every gap (measured: `a\n\n\n\nb` reopens as two paragraphs). Lost:
  the editor and the file disagree until reload; Codex judged shipping it
  alone a lossy release.
- **C. `&nbsp;` paragraph.** An entity is plain CommonMark and shows a gap in
  every renderer. Lost: entity noise in Source mode, a user's own `&nbsp;` is
  captured as an empty paragraph, and it is not what Typora writes.
- **D. Cap runs at one `<br />`.** Treats a symptom, breaks the Enter-several-
  times habit. Lost on both counts.
- **E. Raw blank lines written, read back by count** (Typora's convention).
  Clean source, Typora-compatible files, nothing mdpro-specific on disk.
  Costs below. **Chosen.**
- **F. Upgrade preset-commonmark to 7.22.x.** Fixes only the inline-`<br>`
  deletion (D192's reader) and still writes `<br />` for the last empty
  paragraph. Not a D188 fix; D192 backports the narrow reader instead.

Codex (gpt-6.1-sol, 2026-10-13) ranked E first and warned that it is a
defined editing convention, not a lossless encoding, with the edge cases
named below; mdpro-codex-audit's critique was that E's Typora claim was
unmeasured and that C keeps the visible gap elsewhere. The user chose E
after both were put to them.

## Decision

1. **Writer**: the stock remark-stringify output with
   `remarkPreserveEmptyLinePlugin` removed. Each empty paragraph between two
   blocks adds two newlines to the normal one-blank-line separator, so `n`
   empty paragraphs between `A` and `B` are written as `A` + `\n` × (2n+2) + `B`.
   Inside a blockquote the lines carry the marker as the stock writer emits
   them; inside a list item, the item's indent.
2. **Reader**: a remark transformer (replacing the preset's plugin under the
   same `$remark` id) that, for each pair of positioned siblings in `root`,
   `blockquote` and `listItem`, counts the blank lines `b` between them and
   inserts `floor((b − 1) / 2)` empty paragraphs. An odd leftover is ignored,
   so `A\n\n\nB` reopens with no gap, as in Typora.
3. **Edges**: an empty paragraph at the end of a container (document, list
   item, blockquote) is dropped on write, as today for `doc.lastChild`; the
   end-of-list-item versus after-the-list ambiguity is resolved by that rule.
   Table cells never hold an empty paragraph. A legacy `<br />`-only
   paragraph reads as an empty paragraph (D192's narrow reader) and is
   rewritten to blank lines on the first edit; opening alone writes nothing.
4. **Shipping**: writer and reader land in **one** D188 work item and one
   release. No B-only release. D192 lands first, on its own.
5. **Tests pin three properties separately**: structure on reopen,
   serialize → remount → serialize idempotence, and untouched open → save
   byte stability through the app save path (store text, clean state, bytes
   on disk). Real remounted editors, not detached docs. The input → bytes
   matrix from the Codex deliberation, adjusted to the convention above, is
   the WI's test matrix. The ledger's WYSIWYG row changes in the same commit.

## Consequences

- Source mode shows what a person would type, and files round-trip with
  Typora under the two-newline rule.
- HTML export, GitHub and Obsidian reading view show no gap. The gap exists
  only in WYSIWYG editors that use the same counting rule; MarkText and
  skysa-notes (one blank line per empty paragraph) do not.
- Every existing file with three or more blank lines between blocks now shows
  gaps in WYSIWYG. Idempotent and not dirtying on open, but visible.
- Trailing empty paragraphs are not persisted, and an odd blank line is
  silently dropped on the next save. Both are the convention's cost.
- mdpro owns a remark transformer in place of the preset's plugin. A later
  Milkdown upgrade must keep the `$remark` id contract or re-apply it.
- The Typora rule rests on third-party test files and user reports. If a
  first-hand Typora check contradicts the two-newline convention, a new ADR
  supersedes clause 1–2; the user's choice of form (E) stands.
