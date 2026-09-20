# 0016. The large-document guard judges a source-structure score, not bytes

**Status:** Accepted (2026-09-20)

_Proposed 2026-09-20; accepted the same day after the adversarial review recorded
in the Deliberation note below. Accepted records are immutable: changing any ruling
here requires a new ADR that supersedes this one._

Supersedes the D6 sub-decision in [ADR-0006](./0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)
§Decision 3 ("cost tracks cells in the largest single table"). ADR-0006 itself is
Accepted and unchanged.

## Context

The WYSIWYG guardrail degrades a document to Source mode above
`LARGE_DOCUMENT_THRESHOLD_BYTES = 500 * 1024`. ADR-0006 recorded that the
*mechanism* is verified effective but both the threshold and the judgement
variable are wrong, and froze the predicate pending a sweep on the real
WKWebView, because the prior measurements were V8/jsdom with no layout engine.

That sweep (D6.1) ran on 2026-09-20 — Apple M4 / 24 GB, macOS 26.3.1, WebKit
26.3.1, release bundle — and is recorded in
[`docs/plans/20260920-d61-wkwebview-sweep-record.md`](../plans/20260920-d61-wkwebview-sweep-record.md).
Two of its results decide this ADR.

**Bytes are refuted.** The five WYSIWYG fixtures are byte-matched to within 0.4%
(471,862-473,540 B on disk) and their WYSIWYG open cost spans three orders of
magnitude:

| fixture | disk bytes | lines | table cells | **lines + cells** | open ms | close ms |
|---|---|---|---|---|---|---|
| very-long-line | 471,862 | 3 | 0 | **3** | ~0 (below capture) | 5 |
| normal-prose | 473,540 | 2,574 | 0 | **2,574** | 256 | 10 |
| dense-math | 471,942 | 20,664 | 0 | **20,664** | 1,793 | 30 |
| many-short-nodes | 471,867 | 32,657 | 0 | **32,657** | 7,409 | 57 |
| large-table | 471,880 | 11,438 | 45,752 | **57,190** | 12,004 | 64 |

A 471,845-byte single line costs nothing; 472 KB spread over 32,657 short blocks
costs 7.4 s. The predicate cannot be a function of text volume alone. (Precisely:
bytes are refuted as a *sufficient discriminator*. Byte-matching the corpus was
deliberate and it also means this experiment cannot estimate whether bytes
contribute at larger scales.)

**Cells-in-the-largest-table are refuted as the *sole* variable.**
`many-short-nodes` has zero tables and zero cells and still pegged the CPU for
~7.4 s with ~7.2 s of input lag. ADR-0006's named variable scores that document
at 0 risk. The sweep record states this directly (cells alone are insufficient as
the risk variable) and recommends combining table scale with node/list structure.

`lines + cells` recovers a monotone ordering across all five fixtures (5/5 rank
agreement with measured open cost), and the dominant WebKit frame in both the
large-table open and the same-window switch is `JSC::JSObject::countElements`
(7,170-7,370 samples). That frame is JavaScriptCore counting occupied entries in
an object's indexed storage — **it is not counting Markdown nodes or DOM
elements**, and it is consistent with, but does not establish, a count-driven
cost. In particular it does not distinguish "a few scans of large collections"
from "repeated scans of a growing collection"; the latter would be quadratic in
structure even though this predicate grows linearly. Caller stacks and a
within-shape scaling sweep would separate the two, and neither was collected.

**The guard must not re-parse Markdown**, or it becomes the cost it exists to
prevent (plan M `:743-748`). This is the constraint that killed the obvious
implementation: `findAllTables` -> `scanTables` materialises every `TableCell`.

## Decision

