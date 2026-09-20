# 0004. Waive gate 2's unresponsiveness criterion to admit stage 3

## Status

Accepted — 2026-09-16

**Corrected on two points of fact — 2026-09-17** by
[ADR-0006](./0006-bump-micromark-gfm-table-for-quadratic-edit-map.md): the
attribution of the longest measured main-thread block (lines 21–24) and the
placement of the cause "in a dependency" (lines 32–35). The waiver itself still
stands on its own reasoning, and nothing else in this record is disturbed. Read
ADR-0006 before citing either figure. This Status block is the only part of this
ADR that has been edited — the body below is the 2026-09-16 record as written.

## Context

Gate 2（阶段 3 入口门禁二：大文档性能基线）is the second of two entry gates that
plan M places before step 3. Its six surfaces were fully measured on 2026-09-15
and recorded in
[`20260915-stage3-gate2-record.md`](../plans/20260915-stage3-gate2-record.md).

It is a **record** gate, not a threshold gate: passing means every surface has a
number written down, not that the numbers are small. Of its three hard criteria,
two were met on merit — (2) the 10 MB rejection behaves correctly, and (3) all
six surfaces carry a recorded number. Criterion **(1) — no crash, no permanent
unresponsiveness — was violated**, so by the letter of the gate step 3 cannot be
entered.

The violation is real and is not being disputed. A 9.96 MB document pegs the
renderer with no convergence (3h49m observed in the dev build; 7–10 minutes
across two renderer processes in the bundle), and the UI is verifiably not
interactive throughout. The longest single main-thread block measured 79,197 ms.

What makes this a decision rather than a bug report is **what the cause turned
out to be**:

- The wedge is **not** the ProseMirror mount. `App.tsx:506-515` holds a 500 KB
  guard that force-switches to source mode, and the wedge occurs with that guard
  already active.
- The profile is per-character JS string allocation plus GC
  (`operationSingleCharacterString` → `JSString::create` → sweep), 7858/7858
  samples, living in a dependency. No `charAt` / `charCodeAt` / `split("")`
  exists anywhere in `src/`.
- It therefore runs regardless of editor mode, and regardless of heading
  identity, TOC parsing, or anything else step 3 touches.

Step 3 is the heading identity contract and TOC switching. It neither causes
this defect, depends on it, nor worsens it. Enforcing criterion (1) literally
stalls the entire plan indefinitely on a defect that belongs to no work item in
either plan — the gate would be blocking work that is orthogonal to the thing it
detected. That is a failure of the gate's *scoping*, not a signal that step 3 is
unsafe to start.

## Decision

1. **Criterion (1) is waived for the purpose of admitting step 3.** Gate 2 is
   declared **met for entry**, on criteria (2) and (3) plus this waiver. Step 3
   may begin.
2. **The defect is carried, not closed.** The 9.96 MB wedge and **D6** (the
   500 KB guard is ineffective — `large-table.wysiwyg.md` is 471,880 B, passes
   the threshold, and blocks the main thread ~56 s) remain open, tracked in the
   gate-2 record. Waiving the gate is not a judgement that they are acceptable
   in a shipped build.
3. **The waiver is scoped to entry only.** It does not extend to step 3.8's exit
   re-measurement, and it does not extend to release.
4. **The precedent is conditional.** An entry gate may be waived on this pattern
   only when the failing criterion's cause is demonstrably outside the scope of
   the gated work *and* is not worsened by it — both of which had to be measured
   here, not assumed. Absent that condition, waiving a gate makes every gate
   advisory.

## Consequences

**What this gives up.** Step 3 will be built on top of a large-document path
that is known to be able to hang the app indefinitely. Every piece of work that
lands from here until the defect is fixed inherits that state, and anyone
reading the plan will see step-3 commits landing against a gate that the record
says failed. This ADR is the only thing that makes that sequence legible.

**Step 3.8 is now harder, and must change.** Its exit re-measurement was
designed to compare against the entry baseline. That baseline now contains an
unbounded block, so a whole-app comparison cannot distinguish a step-3
regression from the pre-existing wedge. **3.8 must compare per surface and
exclude the wedged shapes explicitly**, naming them, rather than comparing
aggregates. A comparison that silently absorbs a non-terminating block into its
baseline reports nothing.

**D6 is the more dangerous half, and it is easy to lose behind the 10 MB
number.** 471,880 B is an ordinary document, not an extreme one. The guard stops
10 MB while permitting a 56-second freeze at under half a megabyte, which means
the protection users actually have is weaker than the 500 KB threshold implies.
Whoever fixes this should treat D6 as the live defect and the 10 MB wedge as the
tail case, not the reverse.

**What must happen before this waiver stops applying.** Criterion (1) has to be
satisfied for real — or explicitly re-adjudicated — **before any release**, and
the fix needs its own work item in plan M, since it currently belongs to none.
This record does not create that work item; it records that one is owed.

**What this does not touch.** Criteria (2) and (3) were met on evidence and are
unaffected. The measurement conditions stated in the gate-2 record remain
load-bearing for every number quoted here: Apple M4 / 24 GB, on battery at 91%,
and every non-render figure is a single run.
