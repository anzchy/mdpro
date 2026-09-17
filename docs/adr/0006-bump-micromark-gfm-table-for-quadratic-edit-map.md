# 0006. Override `micromark-extension-gfm-table` to 2.1.2, against the G0 no-new-dependencies gate

## Status

Accepted — 2026-09-17

Opened as Proposed earlier the same day and held there until the before/after
sweep existed, so that no performance claim entered the tree unmeasured. The
numbers are now in Consequences and were reproduced twice by two independent
harnesses.

## Context

Gate 2's performance criterion recorded two main-thread freezes
(`docs/plans/20260915-stage3-gate2-record.md`). ADR-0004 waived the criterion for
step-3 entry and carried both defects forward. That record, and ADR-0004 in turn,
describe them as one phenomenon with one cause. **They are two defects with two
different causes and two different fixes**, and the conflation is load-bearing
enough to state plainly here:

- **ADR-0004 lines 21–24 attribute "the longest single main-thread block measured
  79,197 ms" to the 9.96 MB document.** The gate-2 record's own §1 and §5 say
  otherwise: 79,197 ms is *closing `very-long-line.wysiwyg` at 472 KB*, and
  55,766 ms is *switching to `large-table.wysiwyg` at 472 KB*. Both terminated.
  The 9.96 MB wedge has **no millisecond figure at all** — it never converged
  (3 h 49 m observed, 4330/4330 samples on one stack). ADR-0004 is Accepted and
  therefore immutable; this record is the correction, and it supersedes nothing
  else in it. The waiver itself still stands on its own reasoning.
- **ADR-0004 lines 32–35 place the cause "in a dependency", on the evidence that
  no `charAt` / `charCodeAt` / `split("")` / `fromCharCode` exists in `src/`.**
  That grep is accurate and the inference from it is wrong: it does not cover
  `source[i]` bracket indexing, which allocates a `JSString` per iteration under
  JavaScriptCore for code points above U+00FF — precisely the
  `operationSingleCharacterString` frame the profile showed. The per-character
  loop is in **project code**, at `src/utils/tableParser/parse.ts:112`.

This ADR is about the first defect only. The second is project code, needs no
dependency decision, and is tracked in the sequencing doc's D-series track.

**The 472 KB freeze is a quadratic in a transitive dependency.** Mounting
`large-table.wysiwyg.md` (471,880 B, a single table of 45,744 cells) spends its
time in `micromark-extension-gfm-table@2.1.1`, `lib/edit-map.js`. Its
`addImplementation` linear-scans the accumulated edit list for an existing entry
at the same index before pushing, and that list grows with cell count:

```js
while (index < editMap.map.length) {
  if (editMap.map[index][0] === at) { /* merge */ return }
  index += 1
}
editMap.map.push([at, remove, add])
```

Measured across four doublings of the table, parse time scales ×4 per doubling —
434 / 1364 / 5871 / 18,565 ms at the remark/micromark stage of the full Milkdown
mount path — with counted scan steps 2.13e8 → 8.51e8 → 3.40e9
→ **1.36e10 array comparisons for one 472 KB file**. Profiled self time:
`flushCell` 67.0 %, `EditMap.add` 23.0 %, GC 1.3 %. Replacing every code point
above U+00FF with `x` changes nothing, so the CJK corpus is irrelevant here.

**Upstream fixed it on 2026-09-11 in 2.1.2**, six days before this record. The
fix was verified by diffing the installed 2.1.1 against 2.1.2 on disk rather than
trusting the commit message: `addImplementation` now does `editMap.index.get(at)`
against a real `Map`, and shares the change tuple by reference between `map` and
`index` so the mutate-in-place path stays correct. The linear scan is gone.
`consume()` is untouched.

**The forces in tension.** The G0 gate for this effort states 「无新依赖」. Read
literally it forbids this. Three facts bear on whether it should:

- This is not a new dependency. `micromark-extension-gfm-table` is already in the
  tree at eight resolution paths, all reached through
  `@milkdown/kit` → `@milkdown/preset-gfm` → `remark-gfm` → `micromark-extension-gfm`.
  It is a patch bump of something we already ship.
- `micromark-extension-gfm@3.0.0` declares `^2.0.0`, so 2.1.2 satisfies the
  existing range. No peer or semver conflict is being forced.
- The repository already uses `pnpm.overrides` for exactly this purpose
  (`picomatch`, `rollup`), so the mechanism is established, not invented here.

Against that: it touches `package.json` and `pnpm-lock.yaml`, which is the
category of change G0 exists to freeze, and CLAUDE.md names "adding or refusing a
dependency" as ADR-worthy regardless of size. **There is no project-code
workaround.** The quadratic is inside the parser; the only alternative to bumping
it is not parsing the table — which is what the D6 guard does, and which is a
capability reduction rather than a fix.

## Decision

1. **Pin `micromark-extension-gfm-table` to `>=2.1.2` via `pnpm.overrides`.**
   G0's 「无新依赖」 is read as prohibiting *new* dependencies, not patch bumps of
   existing transitives that fix a measured defect in shipped behaviour. This
   reading is recorded here so it is not re-derived silently for a case that does
   not deserve it.
2. **The exception is scoped to this package and this reason.** It is not a
   general licence to update transitives during the freeze. Another bump needs
   its own justification; "0006 did it" is not one.
3. **D6 is re-stated, not closed.** The 500 KB guard's *mechanism* is verified
   effective — across all 76 Milkdown factory invocations in the local log,
   the largest `initialMarkdownLength` ever passed to `Editor.make()` is 430,614,
   and the count above 500 KB is **zero**. What is wrong is the threshold
   (471,880 B is admitted) and the judgement variable (cost tracks cells in the
   largest single table, not bytes). The guard is retained. Re-choosing its
   predicate is deferred until the post-bump sweep says what remains.
