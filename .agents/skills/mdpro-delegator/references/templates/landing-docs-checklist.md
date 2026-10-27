# Landing docs (one docs-only commit after the checked landing)

On Codex, push the PR head with `node scripts/codex-rules/push-guard.mjs <sha> <branch> [--expected-remote-oid <A>]`,
land with `node scripts/codex-rules/land-guard.mjs <sha>`, and push the direct docs commit with
`node scripts/codex-rules/land-guard.mjs --docs-only`. On Claude, use rule 70's
`git merge --ff-only <sha>` and `git push origin master`.

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
- Before a landing: if dirty docs touch a path the PR also touches, run from the repo root:
  `node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs save -- <paths>` and record the printed OID.
  After landing, run `node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs apply <oid>`.
  The helper applies that exact commit and retains its stash entry; retain the OID in the landing record for later
  coordinated cleanup. The stash stack is shared by all worktrees, so a mutable index cannot identify this entry.
- Commit messages end with the attribution line; push at once. Then tell peers to fast-forward.
