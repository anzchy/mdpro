# 0163. fast-check is added for TypeScript data-shape properties; race models keep the bounded enumerator

**Status**: Accepted (2026-11-01, the user: 「Accept r2 (Recommended)」). Proposed (2026-11-01, herdr-delegator; r2 the same day after plan review round 1: gpt-auditor C0 H0 M2 L1,
fable-auditor C0 H0 M4 L5). The user's words, all 2026-11-01 in the herdr-delegator session (request in chat, the rest as
answers to its AskUserQuestion; the scope answer is also quoted in the assessment request
`~/.mdpro-redesign/herdr-spike/gpt-auditor/ADR0163-assess-request.md`): request 「加入fast-check 依赖，写ADR」; scope
「let codex weigh in」, answered by gpt-auditor's assessment (`RECOMMEND A`, linked at the end); routing
「ADR only, no full gate (Recommended)」; D343 「Keep D343 as is (Recommended)」. If accepted, the D323 plan
([plan](../plans/20261027-plan-d323-model-property-tests.md)) is corrected to cite this record (decision 4); its race-model
conclusion stands.

## Context

- **The trigger.** D343's implementor (2026-10-31) designed a property test over PowerShell step-list shapes and wrote it
  against `fast-check`. The package is not a dependency, so the file could not even be collected, and the RED was a runner
  error. It was told to enumerate the shapes instead, and it did. The user then asked whether fast-check is best practice
  and asked for it to be added.
- **What the repo does today.** Property-style tests use in-repo generators: `tests/support/seededRandom.ts` (mulberry32,
  "The repo does not use fast-check by design"), `seededSequences.ts`, `tableCorpus.ts`, and domain oracles under
  `tests/support/`. Tests that take 2 s or more under coverage go to `*.slow.test.ts` (ADR-0050). No ADR records the "by
  design" choice; it is a convention.
- **The reviewed D323 plan** (2026-10-27, both auditors, two rounds) chose an in-repo bounded enumerator for race
  properties, and its WI-0 was to write an ADR rejecting fast-check. Its reasons: alphabets of 8–16 events, every recorded
  race needed at most 4 disturbances, and § 4.1 requires *every* release order within that bound, which shortest-first
  enumeration gives with a minimal counterexample and no shrinking. Rust needs a hand-rolled harness anyway.
- **Where fast-check would help** (gpt-auditor, prospective; no past defect is proven findable only by it): tests that
  sample rich value spaces from fixed seeds, for example `tests/table-mcp-overflow.test.ts:176-265` (200 table shapes),
  `tests/tooling/release-latest-json.test.ts:162-165` (100 seeded round trips), `tests/tooling/device-drag-plan.test.ts:268-290`
  (300 argument lists), and serializer round trips like D194's. Composable arbitraries and integrated shrinking can reach
  shape combinations those samples miss and cut a failure to its smallest input.
