# <ITEM>: <one-line defect or work item> (<date>, herdr-delegator)

<!-- read-every-session:begin -->
- [docs/agents/implementor.md](../../../../../docs/agents/implementor.md)
<!-- read-every-session:end -->

**Tier: <High|Medium|Low>** (ADR-0121: why). **Difficulty: <routine|standard|hard>** (ADR-0138: why).
Fresh session. On both runtimes, run `jack-tdd-workflow` (Matt Pocock skills <pin>+). A fresh attacker checks the matrix
before RED; if unavailable, record `ATTACK-NOT-RUN` and stop.
<NL item: matrix from `nl-matrix-template.md`, eval results in the handoff (decision 20261103).>

**Rules for paths in scope.** <AGENTS.md path-table rules, by path>. Before editing any matching path, open each rule
named for that path in AGENTS.md. #592 checks rules 22 and 50 only.

## 1. Background
- **The issue.** `anzchy/mdpro#<n>` (or, for an existing D item, `docs/plans/20260912-frontend-backend-sequencing-order.md#<id>`), and the plan row, if any.
- **Evidence.** <device record / report path, the decisive log lines>.
- **The user's decisions**, quoted: 「…」.
- **Binding ADRs and rules:** <ADR-NNNN (what it fixes)>, rule 60's <items>. **Do not** <the guard that must hold>.

## 2. Scope
- Worktree `mdpro-wt/<agent>`; `git fetch origin`; branch `<type>/<id>-<slug>` from `origin/master` (`<sha7>`).
- **May edit:** <paths>, their tests, the <ID> row, `CHANGELOG.md` `[Unreleased]`, the ledger row.
- Anything else: stop and ask for a revised grant, **except** test fixtures and test support: you may add or edit files
  under `tests/fixtures/`, `tests/support/`, `tests/helpers/` and `tests/manual-fixtures/` that an AC's tests need,
  without stopping. List each in the handoff (user, 2026-10-27: 「建议1-7 均采用」, picsee comparison item 4).

## 2a. Open questions, with defaults
Questions the delegator could foresee, each with the default you follow **without stopping**. Record which default
you used and why in the handoff; the audit can challenge it.
- **Q1.** <question>. Default: <answer>.
Stop only for a question with no default here that would change scope, an Accepted ADR, or a user decision.

## 2b. WI-0: probe the risky seam first (when any AC rests on platform behaviour)
When an AC depends on platform order (AppKit, window, focus, OS key, filesystem, WebView or IPC), **before the test
matrix** probe the real platform: <seam and command>. Record observed order in `<ID>-probe.md` with command, log lines
and build SHA. Build matrix and tests on that order. Write "WI-0: none, because <reason>" when no AC rests on platform
behaviour. (D261 → D319: four implementations and seven audit rounds came from an assumed AppKit order.)

**Smoke ([ADR-0162](../../../../../docs/adr/0162-rework-countermeasures-before-0-3-6-and-a-process-freeze.md#decision) decision 2):**
"Smoke: owed, <operation>, run by <implementor|tester>" when a `device` AC exists, the item changes
`.agents/skills/*/scripts/**`, `scripts/{device,control}/**` or `scripts/redesign/device/**`, or it touches window and menu
targeting; otherwise "Smoke: none, because <reason>". It runs after implementation on each audited head, through the real
caller with its default arguments, and is not the ADR-0144 card.

## 3. Acceptance criteria
1. **AC-1 [unit|device].** <behaviour>. Proof: <test file and case, or command>; expected <decisive output>. RED first:
   `<ID>-S<n>` (or `<ID>-ACC` for the optional exit check). A `device` AC also names its ADR-0144 list entry (native menu or window order, cross-window or dialog
   focus, OS key event, file-system event, native dialog, updater or bundle, pixel value) and its cards
   `docs/test/cards/<CARD-ID>.md`. Each card quotes this AC's plan or D-row anchor, and is reviewed in the plan review
   or the round-one audit request. The tester role runs it after round one's code report; the implementor supplies
   the verify-build command in the handoff.
2. **AC-2.** …
(Receipt ids carry the item prefix; check that no `.claude/tdd-guardian/receipts/<ID>.json` exists, in any case, before naming it.)

## 4. Out of scope
<what, and which later item does it>.

## 5. Gates
Decisive files unlocked (≤2 workers) during RED→GREEN; then the full unit coverage lane and `typecheck:tests` + `build`
under `scripts/heavy-lock.sh`; the `rust` and `rust-verify-run` lanes if `src-tauri` changed; `pnpm ledger:check`. Put
`$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin` on PATH for every gate (the rustfmt guard test needs it);
`node scripts/lint/conditional-tests.mjs` (ADR-0162 decision 3). A Claude pane runs `command -v cargo` and `command -v rustfmt`
before any other step and stops if either is missing (ADR-0162 decision 4).
Commit on the branch; no push.

**Receipt habits** (user, 2026-11-01: 「两条都采纳（带条件）(Recommended)」; current landing policy:
[2026-11-04 decision](../../../../../docs/agents/decisions/20261104-receipts-are-audit-evidence.md#current-rule)):
- **Wrong RED:** only discard an unsettled branch-owned receipt before production changes. Fix the oracle and record a
  new id; name both ids and the reason in the handoff. Otherwise retain it as evidence.
- **Cycles:** record RED → minimal change → `verify` → focused tests; settle each before the next. A receipt verdict
  is advisory at landing. After a rebase, report `check-pending` drift; an auditor may ask the delegator for `replay`.

## 6. Self-acceptance
`<ID>-handoff.md` in your folder: the AC | evidence | verdict table, receipts, lanes, tree SHAs, paths changed, the
approaches you rejected and why, and the device recheck steps with the log line that proves each path. Then stop.
