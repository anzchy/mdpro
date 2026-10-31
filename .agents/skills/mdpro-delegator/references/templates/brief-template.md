# <ITEM>: <one-line defect or work item> (<date>, herdr-delegator)

**Tier: <High|Medium|Low>** (ADR-0121: why). **Difficulty: <routine|standard|hard>** (ADR-0138: why; it sets your
effort and the adversary). Fresh session. On Codex, run `$tdd-guardian:tdd-guardian-workflow` for the whole item, including the
matrix attack. On Claude (the plugin is off there), follow rule 71 § Briefs for Claude: design the matrix yourself, have a fresh
subagent attack it with `references/templates/matrix-attack-prompt.md`, and record REDs with `node scripts/tdd/red-receipt.mjs`.

## 1. Background
- **The row.** `docs/plans/20260912-frontend-backend-sequencing-order.md#<id>` (and the plan row, if any).
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
When an AC depends on an order or behaviour the platform decides (AppKit menu or window events, focus, OS key events,
file-system events, WebView or IPC timing), **before writing the test matrix** probe it on the real platform and record
what actually happens: <the seam, and the probe to run>. Write the observed order into
`<ID>-probe.md` (command, log lines, build SHA). The matrix and the tests are built on the observed order, never on an
assumed one. Write "WI-0: none, because <reason>" when no AC rests on platform behaviour. (D261 → D319: four
implementations and seven audit rounds came from an assumed AppKit order.)

## 3. Acceptance criteria
1. **AC-1 [unit|device].** <behaviour>. Proof: <test file and case, or command>; expected <decisive output>. RED first:
   `<ID>-WI-1`. A `device` AC also names its ADR-0144 list entry (native menu or window order, cross-window or dialog
   focus, OS key event, file-system event, native dialog, updater or bundle, pixel value) and its cards
   `docs/test/cards/<CARD-ID>.md`. Each card quotes this AC's plan or D-row anchor, and is reviewed in the plan review
   or the round-one audit request. The tester role runs it after round one's code report; the implementor supplies
   the verify-build command in the handoff.
2. **AC-2.** …
(Receipt ids carry the item prefix; check `receipts.json` that the id is free before naming it.)

## 4. Out of scope
<what, and which later item does it>.

## 5. Gates
Decisive files unlocked (≤2 workers) during RED→GREEN; then the full unit coverage lane and `typecheck:tests` + `build`
under `scripts/heavy-lock.sh`; the `rust` and `rust-verify-run` lanes if `src-tauri` changed; `pnpm ledger:check`. Put
`$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin` on PATH for every gate (the rustfmt guard test needs it).
Commit on the branch; no push.

## 6. Self-acceptance
`<ID>-handoff.md` in your folder: the AC | evidence | verdict table, receipts, lanes, tree SHAs, paths changed, the
approaches you rejected and why, and the device recheck steps with the log line that proves each path. Then stop.
