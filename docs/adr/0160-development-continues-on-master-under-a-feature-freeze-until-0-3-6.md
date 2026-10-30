# 0160. Development continues on `master` under a feature freeze until 0.3.6; there is no restart from v0.3.5

**Status**: Accepted (2026-10-30). Decided by the user: 「采纳方案二，按建议路线走」. The user decided after reading two
independent evaluations, from Codex and Fable, which were run on the same brief and came to the same recommendation.
Recorded by herdr-delegator. This ADR supersedes no earlier ADR, and it builds on [ADR-0083](0083-master-is-the-single-integration-trunk.md).

## Context

The user asked whether development should restart on a branch cut from the `v0.3.5` release (`67715ea2`,
2026-10-16), abandoning every later commit, or keep going on the current `master`. The question followed the
quality audit in `docs/audit/` (untracked), which found the gates and the agent process weak.

These were the facts when the question was asked (evidence in the two evaluation reports, summarised below):

- `v0.3.5..81bc8384` has 481 commits: 273 docs, 114 fix and 34 feat. Its diff is +277k lines, but 49 % of that is a
  single file, `.claude/tdd-guardian/receipts.json`. About 48k lines are product source and 62k are tests.
- `master` holds work that v0.3.5 lacks:
  - roughly 30 data-loss and recovery fixes, among them D261, D214, D290, D253, D299, D305, D241, D273, D291 and D246;
  - three RustSec fixes;
  - Save As and WYSIWYG Find/Replace;
  - the v2 command table, which drives shortcuts and menus.

  The feature ledger went from 82 Shipped rows to 99.
- Only one regression against v0.3.5 is proven, D313 (on Linux, a custom Ctrl+Shift+M Save is captured by Highlight).
  D294 and D321 are a candidate: a WebKit crash when a secondary window closes, which can quit the app. Nobody has
  probed v0.3.5 for it. The W036 Windows batch is incomplete: D50 fails, and that failure predates v0.3.5. Five items
  were not exercised because of driver defects D336–D338.
- None of the audit's root causes is in product code, and every one of them exists at v0.3.5 as well:
  - CI does not run when `master` is pushed;
  - macOS is built only on tags;
  - `land-guard --docs-only`;
  - the dormant `ai-verifier.yml`;
  - the size of rules 70 and 71;
  - the receipt tooling;
  - the Mac mini's capacity.

## Options considered

1. **Restart from v0.3.5** and carry wanted fixes over by cherry-pick. This option lost, for three reasons:
   - **It drops the data-safety fixes.** Any that are carried back would collide with the rewrite of about 170
     files for menus and shortcuts, `App.tsx` and `commands/file.rs` among them.
   - **It orphans the records that cite master's SHAs:**
     - 866 receipts and the `refs/receipts/` trees;
     - 104 audit-log rows;
     - 47 ADRs;
     - the I556 r4 manifest hashes;
     - PR #549 and the branches in flight.
   - **It fixes nothing.** It breaks ADR-0083 decision 1 and leaves every process gap exactly where it is.
2. **Continue on `master` as before**, with no freeze. This option lost because new feature work keeps taking the
   implementation slots. The release blockers and #557's gate work would then land late, if they land at all.
3. **Continue on `master` under a feature freeze, then a lean 0.3.6** (chosen). Both evaluations recommended it.

## Decision

1. **`master` stays the trunk.** There is no branch from v0.3.5 for redevelopment. A `release/0.3` branch from
   `v0.3.5` is cut only if published users need an urgent hotfix (ADR-0083 decision 3), and it carries that fix alone.
2. **New product features are frozen until 0.3.6 is released.** These may still be granted:
   - fixes the 0.3.6 release needs: D50, and D336–D338 so that the W036 rerun can run;
   - #557's gate work (I556, tickets #558–#563);
   - D-item fixes that restore stated behaviour.

   Any other gated (rule 12) feature waits. The user still decides which items are granted and when.
3. **0.3.6 is cut from `master`** once the W036 Windows rerun passes on one locked SHA, together with the 0.3.6 device
   regression. D294 and D313 ship as the Known issues the `CHANGELOG.md` Unreleased section already lists, unless
   they are fixed first.
4. **After 0.3.6**, #557's tickets land one PR at a time, along with #556 solutions 6, 7 and 8. When both are done the
   freeze is lifted explicitly, by the user's word recorded in the sequencing doc.

## Consequences

- **Kept:** every data-loss fix, the feature work since 0.3.5, the single trunk, and the history of receipts, audits
  and ADRs that cites master's SHAs.
- **Given up:** a clean slate. The debt since 0.3.5 stays and must be paid on `master`:
  - Rust files over 300 lines, 60 now against 28 at v0.3.5;
  - 61 gate exceptions;
  - 107 D rows registered but not fixed;
  - 15 CHANGELOG items still awaiting a device check;
  - rules 70 and 71 at 538 and 400 lines.
- **Risk:** `master` may still hold the D294 crash, which can lose unsaved edits that no draft holds. 0.3.6 ships with
  it as a Known issue unless it is fixed first.
- **Risk:** tooling churn may keep using up the slots, so #557 lands late and the freeze runs longer than planned. The
  freeze forecloses new user-facing features until 0.3.6.
- Nothing in this decision repairs CI or the gates. That work is #557 and ADR-0159, which this ADR only orders.

Evidence: [`docs/reference/20261030-restart-from-v035-vs-continue-on-master.md`](../reference/20261030-restart-from-v035-vs-continue-on-master.md) (both evaluations), and
`docs/audit/mdpro 工程质量与 AI Agent 开发流程深度审计.md` (untracked, the user's own file).