1. **The judgement variable is a source-structure risk score**, computed today as
   `newline count + table-cell count`, where table cells are derived as
   `pipes - table-row-starts`. It is **a provisional proxy for risk, not a count
   of anything the editor actually builds** — see Consequences.

   **What this ADR freezes is the set of invariants, not the arithmetic:** one
   forward pass over `content`, constant auxiliary space, **no Markdown parsing
   and no tokenizer**, and a decision made by comparing counts only. D6.3(c) and
   later work may add or reweight counters within those invariants without
   superseding this ADR; changing the invariants requires a new one. Early exit
   once the score has irreversibly crossed the threshold is permitted.

   Measured cost of the current scan: **0.48-0.65 ms** on the 472 KB fixtures and
   **12.87 ms** on the 8.8 MB / 233k-line / 1.16M-pipe worst case — against the
   12,004 ms it exists to avoid. (Detecting a table-row start needs a little
   whitespace state, so the scan is not literally "compare two character codes";
   it remains single-pass and allocation-free.)
2. **The threshold is 25,000 structural elements.** The data locates the boundary
   only to the open interval **(20,664, 32,657)** — the largest relative cost jump
   in the sweep (1,793 ms -> 7,409 ms, 4.1x). 25,000 is a round number chosen
   inside that interval. **It is a choice within a measured interval, not a
   measurement.** The `<=` allow direction is retained.

   **The cell weight `k` is 1 by policy, not by measurement.** With only one table
   fixture, the five-point ranking constrains `k` merely to
   `11,438 + k*45,752 > 32,657`, i.e. **`k > 0.464`**; every larger weight
   preserves the same ordering. `k = 1` is chosen as the simplest default, and
   fitting a coefficient against four zero-cell fixtures would manufacture
   precision the data does not contain.
3. **Multi-table documents are counted as a whole-document total**, not the
   largest single table. `many-short-nodes` proves non-table structure carries
   cost, so a per-table maximum is not a sound accounting unit; and ten tables of
   5,000 cells cost like 50,000 cells, not 5,000. The single-pass scan produces a
   document total natively.
4. **The degrade action is unchanged: toast, then switch to Source mode.** D6.1
   re-confirms Source is the cheap surface. **The message text must change** — the
   current copy names "500KB", which this ADR makes false.
5. **`fileSize` is removed from the guard's input.** A structural predicate must
   read `content`; an on-disk byte count cannot answer the question at all. This
   dissolves open item (4) (stale on-disk `fileSize` beating live in-memory
   content) as a side effect rather than by a separate ruling: the stale number
   is no longer consulted. The characterization test `G15`, which pinned that
   behaviour as "recorded, not endorsed", is expected to flip.
6. **Open item (5) is resolved on the facts, and the answer is neither "one
   toast" nor "two".** The adjacent path at `App.tsx:503-509` is **unreachable**:
   `useDocument.ts:32` warns when `fileSize > 10*1024*1024`, `file.rs:16,162`
   rejects the open when `metadata.len() > 10*1024*1024`, and
   `document.rs:49` sets `file_size` from that same `metadata.len()`. Same
   constant, same strict `>`, Rust rejects first — the condition is never true for
   any document that successfully opens. There is no test covering it. It is dead
   code, and removing it is **not** authorised by this ADR; it is recorded here so
   the degrade-action ruling rests on the real fact rather than on a hypothetical
   second toast.
7. **No millisecond value in this ADR becomes a blocking gate** (E39 / G0). The
   times above are observations that justify a count-based threshold; the shipped
   predicate compares counts only.

## Consequences

**What this gives up.**

- **The threshold is fitted on five points, one per shape, all at ~472 KB.** No
  fixture exists at another byte size for these shapes, so the interaction between
  document size and structure is unmeasured. A document with 24,000 elements at
  5 MB is not covered by anything here.
- **`lines` is a proxy for block-level elements, not a node count**, and the
  proxy's accuracy is shape-dependent: `dense-math` and `normal-prose` both come
  out at exactly 2x their ProseMirror top-level child count (blank-line
  separation), while `many-short-nodes` reports one top-level child for 32,657
  lines. The predicate does not claim to count nodes; it claims the count it does
  compute orders the five measured shapes correctly.
