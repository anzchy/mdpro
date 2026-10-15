# e2e journeys

The fixed catalogue of device checks for macOS and Windows. Each journey
names the ledger rows it proves
([ADR-0103](../../docs/adr/0103-the-e2e-journey-catalogue-is-the-single-source-for-device-checks.md);
plan [`docs/plans/20261015-plan-e2e-journeys.md`](../../docs/plans/20261015-plan-e2e-journeys.md)).
This directory holds only assets: journey files, the registry, projections
and (from WI-E2E-2) fixtures. The tests that check them live where ADR-0098
puts tests: Tier-0 tests at the `tests/` root as `ej-NNN-<slug>.test.ts(x)`,
and the gate's own tests in `tests/tooling/journeys-*.test.ts`.

<!-- journeys:count -->
**1** journeys: 1 active, 0 draft, 0 retired.
<!-- /journeys:count -->

The count is generated: run `pnpm journeys:check --write-count`. Never edit it
by hand.

## Layout

| Path | What |
|---|---|
| `EJ-NNN-<slug>.md` | One journey: a ```` ```json journey ```` metadata block first, then the sections below |
| `REGISTRY.md` | Every id ever issued. Rows are only ever added |
| `projections/EJ-NNN.json` | The journey's log projection (§4.4) |
| `fixtures/<id>/` | Inputs, `expected/` goldens, and `fixture.json` with each file's sha256 (WI-E2E-2) |

## Ids

`EJ-NNN`, three digits, in issue order. **An id is never reused and a journey
file is never deleted.** A retired journey keeps its file, with
`"status": "retired"` and a `"reason"`. A case id is never reused within its
journey either: retire it, don't delete it. Renaming a file is fine as long as
it still starts with its id.

## Metadata

The fields, the enums and the inheritance rules are in plan §4.1. The ones a
writer most often gets wrong:

- `platforms.<macos|windows>.status` is `required`, `optional` or `n/a`, and
  `n/a` needs a `reason`. A required platform requires every live case,
  except a case that lists that platform under `optional`, or that names other
  platforms in its `platforms`.
- `ledger[].row` is the ledger row's 能力 cell, verbatim. `covers` lists the
  invariants proved. `partial` says what is not covered; leave it out only
  when the journey proves the whole row.
- `intended` always states the behaviour the feature should have. A known
  defect is written as `"knownDefect": "Dnnn"` and expected to `XFAIL`. It is
  never written as a changed expectation.
- `"status": "draft"` is checked for structure only (id, title, status), so a
  journey can land before its tests and fixtures do.
- Tier-0 and Rust tests name their journey on their first line:
  `// Tier-0 for EJ-NNN` (or the second line, after a
  `// @vitest-environment` line) and `// Rust golden for EJ-NNN`. The journey
  lists them under `tier0` and `rust`. The gate checks both directions.

Sections: **Why** (what it proves; where Tier-0 and Rust stop and why) ·
**Setup** · **Steps** (`# · Class · Action · macOS input · Windows input ·
Expected log · Expected state`; classes `cli` / `launcher` / `native` /
`human` / `page`) · **Oracle** · **Controls** · **Failure condition** ·
**Cleanup**.

## Verdicts

| Case | Meaning |
|---|---|
| `PASS` | Path reached, oracle holds, controls hold |
| `FAIL` | Path reached, oracle does not hold |
| `XFAIL` | Failed as its `knownDefect` says it would |
| `XPASS` | Has a `knownDefect` but passed. A person confirms it; then `knownDefect` is removed and the D row updated in one commit |
| `未执行` | Path not reached, or a control did not hold |
| `BLOCKED` | Environment: driver, device or build. Give the reason |
| `N/A` | The metadata declares this platform not applicable |

**A journey on a platform** is PASS when every required case is `PASS` or
`XFAIL`. It is FAIL when any required case is `FAIL` or `XPASS`, and
INCOMPLETE otherwise (a required case not run, blocked or missing). Optional
cases are recorded but never decide it.

**A run** is PASS when every applicable journey passed, FAIL when any failed,
and INCOMPLETE otherwise, including a run in which nothing applied.
**INCOMPLETE is not green.** It supports no release and no ledger date.

Each run writes `docs/test/journey-runs/<date>-<tier>-<platform>-<sha7>-<n>.json`
(plan §4.6). The gate checks its schema, recomputes every verdict, and
requires `incompleteReason` for an INCOMPLETE or interrupted run.

## The gate

```bash
pnpm journeys:check                 # every rule; exits 1 on any finding
pnpm journeys:check --base <rev>    # compare history against <rev>
pnpm journeys:check --write-count   # regenerate the count block above
```

CI runs it in `prose-checks` with the full history. The base is the PR's
base, the previous `v*` tag for a tag build, or the `base` input of a manual
run. It fails, never skips, when the base cannot be resolved or equals HEAD.
