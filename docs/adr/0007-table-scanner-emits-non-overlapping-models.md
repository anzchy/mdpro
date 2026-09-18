# 0007. The rewritten table scanner emits non-overlapping models

**Status**: Superseded by [ADR-0008](./0008-non-candidate-delimiter-class-measured-against-gfm.md) — 2026-09-17
(Accepted 2026-09-17, superseded the same day.) The Decision below is
re-affirmed unchanged by ADR-0008. The **Context is factually wrong** on one
load-bearing point: it calls both delimiter shapes "ordinary valid GFM", and
measurement against the reference parser shows neither `---` nor a 4+-space
indent produces a GFM table. Read ADR-0008 before citing anything below.

## Context

`findAllTables(source)` scans a Markdown document for GFM tables by probing it
position by position, and every probe re-splits the entire document. One failed
parse degrades the loop to one probe per line, so the same 2000-row document
costs 2.27 ms when its tables parse and 472.89 ms after one `|` is deleted from
a header row — 208× from deleting one byte. The real 228 000-row fixture stalls
about 15 s, and it reaches the user through the CodeMirror lint timer that runs
on a delay after every keystroke. WI-3 of
`.claude/tdd-guardian/plan-20260917-table-scan-quadratic.md` replaces per-line
probing with one probe per maximal run of table-candidate lines.

That rewrite was justified by an equivalence argument — every probe inside a
candidate run resolves to the same run start, so probing once per run yields the
identical model or null — and was being sold internally as behaviour-preserving.
An adversarial pass on the test matrix, before any implementation existed, found
a counterexample, which was then confirmed against the shipping code.

The parser's walk-down starts at `headerIdx + 2`, so **the delimiter row is
never candidacy-checked**. A delimiter that is valid but is not a candidate line
therefore sits *inside* a model while *splitting* the candidate run. Two shapes
reach it, both ordinary valid GFM: a pipe-less delimiter (`---`, `:-:` — edge
pipes are optional) and a delimiter indented 4+ spaces (`    | - | - |` — the
delimiter check trims before splitting, the candidate check rejects on the
max-indent rule). Measured against shipped code:

| source | shipped result |
|---|---|
| `\| a \|` / `---` / `\| b \|` | 1 model `[0,15]` |
| `\| a \| b \|` / `    \| - \| - \|` / `\| 1 \| 2 \|` | 1 model `[0,33]` |
| the same plus a second indented delimiter and `\| 3 \| 4 \|` | **2 models, `[0,33]` and `[24,57]` — overlapping** |
| `\|a\|` / `---` / `\|b\|` / `\|-\|` / `\|d\|` | 1 model `[0,19]` |

In the third case the line `| 1 | 2 |` is a body row of table 1 **and** the
header of table 2. One byte belongs to two tables. The mechanism is an
interaction, not a property of either part: after emitting the first model the
loop advances to offset 48, and the offset→line resolver deliberately treats
`offset === line.end + 1` as belonging to the previous line, so `48 <= 47 + 1`
matches the indented delimiter line, the probe walks up from there, and a second
overlapping table is built.

The consequence for WI-3 is that a scanner resuming after the model's last line
returns one model here, and a scanner resuming after the run returns two. Both
are one-line rules; neither is more work than the other. **WI-3 is therefore not
output-identical on this class whichever resume rule is chosen**, and the choice
had to be made deliberately rather than discovered.

Nobody has reported this. It was found by attacking the specification, the nine
existing table test files contain no non-candidate delimiter, and the seeded
corpus could not generate the shape (indentation was not a generator dimension;
that is being fixed regardless).

Codex was consulted on the scope question. It recommended removing the overlap
and listed five conditions that would reverse its recommendation. Four were
checked against this repository and are false; the fifth is true but is an
argument about cost rather than correctness:

- *Cursor sync cannot be tested end-to-end before WI-3 ships* — **false**;
  `tests/cursor-sync-table.test.ts` and `tests/mode-toggle-table-cursor-sync.test.ts`
  both exist today.
