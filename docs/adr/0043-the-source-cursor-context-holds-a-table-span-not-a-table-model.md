# 0043. The Source cursor context holds a table span, not a table model

**Status**: Proposed (2026-09-30). Revised the same day after an adversarial
review by Claude (Opus). Codex was unreachable, so this was not a Codex review.
The review added the raw-`lineIndexAt` reuse rule and the shared line source
to Decision 4, and the rejected-alternatives list.

## Context

D12: in Source mode every cursor move builds an object graph for the whole
table. ADR-0022 Context 2 measured it: 931,924 cells and 139,037,640 B retained
per move on a 232,981-row table, growing linearly at 129 B per cell. ADR-0022's
guard removes the table extensions above 50,000 rows. That limits the damage but
doesn't fix it: at the threshold a move still costs about 30.0 MB.

Re-reading the code on 2026-09-30 showed these forces:

1. **One consumer per move, not four.** `tableContextField`
   (`sourceTableDetection.ts:63-77`) re-parses on `docChanged || selection`. On
   each move, the only reader of the result is `computeCellHighlightDecorations`
   (`sourceTableCellHighlight.ts:35-45`). It calls `findCell`
   (`find.ts:18-23`), which does a linear scan of `model.cells`, and it uses one
   cell. Tab nav reads the field only when Tab is pressed. The context menu parses
   its own model on each right-click. `cursorSync/table.ts` never reads the field;
   it calls `scanTables` when the mode toggles. The D12 row says that fixing this
   "changes the `TableModel` contract shared by find.ts / TabNav / ContextMenu /
   cursorSync". That overstates it. Only the field's value has to change.
   `TableModel` can stay as it is for every consumer that needs a whole table.
2. **Dropping `cells` alone doesn't give O(1).** The walk in `parseTableAtLine`
   up to the header and down to the last row fetches every line of the table on
   every move. Each fetch is a `LineRange` plus a text slice from the rope, and
   `rowLines` holds all of them until the call returns. Most of the difference
   between the "parse only" and "production path" figures (18.6 MB) is this
   walk's line cache. If the field kept only a span but still re-walked on every
   move, retained memory would go down while the transient allocation, the GC
   pressure and the O(rows) time would stay.
3. **The walk depends on where it starts.** A single-column table can spell its
   delimiter `:-:` with no pipe. `tableWriteGuard.ts` keeps this case (shape A1).
   That delimiter isn't a candidate line, so an upward walk that starts in a body
   row stops below it. Today that returns `null` or a different table, not the
   table found from the header. So "the cursor is still inside last move's span"
   does not always mean "a re-parse would return the same span".
4. **Tab has the same cost at a lower rate.** `tableTabCommand` runs
   `guardTableWrite(ctx)`. `modelLines` in the guard reads `raw`, which copies
   the whole table and splits it into one string per row, on every Tab. Tab
   happens once per press, not once per move, and the guard is WI-C0's
   write-boundary backstop.
5. **The evidence is counts and heap bytes, not milliseconds** (E39/G0).
   `tests/source-table-extensions.test.ts` X4 checks that exactly 20 parses run
   for 20 selection transactions. That assertion describes the defect: it proves
   the field is installed by checking that it pays the cost.

## Decision

1. **Add a `TableSpan` type and store it in the field instead of a
   `TableModel`.** It holds `{ start, end, headerLine, lastLine, rowCount,
   colCount, alignments, delimiterIsCandidate }`: numbers, one small array and a
   flag. It has no cells, no rows, no `raw` and no reference to the line source.
   `getTableContext` returns `TableSpan | null`. A new `getActiveTableCell(state)`
   returns the one `TableCell` under `selection.main.head`, or `null`. The field stores both
   values. The types now show the cost: code holding a `TableSpan` can't read
   `.cells`, so it can't bring the whole-table graph back onto the per-move path
   without a compile error. That is the D13 regression class (a lazy field that
   someone forces) moved from runtime to the type checker.
2. **Keep one algorithm and add a second output.** `parseTableAtLine` is split
   into an internal walker that takes an optional row collector, and two
   adapters: `locateTableAtLine` / `locateTableAtOffset`, which collect nothing,
   and `parseTableAtLine`, which collects rows as it does today. Guard order,
   refusal conditions and the D13 `line()` budget of 2R + 5 stay the same.
   `parseRowCells` moves to its own module so both adapters can use it.
   `parse.ts` is 299 lines and cannot take new code (rule 50 §6).