4. **The acceptance evidence is a before/after row-count sweep**, at the same four
   doublings, recorded as an observation. Upstream's own figure (8,000-row table,
   12,292 ms → 589 ms) is upstream's and is not adopted as ours.

## Consequences

**What this costs:**

- **G0 is now a gate with a documented exception.** The next person who wants a
  dependency change during the freeze has a precedent to point at. That is the
  real price, and it is why the exception is scoped in Decision 2 rather than
  left to judgement.
- **We take on upstream's fix without upstream's test suite.** The diff is small
  and we read it, but we run `micromark`'s table parser in a configuration we do
  not test directly. The 93-file / 1419-test frontend suite passing is evidence of
  no regression in *our* behaviour, not evidence that the table parser is correct
  on inputs we have no fixture for.
- **The override outlives the reason.** When `@milkdown/preset-gfm` eventually
  ships a `remark-gfm` that pulls 2.1.2 or later on its own, this entry becomes
  dead weight that still looks deliberate. It should be removed then, and nothing
  automated will notice.
- **It does not fix the thing most likely to be hit.** (B) — the Source-mode
  quadratic in our own `findAllTables` / `parseTableAt` — is untouched by this,
  and is already a multi-second stall *below* the 500 KB threshold that ships
  today (measured in jsdom/V8, single lint callback: prose 1.6 s, large-table
  15.3 s, dense-math 22.7 s, many-short-nodes 44.8 s). Landing this ADR and
  stopping here would fix the rarer defect and leave the common one.

**What it buys:**

- The only available fix for (A). Every alternative is a capability reduction.
- It removes a 1.36e10-comparison term from the mount path of any
  table-heavy document, not only the corpus fixture.
- It makes D6's predicate answerable. Once the dependency-side quadratic is gone,
  whatever mount cost remains is layout and ProseMirror construction, which is
  what a guard can actually be calibrated against.

**Verification performed at the time of writing** (bump applied, nothing
committed): `pnpm why --depth 8` resolves 2.1.2 at all eight paths; the lockfile
carries a single entry; `pnpm test:run` 93 files / 1419 passed / 4 todo — the same
counts as before the bump; `tsc --noEmit` exit 0; `pnpm build` exit 0.

**Measured effect.** Parser in isolation — `micromark` 4.0.2 with `gfmTable()`
only, no Milkdown, no jsdom, both versions imported into one process from the
pnpm store and run against the same generated input (node v22.22.3, Apple M4):

| rows | table cells | bytes | 2.1.1 | 2.1.2 | speedup | HTML output |
|---:|---:|---:|---:|---:|---:|---|
| 1 429 | 5 716 | 55 626 | 368 ms | 84 ms | 4.4× | byte-identical |
| 2 859 | 11 436 | 115 686 | 1 300 ms | 114 ms | 11.4× | byte-identical |
| 5 718 | 22 872 | 235 764 | 4 267 ms | 219 ms | 19.5× | byte-identical |
| 11 436 | 45 744 | 481 664 | 15 812 ms | 404 ms | **39.1×** | byte-identical |

Per-doubling ratio moves from ×3.53 / ×3.28 / ×3.71 to ×1.36 / ×1.92 / ×1.84 —
quadratic to linear, which is the claim. **Output is byte-identical at every
size**, which is the correctness evidence that matters more than the timing:
the fix changes how edits are looked up, not what they are.

Through the full Milkdown plugin chain in jsdom (the same mount path as
`MilkdownEditor.tsx:170-186`), at 11 436 rows: parse 18–20 s → **1.5 s**, editor
create 28–36 s → **3.4 s**, process wall clock 58 s → **6.6 s**. Serialization is
unchanged (835–903 → 897–962 ms), consistent with a parse-only fix, and the
zero-table prose control is unchanged.

**On the spread in the 2.1.1 baseline, and why the finding is stated as a ratio.**
The two harnesses agree closely on the 2.1.2 side. They do not agree on the
before-number, and the figures are not all measuring the same stage — which is
itself the reason to be careful with them:

| stage | 2.1.1 at 11 436 rows |
|---|---|
| bare `micromark` + `gfmTable()` | **15 812 ms** (this ADR's table) and **30 536 ms** (second harness, loaded machine) |
| remark/micromark stage inside the Milkdown mount | **18 565** / **20 221** / **45 298 ms** |

The 45 s figures on both rows coincide with a loaded machine and were disclosed
as such rather than dropped. A bare-parser number and a mount-path stage number
are not interchangeable, and quoting one as the other would overstate the win.
**So the finding recorded here is the ratio and the scaling exponent**, both of
which are stable across every run and both harnesses; no single before-number is
load-bearing.

**What this does not establish.** The sweep measures parse and document
construction in V8/jsdom **with no layout**. The gate-2 record's stacks for this
tier (`RenderGrid::layoutBlock` → `GridTrackSizingAlgorithm::run`) are WebKit
layout work that is not modelled here at all, and the residual ≈1.8 s of
ProseMirror document build for 45 744 cells is a jsdom number that will not
transfer. **Whether a 472 KB single-table document is actually usable in WYSIWYG
after this bump is therefore still unmeasured**, and re-choosing D6's predicate
still depends on a sweep on the real WKWebView. This ADR removes one term from
that total and makes the remainder measurable; it does not close D6.

**Related:** ADR-0004 (the gate-2 entry waiver this corrects on two points of
fact, without disturbing its decision); the D-series track in
`docs/plans/20260912-frontend-backend-sequencing-order.md` (D6, and the unnumbered
9.96 MB wedge carried under it).
