# 0055. A missed performance budget changes the design, not the number

**Status**: Accepted (2026-10-07, user decision; Q16 of plan P). Proposed 2026-10-07.

## Context

Plan P's E39 sets three budgets for the status strip (WI-4.8): status-related
main-thread work p95 ≤ 8 ms, no task ≥ 50 ms, and the word count visible within
1 s. E39 calls them targets to verify on a named reference machine, and bars them
from ever blocking CI; CI asserts only deterministic commit and task counts (T30,
T31). Nothing said what happens when the reference machine misses one, so a miss
had no defined consequence (Q16).

A Codex review on 2026-10-07 also found that neither the reference machine nor
the T31 fixture files are actually named yet (plan P :393-396,
`stage-4a-components.md` timing-evidence row). A single miss on an unnamed machine
proves nothing.

## Decision

1. **Measure before acting.** T31 names the reference machine (model, chip,
   macOS, display scale) and commits the fixture generators (Source near 10 MiB,
   WYSIWYG under 500 KiB, each with CJK and very long lines). A miss counts only
   when it reproduces on that machine with those fixtures and the status work
   isolated.
2. **A confirmed miss is a defect in the design.** It gets a D-row in the
   sequencing doc's register, and the fix changes the implementation (scheduling,
   chunking, what is counted), not the target.
3. **The budget changes only through a new ADR**, and only when repeated,
   comparable runs show the platform itself cannot meet it without a
   disproportionate cost or a worse experience. That ADR supersedes the number
   it changes.
4. **Still never a CI gate.** E39 stands: these numbers are recorded evidence,
   not blocking assertions.

## Consequences

- A miss now has an owner and a path to closure instead of being quietly
  tolerated or quietly re-baselined.
- Cost: T31 grows (naming a machine, committing generators), and a confirmed miss
  can hold WI-4.8 back while the design is reworked.
- Cost: relaxing a budget takes an ADR's review, even when everyone already
  agrees the target was too strict.
- Because the gate is manual evidence, nothing mechanical stops a regression
  between measurements; a slow drift is caught only when someone re-measures.
- Forecloses "the measurement becomes the new target" as a default.