- *Models or `tableIndex` values are persisted, exchanged asynchronously, or
  consumed as stable identities* — **false**. The capture slot
  (`pendingCapture` in `src/utils/cursorSync/table.ts`) is module-level
  in-memory state, written on a view-mode transition and read-and-cleared at the
  inbound editor's mount, keyed by `documentId` and discarded on a mismatch.
  Nothing writes it to disk or ships it across a process boundary, and both the
  capture and the restore compute `tableIndex` from the same `findAllTables` in
  the same build. A renumbering cannot straddle the round-trip.
- *The divergence cannot be bounded by a precise predicate* — **false**. It is
  exactly: a model crossing a candidate-run boundary through a valid
  non-candidate delimiter, followed by legacy re-entry caused by the `end + 1`
  resolution.
- *WI-3 must ship as emergency stabilization* — **false**. Nothing is committed;
  the deliverable is a verified working tree.
- *Preserving the overlap needs only a small isolated rule that cannot affect
  the performance target* — **true**, and it cuts against Codex's own framing.
  "Iterate over every run" reproduces the overlap; skipping runs covered by an
  emitted model removes it. Preserving is not the expensive option, so the
  argument that preservation costs extra deliberate effort — which was in the
  brief given to Codex, and was wrong — carries no weight in either direction.

The one place `tableIndex` crosses a real trust boundary is the MCP table tools
(`src/utils/tableMcp.ts`), where an external client supplies the ordinal. Under
the overlap the app's enumeration already disagrees with any external count of
the document's tables, and an edit addressed to `tables[1]` would rewrite lines
belonging to `tables[0]`. Removing the overlap moves that surface toward
agreement with an external reader, not away from it.

## Decision

The rewritten scanner **resumes after the last line of the model it just
emitted**. Emitted models are pairwise non-overlapping: no byte belongs to two
tables. On the non-candidate-delimiter class this is a deliberate, documented
behaviour change relative to the shipped implementation.

The internal claim about WI-3 is restated. It is **not** "behaviour-preserving";
it is *output-identical except for the explicitly characterized removal of
overlapping models*.

The golden oracle survives in two tiers rather than being weakened to an
"ignore differences" escape hatch:

1. Outside the divergence class — every document for which
   `hasNonCandidateDelimiter` is false — exact deep equality against the frozen
   byte-copy of today's `findAllTables` / `parseTableAt`.
2. Inside it, a dedicated fixture set asserts **both** sides by literal value:
   the frozen implementation still produces the documented overlapping output,
   the new scanner produces the approved non-overlapping output, the
   pairwise-non-overlap invariant holds, and the resulting `tableIndex` values
   and cursor-sync round-trip are asserted explicitly.

Tier 2 is a narrow positive exception identified by the causal predicate above,
not a tolerance band. The seeded corpus gains a delimiter-shape dimension so the
class is generable rather than hand-written only.

The `end + 1` resolver quirk is **not** fixed here. It keeps its own work item,
its own regression test, and `offset === line.end + 1` semantics remain in force
everywhere the resolver survives. Removing the overlap at the scanner does not
depend on that fix and does not pre-empt it.

## Consequences

- **A behaviour change lands in a diff whose subject is performance.** That is
  the cost, and it is paid knowingly: the resume rule had to be chosen either
  way, so there was no version of WI-3 that changed nothing.
- **The clean single-assertion oracle is gone.** Two tiers are more code, more
  to read, and more to keep honest than one deep-equality call. The exception is
  load-bearing: if the predicate is wrong, a real divergence hides inside tier 2.
- **`tableIndex` renumbers on documents in the divergence class.** Nothing
  persists it, but any future feature that treats the ordinal as a durable
  identity inherits a behaviour that changed once and can change again.
- **"Pairwise non-overlapping" becomes a real invariant** and can be asserted
  universally on the new scanner. It is *not* an invariant of the frozen legacy
  behaviour, and the matrix must keep saying so where it characterizes legacy.
- **Two shapes of valid GFM now scan differently than they did.** Neither was
  covered by an existing test, and no user reported either, so the blast radius
  is believed small — believed, not measured against real documents.
- **Fixing the `end + 1` quirk later will no longer visibly change this class**,
  because the scanner no longer routes through the resolver here. That removes
  one natural tripwire, so the quirk's own work item cannot lean on this
  behaviour to prove itself.
- This supersedes nothing. It constrains WI-3, WI-3B, and the `end + 1`
  follow-up.
