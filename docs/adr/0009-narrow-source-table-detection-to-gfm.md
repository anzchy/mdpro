# 0009. Narrow Source-mode table detection to GFM on three over-detected shapes

**Status**: Accepted — 2026-09-18. Builds on
[ADR-0008](./0008-non-candidate-delimiter-class-measured-against-gfm.md), which
recorded this defect and left it unowned. ADR-0008's Decision is not reopened.

**Partially superseded — 2026-09-18.** The claim in "What is deliberately not
decided here" that under-detection *"cannot cause a bad write"* is **withdrawn**
by [ADR-0013](./0013-under-detection-shifts-table-ordinals.md): a missed table
shifts every later ordinal, and MCP/HTTP table actions address tables by ordinal.
Decision points 1–3 below stand unchanged. Do not cite this record as authority
for a missed table being write-safe. This Status block is the only part of this
ADR that has been edited — the body below is the 2026-09-18 record as written.

## Context

ADR-0008 closed with "a new defect is on record with no owner and no plan":
mdpro's Source-mode detector reports tables where the GFM reference parser
reports none. It named two shapes and three read-only surfaces, and rated
nothing. That rating was the gap — it was measured on 2026-09-17/18 and written
up in `docs/plans/20260917-plan-table-over-detection-vs-gfm.md`.

**There are three shapes, not two.** `countLeadingSpaces` counted only U+0020, so
a **tab**-indented delimiter — or header — measured indent 0 and escaped
`MAX_INDENT` entirely. ADR-0008's proposed fix would not have caught it, because
`.trim()` eats tabs before the check it proposed. Shape 1 (`---` under a
single-column header) also only diverges when the header has one column; with two
or more, mdpro and GFM already agree at zero.

**The severity is BLOCK, not a read-only annoyance.** ADR-0008 listed three
surfaces, all read-only, and omitted every write path. Reproduced by running the
shipped code:

```
"Intro\n\n| a |\n---\n\n| x | y |\n| - | - |\n| 1 | 2 |\n"
  findAllTables      -> 2 models: [7,16] (phantom) and [18,47] (the real table)
  applyMcpTableAction(doc, "delete_row", {tableIndex: 0, index: 0})
                     -> "Intro\n\n\n\n| x | y |\n| - | - |\n| 1 | 2 |\n"
```

The setext heading is destroyed and the real table is untouched. GFM sees **one**
table in that document, so a client that counts correctly and asks for table `0`
means the real one. The Rust HTTP layer returns `202` at `http_server.rs:834`
*before* the frontend applies anything, so neither the client nor the user is told
otherwise. Data loss, silent failure — two of rule 60's three BLOCK keywords. The
same indices reach `formatAllTables` (auto-reformat on save), the Source context
menu, and Tab navigation.

## Decision

**Narrow detection to agree with GFM on these three shapes**, accepting that it
changes what the app calls a table:

1. A delimiter line that is also a valid setext heading underline loses to
   setext, as it does in GFM. One guard in `parse.ts`, after the delimiter check.
2. Indentation is measured in **CommonMark columns** (a tab advances to the next
   multiple of 4) and measured **before** trimming, on the header *and* the
   delimiter, so 4+ columns is a paragraph either way.
3. The two notions of leading whitespace are separated into
   `src/utils/tableParser/commonmark.ts`: `countIndentColumns` for the block
   rules above, `countLeadingSpaces` for `parseRowCells`' `baseOffset`, which
   must stay a **character** count or every cell offset in a tab-indented row
   shifts. They are one swap apart and now carry the warning saying so.

**What is deliberately not decided here.** mdpro also *under*-detects: GFM
interrupts a paragraph with a table, mdpro does not. Positional agreement over
the measured corpus goes from 40/74 to 44/74 — this fix moves mdpro toward GFM
but nowhere near parity, and under-detection is the larger remaining half. It
cannot cause a bad write (you cannot edit a table you never enumerated), so it is
recorded, not fixed. `NARROW-underdetection-remains` pins two of those misses on
purpose, so the new test file cannot be misread as a parity claim.

## Consequences

- **Phantom tables become no table at all, and that is user-visible.** In a
  document containing `| a |` over `---`, the Source context menu now offers
  nothing there, no column-count diagnostic appears, the cell highlight is gone,
  and Tab no longer navigates. Anyone using that shape as a one-column table
  loses an editing affordance they had. This is the intended trade: GFM renders
  it as an `<h2>`, and mdpro's own WYSIWYG surface already did — the Source side
  was the one lying.
- **A red receipt was deliberately broken.** 64 recorded lines in
  `tests/table-scan-enumeration.test.ts` changed under receipt `TS-WI-3`
  (`SEPARATION-BROKEN`, authorised before dispatch). `SCAN-oracle` could not be
  left as "identical to the legacy scanner on all 200 documents" once the legacy
  scanner is known wrong; it is re-scoped to *exact identity outside the class,
  and only phantom removal inside it*, with the divergent indices, the dropped
  count, and `invented === []` all pinned by literal. Re-scoping an oracle is
  the expensive half of this change and the part most worth re-reading.
- **Removing a phantom can uncover a real table.** Fixture F4's span went
  `[[0,19]]` → `[[8,19]]`, not → `[]`: the phantom had been swallowing a genuine
  table that starts inside it. Narrowing is not monotonic in table count.
- **ADR-0007's fixtures now yield zero tables.** F1, F2 and F3 are all built from
  shapes 1 and 2, so the overlap class ADR-0007 legislated about is now
  unreachable by a second, independent route. ADR-0007's resume rule still
  stands and is still load-bearing for other inputs; the class it governs has
  shrunk again.
- **The MCP client still cannot tell.** The Rust `202`-before-apply contract is
  untouched by this change, so a table index that no longer exists fails
  frontend-side and returns success to the caller. That contract needs its own
  decision; refusals are logged to `~/.mdpro/mdpro.log` so they are at least
  diagnosable.
- **Legacy behaviour was kept as evidence, not deleted.** `LEGACY_SPANS` holds
  what the old scanner emitted for each re-pinned fixture, so the diff between
  the two is readable in the test rather than only in this record.
