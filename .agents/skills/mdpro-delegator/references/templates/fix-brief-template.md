# <ITEM> fix <n>: <what> (<date>, herdr-delegator)

**Tier <T>, difficulty <D>.** Fresh session (rule 71 § Fresh context: fix 2+, or fix 1 when the session is over 12 %).
Read, in order: `<ID>-brief.md` (grants still bind), `<ID>-handoff.md`, the merged verdict
`~/.mdpro-redesign/herdr-spike/delegator/<ID>-r<k>-merged.md`, then each open finding in full:
<report path § finding>, … (include every counter-proof the fix must answer).

## Scope
Branch `<branch>` at `<sha>`; rebase onto `origin/master` first if it moved. Same paths as the grant.

## Acceptance criteria
- **AC-F1 (finding <id>).** <the fix>, and its regression: <the exact sequence the auditor traced>, RED first
  (`<ID>-F<n>-1`; a fresh id, never one already in `receipts.json`). Must fail on `<sha>`.
- **AC-Fk.** Every existing AC still passes unchanged.
Matrix attack: <required (a missed case) | skipped: this brief fully specifies the fix and its regression>.

## Gates
As the grant's § 5. One fix commit on top; no push.

## Self-acceptance
A "Fix <n>" section in `<ID>-handoff.md`: AC table, receipts, lanes, SHA and trees, rejected approaches. Then stop.
