# 0104. The ledger gate requires a journey or a tested exemption on each platform

## Status

**Proposed** (2026-10-15). Decisions 1 and 3 are **[Accepted]**: they are §0 Q2 of
[the e2e journeys plan](../plans/20261015-plan-e2e-journeys.md), and the user agreed with 「Q1-Q3 agree」, relayed
by mdpro-delegator on 2026-10-15. Decisions 2, 4 and 5 become Accepted when the user approves them. Drafted by
adr047-verify; the number was reserved by mdpro-delegator.

Builds on [ADR-0089](0089-the-feature-ledger-records-windows-state-in-a-per-area-difference-table.md) and
[ADR-0103](0103-the-e2e-journey-catalogue-is-the-single-source-for-device-checks.md).

## Context

The ledger has 185 inventory rows, 80 of them `Shipped`, and 12 Windows difference tables with 118 rows. The
Windows tables have the columns `能力 / Windows / 说明` and no 怎么确认 column (`scripts/ledger/windowsDiff.mjs`).
ADR-0089 makes an omitted Windows row a claim: "same state as macOS, verified on Windows".

`ledger:check` today:
- checks that paths resolve and that declared surfaces are named somewhere;
- has a backlog block that only prints a hollow-pass count, with no baseline and no refusal of additions
  (`scripts/ledger/check.mjs`);
- runs in the `prose-checks` job, which uses a shallow checkout and bare node.

Pushes to `master` run no CI by design (`ci.yml`), and rule 70 lets the delegator commit docs directly.

## Options considered

1. **A marker in the existing cell, with per-platform effective status and an identity baseline** (chosen).
2. **A new ledger column for journey ids.** It lost because every inventory row and all 12 Windows tables would
   change shape.
3. **A backlog counted by number.** It lost because a count lets one exemption be swapped for another without
   anyone noticing.
4. **No gate, only review.** It lost because review is how today's prose drifted.

## Decision

1. **[Accepted] Markers and effective status.**
   - Inventory rows carry their marker in 怎么确认; Windows rows carry it in 说明.
   - The three forms are `旅程：EJ-NNN`, `旅程（部分）：EJ-NNN` and `无 UI 旅程（<类别>）：<理由>；测试：<path>`.
   - The gate computes each capability's effective status per platform. An omitted Windows row inherits the
     inventory state, and `N/A` is excluded.
   - Every platform where the effective status is `Shipped` needs a marker.
   - Links are checked both ways: the journey's `ledger[].row` must equal the row's 能力 text, the platform must
     not be `n/a` in the journey, and a full marker must not point at a journey that declares `partial`.
2. **Exemptions.**
   - The categories are a closed set: `rust-only`, `pure-transform`, `os-owned` and `not-user-visible`.
   - Each exemption names at least one test path that resolves.
   - A whole user-visible pipeline is never exempted, only individual pure invariants within it. The gate cannot
     judge this, so rule 60's checklist carries it.
3. **[Accepted] Backlog by identity, shrinking only.**
   - `tests/journeys/ledger-backlog.baseline.json` lists `{area, platform, 能力}` identities.
   - The current set of unmarked identities must be a subset of the baseline.
   - A change that adds to the baseline is refused against the base ref.
   - A rename is declared in `renames`, and only after its old name is gone from the ledger.
   - Migration progress and device coverage are reported separately.
4. **History in CI.**
   - `prose-checks` fetches full history.
   - The base is the PR base on pull requests and the previous `v*` tag on tag runs. A manual run requires an
     explicit base.
   - A base that does not resolve, or that equals HEAD, fails the check.
   - The checkers stay dependency-free and run with plain node.
5. **Pull requests only.**
   - A commit that touches `tests/journeys/` or the baseline file goes through a branch and a PR, never through
     a delegator's direct docs commit.
   - Before such a landing, the landing verifier also runs `journeys:check --base <master HEAD>`.

## Consequences

- Day one has a large baseline, close to every `Shipped` row on both platforms. It shrinks only as journeys or
  tested exemptions land.
- A rename of a 能力 cell now costs a baseline edit in the same commit.
- An omitted Windows row now carries an obligation the author may not have meant. Writing `Unknown` explicitly
  becomes the cheap way out, which is what ADR-0089 already asks for.
- Decision 5 narrows rule 70's direct-commit exception for the delegator. Rule 70 needs a matching sentence when
  this is accepted.
- `prose-checks` gets slower with a full-history checkout, and gains a failure mode when the base is missing.
- The gate proves that links exist and agree. It cannot prove that a journey actually exercises what its
  `covers` list claims; that stays a review question.
