# 0159. Landing is checked against the records by one command, and Policy files land by PR

**Status**: Proposed (2026-10-30, drafted by herdr-delegator for I556 r2; revised for r3 and r4 the same day; snapshot
`docs/specs/i556/r4/`, which supersedes r3).

The decision rests on these user words, all from 2026-10-30:
- the grill of #556 item 4, four rounds, each answered 「全部同意」;
- seams confirmed 「对的」;
- four r2 rulings: 「Accept ruling row (Recommended)」, 「Low-tier gpt audit (Recommended)」, 「docs/agents/**」 and
  「Yes, both (Recommended)」;
- two r2 approval rulings: 「No, both auditors」 (routine Policy PRs keep both auditors) and 「ci-gate + audit only
  (Recommended)」 (routine Policy PRs need no verifier record), then 「Approve, proceed (Recommended)」;
- the r3 ruling on the r2 round-1 plan review: 「好，按方案一起草 r3」 (keep the routine route, and have the command force
  the audited route for gate-sensitive paths);
- the r3 confirmation rulings: 「同意收紧 (Recommended)」 (exceptions through the verifier's CARRIED line; `ci-gate`
  exceptions for one landing and one SHA), 「同意 (Recommended)」 (an unset role in the main checkout counts as the
  delegator), 「两个都强制」 (both auditors' security lines required on High tier), and 「release/x.y 纳入范围, 带开放问题落地,
  扩大门禁文件列表, routine 路由收窄」 (all four other drafting decisions confirmed);
- the r4 cap rulings on the r3 round-2 plan review: 「修成 r4 + 限定复核 (Recommended)」 (fix Z1–Z8 as r4, then a
  scoped confirm by the raisers) and, on Z2, 「算，强制 High (Recommended)」 (rules 60, 70 and 71, `CLAUDE.md`,
  `AGENTS.md` and the delegator Skill are gate-sensitive).

> **r4 revision.** This revision answers the r3 round-2 plan review after the two-round cap (gpt-auditor H3 M1,
> opus-auditor H1 M3 L3), under the user's cap ruling above. The edits, Z1–Z8:
> - gate-sensitive paths require `tier High` from both reports (decision 6, and ADR-0121 under Kept);
> - the gate-sensitive subset gains the landing-condition prose and the delegator Skill (decision 6, costs);
> - High tier is set by either report or by a gate-sensitive path, and each post-cap form names the security line it
>   reads (decisions 2 and 4);
> - land-open rows map each blocking finding to an existing, complete D row (decision 4);
> - only G-D325-1 and G-D327-1 are re-recorded, and a closed row is never reopened (costs);
> - a carried row's token must be `verifier` (decision 4);
> - `--create-release <tag>` cuts a `release/<x.y>` branch (decision 1);
> - the spec's Solution names both auditors' security sections.
>
> Each finding's edit is mapped in `changes-from-r3.md`.

> **r3 revision.** This revision answers the r2 round-1 plan review: gpt-auditor C0 H2 M2, opus-auditor C0 H2 M7 L7.
> The merged verdict is planner-local. The edits:
> - options 9 (route choice) and 10 (standing waivers);
> - the security check;
> - the `release/x.y` route;
> - the post-cap forms, which extend ADR-0129 decision 8's row grammar;
> - the unset role in the main checkout;
> - the costs and known limits that follow.
>
> Each finding's edit is mapped in `changes-from-r2.md`.

**Supersedes:**
- ADR-0141 decision 2: the clause "the script enforces only what it can check mechanically, and says so", and the
  entries `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md` and `.claude/agents/*.md` in the docs-only direct-commit set;
- ADR-0141 decision 4: "On the claude route the Codex rules do not apply to the delegator, and nothing changes";
- ADR-0121 decision 1's tier for routine Policy-file PRs outside the gate-sensitive subset, which becomes Low (any
  unlisted path was High);
- rule 70 § Commits item 2's verifier-PASS condition, for routine Policy-file PRs only;
- rule 70 § Commits item 2's raw `git merge --ff-only` and `git push origin master`, and rule 70's sentence that no
  role set means no checks, for the main checkout;
- rule 71's raw git on the Claude delegator route.

**Extends:**
- ADR-0129 decision 8's Gate exceptions row grammar. It adds:
  - a check token at the head of Gate waived;
  - a `this landing only (PR #n, sha40)` scope;
  - a `post-cap` scope in three forms, plus `single-auditor`;
  - the rule that `any`/`until` rows count only when the verifier carries them.

**Kept, and now enforced by the command:**
- ADR-0095: `ci-gate` is a landing gate;
- ADR-0143: both auditors on every audit, routine Policy-file PRs included, capped at two rounds. The security section
  is required on High tier;
- ADR-0144: device ACs are proved in the real app, under decision 5's identity;
- ADR-0129: the post-cap rules, read through a recorded row;
- ADR-0121: the tiers, for every other path, with High tier enforced for every gate-sensitive path whatever the route
  marker;
- ADR-0146: the audit dimensions file and its route;
- ADR-0083: `release/x.y` hotfix branches, landed only by the delegator;
- ADR-0084 and ADR-0157.

## Context

The four landing conditions (rule 70 § Commits item 2) are kept by habit:
- on the Claude route, landing is a raw fast-forward and push;
- on the Codex route, `land-guard.mjs` checks only the PR head and `ci-gate` (ADR-0141 decision 2 says so by design);
- `master`'s branch protection has `enforce_admins` off.

An outside audit on 2026-10-30 (#556) found that Policy files ride the delegator's docs-only path, with no PR, no CI and
no review. About two dozen such commits landed in the week of 2026-10-23. One left three agent definitions, the landing
verifier's among them, pointing at `/Users/jackcheng/…`, a home directory that does not exist on the Mac mini.

The records the conditions rest on already exist, but they are irregular:
- verifier records have several file-name shapes and qualified verdicts, and for #551 none was saved at all;
- auditor reports:
  - come in two VERDICT spellings (`range` and `fix range`) and varied file names;
  - sometimes carry a COUNT line inside the security section;
  - spell the security line three ways;
- device reports state identity in four ways, and a release-type verify build has no `-dev` suffix;
- Gate exception rows are prose, and some are open `until` rows for any PR.

Several accepted ADRs let a landing proceed with one auditor's last report on an older head:
- ADR-0129 decision 6: only the raiser confirms a post-cap fix;
- ADR-0143 decision 3: after round two, the user may rule a fix with no further round, or a landing with the finding
  open;
- ADR-0143 decision 4: a single-auditor round, on the user's direction.

`tree-identity.sh`, cited for docs-only rebases, compares only `src`, `tests` and `src-tauri`, and always exits 0.

The r2 plan review found four more things:
- the routine route was chosen by a marker the PR author writes, so a change to the gate itself could take it;
- the High-tier security review was not checked;
- standing `until` exceptions would have waived whole checks for every PR;
- `gh pr merge` and `release/x.y` were open side doors.

## Options considered

1. **Keep the conditions as the delegator's own checks** (ADR-0141 as written). Lost: that is the gap the audit found.
2. **A GitHub required check that reads the records.** Lost: the records are local, on the delegator's machine, and
   publishing them is out of scope.
3. **Turn on `enforce_admins`.** Lost: the user kept it off (grill Q3). It is revisited with #556 item 9's metrics.
4. **A per-item state file or workflow engine.** Lost: a new state file is one more record to go stale (Q2).
5. **The landing command checks the existing records, with pinned grammar.** Chosen.

For post-cap landings:
- **5a. Every post-cap landing needs a confirm from both auditors at the SHA.** Lost (user, 「Accept ruling row」): one
  extra audit per post-cap landing, and it overrides ADR-0129 decision 6.
- **5b. A recorded post-cap row, per ruling form, with the evidence each form needs.** Chosen. The raiser-confirm form
  needs (a) the non-raiser's clear report at the pre-ruling head, (b) descent from that head, and (c) the raiser's
  confirm covering it.

For routine Policy-file PRs:
- **6a. Unaudited, with a new landing mode** (grill Q6 as first agreed). Lost (user, 「Low-tier gpt audit」): there was
  no mode for it, and it lowered ADR-0121's tier with no second model reading the change.
- **6b. One Low-tier gpt-auditor mini audit.** Lost (user, 「No, both auditors」): it would have narrowed ADR-0143.
- **6c. A Low-tier mini audit by both auditors, plus the verifier.** Lost (user, 「ci-gate + audit only」): a routine
  text change has no lanes or receipts for the verifier to re-run.
- **6d. A Low-tier mini audit by both auditors and `ci-gate`, no verifier record.** Chosen.

For the Claude route:
- **7a. Skip the overlay check when `MDPRO_ROLE=delegator` is set.** Lost (user, 「Yes, both」): it is a weaker identity
  check, resting on an environment variable alone.
- **7b. Install the delegator overlay on the main checkout, and launch the pane with `MDPRO_ROLE=delegator`.** Chosen.
  An unset role in the main checkout also counts as `delegator`, so a pane launched without the variable is still
  guarded.

For the docs-only rebase proof:
- **8a. `tree-identity.sh`.** Lost: it covers three trees and never fails.
- **8b. `git range-diff`, with every pair `=`.** Chosen.

For who chooses the routine route (r3):
- **9a. The PR's `Policy route:` marker chooses.** Lost (plan review, gpt H1 and opus H1): the author of a change to
  the landing command, the hooks or the audit rules could mark it routine and skip the verifier and the High-tier
  audit.
- **9b. The command refuses `routine` for a mechanical gate-sensitive subset, for code, and when an auditor's tier is
  above Low.** Chosen (user, 「好，按方案一起草 r3」). The marker is still read, but it can only make the route stricter.
- **9c. Drop the routine route.** Lost: the user kept it, and most Policy edits are wording.

For standing waivers (r3):
- **10a. `--exception` accepts open `until` rows for any PR,** waiving a whole check. Lost (plan review, opus H2): an
  old narrow waiver would waive the whole check for every later landing.
- **10b. `--exception` accepts only this-landing and post-cap rows. A standing row counts only when the verifier lists
  it on `CARRIED`, judging its narrow wording, and never for `ci-gate`.** Chosen.

For the security review (r3):
- **11a. Not checked.** Lost (gpt H2): ADR-0143 decision 1 and rule 71 make it part of a High-tier audit.
- **11b. Both auditors' security lines required.** Chosen (user, 2026-10-30: 「两个都强制」). The request templates ask
  opus-auditor for the section too.
- **11c. gpt-auditor's line required on High tier, and opus's checked when present.** Lost: the user chose 11b, so an
  opus report without the line cannot pass.

For `release/x.y` (r3):
- **12a. Out of scope.** Lost (opus M2): a raw hotfix landing would bypass every check.
- **12b. `--target release/<x.y>`, with the hook refusing raw merges and pushes there.** Chosen.

## Decision

1. **One landing command for both routes:**
   `land-guard.mjs <sha> [--item <id>] [--target release/<x.y>] [--exception <id>]…`. It checks, and then does the
   fast-forward and push itself. It also has a docs-only mode, a dry run, a read-only replay mode, and
   `--create-release <tag>`, which cuts a new `release/<x.y>` at a `v<x.y>.*` tag's commit only when that branch does
   not exist (ADR-0083 decision 3). `--item` is
   optional. Without it, records are found by SHA, and a rebased or post-cap landing is refused, naming `--item`.
2. **It checks five kinds of evidence at the SHA:**
   - the verifier's PASS record;
   - each auditor's highest-round report, with a range ending at the SHA, or at an audited head the SHA is an accepted
     rebase of, and zero blocking Critical and High;
   - on High tier, both auditors' clear security lines. A landing is High tier when either report says `tier High` or
     any changed path is gate-sensitive. Each post-cap form names the security line it reads, and a single-auditor
     landing at High tier also needs a `security` exception for this landing;
   - a green `ci-gate` on the PR whose head is the SHA and whose base is the target;
   - the cited device reports, whose `IDENTITY releaseId` SHA has the landing SHA's ADR-0144 decision 5 identity.
3. **Fail closed.** A check that cannot run, or a record that cannot be read or parsed, refuses the landing. Every
   refusal names each failed check.
4. **The only override is a Gate exception row,** read from the fetched `origin/master` in the grammar the spec pins,
   quoting the user, with a check token. Three kinds of row count:
   - **`--exception <id>`** accepts a `this landing only` row for this PR and SHA, or a post-cap row (raiser-confirm,
     no-round, land-open, single-auditor). A land-open row maps each blocking finding to a D row that exists in the
     sequencing doc on `origin/master` and names the item, the finding, an owner and a fix-by;
   - **a standing `until` row** counts only when the verifier carries it, and only with the token `verifier`;
   - **a waived device AC** goes through a `device:<AC>` row.

   Old rows match nothing.
5. **Records stay where they are, but their formats are pinned.**
   - The records root is the password-database home's `.mdpro-redesign`, overridable only in test mode.
   - One verification-record template serves both producers, with optional `CARRIED` and `waived:` entries. On Claude,
     the verifier writes its own record.
   - Auditor reports are read in the shape `docs/agents/audit-dimensions.md` pins, which does not change:
     - the VERDICT line, with `range` or `fix range` and a sha7+ prefix;
     - the first COUNT line outside the security section;
     - the security line in its live spellings.

     The request templates name the file. A non-conforming report is re-asked in the same round.
   - Device reports carry one IDENTITY line, `-dev` or release.
6. **Policy files and Knowledge documents** are classified by one path module:
   - **Policy files** are `.claude/**`, `.agents/**`, `.codex/**`, `scripts/codex-rules/**`, `CLAUDE.md`, `AGENTS.md`
     and `docs/agents/**`. They land only by PR, with `ci-gate` and the policy tests. A routine change gets a Low-tier
     mini audit by both auditors and needs no verifier record. Every other change gets the two-auditor audit at its
     tier, plus the verifier.
   - **Gate-sensitive Policy files** never take the routine route, and a change to any of them is High tier: both
     qualifying reports must say `tier High`, or the command refuses. They are the landing command and its modules,
     the hooks and settings, the agent definitions, the tdd-guardian state, the Codex rules and agents, the skills'
     scripts, the delegator Skill and its `references/**`, the audit dimensions file, and the prose that states the
     landing conditions: rules 60, 70 and 71, `CLAUDE.md` and `AGENTS.md`. Every executable or data file under a Policy
     prefix is among them.
   - **Knowledge documents** go by docs-only, through the same command.
7. **The policy tests:** change classification treats Policy files as code, and a path check refuses known-wrong
   prefixes.
8. **The backstop.**
   - On the Claude route, the role guard's delegator branch refuses:
     - a raw merge into `master` or `release/*`;
     - every push to them;
     - `gh pr merge`, and `gh api` merges.

     In the main checkout an unset role counts as `delegator`. The main checkout carries the delegator overlay, and the
     pane runs with `MDPRO_ROLE=delegator`.
   - On Codex, the delegator overlay forbids `git merge`. The shared rules already forbid `git push` and
     `gh pr merge`.
9. **Enforced from the first landing after rollout**, with no warn-only mode. Before rollout, replays on real records
   show:
   - #551 refused on exactly the verifier, auditor:opus and device checks;
   - #549 refused;
   - one clean landing passing.

## Consequences

- The four landing conditions, and the security review, are checked by the same code on both routes. A skipped
  verifier, a stale audit round, a missing security review or an unverified device run no longer lands unnoticed.
- **Given up and costs:**
  - **GitHub must be reachable to land.** When it is not, landing waits. A `ci-gate` exception is for one landing and
    one SHA only, so an outage never becomes a standing waiver.
  - **Every routine Policy PR costs two Low-tier mini audits and a CI run,** where it used to be a direct commit. This
    A gate-sensitive one costs the full High-tier audit by both auditors and the verifier, even for a one-line fix.
  - **A typo fix in rules 60, 70 or 71, `CLAUDE.md`, `AGENTS.md` or the delegator Skill needs a High-tier audit**
    (user, 「算，强制 High (Recommended)」). These files state the landing conditions, so a wording change can move a
    gate; the price is that no edit to them, however small, is cheap.
  - **A routine Policy PR skips the verifier,** so nothing re-checks its lanes or receipts. A routine PR that touches
    code or a gate-sensitive path is refused and must go `audited`.
  - **Both auditors must report security on High tier.** An opus report that omits the security section is re-asked,
    and the landing waits for it. Today opus reports often omit it, so the first High-tier landings may wait.
  - **The user's own sessions in the main checkout are guarded too.** With no role set, they can no longer raw-merge
    or push `master` or `release/*`, or `gh pr merge`. A manual landing there goes through the command.
  - **The Claude delegator now carries a Codex overlay file** in the main checkout and a role variable at launch. Both
    must be restored after any reset of the pane.
  - **Old records do not fit the pinned grammar.**
    - Old exception rows match nothing, so a historical replay may refuse landings that were proper at the time, #551
      among them. G551-1 is not re-recorded.
    - The two standing rows still open at `a39a04ad`, G-D325-1 and G-D327-1, need new-grammar rows before a verifier
      can carry them. G518-1 and G-D340-1 are closed and are never re-recorded as open.
  - **More records must be written exactly.**
    - A post-cap ruling now also needs an audit-log row in one of the four forms; a land-open ruling also needs its D
      rows, with owner and fix-by, on `origin/master` first.
    - On Claude, the verifier writes its record as a file.
    - Auditors write to the file name the request pins.
- **Known limits:**
  - On Codex, the verifier record is written by the agent that lands. On Claude, the verifier writes its own.
  - Whether a carried `until` row's narrow wording still covers the landing is judged by the verifier, not the command.
  - The command does not check that a device report says PASS, and does not check the ADR-0144 AC-text hash. Both stay
    with the verifier.
  - The path check catches only denylisted prefixes, not every wrong path.
  - The gate-sensitive subset is a list. A new kind of gate file outside it is caught only by the executable-and-data
    rule, or by review.
  - The hook and the command rules stop slips, not deliberate evasion.
- **Precondition:** #556 item 1 fixes the three agent definitions before the switch-over.
