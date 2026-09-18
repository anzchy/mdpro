# 0012. Extract TOC headings with the existing Lezer parser, and refuse the remark dependency

## Status

Accepted — 2026-09-18

## Context

Stage 3 row 3.3 of `docs/plans/20260912-frontend-backend-sequencing-order.md` is
written as "replace the hand-rolled heading parser with remark", and it opens with
a required standalone `chore(deps)` commit adding `unified`, `remark-parse` and
`remark-gfm`. Gate G0 for this effort states 「无新依赖」, so the row could not start
without a decision on that gate.

**What the hand-rolled parser gets wrong.** `parseHeadingsFromContent`
(`src/services/tocService.ts:49-94`) matches ATX headings with a line regex over
`stripped.split(/\r?\n/)`. Five fixture cases in
`tests/render-fixtures/heading-identity.json` are pinned to its measured output:

| case | owner | measured today | correct |
|---|---|---|---|
| `fenced-hash` | 3.3 | `["not-a-heading"]` | `[]` — a `#` inside a fenced block is not a heading |
| `setext-noncolliding` | 3.3 | `[]` | `["alpha"]` — setext headings are not matched at all |
| `setext-title` | 3.3 | `[]` | `["title"]` |
| `crlf-doc` | 3.4 | offset `5` | `6` |
| `crlf-two-lines` | 3.4 | offset `4` | `6` — the error accumulates per CRLF line |

The offset defects have one cause: `offset += line.length + 1` (`:90`) assumes a
one-character terminator, but `/\r?\n/` consumed two.

**The case for remark.** All three packages are already in the pnpm store as
`@milkdown/kit` transitives at `unified@11.0.5`, `remark-parse@11.0.0`,
`remark-gfm@4.0.1` — verified on disk under `node_modules/.pnpm`. Pinning those
exact versions downloads nothing and yields a single shared instance. It is also
the parser Milkdown already uses for WYSIWYG, so the TOC face and the editor face
would agree by construction.

**What that argument leaves out.** "Downloads nothing" is not "adds nothing".
Three entries enter `package.json` and the lockfile's `importers` section, which
is the category of change G0 exists to freeze, and they must then be kept in
lockstep with whatever `@milkdown/kit` resolves on its next bump — the moment the
two ranges diverge, pnpm installs two copies and the single-instance property
quietly disappears. [ADR-0006](./0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)
granted the only existing G0 exception and its decision point 2 refuses to
generalize: "Another bump needs its own justification; '0006 did it' is not one."

**The alternative nobody had costed.** `@codemirror/lang-markdown` is *already* a
direct dependency (`package.json`, `^6.2.5`). It exports `markdownLanguage`, whose
`.parser` is a Lezer markdown parser that runs headlessly on a plain string — no
`EditorState`, no DOM. It is already parsing this same content in Source mode for
syntax highlighting, so it is already in the bundle and already resident at runtime.

Measured 2026-09-18 against the fixture cases above, walking `ATXHeading1-6` and
`SetextHeading1-2` nodes and deriving heading text by subtracting the `HeaderMark`
children from the node range:

- `fenced-hash` → `[]`; `setext-noncolliding` → `Alpha`; `setext-title` → `Title`
  — all three 3.3 pins produce the **expected** answer.
- `crlf-doc` → offset `6`; `crlf-two-lines` → offset `6`; `lf-two-lines` → `4`
  unchanged — both 3.4 pins produce the **expected** answer, because a Lezer node's
  `from` is a UTF-16 index into the source string and therefore counts the `\r`.
- `# Title ###` → `Title` (trailing hashes stripped) and `#### 标题 🎉` parses
  correctly, so CJK and astral-plane text need no special handling.

## Decision

1. **Use `markdownLanguage.parser` from `@codemirror/lang-markdown` as the heading
   parser for the TOC face.** Heading text is the node range minus its `HeaderMark`
   children; position is the node's `from`, which is already the UTF-16 offset the
   three-concept model in `src/types/toc.ts` calls `offsetUtf16`.
2. **Refuse the remark dependency.** No G0 exception is requested, because none is
   needed. Row 3.3's "replace with remark" wording is superseded by this record.
3. **Merge rows 3.3 and 3.4 into one work item.** They were separate only because
   they had different fixes; one parser swap unpins all five faces, and splitting
   the change would mean landing a parser that fixes offsets while deliberately not
   unpinning the offset faces.
4. **Do not build the bespoke line/terminator mapper** that the WI-3.4 plan
   specified as `src/utils/headingPosition.ts`. It would be dead on arrival. The
   position *laws* that plan specified (offset round-trip, offset/line agreement,
   the CRLF metamorphic law, monotonicity) are kept — they are written against
   `parseHeadingsFromContent`'s output, not its internals, and survive the swap as
   the acceptance harness.

## Consequences

**The TOC face now uses a third parser.** The repository parses Markdown with
pulldown-cmark (Rust, canonical export), remark/micromark (Milkdown WYSIWYG), and
now Lezer (TOC, and already Source-mode highlighting). These can disagree at
CommonMark edges. The mitigation is the one already built: the shared fixture
corpus pins per-face output, so a divergence shows up as a failing face rather
than as a silent inconsistency. It is a real cost, not a hypothetical one — the
remark option was the only one that would have *reduced* the parser count.

**Lezer's markdown parser is not a CommonMark reference implementation.** It is
written for incremental editor highlighting, and its extension set is chosen by
`@codemirror/lang-markdown`, not by us. A minor bump of that package could change
which constructs `markdownLanguage` recognises, and **nothing in the build would
flag it** — only the corpus would, and only for shapes the corpus contains. The
evidence for this decision is eight fixture cases, not a specification audit.

**The TOC parser is now coupled to the Source-mode editor's dependency.** If
CodeMirror is ever replaced, the TOC parser leaves with it, and the remark option
reappears at that point with its cost unpaid. Recorded so that swap is understood
as touching two features, not one.

**Heading-text extraction is our code, not the library's.** Lezer gives a tree,
not a heading list; the `HeaderMark`-subtraction step is ours to get right and to
test. remark would have handed back an AST with the text already assembled.

**What it buys.** G0 stays intact with no exception and no precedent to point at.
Two sequencing rows collapse to one, a planned new module is never written, and
the five pinned defects are fixed by deleting code rather than adding a
dependency, a mapper, and a lockfile change.

**Related:** [ADR-0006](./0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)
(the only other G0 dependency decision, and the one this record declines to lean
on); [ADR-0004](./0004-gate2-waiver-for-stage3-entry.md); rows 3.3 and 3.4 of
`docs/plans/20260912-frontend-backend-sequencing-order.md`, which this record
corrects.
