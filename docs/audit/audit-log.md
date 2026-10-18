# Audit log

One row per audited range, and one row per Critical or High finding
([ADR-0121](../adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md)
Decision 6). The delegator is the only writer. A row is written when its
merged verdict is posted on the PR, updated at each confirm, and closed at the
final outcome. The rows come from the merged-verdict PR comments.

It starts with audits requested after `811e5047`, the commit that accepted
ADR-0121. WI-009 and WI-4.3a finished under the earlier order and are not
backfilled.

## Ranges

- **Tier**: High / Medium / Low (rule 70 item 4, "Effort follows risk").
- **Base**: `git merge-base master <head>` at audit time. It moves with each rebase, so a row
  lists every base it had.
- **Counts**: each detector's raw `C/H/M/L`, then the merged blocking count `BLOCKING C<n> H<n>`.
- **Outcome**: `landed <sha>` / `superseded by <PR>` / `abandoned` / `open`.

| PR | Item | Tier | Base → head | Rounds | Codex | Fable | security-review | Blocking | Reports | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|

## Findings

- **Id**: `F<PR>-<n>`, stable once posted.
- **Detectors**: Codex, Fable, `security-review`, or several of them.
- **Class**: the bug class it names. The same class raised on a second PR goes into
  `REVIEW.md` or becomes a lint-test D item.
- **Outcome**: `fixed <sha>` / `refuted` (with the counter-proof's link) / `pre-existing D<n>` /
  `ruled by the user` (quoted).

| Id | PR | Severity | Detectors | Class | file:line | Outcome |
|---|---|---|---|---|---|---|
