# Landing docs (one docs-only commit right after `git merge --ff-only <sha>` and `git push origin master`)

- `docs/audit/audit-log.md`: one PR row after the newest (`| #<pr> | <ID> | <tier> | <ranges> | <rounds> | <Codex per
  round> | <Opus per round> | <security> | <merged per round> | PR #<pr> comments | landed `<sha>` |`); one
  `G<pr>-<n>` row under § Gate exceptions for every receipt or lane exception, quoting the user's ruling.
- Sequencing row: status → `🟡 **已落地 `<sha>`、真机未验**（date, PR, rounds, merged BLOCKING C0 H0, exceptions, owner）`.
- Ledger and CHANGELOG were the implementor's; check they landed.
- ADR-0129 when a High lands open: D row with owner, fix-by version, compensating control, CHANGELOG Known issues, the
  quoted ruling.
- Device records: `docs/test/<date>-<batch>-<area>-device-check.md` = header, the delegator's check against the cards
  (corrections of the brief stated plainly), then each tester report verbatim. New findings get a D row in the same
  commit, numbers reserved in `~/.mdpro-redesign/herdr-spike/delegator/reservations.md` first. A FAIL in landed,
  audited code also adds its `docs/audit/escapes.md` row in that same commit: the audited range from audit-log.md,
  the record line, and the fault's `file:line` at the pre-fix SHA. If the fault is not yet root-caused, the record says
  "escape row held" (issue #542 item 5).
- Before a landing: if your dirty docs touch a path the PR also touches, stash them under a unique name and pop
  **that entry by name**, never a bare `git stash pop`: the stash stack is shared by every worktree of the repo, and
  implementors stash too. `m=land-$(date +%s)`; `git stash push -q -m "$m" <path>`; merge; then
  `git stash pop "$(git stash list | grep -m1 -F "$m" | cut -d: -f1)"`, and stop if that finds nothing.
- Commit messages end with the attribution line; push at once. Then tell peers to fast-forward.
