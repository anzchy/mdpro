# 0022. Source mode gets its own guard, keyed on table-row density

## Status

**Proposed** (2026-09-22)

Extends [ADR-0016](./0016-large-document-guard-predicate-is-a-source-structure-score.md)
and [ADR-0019](./0019-large-document-guard-adds-a-longest-line-trigger.md) in the
same relationship 0019 has to 0016: every invariant 0016 Decision 1 freezes is
preserved. It supersedes neither.

Two of its four decisions can be implemented today. **Decision 3 (the threshold)
deliberately cannot**, and says so.

## Context

`decideLargeDocumentGuard` returns `{ action: "allow" }` before it reads
`content` at all when `viewMode !== "wysiwyg"`
(`src/utils/largeDocumentGuard.ts:260`). Source mode therefore has no criterion —
not a loose one, none. D6 has carried this as an open hole, and
`docs/test/20260921-d6-matrix-retest.md:117-119` states it plainly: the frozen
predicates act only at the WYSIWYG entry, and do nothing for a 9.96 MB document
opened in Source.

The reason it stayed open is that the evidence was withdrawn before it was
replaced. The one on-device Source measurement (153–183 s on
`dense-math.source.md`) was dominated by a quadratic line counter removed in
`3d37b86`, and §7.4 of that same retest withdraws the number without supplying
another: the gap became **unmeasured** rather than measured-and-small. Two
further costs on that surface have since been found and fixed — `tocService`'s
O(n²) (`3d37b86`) and `TableModel.raw`'s eager whole-table copy (D11,
`11b7dab`).

A code-level inventory of Source mode was taken on 2026-09-22. Three findings
bear on the criterion:

1. **A per-keystroke floor that mdpro does not own.** `@uiw/react-codemirror`
   calls `doc.toString()` unconditionally in its update listener
   (`useCodeMirror.js:76-78`) and again in its value-sync effect
   (`:153`), where it also compares two equal full-length strings. The
   `:153` call is evaluated *before* the typing latch is consulted, so the latch
   does not suppress it. On a 9.96 MB document that is two whole-document string
   materialisations plus one whole-document comparison per character typed. This
   is in the CodeMirror wrapper, so it is **specific to Source mode**, and it
   scales with characters only — no shape variable predicts it.

2. **A per-cursor-move object graph, measured.** `sourceTableDetection`'s
   `tableContextField` re-runs `parseTableAtOffset` on every transaction with
   `docChanged || selection` (`sourceTableDetection.ts:63-77`). On a synthetic
   document matching `large-table.source.md`'s shape (9,340,767 chars, 232,981
   rows) one call returns `cells.length` = **931,924** and allocates a measured
   **148.1 MB** of heap. D11 removed the string copy from this path; the object
   graph was never the same defect and is still there. It is not merely
   allocated — `findCell` linearly scans `model.cells` on every cursor move
   (`find.ts:19`, `sourceTableCellHighlight.ts:48-50`), so the array is
   *consumed*. This is recorded as **D12**.

3. **Most of the source editor is viewport-bounded, and that is the useful
   negative result.** `@codemirror/language` parses viewport-first under a
   budget, and the wysiwyg-decoration, focus, search and basic-setup extensions
   all iterate `visibleRanges` only. The whole-document costs are few and named:
   the two above, plus the table lint's `scanTables` walk 750 ms after mount
   (`lintTableColumnCount.ts:44-48`, never measured) and the TOC's headless
   parse 300 ms after mount (`tocService.ts:155-230`).

On fixture shape, the five `*.source.md` corpora are all ~9.96 MB, so **total
size cannot discriminate among them at all** — the spread is 470 bytes, 0.005%.
Line count and longest line discriminate strongly and orthogonally (4 to 637,941;
16 to 7,583,742). Table-row-start count discriminates perfectly and binarily:
232,982 for `large-table`, exactly 0 for the other four. Fenced-block count is
zero in all five, so no fence-based predictor can be fitted or falsified on this
corpus.

## Decision

1. **Source mode gets a criterion.** The `viewMode !== "wysiwyg"` early return at
   `largeDocumentGuard.ts:260` stops being an unconditional allow. The premise
   that made it defensible — ADR-0016 Decision 4's "Source is the cheap surface"
   — is narrower than it reads. It was established against the WYSIWYG *mount*
   cost, and it is correct there. It was never established against per-keystroke
   or per-cursor-move cost in Source, which is where findings 1 and 2 sit.

