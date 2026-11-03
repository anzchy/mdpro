# Landing and audit

How a handoff is checked, audited and landed, and what the delegator records. Text moved here from rules 70, 71 and 12 by D355 (ADR-0147 WI-1) keeps the rule's authority (ADR-0147 decision 3);
each block names where it came from. When this file and a rule disagree, the rule wins and this file is the bug.

## Landing

<!-- moved-from: rule 70 § Commits and branches (ADR-0147) -->
2. **The delegator checks ancestry and scope** (not a code review) with `git cat-file -p <sha>` and
   `git diff-tree --no-ext-diff --stat -r <parent> <sha>` (the external diff
   wrapper garbles plain `git diff`), then dispatches two independent checks
   on that SHA at once: `mdpro-landing-verifier` (lanes, receipt-store integrity, tree
   identity) and the two audits of item 4. It also pushes that SHA as the
   PR's head, so CI tests what will land. When the branch was rebased or fixed
   after an earlier push, it re-pushes with
   `git push --force-with-lease=<branch>:<old head>`, a standing exception to
   rule 25 for PR branches only, never `master`, `release/x.y` or a tag
   ([ADR-0095](../../../../docs/adr/0095-pull-request-ci-is-a-landing-gate.md)). It
   runs `git merge --ff-only <sha>` in the main checkout, and right after it
   `git push origin master`, only when all four hold:
   - the verifier says PASS;
   - the merged verdict counts zero **blocking** Critical and High findings
     (ADR-0121: a proven pre-existing High is counted but does not block);
   - the PR's head is that SHA and its required `ci-gate` check is green on it;
   - every `device` AC of the brief has PASS evidence from a real-app run whose
     identity matches that SHA, or a user waiver recorded as a gate exception
     ([ADR-0144](../../../../docs/adr/0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md),
     user 2026-10-27: 「Accept (Recommended)」). The brief tags each AC `unit` or
     `device` and cites its cards in `docs/test/cards/`; the tester role runs the
     cards after round one's code report; the verifier checks the identity. NOT
     EXERCISED is not PASS. Windows `device` ACs stay in batches for now.

   A red result from a registered intermittent test (D196) may be rerun once
   with `gh run rerun <id> --failed`. A second red blocks the landing.
   A docs-only commit that item 4 leaves unaudited also needs no PR and no CI.
3. **No other session lands on `master` itself**, by cherry-pick or
   otherwise. An auditor's fixes reach `master` the way a peer's do: a
   branch rebased onto `master`, handed to the delegator with the SHAs and
   the lanes that passed, landed by `--ff-only`. After each landing the
   delegator warns the peers to fast-forward before their next commit.

**Only the delegator lands on `master`**, by `git merge --ff-only`, and it
pushes `origin master` right after every landing (user decision, 2026-10-12:
「落地即推」). No one else pushes, and no one else commits to `master`.
`master` never takes a merge commit, and the only direct commits on it are
the delegator's own docs-only ones (device-check records, sequencing-row SHA
fills, the release-freeze paragraph), pushed at once; a one-commit branch
fast-forwarded would be the same commit with more ceremony. A
`release/x.y` hotfix branch (ADR-0083) is protected the same way: only the
delegator lands on it and pushes it. `frontend-backend-redesign` is frozen
as of 2026-10-12: nothing lands on it, it is tagged
`archive/frontend-backend-redesign`, and it is deleted no earlier than
2026-11-11 with the user's confirmation (rule 25). **A branch on `origin` is
kept thirty days after its work landed before it is deleted**
([ADR-0084](../../../../docs/adr/0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md),
user decision 2026-10-12: 「remote上的分支branch 满30天再删」); local
worktrees and local branches are still removed once the landing is confirmed.
Stage only paths you can name, and never the user's own dirty files — anything in `git status` you did not
change (on 2026-10-10: their
`.claude/*` edits, `docs/pending/`, `docs/reference/`, the `docs/plans`
archive moves, `tsconfig.node.tsbuildinfo`). Deleting a branch or worktree
needs the user's confirmation (rule 25). The one exception is a detached
`verify-<sha7>` worktree that `mdpro-landing-verifier` created for its own run;
it removes that one when it finishes. **A landed item's worktree is removed at landing without asking**, under the checks in
[ADR-0157](../../../../docs/adr/0157-a-landed-branchs-worktree-is-removed-at-landing-without-asking.md), which supersedes the
worktree half of the confirmation above; branches still need it.