3. **Look up the active cell from the cursor's row only.** `cellAtOffset(src,
   span, offset)` parses only the cursor's line. The header row is row 0, the
   delimiter row returns `null`, and a body line maps to row `line − headerLine −
   1`. The line that owns the cursor is not always `lineIndexAt(offset)`.
   `lineIndexAt` maps column 0 of a line to the line *above*. Checked on
   2026-09-30: in `a | b\n- | -\nc | d`, offset 12 resolves to the delimiter
   line, but `findCell` returns the `c` cell on row 1. The rule is: when
   `offset > line(i).end`, the owning row is `i + 1`. This still parses exactly
   one row. On every offset of every test corpus, and on explicit fixtures of
   tables without edge pipes (the seeded corpus doesn't produce any), its result
   must `deep-equal` `findCell(parseTableAtOffset(src, offset), offset)`.
   A `null` span gives `null`.
4. **Reuse the span on a selection-only transaction when the result is
   provably the same.** Reuse requires `!docChanged`, a non-null previous span,
   `delimiterIsCandidate`, and `lineIndexAt(selection.main.head)` in
   `[headerLine, lastLine]`. That line index comes from the **raw**
   `lineIndexAt`, the same resolution `parseTableAtOffset` uses. It is
   **never** the adjusted owning-row rule from Decision 3. Consider column 0 of
   a header whose line above is not a candidate line. Raw resolution lands on
   that line above, and today's parse returns `null` there. The adjusted rule
   would land on the header, reuse the span and produce a non-null context, and
   Tab would then take over a key it should leave alone. When the raw line is in
   the span, `parseTableAtOffset` would start its walk from that same line. The
   upward walk from any line in the span stops at `headerLine` (Context 3), so
   the reused span is the span a re-parse would return. The reuse check and
   `cellAtOffset` share **one** `linesFromText` source per update. The
   adapter's `lineIndexAt` fetches `line(i − 1)` internally, and sharing the
   source means the cell lookup finds that line in the cache instead of
   fetching it again. The fence check still runs on every move;
   it's a syntax-tree lookup whose cost doesn't depend on table size. A
   pipe-less single-column table always re-locates and behaves exactly as it
   does today. The field's value is recomputed on every doc change, so a cached
   value always belongs to the current `Text`. The header's rule, "a cache keyed
   on anything but the exact `Text` instance would retain superseded document
   states", still holds.
5. **Materialise the full model only on user actions.** Tab / Shift-Tab and the
   context menu call `parseTableAtOffset` themselves when the user acts. Their
   logic, the write guard and its WI-C0 "false affordance" rule don't change.
   `TableModel`, `findCell`, `findCellOrNearest`, `scanTables`, serialize,
   edits, MCP and cursor sync don't change.
6. **ADR-0022's guard and its 50,000-row threshold stay.** This ADR doesn't
   decide whether to relax them. A later ADR can do that, based on the counts
   this fix produces.

### Alternatives rejected

- **Index `model.cells`** (binary search in `findCell`). Lookups get faster,
  but the whole-table allocation on every move stays. It doesn't address D12.
- **Lazy memoized `cells` / `rows` getters on `TableModel`** (the D11 pattern).
  Reading `.cells`, spreading the model or passing it to `JSON.stringify` would
  silently bring the cost back. That is the D13 failure mode, and the type
  checker can't see it.
- **Keep a `TableModel` in the field, reuse it on selection-only transactions,
  and look cells up via `rows[line − headerLine − 1]`.** This is the smallest
  diff. Its costs: every keystroke still builds the full cell graph, and the
  whole model stays in memory for as long as the cursor is in the table (about
  30 MB at 50,000 rows). It fixes arrow keys and leaves typing, which is the
  more frequent event, as bad as it is today.
- **Store a span but re-locate on every move.** Retained memory drops, but the
  O(rows) walk and its transient allocation stay on every arrow key
  (Context 2).

## Consequences

- A cursor move within a table reads O(1) lines: the cursor's line plus
  `lineIndexAt`. It holds one span and at most one `TableCell`, whatever the
  table size. Tests check this with counts and retained bytes.
- **Typing is not fixed.** On `docChanged` the field re-locates, which walks
  O(rows) lines with transient allocation. It no longer keeps a cell graph, but
  a keystroke in row 200,000 of a 232,981-row table still reads every row. An
  incremental re-locate that maps the span through the change is left for later.
  It's a separate correctness problem: an edit can add a pipe to the line below
  the table or remove the delimiter.
- **Tab now pays for its own parse.** Before this change the field had already
  built the model, so Tab paid only the guard's `raw` copy. After it, Tab also
  pays a full parse. The per-move cost becomes a per-Tab cost. That's a much
  lower rate but no smaller for each event. The guard's split of `raw` into one
  string per row is unchanged. Making the guard walk rows directly (as D13 did
  for the linter) is not part of this change.
- **The contract change is visible.** `getTableContext` changes its return
  type, so the Tab nav and cell highlight call sites and their tests need
  editing. The X4 assertion "exactly 20 parses" has to be rewritten. It becomes
  0 withheld and a small constant allowed, and the count moves from
  `parseTableAtOffset` to the locate function. This is a change to a pinned
  test, and the reason is recorded here: it pinned the defect.
- The field's span is cached across selection transactions. That is a new
  invariant: a later change must not add a reuse path that skips
  `delimiterIsCandidate` or runs on `docChanged`. The equivalence tests in
  Decision 3 and Decision 4 enforce it.
- Two table views now exist: `TableSpan`, which is cheap and positional, and
  `TableModel`, which holds every cell. There's more to learn, and someone can
  still pick the wrong one. The types make that choice explicit.
