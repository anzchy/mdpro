# <ITEM> fix <n>: <what> (<date>, herdr-delegator)

<!-- read-every-session:begin -->
- [docs/agents/implementor.md](../../../../../docs/agents/implementor.md)
<!-- read-every-session:end -->

**Tier <T>, difficulty <D>.** Fresh session ([implementor.md § Fix sessions](../../../../../docs/agents/implementor.md#fix-sessions): fix 2+, or fix 1 when the session is over 12 %).
Read, in order: `<ID>-brief.md` (grants still bind), `<ID>-handoff.md`, the merged verdict
`~/.mdpro-redesign/herdr-spike/delegator/<ID>-r<k>-merged.md`, then each open finding in full:
<report path § finding>, … (include every counter-proof the fix must answer).

## Scope
Branch `<branch>` at `<sha>`; rebase onto `origin/master` first if it moved. Same paths as the grant, and the same
fixture allowance (brief § 2).
- **May edit:** <paths>, copied from the grant's May edit with its backticks; #592 refuses a fix brief without this line.

**Rules for paths in scope.** <AGENTS.md path-table rules, by path>. Before editing any matching path, open each rule
named for that path in AGENTS.md. `prompt.sh` checks rules 22 and 50 only, each named as `rule <n>` (#592;
forms: `codex-panes.md`).

## Open questions, with defaults
- **Q1.** <question>. Default: <answer>. (Follow each default without stopping; record which you used.)

## Acceptance criteria
- **AC-F1 (finding <id>).** <the fix>, and its regression: <the exact sequence the auditor traced>, RED first
  (`<ID>-F<n>-1`; a fresh id, never one that already has a `.claude/tdd-guardian/receipts/<ID>.json`). Must fail on `<sha>`.
- **AC-Fs (instance sweep, every Critical or High).** The class is <class>. The "Fix <n>" section carries a sweep
  table: one row per instance (site × triggering case or input shape) across the whole class wherever the range
  reaches it, each fixed with its regression test or not affected with a file:line trace or a command and its
  output ([§ Converging rounds](../landing-and-audit.md#converging-rounds)).
- **AC-Fk.** Every existing AC still passes unchanged.
Matrix attack: <required (a missed case) | skipped: this brief fully specifies the fix and its regression>.

## Gates
As the grant's § 5. One fix commit on top; no push.

## Self-acceptance
A "Fix <n>" section in `<ID>-handoff.md`: AC table, receipts, lanes, SHA and trees, rejected approaches. Then stop.