## Audit merge

<!-- moved-from: rule 70 § Commits and branches (ADR-0147) -->
4. **Every WI or finished module is audited before it lands**
   ([ADR-0085](../../../../docs/adr/0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md);
   user decision 2026-10-12: 「只有分支branch 经过Codex audit 并且修复，没有critical /
   high severity findings之后，才允许ff 到master」). When a handoff passes the
   ancestry and scope check, the delegator sends the auditor the branch SHA,
   its parent, the WI or D id and the owner. The auditor audits
   `<parent>..<sha>` under the set that § Which set of
   `docs/agents/audit-dimensions.md` names for the range, pinned at master `<M>` by blob `<B>`, and
   `docs/agents/audit-policy-set.md` blob `<P>` when the pinned file's § Which set names `<P>`, with preflight bypassed, model `gpt-6.1-sol` and effort `high`, unless the delegator names others. Nobody
   asks the user first: the user approved this standing order on 2026-10-10
   so that no human sits in the loop. The approval covers the audit run
   only; rule 25 commands still need their own confirmation. A docs-only or
   device-record commit is not audited, except that a change to
   `docs/agents/audit-dimensions.md` or `docs/agents/audit-policy-set.md` goes through a PR, audited at High tier
   under the old pinned blob, with plan review of the proposed blob by both
   auditors before it lands; never a direct docs-only commit. A
   [gate-sensitive decision-log entry](../../../../docs/agents/decisions/README.md#gate-sensitive-entries) is the other exception:
   both auditors plan-review it before it lands. **Mediums are listed, Lows counted**;
   the verdict ends with one line counting Critical, High, Medium and
   Low, and the delegator reads the gate off that line. Nobody registers
   Medium or Low findings as D items or issues (user decision, 2026-10-10). **A
   Critical or High the auditor downgrades carries a reproduction or a
   counter-proof**: the command and its decisive output, or a run, a
   measured value or a file:line trace showing the ordinary path never
   reaches it, posted next to the finding on the PR and in the report.
   Without one, the finding stays High and fails the gate (user decision,
   2026-10-16: 「后续每次降级都附上复现或者反证」). The
   auditor reports to the delegator, not to the implementor.

   **Every audit runs on both auditors, `gpt-auditor` and `opus-auditor`, on the same dimensions**
   ([ADR-0143](../../../../docs/adr/0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md)
   decision 1; ADR-0115 and [ADR-0137](../../../../docs/adr/0137-the-second-auditor-runs-on-opus-as-the-opus-auditor-pane.md)
   before it; user decision, 2026-10-25: 「audit now has gpt-auditor + opus-auditor at the same time, audit cap is two」):
   - The delegator sends each auditor its own request file, in a fresh pane, with the same range and the same
     dimension set from the pinned file (the set its § Which set names for the range). When the opus-auditor pane cannot start, the
     `mdpro-fable-auditor` subagent runs that request.
   - **Round one is blind** (「不能，先各自单独审」). Neither auditor sees the
     other's verdict, and the delegator forwards nothing between them until
     both are in.
   - **The delegator posts both round-one reports** as separate PR comments, as written, once both verdicts are in,
     so the PR never shows one report to an auditor still at work (user decision, 2026-10-17:
     「第一轮fable的audit report，也单独写到对应pr作为comment，其他的不变」).
   - **The delegator merges** the Critical and High findings, one by one:
     - A finding both raise stands.
     - A finding only one raises is challenged: the other auditor gets that one finding in a challenge request file,
       in a fresh pane, and returns CONFIRMED or REFUTED. A refutation needs a reproduction or a counter-proof.
       Without one, the finding stands. A challenge is not a round.
     - A disagreement that survives the challenge stands too: the gate fails
       closed.
   - The delegator posts the merged verdict on the PR: both count lines, each
     challenge and its outcome, and the merged count.
   - **ADRs and plans**: a plan before its first `impl` grant, an ADR that
     meets [CLAUDE.md § ADR](../../../../CLAUDE.md#architecture-decision-records-adr)'s
     review trigger before the user is asked to accept it (doubt means review), and a
     [gate-sensitive decision-log entry](../../../../docs/agents/decisions/README.md#gate-sensitive-entries) before it lands
     ([ADR-0165](../../../../docs/adr/0165-adrs-record-architecture-and-product-decisions-only.md)
     decisions 2 and 4; [decision log](../../../../docs/agents/decisions/20261102-adr-scope-and-decision-log.md)), go to
     `gpt-auditor` and `opus-auditor`, each by request file in a fresh pane (rule 71), on the set
     the pinned file's § Which set names for that case: plan; plan + policy at Full for a
     gate-sensitive entry ([policy set](../../../../docs/agents/decisions/20261102-cc-suite-policy-set.md)). Blind and merged the same way.

   **Zero Critical and zero High in the merged verdict is the landing
   condition.** A Critical or High goes to the owner on the same branch: the
   owner fixes it there (new SHA, rebased if `master` moved, decisive tests
   re-run). **Both** auditors then confirm the fix on the new SHA, each by a confirm request file in a fresh pane,
   scoped to every open finding from either side, not
   a fresh full audit (「Both, scoped (Recommended)」). One auditor's OPEN or
   PARTIAL is challenged like a one-sided finding. Then the verifier
   re-checks by tree identity, and the delegator lands. **There are at most two rounds: the blind audit and one scoped
   confirm** (ADR-0143 decision 2; a round is the pair). A Critical or High still open after round two goes to the user
   with both auditors' evidence, and the user rules under ADR-0143 decision 3 and ADR-0129: one more round once per
   review, a fix without a further round, landing it open, or stopping the item. The ruling is quoted in the row.

## After the cap

<!-- moved-from: rule 70 § Commits and branches (ADR-0147) -->
   **After the cap** ([ADR-0129](../../../../docs/adr/0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md);
   user decision, 2026-10-21: 「采纳 (Recommended)」):
   - **The ruling request** classifies each open finding:
     - introduced or pre-existing;
     - reproduced or disputed;
     - product or tooling;
     - its impact.

     It offers five options: fix with a scoped confirm, narrow or revert, reconsider, refuted, or
     land open.
   - **Landing a finding open** needs a record:
     - an issue with an owner (or an existing D row);
     - a fix-by version number;
     - a compensating control, or "none" with the reason;
     - for product code, a `CHANGELOG.md` Known issues line;
     - the quoted ruling.

     A Critical's fix-by is the lowest unreleased version, and it is never carried.
   - **A post-cap fix** is confirmed by each detector that raised the finding, on the fix diff
     only. It lands only if every raiser marks it CLOSED. Otherwise it goes back to the user once,
     and no second fix is offered.
   - **Every release checkpoint** runs each tracked finding's presence check on the locked SHA.
     Ancestry does not count.
   - **Every gate exception** (lane or unrunnable check) gets a row in
     `docs/audit/audit-log.md` § Gate exceptions, whenever it is granted.

## Tiers

<!-- moved-from: rule 70 § Commits and branches (ADR-0147) -->
   **Effort follows risk** ([ADR-0121](../../../../docs/adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md); user decision,
   2026-10-18: 「Accept with revisions (Recommended)」):
   - **Tier.** The delegator names a tier for each range in the audit request, and either auditor
     may raise it:
     - **High** (document save, close, draft or sync behaviour, MCP approval, preference writes,
       `src-tauri`, `src/services`, CI, release, gate tooling, dependencies, any unlisted path):
       both auditors, on the set the pinned file's § Which set names for the range, in the pinned
       `docs/agents/audit-dimensions.md` blob `<B>`, and `docs/agents/audit-policy-set.md` blob `<P>` when the pinned
       file's § Which set names `<P>`.
     - **Medium** (other `src/`): both auditors, on the set § Which set names, as above.
     - **Low** (CSS, docs except `docs/agents/audit-dimensions.md` and `docs/agents/audit-policy-set.md`, presentation-only tests):
       `gpt-auditor` alone, on the set § Which set names, with `opus-auditor` (ADR-0137) challenging each Critical or High
       it raises, as ADR-0121 set the tiers and ADR-0143 left them unchanged. A change to the excluded file is High tier.
   - **Base.** The base is the PR's fork point on `master` (`git merge-base`). It moves with each
     rebase.
   - **Pre-existing.** A *Pre-existing* High needs three things before it stops blocking:
     - proof: the code is unchanged at the base, a caller trace shows the PR does not reach or
       worsen it, and the PR claims no such property;
     - the other auditor's affirmative confirmation;
     - a linked issue with an owner (or an existing D row).

     A pre-existing Critical still goes to the user.
   - **Confirms** review the fix diff (a `git range-diff` across a rebase) and every open finding.
     A Critical or High that any PR commit introduced blocks, whatever round finds it.
   - **Count line.** It carries raw counts plus a blocking count, and the gate reads the blocking
     count.
   - **Records.** The delegator records every audited range in `docs/audit/audit-log.md` and every
     escaped defect in `docs/audit/escapes.md`.

   A partial fix does not land; deferring a Critical or High instead of fixing
   it needs the user's word, quoted in the row. Audits requested before
   2026-10-12 on already-landed ranges finish under the old order: a
   Critical or High there gets an issue and goes to the owner, and the
   landed commit is not reopened.

## Audits under herdr

<!-- moved-from: rule 71 § Audits under herdr (ADR-0147) -->
- **Dimensions.** Both auditors use `docs/agents/audit-dimensions.md` at the master `<M>` and blob `<B>`
  named in the request, and `docs/agents/audit-policy-set.md` blob `<P>` when the pinned file's § Which set names `<P>`,
  with one pin for the full review (ADR-0146).
- **PRs.** The delegator sends one fresh-pane request each to `gpt-auditor` and `opus-auditor` on the exact range (ADR-0143).
  On High tier, unless policy-only (§ Which set; [policy set](../../../../docs/agents/decisions/20261102-cc-suite-policy-set.md)), both requests also require an explicit security review section and count.
- **Round one is blind to PR comments and delegator conclusions.** Each auditor writes its report;
  the delegator checks the evidence, posts both reports when a PR exists, and merges them (§ Audit merge).
  Any blocking Critical or High stays open until both auditors' scoped confirm closes it.
- **ADRs and plans.** Reviewed only as rule 70 item 4 "ADRs and plans" says
  ([ADR-0165](../../../../docs/adr/0165-adrs-record-architecture-and-product-decisions-only.md);
  [decision log](../../../../docs/agents/decisions/20261102-adr-scope-and-decision-log.md)): a plan; an ADR that
  meets [CLAUDE.md § ADR](../../../../CLAUDE.md#architecture-decision-records-adr)'s review trigger; a
  [gate-sensitive decision-log entry](../../../../docs/agents/decisions/README.md#gate-sensitive-entries) before it lands.
  Doubt means review. Another ADR lands with the user's quoted acceptance, and another log entry is a docs-only commit.
  `gpt-auditor` and `opus-auditor` each review consistency, completeness, feasibility, ambiguity and
  risk in a fresh pane. The delegator records the applicable verdict and asks the user about
  unresolved decisions.

## Requests

<!-- moved-from: rule 71 § Fresh context (ADR-0147) -->
**Every audit request and every fix round after the first starts from a fresh context** ([ADR-0131](../../../../docs/adr/0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md);
user decision, 2026-10-22: 「Accept (Recommended)」). File-carried context replaces the thread.

- **Reset a pane** before every `gpt-auditor` and `opus-auditor` request (first audit, confirm, challenge, ADR or
  plan review) and every implementor fix that needs a new session
  ([codex-panes.md § Restart](codex-panes.md#restart) for a Codex pane; `opus-auditor` is a new Claude Code pane on Opus,
  [the roster](roster-and-routing.md#roster)): each auditor gets a new pane with the full launch line. The in-pane `/new` reset and its session-id check are superseded (ADR-0133
  decision 4): `/new` drops the launch flags, and herdr can report another project's session id.
- **A request file is self-contained.** A confirm or challenge names:
  - the fix range;
  - the open findings by id, with their text;
  - the earlier report files;
  - **the text of every counter-proof it must answer.**

  Its scope is ADR-0121 decision 4 as written: the fix diff, every open finding and unfixed
  instance of its class, and any Critical or High a commit in `base..sha` introduced, exposed or
  worsened. Before sending a confirm, check the request against the merged verdict's open list.
- **When a model is unavailable**, the delegator tells the user and the audit waits (ADR-0143 decision 4).
  A single-auditor round needs the user's word, which the record names.
- **The delegator** asks the user to type `/compact` at a quiet point: no landing in flight, every
  wait recorded in `heartbeat.json`. The compaction instructions keep the open findings, SHAs,
  number reservations and armed waits.
- **Cost record.** The first ten requests after 2026-10-22 record their duration and their input,
  cached and output tokens in `docs/audit/audit-log.md` § Fresh-context cost.

## Briefs

<!-- moved-from: rule 71 § Briefs and self-acceptance (ADR-0147) -->
**The delegator gives a Codex implementor a full brief, the implementor accepts its own work
against it, and only then does the delegator confirm.** A cross-model agent shares none of the
delegator's context. User decision, 2026-10-18: 「由于是cross model delegate tasks,
之后给implementor 布置任务，要详细交代任务背景，给出详细的验收标准，让 implementor执行完之后，自己验收合格再由你确认」.

Every grant, and every fix round, is written to
`~/.mdpro-redesign/herdr-spike/<name>/<item>-brief.md` before the prompt points at it. It has
six sections:

1. **Background.** Why the item exists: the defect or plan row, the user decisions it rests on
   (quoted), the ADRs it must not contradict, and what earlier work already landed.
2. **Scope.** The worktree, the branch and its base SHA, and the paths it may edit and create.
   Anything outside them needs a revised grant.
3. **Acceptance criteria**, numbered `AC-1…`. Each is a behaviour plus its proof:
   - the test file and case, or the command;
   - the expected decisive output;
   - for a behaviour change, the receipt id of the RED that must come first.

   The plan row's tests column is the floor, not the ceiling.
4. **Out of scope.** What this item must not do, and which later item does it.
5. **Gates.** The lanes to run before handoff, with the exact commands.
6. **Self-acceptance.** The handoff ends with an `AC | evidence | verdict` table: each AC with the
   command or test it ran, its decisive output line, and its receipt and verdict. Then come the
   lanes, the tree SHAs and the paths changed.

## Confirm handoff

<!-- moved-from: rule 71 § Briefs and self-acceptance (ADR-0147) -->
The delegator checks the attack file and the matrix when it confirms the handoff. The method is
[implementor.md § Matrix and attack](../../../../docs/agents/implementor.md#matrix-and-attack); the brief adds exact lanes
and the self-acceptance table, and the implementor makes the branch commit the brief requires. The matrix-attack step exists
because on 2026-10-20 all three blocking Highs were untested cases: M3b H1 (a submit that fails inside a table), D290 H1 (a
close while a save awaited) and D290 H2 (a deletion ignored mid-batch).

The matrix-attack step applies to every grant. On a fix round it applies when the finding is a missed case, as those
three were. A fix the brief fully specifies with its regression test can skip it, and the fix brief says so.

An implementor does not hand off with an AC unproved unless it names that AC, says why, and says
what it needs. An AC that conflicts with another is recorded, resolved toward the plan and the
brief's background, and the work goes on. The implementor stops only for a path outside scope.

**The delegator confirms by checking the table, not by trusting it.** It re-reads the evidence
for each AC. The verifier re-runs the lanes and checks parent receipt bytes and shape with `keep-check`;
`check-pending` is informational for verifiers dispatched after the policy commit is on master
([decision](../../../../docs/agents/decisions/20261104-receipts-are-audit-evidence.md)).
The auditors are given the ACs. An
AC with no evidence, or with evidence that does not show the behaviour, sends the item back
before any audit starts, except an unproved AC with a recorded acceptance under ADR-0146 decision 4
cited in the audit request. The delegator records that acceptance before audit only when (a) a
revised brief moves the AC to a later item, (b) the real-app half of a `device` AC goes to its
ADR-0144 card, or (c) a user waiver is recorded as an audit-log gate exception. Naming an AC
unproved in the handoff alone does not accept it.

## Failed Windows run

<!-- moved-from: rule 71 § Roster (ADR-0147) -->
**A Windows device test that fails goes to both auditors before any fix** (user decision, 2026-11-01:
「接下来如果Windows device test 无法通过，把问题同时交给gpt-auditor和opus-auditor 同时审议，再决定下一步如何修复，而不是一直原地让implementor转圈」).
- **Who reviews.** On a FAIL, NOT EXERCISED or a stop of a Windows smoke or device AC, the delegator sends the report, the run
  evidence and the brief to `gpt-auditor` and `opus-auditor` at the same time, each in a fresh context and blind to the other.
  Each returns a root-cause ranking with the evidence that confirms or refutes each cause, and a proposed fix with the test that
  proves it.
- **The host.** A reviewer that needs read-only host checks gets them under the [win-desktop lock](device-batches.md#win-desktop-lock), one at a time; the other
  works from the evidence until the lock is free.
- **Then the delegator decides.** It compares the two reviews (agreements, disagreements, and which is better supported), writes
  the decision as a ruling, and only then sends the implementor a fix brief. If the reviews disagree on the cause and the evidence
  cannot settle it, the delegator asks the user.
- **The implementor does not iterate on a failed Windows run by itself.** Its next round starts from that ruling.

## Gated items

<!-- moved-from: rule 12 § Planning (ADR-0147) -->
- **The delegator then:**
  1. reserves the ADR numbers and commits the drafts Proposed;
  2. commits `GLOSSARY.md`;
  3. commits the snapshot `docs/specs/<feature>/r<N>/`: `spec.md`, `tickets/<T-nn>.md`, and a `manifest.md` with issue URLs, body
     SHA-256s, approval words and blocking edges;
  4. sends spec and tickets to both auditors for plan review, with each ADR draft that meets CLAUDE.md § ADR's review trigger
     (doubt means review). It records that classification in the draft's Status line.
- **Snapshot revisions never change.** A normative issue edit becomes `r<N+1>` and needs re-approval. Before any brief cites it, both
  auditors plan-review its diff against `r<N>`; an earlier review never covers a later revision. `docs/specs/**` is never Low tier.
- **Asking.** "Ask the user" means the delegator's route question channel: `AskUserQuestion` on Claude, Codex's channel on Codex. It
  names the next missing step and the planner pane. Implementors never ask the user (rule 70).
- **Setup.** `/setup-matt-pocock-skills` runs once, by the user, with GitHub Issues. The delegator reviews and commits what it writes.

<!-- moved-from: rule 12 § From tickets to landing (ADR-0147) -->
- **One approved ticket is one brief and one PR.** It is granted only when every ticket that blocks it has landed: `ready-for-agent` is
  not a grant.
- **The brief** pins the snapshot's commit and blobs and the skill versions. It maps each AC to a ticket and a spec story or testing
  decision, tagged `unit` or `device`.
- **Precedence:** spec snapshot, then ticket, then brief, then card. This replaces CLAUDE.md's "the original plan wins" and ADR-0144's
  plan or D-row anchor for gated items. A card may quote a snapshot AC id.
- **Closing tickets.** After the push, the delegator closes the ticket issue with the landing record, and closes the spec issue after the
  last ticket.
- **Never:** `/implement`, `/implement-spec`, or an integration branch.

<!-- moved-from: rule 12 § Before the first gated grant (ADR-0147) -->
## Before the first gated grant
All of these must be done:
- the setup run;
- the `planner` roster row and its `role-guard.sh` branch;
- the brief template's snapshot fields;
- for any `device` AC, the card checker's snapshot anchor.
