# 0046. Source-mode table Tab swallows the key when it owns it but cannot navigate

**Status**: Proposed (2026-10-02). Acceptance requires the D41 device re-check
of Tab / Shift-Tab in Source mode (sequencing doc, D41 row).

## Context

D40 put the table Tab keymap at `Prec.high`. Its decision A also set the
fallback: whenever `tableTabCommand` returned `false`, the default
`indentWithTab` ran. In practice that fallback covered more than "not in a
table". It also ran when the cursor was in a table but navigation could not
happen: on the delimiter row, on Shift-Tab in the first header cell, when the
write guard refused, and when the selection had ranges in both a table and
prose. In each of those cases Tab inserted an indent into a table row. That
breaks the row's pipe alignment, and for a header or delimiter row it can stop
the table being recognised as a table. D41 recorded this on device as part of
the "Source Tab gaps".

Things we knew at the time:

- In the mounted editor `indentWithTab` always returns `true`. A test can
  therefore only tell "swallowed" from "fell through" by checking the
  document and the selection, not the command's return value.
- ADR-0043 caps the cost of cursor-context work. Nothing on the key path may
  copy the document (`doc.toString`, `sliceDoc`, `sliceString(0, len)`,
  `toJSON`). Cost is counted in calls, not milliseconds (E39).
- `getTableContext` describes only the main cursor. It cannot answer whether
  *any* range touches a table.
- The table walker requires a header to be the first line of its maximal run
  of candidate lines. A table directly under a `p | q` paragraph line is not
  detected, even though GFM renders it as a table.

## Decision

1. **Ownership is decided per key press, line by line.** A new classifier
   (`sourceTableTabOwnership.ts`) looks at the lines each selection range
   covers. It uses the real `doc.lineAt`, not ADR-0043's `lineIndexAt`, so a
   cursor at column 0 belongs to its own line. Fenced lines count as prose.
   The walker runs once per maximal candidate run. It does not run once per
   range.
2. **If no range touches a table, the key falls through to the default
   indent.** That covers prose, fenced code, and documents withheld from
   detection.
3. **If any range touches a table and navigation cannot happen, the key is
   swallowed.** The handler returns `true` and changes neither the document
   nor the selection. When more than one reason applies, the first in this
   order wins: multi-table > mixed-selection > delimiter-row > guard-refused >
   first-cell. Shape (multi-table, mixed) is checked before the cursor's row
   and the guard.
4. **Each swallow logs `ui.table.tab_swallowed`** at level `info`, with
   `{controlId: "source.tab_nav", key, reason, ranges}` and no document text.
5. This **amends D40 decision A**: the fallback to the default indent now
   applies only to case 2. It **narrows ADR-0043's column-0 remark** without
   superseding it. The cursor context keeps raw `lineIndexAt`. Only the Tab
   ownership check uses `lineAt`. The `getTableContext` field is unchanged.

## Consequences

- A table row can no longer pick up an indent through Tab or Shift-Tab, as
  long as the table is detected.
- Every swallow is visible in `~/.mdpro/mdpro.log`, so a user report of "Tab
  did nothing" can be traced to its reason.
- **Cost: Tab sometimes does nothing.** Shift-Tab in the first header cell,
  Tab on the delimiter row, and a selection that spans a table and prose are
  now silent no-ops apart from the log line. Before this change they indented
  the text. A user who wanted to indent prose next to a table has to narrow
  the selection first. ⌘A then Tab in a document that contains a table does
  nothing.
- **Residual: withheld documents still indent table rows.** A document that
  is too large for detection gets no ownership check, so Tab falls through
  and indents table rows exactly as before D41.
- **Residual: a table directly under a paragraph line is not owned.** The
  walker does not detect it, so Tab indents its rows, even though GFM renders
  it as a table. Fixing this means changing the walker's
  header-must-start-the-run rule, which ADR-0043's span reuse depends on. That
  is out of scope here.
- Each key press does one extra pass over the lines the selection covers, plus
  one walk per candidate run it touches. The cost grows with the selection,
  not with the document. The ADR-0043 copy bans still hold and are pinned by
  count tests.
- Two code paths now answer "is this a table?": the cursor context and the
  Tab ownership check. They differ on purpose at column 0, and a later change
  to one has to check the other.
