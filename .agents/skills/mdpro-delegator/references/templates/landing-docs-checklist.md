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
  commit, numbers reserved in `~/.mdpro-redesign/herdr-spike/delegator/reservations.md` first.
- Before a landing: if your dirty docs touch a path the PR also touches, `git stash push -q -m <name> <path>`, merge,
  `git stash pop`.
- Commit messages end with the attribution line; push at once. Then tell peers to fast-forward.
