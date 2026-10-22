# 0121. Audit effort follows risk, pre-existing findings do not block, and the auditors are measured

## Status

Applied 2026-10-22 by [ADR-0131](0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md): its auditor-change escape replay ran on zero escapes ("insufficient evidence"), and the user decided without recall numbers. Nothing in this ADR is superseded.

Accepted, 2026-10-18. Decided by the user, recorded by mdpro-delegator. The user's words, on the
draft with the revisions below: 「Accept with revisions (Recommended)」. Reviewed before acceptance
by Codex `review-plan` and by Opus (`mdpro-fable-auditor`, plan mode) over three drafts. Codex's
final verdict was READY. Opus's last High (the base moving across a rebase) is answered in
Decision 3.

Partially superseded 2026-10-20 by [ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md), under herdr only: `/security-review` on the High tier is run by an Opus fork of herdr-delegator, not mdpro-codex-audit.

Partially superseded (2026-10-21) by [ADR-0129](0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md): Decision 3 (a pre-existing High's D row also carries a
fix-by and is assessed at every release checkpoint) and Decision 6 (how a ruling on a disputed finding
is counted).

The new rules apply to every audit requested after the commit that accepts this ADR. WI-009 and
WI-4.3a, already in audit, finish under the earlier rules.

**What the user asked for.** After reading the Claude Code team's post on code review
(<https://claude.dev/blog/solving-code-review-at-anthropic/>), the user asked:
「according to this, see how to improve our auditing principle, policy, etc.」. They were shown six
proposals, kept verbatim in
[`docs/reference/20261018-code-review-post-gap-analysis.md`](../reference/20261018-code-review-post-gap-analysis.md),
and chose 「1+2+3 core (Recommended), 5 Measure auditors, 4 REVIEW.md」.

**This draft is narrower than what the user chose.** The reviews changed two of the chosen
proposals. These are revisions made after review, not part of the user's choice, and the user is
asked to accept them explicitly:
- **Proposal 1** read: a proven pre-existing "Critical or High … becomes a D item and does not
  block". This draft lets only a pre-existing **High** land on proof. A pre-existing **Critical**
  stays blocking until the user rules, and the ruling is quoted (Decision 3).
- **Proposal 2** put "test-only" changes in the Low tier. This draft tiers each test by what it
  guards. A diff that deletes or loosens an existing assertion is never Low (Decision 1). The
  draft also **widens** proposal 2, which set tiers by path alone: a change is High by what it does
  wherever its file lives, and a path no row names is High.

The first draft also let a finding outside the fix diff become a D item. Both reviews showed this
would let a regression the PR introduced land, so this draft drops it (Decision 4).

**If accepted, it partially supersedes these exact clauses, and only as stated:**
- **ADR-0085:**
  - Decision 1, and Decision 3's clause that the gate is read off the four-severity count line:
    the gate reads the **blocking** count (Decision 3);
  - Decision 2:
    - its deferral clause, for proven pre-existing Highs only;
    - its confirm scope, widened from "its findings" to the fix diff plus the open findings
      (Decision 4).
- **ADR-0115:**
  - Decision 4: the gate is the blocking count;
  - Decisions 1, 3, 5 and 6: for the tier exceptions in Decisions 1 and 2.
- **ADR-0120:**
  - Decision 1: a Low-tier round is Codex alone, plus any Fable challenge;
  - Decision 2: escalation to the user concerns open **blocking** findings.

  The three-round cap and the user's authority to rule are unchanged.
- **ADR-0095 Decision 5:** "zero Critical and zero High" means zero **blocking**.
- **Rule 60:** its BLOCK, MUST and Critical-pass blocker requirements get the same narrow exception
  for proven pre-existing Highs.

**Unchanged:**
- ADR-0118 Decision 2: PR tiers do not govern ADR and plan reviews.
- ADR-0085 Decision 3's non-registration: Medium and Low findings are never D items.

## Context

Since ADR-0115, every work item has been audited the same way: two blind auditors (Codex and Fable),
up to three rounds, and every Critical or High blocks. This week showed three problems with that:

- **D277**, a test-only z-index guard, used all three rounds with both auditors. Each confirm round
  found a new instance of the same bypass class, so the fix went one instance at a time.
- **D261**: Codex rated High a race in `close_document`, which this PR does not touch. It took a
  challenge round to establish that the race predates the PR and that the PR shrinks its effect. The
  rules had no category for "real, but not this PR's".
- **Nothing is measured.** We do not know which auditor catches more, how often findings are refuted,
  or how many defects reached the device after an audit had passed. So a proposal to change an
  auditor's model (see `docs/reference/20261018-herdr-multi-agent-rule70-roles.md`) has no evidence
  to go on.

**What the post actually describes, read with care:**
- Its tiers set how many *human approvals* a change needs. Automated review and security review
  still run on every PR.
- Its *Pre-existing* tag is about attribution.
- Its convergence rules cap re-review at three rounds, re-review only the new diff, flag the class of
  a bug, and never repeat a finding.

We have no human reviewer to remove. What we can scale is the number of model audits.

## Options considered

1. **Keep the current order.** Lost: it spends two auditors and three rounds on presentation-only
   diffs, and it blocks a PR on bugs the PR did not write.
2. **Let the author pick the tier.** Lost: the change sets the tier, not the person who wrote it.
3. **No audit for Low-tier changes**, our analogue of the post's zero approvals. Lost: the post itself
   still reviews every PR automatically, and we have no escape data yet to show that this is safe.
4. **Unlisted paths default to Medium** (the Opus reviewer's suggestion). Lost to **default High**
   (Codex's): a path nobody thought to list is exactly the one nobody has judged safe.
5. **Confirm rounds treat a finding outside the fix diff as out of scope and turn it into a D item**
   (the first draft). Lost: both reviewers showed it lets a High that the PR introduced land when it
   is found late. That is the worst outcome an audit can have.
6. **This draft.** Tiers decided by behaviour and path, failing closed. A proven pre-existing High
   does not block. Confirms are scoped to the fix diff, but a regression the PR introduced always
   blocks. `REVIEW.md`. An audit log with an escape set.
7. **Implementors run a fresh-context review before handoff.** Not chosen by the user.

## Decision

1. **Each audited range gets a tier.** The delegator states the tier and the reason in the audit
   request. Either auditor may raise it, with a reason, and neither may lower it. The highest tier
   any part of the range falls in wins. **A path matched by no row is High.**

   | Tier | What falls in it | Audit |
   |---|---|---|
   | **High** | **By behaviour, wherever the file lives:** code that mutates document content; code that saves, opens, closes, recovers, discards or drafts a document; watcher and encoding code; window and menu targeting; MCP writes and their approval; writing, merging, migrating or resetting preferences.<br>**By path:** `src-tauri/**` (production code), `src/services/**`, `.github/**`, `scripts/{ci,release,control}/**`, `.claude/hooks/**`, `.claude/agents/**`, `.claude/tdd-guardian/config.json`, `vitest*.config.ts`, `vitest.workers.ts`, `vite.config.ts`, `tsconfig*.json`, `tests/setup.ts`, `package.json`, `pnpm-lock.yaml`, `patches/**`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/**`.<br>**Tests**, in `tests/**` or `*_tests.rs`, that guard any of the above, or trust, isolation, release-clean or the landing gates | Codex and Fable, both on full's nine dimensions, plus `/security-review` |
   | **Medium** | Other `src/**` code, other `scripts/**`, `.claude/skills/**`, and tests of Medium code | Codex and Fable on mini's five dimensions, as today |
   | **Low** | Only CSS (including `src/**/*.css`), `docs/**`, `design/**`, `CHANGELOG.md`, and tests that guard presentation only (layout, tokens, z-index, type ramp) | Codex mini alone |

   **Tier-neutral** (does not raise the tier): `.claude/tdd-guardian/receipts.json`, the sequencing
   doc, and `docs/feature-ledger.*`. A range made only of tier-neutral files is Low.

   Two more rules for tests:
   - **Shared helpers** in `tests/support/` take the tier of the tests that use them.
   - **A diff that deletes or loosens an existing test assertion is at least Medium**, whatever the
     test guards.

   Test cases:
   - **High:** D261, D214, D241 with D273, WI-009, and M7's Save/Reset path.
   - **Medium:** D259.
   - **Low:** D277 under the user's scope ruling 「Accidental drift only (Recommended)」.

   Docs-only commits stay unaudited (ADR-0085 Decision 4).

2. **How each tier's audit runs:**
   - **`/security-review` (High tier).** This is Claude Code's built-in `/security-review` command.
     The mdpro-codex-audit session runs it on Opus, in the same request as the full audit. The
     command reviews a checkout's pending changes, so the session runs it in a detached worktree of
     the head with the PR's own diff (`base..sha`, as defined in Decision 3) presented as pending
     changes against `base`, then removes the worktree.
     - Its Critical and High findings are logged with the detector `security-review`, not Codex.
       They merge like any auditor's: a one-sided one is challenged by Fable.
     - A High-tier audit is incomplete until the command has run successfully. A run that fails or
       cannot run keeps the gate closed until it succeeds, or until the user rules.
   - **Low tier.** A round is Codex alone, plus a Fable challenge of each Critical or High that
     Codex raises, so a second model sees every finding that would block. Confirms are run by Codex,
     and by Fable for each finding it challenged and confirmed.
   - **A tier raised mid-round.** The delegator dispatches Fable blind, at the new tier, on the whole
     range, inside the same round.

3. **A proven pre-existing High does not block.**

   The **base** is the PR's fork point on `master`, `git merge-base master <sha>`. It comes before
   every commit in the PR, not just the last one: for WI-009 it is `1eaa443d`, not `9eb9d4e9^`.
   - **After a rebase** the base moves to the new fork point. So `base..sha` always holds the PR's
     own commits, never another PR's.
   - **A confirm after a rebase** judges the fix with `git range-diff` from the previous audited
     range to the new one. It never uses a literal diff across the rebase.

   An auditor may tag a Critical or High *Pre-existing* only with all three of these:
   - (a) the code at fault is identical at the base (`git diff-tree` or `git blame` against the base);
   - (b) a caller trace from each changed line in `base..sha`, showing the PR does not reach, expose
     or worsen the fault;
   - (c) the PR does not claim to provide the property the fault violates. D261's close-confirm
     guarantee would have failed this test.

   The tag stands only when the other auditor **affirmatively confirms** it, in a challenge. For a
   `security-review` finding, Codex may tag it and Fable confirms. A tag that is disputed, or whose
   proof falls short, blocks at the finding's severity.

   - **A pre-existing High:** before it stops blocking, the delegator registers it as a D item and
     links the row from the merged verdict. The row names an owner. A missing row, link or owner
     keeps it blocking.
   - **A pre-existing Critical:** it stays blocking until the user rules, and the ruling is quoted
     (ADR-0085 Decision 2 is unchanged for Criticals).
   - **The count line** carries both the raw severities and a separate **blocking** count. The gate
     reads the blocking count.

4. **Confirms converge, and a regression never escapes by arriving late.**
   - In rounds two and three, in every tier, each auditor reviews the fix diff and every open
     finding. The fix diff runs from the previous audited SHA to the new SHA, or is a
     `git range-diff` across a rebase (Decision 3).
   - A finding names its bug class and lists every instance. Any instance still unfixed keeps the
     finding PARTIAL. A finding already posted is not posted again.
   - **A Critical or High introduced, exposed or worsened by any commit in `base..sha` blocks,
     whatever round finds it.** Only a finding that passes Decision 3 leaves the gate.

5. **`REVIEW.md`** at the repo root. Both auditors read it on every audit, and it links to rule 60.
   - **Content:** for each area (save and drafts, the watcher, MCP, export, menus and keys,
     preferences, the control channel, CSS and tokens) what failure looks like, and what not to flag.
     It asks for file:line evidence and for a summary that starts with the count.
   - **Owner:** the delegator writes it as a docs-only commit. Its first version gets the ADR-0118
     plan review before auditors use it.
   - **Recurring findings:** a finding class raised on a second PR goes into `REVIEW.md` in the
     delegator's next docs batch, or becomes a lint-test D item.

6. **The auditors are measured.** The delegator is the only writer.
   - **When rows are written:** a row is written when its verdict is posted, updated at each confirm,
     and closed at the final outcome.
   - **`docs/audit/audit-log.md`**: one row per audited range, whether it landed, was superseded or
     was abandoned. Each row records:
     - the PR, the item and the tier;
     - the base and head SHAs;
     - the rounds;
     - each detector's raw count and the blocking count;
     - links to the reports;
     - the outcome.
   - **Finding rows**: one per Critical or High, with:
     - a stable id `F<PR>-<n>`;
     - its detectors: Codex, Fable, `security-review`, or several of them;
     - its class;
     - its outcome: fixed, refuted, pre-existing, or ruled by the user.

     These rows come from the merged-verdict PR comments the delegator already posts.
   - **`docs/audit/escapes.md`**: every defect found on a device, or after landing, in code that had
     passed an audit. Each row records the audited range and the D row whose fix confirms the defect.
     The delegator reconciles this file with each batch of device-check records.
   - **Before an auditor's model, its agent definition or its request template changes**, both the
     current and the proposed auditor are replayed on every escape:
     - each runs on the escape's audited range at its pre-fix SHA, with the same context;
     - the fix and every later finding report are withheld from it;
     - an escape counts as caught when a finding names the same file and the same fault;
     - recall is caught escapes divided by all escapes.

     The ADR proposing the change records each auditor's recall and cost. Findings the escape's fix
     does not explain are recorded separately and judged independently; only a refuted one counts as
     a false positive. With fewer than five escapes the
     result is "insufficient evidence", and the user decides without the numbers. Routine
     `REVIEW.md` edits do not trigger the replay.

## Consequences

**Gains**
- Presentation-only work (CSS, docs, layout guards) costs one auditor plus a challenge, not two
  blind audits.
- A bug that predates a PR stops blocking it once proven, and is registered rather than lost.
- Confirm rounds look at the fix diff and fix whole classes of bug, so D277's one-instance-per-round
  loop does not repeat.
- An auditor model change will have recall and false-positive data behind it, once there is enough
  data.

**Costs**
- **The High tier costs more than today.** Full nine dimensions plus `/security-review` on every
  `src-tauri`, `src/services` and document-path change, which is most of our backlog.
- **Behaviour-based tiering is judgment.** The delegator can still tier a High change as Medium. The
  auditors' right to raise the tier and the default-High rule are the only defences.
- **The Low tier runs one model.** A CSS or layout-guard change that breaks something is seen by a
  second model only when Codex raises a finding. Otherwise, only the verifier, CI and the device
  checks see it.
- **Pre-existing Highs ship.** The D list grows, and a release can carry a known High.
- **Pre-existing tags cost time.** Proving one needs a caller trace and an affirmative confirmation,
  which costs about a challenge round each time.
- **The delegator's bookkeeping grows.** The tier per range, the audit log, the escape list,
  `REVIEW.md` upkeep, and replays on the escape set before any auditor change.
- **The escape set starts empty.** Backfilling it from device records is work, and until it reaches
  five cases it cannot decide anything.
- **Same commit as acceptance:** rule 70 items 2 and 4, the count-line format, the
  `mdpro-fable-auditor` definition, and the Codex request template all change in the commit that
  accepts this ADR.
