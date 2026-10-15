# 0103. The e2e journey catalogue is the single source for device checks

## Status

**Proposed** (2026-10-15). The decisions the user already took are marked **[Accepted]** below:

- Decision 1 (format) and decision 3 (shared goldens) are §0 Q1 and Q3 of
  [the e2e journeys plan](../plans/20261015-plan-e2e-journeys.md). The user's words were 「Q1-Q3 agree」.
- Decision 5 (where device journeys run) is §0 Q4. The user said 「Q4 同意」 after a plain-language explanation,
  and understood it as: real-app journeys run only on the Mac mini and win-desktop, and hosted CI runs only
  Tier-0 and the gates.

Both answers were relayed by mdpro-delegator on 2026-10-15. The other decisions become Accepted when the user
approves them. Drafted by adr047-verify; the number was reserved by mdpro-delegator.

Relates to [ADR-0034](0034-a-local-real-app-journey-lane-runs-before-release.md) (Proposed) and supersedes none
of it (see decision 7).

## Context

Every device check so far has been an ad-hoc brief. Whoever writes the brief picks its steps and fixtures, so two
checks of the same feature can't be compared. The ledger's 怎么确认 cells are prose that no machine can check. The
user asked, on 2026-10-15: 「我需要固定一组fixture，涵盖App主要的快捷键和各种功能，随着迭代开发，不断完善，fixture需与
feature-ledger 尽量映射」.

VMark (xiaolai/vmark) keeps a catalogue of 47 journey modules with ids that are never reused, a Tier-0 suite and
a feature-map gate. It also has these gaps:
- fixtures generated at runtime;
- Tier-0 linked to the journeys by comments only;
- a stale prose count ("38" against 47);
- no Windows CI leg;
- debug builds only.

The evidence, and two Codex reviews (`review-plan-mv9470lo-rsc315` and `review-plan-mv94qrr4-rqovhp`), are in
the plan's §3 and §12.

## Options considered

1. **A catalogue of Markdown journeys with a JSON metadata block** (chosen). Agents (dtrack's computer use and
   the Windows SSH driver) execute the step tables today. The metadata is machine-checked with plain node.
2. **VMark-style `.mjs` modules.** Feasible, because the existing drivers can act. It lost on cost: each platform
   would need an adapter now, and it would duplicate ADR-0047 WI-011's runner.
3. **Markdown with YAML frontmatter.** It lost because no YAML loader is available to a dependency-free checker,
   and `prose-checks` installs no dependencies.
4. **Keep ad-hoc briefs.** It lost because it is the problem the user named.
5. **Run device journeys weekly on hosted CI** (VMark). It lost because there is no driver that can operate the
   WebView on hosted runners before ADR-0047's selection, and the device cost has not been measured.

## Decision

1. **[Accepted] Format.** One file per journey, `tests/journeys/EJ-NNN-<slug>.md`, opening with a
   ` ```json journey ` block, followed by:
   - Why;
   - Setup;
   - Steps, with step classes `cli` / `launcher` / `native` / `human` / `page`;
   - Oracle;
   - Controls;
   - Failure condition;
   - Cleanup.

   Turning steps into executable input is deferred to ADR-0105.
2. **Identity.** An `EJ-NNN` id and a case id within it are never reused. A journey file is never deleted; it
   is retired in its metadata. Ordered journeys that share a session (the ADR-0047 spike set, the watcher and RC
   regression groups) carry a `group` and run whole.
3. **[Accepted] Fixtures and goldens.** A fixed fixture corpus is versioned in the repo, with a golden file for
   each case's expected output. Large and CRLF files come from deterministic generators. Tier-0, Rust tests and
   device runs share the golden data, and each layer asserts only what it can observe. A fake fs never produces
   golden bytes.
4. **Verdicts and aggregation.**
   - Case verdicts: `PASS`, `FAIL`, `XFAIL` (a known defect, tied to a D row), `XPASS`, `未执行`, `BLOCKED`
     and `N/A`.
   - A journey passes on a platform only when every required case is `PASS` or `XFAIL` and its controls hold.
   - A run that is not wholly PASS or FAIL is INCOMPLETE, and INCOMPLETE is not green.
   - Every run writes a machine-readable manifest. A PASS counts as fresh only while the journey revision and
     golden hashes in the manifest still match.
5. **[Accepted] Where journeys run.** Device journeys run on the owned devices only: the Mac mini (dtrack) and
   win-desktop. In phase A, hosted CI runs Tier-0 and the gates only. This is a scope and cost decision, to be
   revisited once a driver exists and the device time has been measured.
6. **Replacement order.** A smoke tier runs in addition to the RC regression and the watcher combined run. It
   replaces them only after their groups have been migrated and run once alongside the old gate with equivalent
   results (rule 70: combined runs stay whole).
7. **ADR-0034.** The catalogue is the content of ADR-0034's `app` lane. Its decision 7 journeys become catalogue
   entries. Its single-command `pnpm test:app` waits for the phase-B runner (ADR-0105). This record changes no
   other part of ADR-0034, which stays Proposed.

## Consequences

- A brief becomes "this tier on this build, plus any one-off items". A one-off that recurs becomes a journey.
- Every commit that changes behaviour now edits three things, not one: the ledger row, the journey and the golden.
  That is real maintenance cost on every behaviour change.
- Golden files fix one canonical output. Where v0.3.3 and v0.3.4 differ (`*` against `-`), someone has to choose,
  and the choice is recorded in `fixture.json`.
- Known defects stay visible as `XFAIL` and do not count as coverage. The catalogue will show red-adjacent states
  for as long as the defects are open.
- A full run is estimated at 6–9 device-hours per release, before overheads, and the two devices run one job at a
  time. Release timing now depends on device availability.
- Hosted CI cannot catch a device-level regression between releases. Only the RC smoke tier and targeted runs will.
- Phase A steps are prose that agents read. Two agents can still execute the same step differently until
  ADR-0105's runner exists. Controls and manifests narrow that risk, but do not remove it.
