# 0105. The control-channel runner and Feature Map read the journey catalogue

## Status

**Proposed** (2026-10-15). The user has not yet ruled on it; none of it was in §0 of
[the e2e journeys plan](../plans/20261015-plan-e2e-journeys.md). Drafted by adr047-verify; the number was
reserved by mdpro-delegator.

It amends the acceptance criteria of WI-011 and WI-012 in
[the control-channel plan](../plans/20261002-plan-agent-control-channel.md). It also bears on
[ADR-0047](0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md), which is still Proposed
and is not edited by this record.

## Context

ADR-0047's plan has two work items that the journey catalogue
([ADR-0103](0103-the-e2e-journey-catalogue-is-the-single-source-for-device-checks.md)) overlaps:

- **WI-011** specifies `control-mdpro run-journey <id>`. It executes the `cli` and `launcher` steps, stops at
  `native` and `human` steps, and returns verdicts per step with the step class and evidence class.
- **WI-012** specifies a Feature Map with one entry per ledger row, giving the drive steps and the evidence.

Both were written before the catalogue existed. Built as written, the repo would have two journey formats, two
runners and two maps from ledger rows to checks. Codex's review of the e2e plan raised the runner overlap as
finding 2 and the Feature Map overlap as finding 22.

## Options considered

1. **WI-011 and WI-012 consume the catalogue** (chosen).
2. **A separate runner for EJ journeys** (rev1 of the e2e plan proposed `page`/`cli` execution with its own
   command). It lost because it duplicates WI-011's contract: its exit codes, unknown-outcome handling and
   evidence classes.
3. **The Feature Map keeps its own mapping.** It lost because two mappings from ledger rows to checks drift, which
   is the failure ADR-0104 exists to prevent.

## Decision

1. WI-011's `run-journey` reads the journey files from `tests/journeys/`. The executable form of the steps is a
   ` ```json steps ` block whose schema is WI-011's input format, defined when WI-011 starts. The runner
   executes:
   - `cli`;
   - `launcher`;
   - `page`, where the selected driver allows it.

   It stops at `native` and `human` steps, and writes ADR-0103's run manifest.
2. WI-012's Feature Map is derived from the catalogue and the ledger markers (ADR-0104). It adds only the drive
   notes an agent needs, and keeps no separate list of row-to-check links.
3. The acceptance of WI-011 and WI-012 is amended to say so before either starts. Until then the control-channel
   plan's text stands, and nothing in it is built.
4. Phase B is done only when, on the same build, the runner's results match a phase-A execution of the same
   journeys under the journey's projection. If ADR-0047 selects the read-only probe fallback, only the oracle
   side is automated.

## Consequences

- WI-011's schedule now depends on the catalogue's format being stable, and the catalogue's phase B depends on
  WI-011. Neither can be redesigned alone.
- The ADR-0047 spike journeys (J1a–J7b) appear in the catalogue as an ordered group that supersedes the old
  ids. `docs/test/20261002-adr0047-journeys.md` stays the frozen record of the spike's evidence until WI-005's
  comparisons finish.
- If WI-006's driver cannot reach WebView2, phase B is macOS-only and Windows stays agent-driven. The catalogue
  does not change; only who executes it does.
- One more cross-plan dependency for the delegator to sequence.
