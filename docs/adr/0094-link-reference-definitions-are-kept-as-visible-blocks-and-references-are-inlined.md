# 0094. Link reference definitions are kept as visible blocks, and references are inlined

**Status**: Accepted (2026-10-14). Decided by the user, answering the delegator's questions: fix form 「B: keep definitions (Recommended)」, display 「Visible muted block (Recommended)」. Implementation is [D194](../plans/20260912-frontend-backend-sequencing-order.md#d194) (mdpro-a6), a v0.3.2 gate item. Keeping the reference style (option A) is deferred to [D197](../plans/20260912-frontend-backend-sequencing-order.md#d197).

## Context

`@milkdown/preset-commonmark@7.18.0` always registers `remarkInlineLinkPlugin`
(`src/plugin/remark-inline-link-plugin.ts:7-10`, `src/composed/plugins.ts:27`),
which wraps `remark-inline-links@7.0.0` with no options. On load it splices
**every** `definition` out of the tree, used or not (`lib/index.js:27-34`), and
replaces each resolved `linkReference` / `imageReference` with an inline link or
image (`:36-50`). The editor schema has no node for a definition, and the link
mark keeps only `href` and `title`.

Forces, as understood at the time:

- Opening a file writes nothing (edit-sync baseline), but the first edit anywhere
  serializes the document without its definitions, and ⌘S writes that. An
  unused definition's URL and title are gone with no prompt and no log line; a
  used one survives only as an inline link. mdpro-a6 measured both in the real
  app editor, in paragraphs, quotes and list items (D194 row).
- Dropping the plugin alone does not work: `@milkdown/transformer`'s parser
  throws `parserMatchError` on an mdast node no schema entry matches
  (`parser/state.ts:76`), so the file would fail to load.
- GFM footnotes have their own nodes in preset-gfm and round-trip; only link
  and image references are affected.
- The D188 reader ([ADR-0091](0091-an-empty-wysiwyg-paragraph-is-saved-as-blank-lines-and-read-back-by-count.md))
  counts blank lines between positioned siblings; a definition that stays in the
  tree becomes such a sibling.
- v0.3.2 is the last release before development pauses; the fix has to close
  the loss at a cost that fits it.

## Options considered

- **A. Full round-trip.** A definition node plus `refType` / `label` on the link
  mark and the image node, so `[text][label]` is written back in its original
  style while its definition exists. Nothing on disk changes on an edited save.
  Lost: about twice the work of B (link popover, click guard, image node,
  serializer), and v0.3.2 cannot carry it. Not refused: it is **D197**, and it
  builds on B's node.
- **B. Keep definitions, inline references.** A `link_definition` block node
  holding the definition's exact source text, written back verbatim; references
  are resolved by mdpro's own resolver (case-insensitive label, first definition
  wins) and inlined as today. **Chosen.**
- **C. Splice the raw text back on write.** No schema change: remember each
  definition's source and the block after it, and reinsert on serialize. Lost:
  the anchor breaks when blocks move or are deleted, under undo, and under an
  MCP `write_document`; references are still inlined.

How a kept definition shows in WYSIWYG:

- **(i) A visible, muted, monospace block** showing `[r]: http://x "T"`, not
  editable inline, selectable as a node and deletable. **Chosen.**
- **(ii) A hidden block.** Lost: content the user cannot see cannot be removed
  on purpose, and is easy to delete by accident inside a larger selection.

## Decision

1. The preset's `remarkInlineLinkPlugin` is replaced by mdpro's own transformer,
   in the same way as ADR-0091's reader. It inlines resolved references with
   case-insensitive matching (first definition wins) and keeps each `definition`
   in place.
2. A `link_definition` block atom holds `identifier`, `label`, `url`, `title` and
   `raw`, the exact source text. It is serialized as `raw`, so the spelling,
   spacing, brackets and quotes are kept. Consecutive definitions join with
   a single newline, not a blank line.
3. It renders as a muted monospace block with the raw text, with
   `contenteditable="false"`, and is deleted like any other node.
4. A definition is a positioned sibling for the D188 reader, so blank lines next
   to it count as gaps. Two D188 rows that pinned the old loss (B7, B7b) change
   with this decision.

## Consequences

- An edited save no longer loses definitions, used or unused, in the document,
  in quotes or in list items.
- **Style change, accepted**: after an edit, `[docs][r]` is written as
  `[docs](http://x)` while `[r]: http://x` stays. The file keeps every URL but
  no longer uses the reference. Keeping the style is D197, deferred past v0.3.2.
- A file with reference links shows each definition as a visible block in
  WYSIWYG where it used to show nothing.
- A definition cannot be edited inline in WYSIWYG. The user can only delete it,
  or change it in Source mode.
- mdpro owns a second remark transformer in place of a preset plugin. A Milkdown
  upgrade must keep the swap or re-apply it.
- An undefined reference such as `[docs][nope]` is still written escaped
  (`\[docs]\[nope]`): the text survives, the bytes change. That is noted in the
  D194 row and not fixed here.