- **THE PREDICATE IS BLIND TO INLINE STRUCTURE, and no threshold or cell weight
  can repair it.** Links, images, emphasis and inline code contribute neither
  newlines nor pipes. A generated asset index of **20,000 inline links in a single
  paragraph scores 1** and is allowed through, while requiring the editor to build
  ~20,000 anchor elements. The predicate assigns essentially the same risk to one
  long plain-text paragraph and one long paragraph containing tens of thousands of
  inline nodes. This is a known, **unmitigated** hole, accepted deliberately: a
  cheap inline proxy exists (counting `[`), but shipping it unmeasured would
  repeat the error this ADR exists to correct. It is left for a future measurement,
  not smuggled in as a guess. No fixture in the D6.1 corpus exercises this shape.
- **Pipe arithmetic errs in BOTH directions — it is not a safe-direction-only
  approximation.** It over-counts on a literal `|` in prose or inside a fenced
  code block, and on the delimiter row (`|---|---|`), which is not a rendered
  row. It **under-counts** wherever GFM's optional outer pipes are omitted
  (`a | b` scores 1 cell, not 2), and badly under-counts ragged tables, where GFM
  pads short rows out to the header width: a 100-column header over 1,000 rows of
  `| value |` scores ~2,200 against roughly 100,100 rendered cells. Whether this
  Milkdown path pads during conversion was not verified.
- **Table geometry is invisible.** 10,000x4 and 40x1,000 score identically; only
  one table fixture (11,438x4) was measured, so nothing here distinguishes them.
- **A false degrade is silent and unobservable in production.** The guard still
  emits no decision log event (sweep record `:88`), so a user pushed to Source by
  this predicate leaves no trace to debug. This ADR does not close that gap.
- **Two pinned-literal test anchors must move**: `C8b` (the comment-stripped
  numeric-literal list must be exactly `["500","1024"]`) and `G21`
  (`LARGE_DOCUMENT_THRESHOLD_BYTES === 512_000`). `C8b` exists precisely to make
  this change visible rather than silently inlined; that is it working, not
  failing.
- **The `<=` boundary now compares a different quantity**, so every UTF-8
  byte-width boundary case (`G11`-`G13`) becomes meaningless rather than merely
  relocated, and `G18`'s "a present `fileSize` must not read content" arm fails by
  construction.

**What it keeps.** The guard module retains its single import
(`import type { ViewMode }`), because the scan is inline arithmetic and needs no
table parser — the constraint `C7` pins. The mechanism, verified effective in the
field by ADR-0006, is untouched.

**What is still open.** Implementation is **D6.3(c)**, which owns the test-matrix
rewrite and must go through the TDD workflow. Whether the dead `largeFileWarning`
path is deleted, and whether the guard gains a decision log event, are separate
decisions this ADR deliberately does not take.

**Related:** ADR-0006 (the D6 sub-decision this supersedes); ADR-0004 (the gate-2
waiver; D6 is the live defect, the 9.96 MB wedge the tail case); plan M
`WI-D6`; the D6.1 sweep record and its 2026-09-20 verification pass.

## Deliberation note (2026-09-20)

The shape was reviewed adversarially before proposal, against the brief
"attack the shape, the threshold is secondary". The review did not overturn the
shape — its verdict was that `lines + cells` is defensible as a provisional risk
score and that `k = 1` should stand — but it produced four corrections that are
folded in above: the `k > 0.464` identifiability bound; the fact that pipe
arithmetic errs in both directions rather than only toward safety; the weakening
of the `countElements` inference; and the inline-structure blind spot with its
20,000-link failure case, which is the sharpest limitation recorded here.

One recommendation was **declined**: adding a cheap inline-density counter (`[`)
to the shipped predicate now. The same review that proposed it also said it needs
measurement before a weight is assigned. Shipping an unvalidated counter is the
error this ADR exists to correct, so the gap is named as unmitigated instead.

The architectural framing — freeze the invariants (one pass, constant space, no
parsing, counts-only), not the specific character codes — was adopted, and is why
Decision 1 is written the way it is.