- **Facts checked 2026-11-01.** `fast-check@4.10.2`: 1.52 MB unpacked, MIT, one runtime dependency (`pure-rand@^8`, 64 KB).
  The repo is on vitest `~3.2.7` (`package.json:90`; the D323 plan's "3.2.4" is stale). The figures are unpacked package
  sizes from the registry, not measured install bytes. `@fast-check/vitest` 0.4/0.5 need
  vitest ≥ 4.1; only the old 0.2.4 fits. Plain `fc.assert` inside an ordinary `it` needs no adapter.
- **Freezes.** ADR-0160 freezes user-facing features; ADR-0162 decision 5 freezes audit rounds, the auditor set, the
  receipt contract and landing gates. A test-only devDependency touches none of them. Plan P's A7 bars *runtime*
  dependencies only, and test-only devDependencies have landed before (`16fb45c`).

## Options considered

1. **A. fast-check for TS data-shape properties; race models keep the enumerator** (chosen; gpt-auditor's recommendation).
2. **B. fast-check everywhere in TS, replacing D323's harness** (`fc.scheduler`, `asyncModelRun`). Lost: random sampling
   of interleavings weakens D323 § 4.1's exhaustive claim unless the oracle and plan are reworked and re-reviewed, and Rust
   would still need its own harness, so the repo would end with two race styles instead of one.
3. **C. No dependency; record the rejection as D323 WI-0 planned.** Lost: it keeps ad hoc generators for every new
   data-shape test, with no shrinking and no composition, which is the gap the user asked to close.
4. **fast-check plus `proptest` for Rust** (weighed in the D323 plan's WI-0). Lost: Rust keeps the hand-rolled mirror of the
   TS harness (D323 § 4.1), and `proptest` would be a second dependency needing its own ADR.
5. **A with the `@fast-check/vitest` adapter.** Lost: only 0.2.4 fits vitest 3.2, a second package to maintain for
   little value over plain `fc.assert`. Reconsider after a vitest 4.1 upgrade.

## Decision

1. **Add `fast-check` as a devDependency**, pinned exact with no caret: the exact 4.x version current at PR time, recorded
   in the landing row, with its lockfile entries. No adapter, no `patches/` entry. Tests import it only under `tests/`;
   nothing under `src/` or `src-tauri/` may import it, and the dependency PR adds a tooling test that sweeps `src/**` for
   the import (the T566 vendor sweep is the pattern).
2. **Which style a test uses**, decided per matrix case. The brief's test matrix names each case's style, `enumerate`,
   `fc` or `named`, so the audit reads the choice off the matrix:
   - **`enumerate`:** any claim about the order of lifecycle or interleaving events within a bound (D323's harness, the
     quit-guard properties), and any input set that can be listed in full within the unit lane's 2 s budget (ADR-0050).
     The order sweep stays exhaustive **even when the events carry rich payloads**: fast-check may generate the payloads,
     never the order. A bounded order claim whose alphabet is too large to enumerate in 2 s goes to a `*.slow.test.ts`
     enumeration, not to sampling;
   - **`fc`:** an input space that is unbounded (free strings, numbers, nested shapes) or cannot be listed within 2 s, **and**
     has an independent oracle, meaning a check stated without re-running the implementation (round-trip identity, an
     invariant, a reference model). Without such an oracle, use `named` cases;
   - **`named`:** a known bug's input is always a named regression case, whichever style found it.
   Existing seeded tests are not migrated. A new open-ended random loop prefers fast-check when shrinking or composed
   generators are worth it.
3. **How it runs.** `fc.assert(fc.property(…))` or `fc.asyncProperty` inside a plain vitest `it`, with an explicit
   `numRuns`. A failure prints its `seed` and `path`; the fix commit turns the counterexample into a named case. **A
   property used as a RED receipt's test pins `seed` and `numRuns` in source at RED time**, so the ADR-0149 base replay is
   deterministic, and its shrunk counterexample becomes the named case in the same commit; unpinned seeds are for
   exploratory runs only. This changes no receipt rule. A
   property that takes 2 s or more under coverage moves to a `*.slow.test.ts` sibling (ADR-0050) and leaves a small-scale
   check in the unit file.
4. **The D323 plan is corrected, not re-planned.** Its race-model conclusion, § 4.1's exhaustive enumerator and the Q7
   ruling that D323 adds no dependency all stand. In the dependency item's landing, the delegator's docs-only commit amends
   the passages that become false: the summary's "does not use fast-check by design" statement (around lines 34–38), § 4's
   dependency-gate row and its "by design" precedent bullet (around lines 590–591), and the Q7 row's "§ 4 (unchanged)", each
   to cite this record. D323's WI-0 ADR rejects fast-check *for race models* and cites this record. The `seededRandom.ts`
   header comment is corrected in the dependency PR.
5. **Routing.** The dependency lands as one High-tier PR (`package.json`, `pnpm-lock.yaml`, the `seededRandom.ts` comment,
   the `src/**` import sweep, and one smoke test that runs a trivial property), audited by both auditors. Rule 12 gates an
   item that needs an ADR; under its "Doubt goes to the user", the user ruled for this one item 「ADR only, no full gate
   (Recommended)」, so it skips `/grill-with-docs`, `/to-spec` and `/to-tickets`. That is a gate exception: it gets row
   `G-ADR0163-1` in `docs/audit/audit-log.md` § Gate exceptions (ADR-0129 decision 8) in the acceptance commit. It changes
   rule 12 for no other item. D343 does not wait for it.

## Consequences

- **Gains:** shrinking and composable generators for data-shape tests; a common, documented library instead of a new
  hand-rolled generator per test; a stated rule for which property style to use.
- **Costs:**
  - about 1.6 MB unpacked footprint and two more packages in the lockfile, each a supply-chain trust and an upgrade to track;
    both enter `pnpm audit --audit-level=critical` on every PR, so a dev-only advisory can turn CI red (G-D340-1 is the
    precedent). D181's `check-patched.mjs` is unaffected, since no patch is added;
  - two property styles in TS, which implementors must route by decision 2 and auditors must check;
  - random properties can be slower and less deterministic than enumerations; seeds must be recorded for replay, and
    an unbounded `numRuns` can overrun the unit lane, so each property's CI cost is bounded by its explicit `numRuns`;
  - the "by design" convention is reversed for data shapes, so older tests and new ones look different.
- **Forecloses:** nothing permanent. Adopting the adapter, or fast-check for race models, needs a new ADR.
- **Reconsider** if the first two fast-check uses cannot find an independent oracle or a counterexample simpler than the
  existing seeded cases (then fall back to C), or if D323's enumerator proves infeasible within its lane budget or a real
  race needs a trace longer than its 8-event trigger (then reconsider B).

Evidence: gpt-auditor's assessment, [`docs/reference/20261101-adr0163-fast-check-assessment.md`](../reference/20261101-adr0163-fast-check-assessment.md) (2026-11-01).