2. **The predictor is table-row-start count, as its own counter with its own
   threshold.** The existing forward pass already computes this quantity and
   throws it away: `largeDocumentGuard.ts:291-294` decrements `score` on exactly
   the condition "a pipe seen while still at line start". Promoting it to a third
   integer accumulator is one `let` and one `++`, so ADR-0016 Decision 1's
   invariants all hold — one forward pass, constant auxiliary space, no parsing,
   no tokenizer, counts compared to counts. ADR-0019 Decision 3 forbids folding
   counts into a composite score, and that is honoured: this is a third
   independent threshold, not a reweighting of the structure score.

   It is chosen over the alternatives on evidence: total length predicts finding
   1 but cannot be fitted on a corpus where it does not vary; heading count
   predicts the TOC cost but cannot be computed without a Markdown parsing rule,
   which Decision 1 forbids outright; fence count has no corpus support at all.
   Table-row density is the only variable that isolates finding 2, which is the
   only Source cost with a measured number behind it.

3. **The threshold is NOT set by this ADR.** ADR-0016 and 0019 both chose round
   numbers inside measured intervals and said so. There is no measured interval
   here: finding 2 has one point (148.1 MB at 232,981 rows) and finding 3's lint
   scan has none. Setting a number now would present a structural argument as a
   fitted one, which is the precise failure ADR-0016's own header warns about
   when it calls its five-point evidence "thin". The threshold is deferred to
   these counted observations, each an integer rather than a duration, per E39/G0:
   - `cells.length` and heap delta from `parseTableAtOffset` across all five
     corpora, extending the measurement above;
   - `line()` and `slice()` call counts for `columnCountDiagnosticsFromSource`
     across all five, using the counting-delegate pattern `CONF-scan-cost`
     already establishes;
   - the `doc.toString()` call count over 20 keystrokes, to settle whether
     finding 1 is per-keystroke in the running app or collapsed by batching.

4. **The degrade action is to drop the table extension set, not to switch
   modes.** ADR-0016 Decision 4's action — toast, then force Source — is
   unavailable by construction: a criterion that fires *in* Source cannot degrade
   to Source. The action is to withhold `tableDetectionExtension`,
   `cellHighlightPlugin`, `sourceTableTabNav`, `sourceTableContextMenu` and
   `tableColumnCountLinter`, leaving plain text editing intact. This maps exactly
   onto the predictor: every one of those extensions is a table-shaped cost, and
   the predictor counts table rows. New user-facing copy is required — ADR-0019
   Decision 5 notes the existing toast is trigger-agnostic, but it promises a
   mode switch that will not happen here.

## Consequences

**What this gives up.** A document above the threshold loses table awareness in
Source mode: no cell highlight, no Tab navigation between cells, no right-click
table menu, no column-count lint. That is a real feature regression on exactly
the documents most likely to be tables, and it is chosen over the alternative of
letting an arrow-key press allocate 148 MB. It also breaks cross-mode parity
(rule 30) for those documents by design — WYSIWYG will have already refused them
on the structure-score trigger, so the two surfaces disagree about what the
document is, and a user who cannot open it in WYSIWYG also cannot use tables in
Source.

**What it does not fix.** Finding 1 is untouched and is not gateable by any shape
variable, because it scales with characters and the corpus has no character-count
spread. It belongs to `@uiw/react-codemirror`, not to mdpro, and needs its own
work item — either bypassing the wrapper's value-sync or not passing `value` on
every keystroke. **Do not read this ADR as closing the Source-mode gap.** It
closes the table-shaped part of it.

**D12 is created, not solved.** Dropping the extensions above the threshold means
documents *below* it still pay the full `cells` array on every cursor move. The
underlying fix — resolving a cell from the cursor's own line rather than scanning
a materialised whole-table array — changes the `TableModel` contract that
`find.ts`, `sourceTableTabNav`, `sourceTableContextMenu` and `cursorSync/table`
all consume, and is a separate decision. A guard is a bound on the damage, not a
repair.

**Cost of the counter itself.** Source mode currently pays nothing for the guard,
because the early return precedes the scan. After Decision 1 it pays one forward
pass over the document — ~10M `charCodeAt` iterations on a 9.96 MB file, no
allocation. That is a new cost on the open path, incurred to avoid a much larger
one, and it should be stated rather than discovered.

**The corpus is the binding constraint on ever calibrating this.** Four of five
fixtures have zero table rows, so the predictor is validated by exactly one
fixture. Any threshold fitted on this corpus is fitted on a single point. Adding
table-shaped fixtures at several densities is a precondition for Decision 3, not
an improvement to it.

**Superseding this is cheap and expected.** Decision 3 is deliberately an empty
slot. Filling it should be a new ADR that supersedes this one, carrying the
measurements, rather than an edit here — this record's value is that it states
what was *not* known on 2026-09-22.
