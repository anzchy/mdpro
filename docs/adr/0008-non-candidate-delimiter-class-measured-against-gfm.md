# 0008. The non-candidate-delimiter class, measured against GFM

**Status**: Accepted — 2026-09-17. Supersedes
[ADR-0007](./0007-table-scanner-emits-non-overlapping-models.md), whose Decision
is re-affirmed unchanged and whose Context contains a factual error.

## Context

ADR-0007 decided that the rewritten table scanner resumes after the last line of
the model it emitted, so emitted models never overlap. It justified this against
a class of documents it described as **"both ordinary valid GFM"**, and listed as
a Consequence that "Two shapes of valid GFM now scan differently than they did."

That claim was asserted from reading the parser, never measured. It was measured
on 2026-09-17, after WI-3 was implemented and green, against
`micromark-extension-gfm-table@2.1.2` — the GFM reference table parser, reached
through `@milkdown/preset-gfm@7.18.0` → `remark-gfm`, and therefore **the parser
the WYSIWYG surface actually uses**. It is the same package this effort pinned in
`package.json` for [ADR-0006](./0006-bump-micromark-gfm-table-for-quadratic-edit-map.md).

| shape | micromark (GFM) | mdpro `findAllTables` |
|---|---|---|
| `\| a \|` / `---` / `\| b \|` (ADR-0007 F1) | **0 tables** — `---` is a setext heading underline; `\| a \|` becomes an `<h2>` | 1 table |
| `\| a \|` / `:-:` / `\| b \|` | 1 table | 1 table — agree |
| `\| a \| b \|` / `--- \| ---` / `\| 1 \| 2 \|` | 1 table | 1 table — agree |
| 3-space-indented delimiter | 1 table | 1 table — agree |
| 4-space-indented delimiter (ADR-0007 F2) | **0 tables** — one paragraph; still 0 after a preceding blank line | 1 table |

Three corrections follow, in decreasing order of how much they change the picture.

**1. The pipe-less half of ADR-0007's claim is true; its chosen fixture is not.**
Edge pipes really are optional in GFM — `:-:` and `--- | ---` both produce real
tables, and mdpro agrees on both. But `---` specifically is not a delimiter row:
it collides with the setext heading underline, and setext wins. ADR-0007 picked
the one member of a valid class that is not a table.

**2. The indented half is simply false.** A delimiter row indented 4+ spaces is
never a GFM table, in any surrounding context. ADR-0007 called it valid GFM; it
is not.

**3. Therefore the entire divergence class is built out of documents mdpro
already mis-detects.** ADR-0007's F3 — the overlapping fixture, the only member
of the class anyone has ever produced — is constructed from shape 2. GFM sees no
table there at all; the shipped scanner saw two, overlapping; the WI-3 scanner
sees one. Removing the overlap moves mdpro *toward* the reference parser.

This also exposes a defect that belongs to neither scanner and predates both:
**mdpro's Source-mode table detector over-detects tables in exactly two shapes** —
`---` used as a delimiter, and a delimiter indented 4+ spaces. The second has a
located cause: `isTableCandidateLine` enforces `MAX_INDENT`, but `isDelimiterLine`
trims leading whitespace before splitting, so the delimiter row escapes the very
rule its neighbours obey. The first is an unimplemented setext-vs-delimiter
precedence rule. Both are out of scope for a performance effort; both are
recorded here because this measurement is where they surfaced.

## Decision

**ADR-0007's Decision stands, unchanged**: the scanner resumes after the last
line of the model it emitted; emitted models are pairwise non-overlapping. The
measurement strengthens it rather than reopening it — the behaviour ADR-0007
chose to remove was mdpro disagreeing with GFM twice over instead of once.

The **characterization** of that decision is corrected. It is no longer
"a behaviour change on two shapes of ordinary valid GFM". It is: *a behaviour
change confined to documents that mdpro already detects as tables and GFM does
not*. The tests are unchanged — `SCAN-noncandidate-delimiter` pins both sides by
literal and remains correct as written — but no plan, work item, or later ADR may
describe the class as valid GFM.

Two claims are retired and must not be reused:

- That the corpus makes the divergence class generable. It generates the
  *predicate* (`hasNonCandidateDelimiter`, 138 of 200 documents) but never the
  overlap sub-shape, so ADR-0007's tier 2 is currently vacuous. `SCAN-oracle`
  asserts exact identity on all 200 documents and pins `divergent === []`, which
  is stronger than tier 2 promised — the safety argument holds, but not for the
  reason ADR-0007 gave.
- That the WI-3 cursor-sync change is a round-trip loss. On F3,
  `captureCellFromSource(src, 49)` now returns `null`. GFM has no table at that
  offset, so the null is correct and the legacy capture was the wrong one.

The over-detection defect gets its own investigation before anything is built on
it. It is **not** fixed here, and WI-3B, WI-4 and WI-5 proceed without waiting
for it.

## Consequences

- **An Accepted ADR is on record with a false Context, and stays in the tree.**
  That is the cost of immutability and it is the right cost: ADR-0007 is the
  evidence of what the decision looked like when it was made from reading code
  alone. Anyone who reads only 0007 will believe something untrue, which is why
  its Status line points here.
- **The decision was right for a reason nobody had checked.** The equivalence
  argument, the adversary pass, the Codex consultation, and the resume-rule
  choice were all conducted on a premise that a fifteen-minute measurement would
  have falsified. The lesson is cheap to state and was expensive to earn: when an
  ADR's Context asserts what a parser does, run the parser.
- **The divergence class is now known to be smaller and less consequential than
  ADR-0007 believed**, which lowers the blast radius of WI-3 — but only because
  mdpro is wrong on those documents in the first place. Fixing the
  over-detection would change behaviour on them again, this time visibly.
- **A new defect is on record with no owner and no plan.** The over-detection
  reaches users through three surfaces: `lintTableColumnCount` can raise
  column-count diagnostics on text that is not a table; the MCP table tools
  address `tableIndex` values that do not exist in the rendered document; and
  cursor sync maps into tables the WYSIWYG side never renders. Nobody has
  reported any of it, and the shapes are rare. Left unfixed it stays a silent
  Source-vs-WYSIWYG disagreement, which is the exact class of bug this
  application exists to avoid.
- **The seeded corpus still cannot generate the overlap shape**, and extending
  `makeCorpus` is blocked: a new `BLOCK_KIND` shifts the `mulberry32` stream and
  invalidates `CORPUS_TOTAL_BYTES = 64568`, asserted inside a file fingerprinted
  by an open red receipt. The way out is a second generator with its own seed and
  its own byte-total, leaving `makeCorpus` byte-identical.
- This supersedes ADR-0007 and constrains WI-3B, WI-4, WI-5, and the
  over-detection investigation. It does not reopen the resume rule.
