# <ITEM>: <one-line defect or work item> (<date>, herdr-delegator)

**Tier: <High|Medium|Low>** (ADR-0121: why). **Difficulty: <routine|standard|hard>** (ADR-0138: why; it sets your
effort and the adversary). Fresh session. Run `$mdpro-tdd-workflow` for the whole item, including the matrix attack.

## 1. Background
- **The row.** `docs/plans/20260912-frontend-backend-sequencing-order.md#<id>` (and the plan row, if any).
- **Evidence.** <device record / report path, the decisive log lines>.
- **The user's decisions**, quoted: 「…」.
- **Binding ADRs and rules:** <ADR-NNNN (what it fixes)>, rule 60's <items>. **Do not** <the guard that must hold>.

## 2. Scope
- Worktree `mdpro-wt/<agent>`; `git fetch origin`; branch `<type>/<id>-<slug>` from `origin/master` (`<sha7>`).
- **May edit:** <paths>, their tests, the <ID> row, `CHANGELOG.md` `[Unreleased]`, the ledger row.
- Anything else: stop and ask for a revised grant.

## 3. Acceptance criteria
1. **AC-1.** <behaviour>. Proof: <test file and case, or command>; expected <decisive output>. RED first: `<ID>-WI-1`.
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
