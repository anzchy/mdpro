## Problem Statement

The rules say a change lands on `master` only when four things hold:
- the landing verifier passed on its exact SHA;
- both auditors found no blocking Critical or High;
- the PR's `ci-gate` is green;
- every device AC has real-app PASS evidence.

Nothing enforces that:
- On the Claude delegator route, landing is a plain fast-forward and push.
- On the Codex route, the landing guard checks only the PR head and `ci-gate`.
- `master`'s branch protection does not apply to admins.

So a step skipped under pressure, or a stale record, lands unnoticed.

Policy files have a further hole. These are the project instructions, the rules, the agent definitions, the skills and
the agent-facing docs. They change how every agent works, yet they ride the delegator's docs-only direct path: no PR, no
CI, no review. In the week of 2026-10-23, about two dozen commits changed Policy files that way. One left three agent
definitions pointing at a home directory that does not exist on the machine they run on. The landing verifier was one
of the three.

(Issue #556, item 4; outside audit of 2026-10-30, problems 1–3.)

## Solution

One landing command for both delegator routes. Before it fast-forwards and pushes, it checks the evidence that already
exists for that exact SHA:
- the landing verifier's PASS record;
- each auditor's latest report showing zero blocking Critical and High, or a recorded post-cap ruling;
- a green `ci-gate`;
- the device reports the verifier cites, with their build identity matching under ADR-0144.

If any check fails or cannot be run, the command refuses and names every failed check. The only way past is a Gate
exception that the user has already approved and that the audit log already records.

The delegator's docs-only path keeps working, for Knowledge documents only. A Policy file now goes by PR, with CI, the
policy tests and an audit:
- a routine Policy PR gets a Low-tier mini audit by both auditors, and needs no verifier record;
- a Policy PR that changes a gate, a landing condition, a role's permissions or the audit rules gets a High-tier audit
  by both auditors.

A hook stops the delegator from merging into or pushing to `master` any other way, as a backstop against habit.

## User Stories

1. As the user, I want nothing to reach `master` unless its verifier, audit, CI and device evidence all match its exact
   SHA (for a routine Policy PR, its audit and CI), so that the landing rules I approved actually hold.
2. As the user, I want a refused landing to name every check that failed, so that I know what is missing without
   reading logs.
3. As the user, I want the only override to be a Gate exception that I already approved and the audit log already
   records, so that no one can bypass a check by passing a flag or pointing the command at another folder.
4. As the user, I want a Policy file change to go through a PR with CI, so that a change to how agents behave is never
   invisible.
5. As the user, I want Policy file changes that alter gates, landing conditions, role permissions or audit rules to be
   audited at High tier by both auditors, so that the process cannot be weakened quietly.
6. As the user, I want routine Policy file changes (wording, history moves, alias updates) to need only a cheap
   Low-tier mini audit by both auditors and no verifier run, so that every Policy change is read by two models without
   adding a full audit and lane re-run to two dozen commits a week.
7. As the user, I want one exact list of which paths are Policy files and which are Knowledge documents, so that the
   landing command, change classification and the path check never disagree.
8. As the delegator on either runtime, I want one command that checks and lands, so that "checked" and "merged" cannot
   drift apart.
9. As the delegator, I want my Knowledge-document commits (audit-log rows, device records, sequencing fills) to keep
   landing directly through the same command's docs-only mode, so that record-keeping stays cheap.
10. As the delegator, I want docs-only mode to refuse a commit that touches a Policy file and point me to the PR route,
    so that I cannot use the cheap path by mistake.
11. As the delegator, I want the landing command to read the records I already write (verifier records, auditor
    reports, device reports, the audit log) at fixed locations, so that landing needs no new state file.
12. As the delegator, I want a landing to be refused when the verifier record is for a different SHA, says ISSUES or
    BLOCKED, is missing, or conflicts with another record for the same SHA, so that a stale or failed verification
    never passes.
13. As the delegator, I want a landing to be refused when either auditor's highest-round report for the item names a
    range that does not end at the SHA, or counts a blocking Critical or High, so that a confirm round on an older head
    is never mistaken for one on this head.
14. As the delegator, I want a rebase after the audit to be accepted only when the range-diff shows every commit pair
    unchanged and the new base is on `origin/master`, so that a master move does not force a re-audit and a changed
    commit never slips through.
15. As the delegator, I want an ADR-0129 post-cap landing (only the raiser confirms the fix) to be accepted when the
    audit log records the user's ruling as a post-cap row naming both SHAs, so that the gate enforces accepted ADRs
    instead of refusing what they allow.
16. As the delegator, I want a landing to be refused when a device report cited in the verifier record is missing, or
    when its build identity does not match the landing SHA under ADR-0144, so that device PASS is bound to what lands.
17. As the delegator, I want a landing to be refused when `ci-gate` is not green on the PR head, or the PR head is not
    the SHA, so that CI tested what lands.
18. As the delegator, I want a landing to be refused when GitHub is unreachable or a record cannot be read or parsed,
    so that a broken check never counts as a pass.
19. As the delegator, I want each `--exception <id>` (repeatable) to be accepted only when its row exists, is open,
    matches this PR or is an open `until` row for any PR, quotes the user, and names the failing check, so that an
    exception for another PR, another SHA or another check cannot be reused.
20. As the delegator, I want a waived auditor or device AC to count only through such an exception or a post-cap row,
    so that a missing report never silently passes.
21. As the delegator, I want the hook to refuse my raw merge and any push to `master` outside the landing command, so
    that an old habit cannot skip the checks.
22. As the delegator, I want the landing command's own git calls to be unaffected by that hook, so that the one
    sanctioned path keeps working.
23. As the Claude delegator, I want the main checkout to carry the delegator overlay and my pane to run with
    `MDPRO_ROLE=delegator`, so that the landing command runs for me and the hook knows my role.
24. As a Codex delegator, I want the same refusals from the Codex command rules, so that both runtimes behave alike.
25. As an auditor, I want the landing command to read my existing VERDICT and `COUNT … · BLOCKING` lines in either live
    spelling, so that I do not have to change how I report.
26. As the landing verifier, I want one verification-record template that both delegator routes write from, so that
    the landing command cannot misread my verdict and device lines.
27. As a device tester, I want one fixed `IDENTITY releaseId` line in my report, so that the landing command can bind
    the report to the build it tested.
28. As a maintainer, I want the record grammar pinned by fixture tests against the templates, so that a template edit
    that breaks parsing fails a test instead of a landing.
29. As a maintainer, I want a check that no Policy file names a known-wrong path prefix, so that a machine-specific
    stale path fails CI on any runner.
30. As a maintainer, I want change classification to treat every Policy file as code, so that the tests that read those
    files run when they change.
31. As a maintainer, I want the landing command enforced from its first landing, with no warn-only mode, so that it
    does not stay advisory forever.
32. As a maintainer, I want the command proved before rollout by read-only replays on real records: #551 refused (no
    verifier record), #549 refused (verifier and auditors stale at `5b55447f`), and one clean landing passing, so that
    both the pass path and the refusals are shown on real records.
33. As a future reader, I want an ADR recording which earlier decisions this supersedes and which it only enforces, so
    that the landing rules are not re-argued from scratch.

## Implementation Decisions

- **The landing guard becomes the single landing command for both routes.**
  - **Invocation:** a SHA and the item id, plus a repeatable exception id. It also has the existing docs-only mode, a
    dry run, and a replay mode.
  - **Replay mode:** read-only. It takes an explicit historical parent, accepts a merged PR, writes nothing, and
    reports every check's outcome.
  - **Order:** it checks first, then performs the fast-forward of `master` and the push itself. It composes with the
    saved-landing-stash workflow the delegator guide describes.
  - **`--item`:** optional until the ticket that updates the Codex delegator Skill's landing command lands. In that
    same ticket it becomes required.
  - **Module split:** the record parsers, the exception reader and the path list each get their own module, under rule
    50's file-size limit.
- **Policy and Knowledge paths come from one module.** Its exports are read by the landing command's docs-only mode,
  by change classification and by the path check. A fixture test classifies every `git ls-files` path exactly once.
  - **Policy files:** `.claude/**`, `.agents/**`, `.codex/**`, `scripts/codex-rules/**`, `CLAUDE.md`, `AGENTS.md`,
    `docs/agents/**`.
  - **Knowledge documents:** every other path under `docs/`, plus `design/**/*.md`, `GLOSSARY.md`, `progress.md` and
    `CHANGELOG.md` (user ruling, 2026-10-30: 「docs/agents/**」 is the only borderline path classed as Policy).
  - **Neither (code):** everything else. Code is refused by docs-only mode, as today.
- **The evidence checked, all bound to the SHA:**
  - **Verifier.** A record whose VERDICT line says PASS at that SHA, with no qualifier inside the verdict token.
  - **Auditors**, read from each auditor's highest-round report for the item. The report must meet one of these:
    - it names a range ending at the SHA, and its `COUNT … · BLOCKING` line shows zero Critical and zero High;
    - it names a range ending at an audited head from which the SHA is an accepted rebase (below), and is clear;
    - it falls under a matching post-cap row (below).
  - **CI.** The item's open PR has the SHA as head and a green required `ci-gate` on it. The PR number is read for the
    exception match.
  - **Device.** Every report cited in the verifier record's DEVICE line exists. Its `IDENTITY releaseId` SHA must
    resolve to a commit with the landing SHA's ADR-0144 decision 5 identity, which the command computes as a tree diff.
- **An accepted rebase is proved by range-diff, not tree identity.** Three things must hold:
  - `git range-diff <audited-base>..<audited-head> <new-base>..<sha>` shows every commit pair as `=`, with none added
    or dropped;
  - the new base is an ancestor of fetched `origin/master`;
  - the auditor's report range equals `<audited-base>..<audited-head>`.

  `tree-identity.sh` stays as a lane-rerun aid only. It compares three trees and always exits 0, so it is not a proof.
- **Post-cap rulings are read from the audit log** (user ruling, 2026-10-30: 「Accept ruling row (Recommended)」). This
  covers ADR-0129 decision 6 (only the raiser confirms the fix after the cap) and ADR-0143 decisions 3 and 4 (a user-directed fix with no further round, or a single-auditor round).
  - **How the user's ruling is recorded:** a Gate exceptions row with the check token `auditor:<name>`, a scope of
    `post-cap <pre-ruling head sha40> → <landing sha40>`, and the quoted ruling.
  - **What the command then accepts:** the raiser's confirm at the landing SHA, which must be clear, together with the
    non-raiser's last report ending at the pre-ruling head.
  - ADR-0129 and ADR-0143 stay in force.
- **Record grammar and discovery are fixed.** Records are read where they are written today, but the formats are
  pinned.
  - **Records root:** `$HOME/.mdpro-redesign`, with fixed subfolders:
    - `herdr-spike/delegator/` for verifier records;
    - `herdr-spike/gpt-auditor/` and `herdr-spike/opus-auditor/` for auditor reports;
    - `device/` for device reports.

    Only under `MDPRO_GUARD_TEST=1` may another root be used, and then only one whose realpath is under `os.tmpdir()`,
    as for the existing test-mode rule.
  - **Verifier records:**
    - one new template, `verification-record-template.md`, serves both producers: the verifier agent definition on
      Claude and the delegator's own procedure on Codex;
    - the file is `<item>-verify-<sha7>.md`, and the command finds a record by scanning for a VERDICT line naming the
      SHA (a sha7-or-longer prefix of the 40-character SHA);
    - two records with different verdicts for one SHA mean a refusal;
    - on Claude, the delegator saves the subagent's output verbatim;
    - the VERDICT line is `VERDICT PASS|ISSUES|BLOCKED @ <sha> (parent <sha7>)`;
    - the DEVICE line is `DEVICE none | <AC>=<report basename>@<releaseId sha40>[, …]`.
  - **Auditor reports:**
    - the discovery pattern is `^<item>-r(\d+)(pc|postcap)?\.md$`, excluding `-request`, `-challenge`, `-plan` and
      `-confirm` siblings;
    - the highest round wins, and a `pc`/`postcap` file outranks the plain file of the same round;
    - both live VERDICT spellings are accepted: gpt's `VERDICT … @ <sha> (range a..b)`, and opus's fenced form with
      `(range a..b; fix diff c..d)` or `(fix range a..b; base c)`;
    - the command reads the line matching `^COUNT\s+C\d+ H\d+ M\d+ L\d+ · BLOCKING C\d+ H\d+`, never the last line,
      since `SECURITY COUNT` follows it;
    - `docs/agents/audit-dimensions.md` is not changed.
  - **Device reports:** the device-brief template is amended so that every report carries one line,
    `IDENTITY releaseId <version>-dev@<sha40>`.
  - **Parse failure:** an unparseable line is a refusal.
- **Fail closed.** An unreachable GitHub, a missing or unreadable record, or an unparseable line refuses the landing and
  names the check.
- **The only override is an exception id, repeatable.** For each id, the guard accepts it only if all of these hold:
  - a row with that id exists in the audit log's Gate exceptions section, and its Closed cell is empty or `open`;
  - its PR cell is `#<n>` matching this PR, or `any` with an open `until <condition>` scope;
  - its scope SHA equals the landing SHA, for a `this landing only (PR #<n>, <sha40>)` scope;
  - its Gate waived cell starts with one check token from the closed set
    `verifier | auditor:gpt | auditor:opus | ci-gate | device:<AC>`, followed by `:`, and that token is a failing
    check;
  - its Ruling cell quotes the user in 「…」 or “…”.

  The grammar is for new rows only. Old rows stay as written and match nothing: G551-1 is not re-recorded.
- **Docs-only mode takes Knowledge documents only.**
  - **Policy files:** it refuses any commit touching one, and names the PR route.
  - **Audit dimensions file:** keeps its existing ADR-0146 High-tier PR rule.
- **Policy file route** (user rulings, 2026-10-30: 「Low-tier gpt audit (Recommended)」, revising grill Q6; then
  「No, both auditors」 and 「ci-gate + audit only (Recommended)」). A Policy file change goes by PR, with a green
  `ci-gate` and the policy tests.
  - The PR body carries `Policy route: routine | audited`, and the command reads it.
  - **`routine`:** every changed path must be a Policy file or a Knowledge document. Both auditors' mini reports at
    Low tier are required, as ADR-0143 has it for every audit. **No verifier record is required:** the command checks
    `ci-gate` and both auditors' reports only, since a routine text change has no lanes or receipts to re-run.
  - **`audited`:** required for a change to a gate, a landing condition, a role's permissions or the audit rules. It
    takes the High-tier two-auditor audit and the verifier, like any other landing.
  - An auditor may raise `routine` to `audited`. The delegator states the route in the PR.
- **Policy tests:** the existing rules check, plus:
  - **The path check.** No Policy file may name a path that starts with a denylisted, known-wrong prefix. The first
    entry is `/Users/jackcheng/`. It runs the same on macOS and on Ubuntu CI.
  - **Change classification.** It treats every Policy file as code, which moves `AGENTS.md` and `CLAUDE.md` off the
    prose list.
- **Hook backstop and the Claude route** (user ruling, 2026-10-30: 「Yes, both (Recommended)」).
  - The main checkout gets the delegator overlay, through the existing installer's delegator role, so the landing
    command runs on the Claude route.
  - The herdr-delegator pane is launched with `MDPRO_ROLE=delegator`.
  - The role guard's delegator branch refuses a raw `git merge` on `master`, and any push to `master` in every
    spelling: `HEAD:master`, `+master`, `refs/heads/master`, a bare `git push` or `git push origin` on `master`,
    `--all` and `--mirror`. The existing refspec helper is reused.
  - It allows ordinary git, `git commit` on `master` for docs-only commits, and the landing command.
  - The landing command's child git calls are not affected.
  - Rule 70's sentence "No role set means no checks, so the delegator … run unchanged" changes to match.
  - **Codex:** shared rules already forbid every `git push`. The installer's delegator overlay body gains a forbidden
    `git merge` rule. The overlay is reinstalled and the pane restarted at rollout.
  - This guards against slips, not deliberate evasion.
- **Landing docs that move to the landing command:**
  - rules 70 and 71;
  - the delegator Skill and its guide;
  - the codex-rules README;
  - `AGENTS.md` § Delegator routing;
  - `CLAUDE.md` § Release Workflow and § Plan Status;
  - the landing command's own output strings.
- **Unchanged.**
  - `master`'s admin enforcement stays off. It is revisited with #556 item 9's metrics.
  - These stay in force and are enforced, not changed: ADR-0095 (`ci-gate`), ADR-0143 (both auditors on every audit,
    routine Policy PRs included), ADR-0144 (device ACs and identity), ADR-0129 (post-cap), ADR-0146 (audit dimensions), and ADR-0121
    (tiers, except routine Policy paths).
- **ADR (reserved ADR-0159).** The draft is in this snapshot. It supersedes:
  - ADR-0141 decision 2: "the script enforces only what it can check mechanically", and its docs-only set's
    `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md` and `.claude/agents/*.md`;
  - ADR-0141 decision 4: "On the claude route the Codex rules do not apply to the delegator, and nothing changes";
  - ADR-0121's tier for routine Policy paths, which becomes Low;
  - for routine Policy PRs only, rule 70 § Commits item 2's verifier condition (the verifier record is not required);
  - rule 70 § Commits item 2's raw fast-forward and push;
  - rule 71's raw git on the Claude route.
- **Glossary.** A `## Landing` section adds Policy file, Knowledge document and Gate exception. The delegator commits
  it with the snapshot (rule 12).
- **Precondition.** #556 item 1 (the `/Users/jackcheng` paths in three agent definitions) lands before the switch-over
  ticket. The Claude-route verifier records depend on it, and the path check would refuse those files.

## Testing Decisions

- **A good test drives the command or the hook from outside and checks the outcome:** a refusal naming the failed
  checks, or `origin/master` moving to the SHA. It never checks how records are parsed internally.
- **Seam 1, the landing command (process level).** Prior art: the existing land-guard tests, with a temporary repo, a
  bare origin and a fake `gh` on `PATH`, under `MDPRO_GUARD_TEST=1`. New fixture records roots hold verifier records,
  reports from both auditors in both live spellings, device reports and an audit log. Cases:
  - **Pass paths:**
    - all evidence present: lands;
    - an accepted rebase by range-diff: lands;
    - a valid post-cap row: lands;
    - a valid exception, or two: lands, and names them;
    - a routine Policy PR with clear Low reports from both auditors and no verifier record: lands;
    - a routine Policy PR missing either auditor's Low report: refused, naming that auditor.
  - **Each check alone** missing, stale (another SHA), failing (ISSUES, BLOCKED, a blocking High), unparseable, or in
    conflict (two verifier records): refused, naming that check.
  - **Auditor history:**
    - the latest round on an older head: refused;
    - `SECURITY COUNT` after `COUNT`: the BLOCKING line is read;
    - a range-diff with any `!` or a dropped commit: refused.
  - **Device:** an identity mismatch under the ADR-0144 diff is refused; a docs-only change between the release SHA and
    the landing SHA passes.
  - **GitHub unreachable:** refused.
  - **Exceptions:** refused for another PR, another SHA, another check, a closed row, or no quoted words. An open
    `until` row with PR `any` matches.
  - **Records root:** an override outside test mode is ignored.
  - **Policy routes:**
    - a routine Policy PR touching code is refused;
    - docs-only touching a Policy file is refused;
    - docs-only on Knowledge documents lands.
  - **Claude route:** with the delegator overlay and no Codex runtime, it lands.
- **Seam 2, the role-guard hook.** Prior art: the existing role-guard hook tests, with tool-call JSON in and allow or
  deny out. The test's current "delegator passes" case is rewritten. For the delegator role:
  - **Refused:** a raw merge on `master`, and a push to `master` in each listed spelling.
  - **Allowed:** ordinary git, `git commit` on `master`, and the landing command.

  The Codex installer's delegator body gets the matching cases in the existing installer and role-rules tests. The
  `codex execpolicy` cases are a named skip in CI and run locally before landing.
- **Seam 3, policy tests.**
  - The path-list fixture classifies every `git ls-files` path exactly once.
  - Change classification is covered by the existing change-scope tests, extended to every Policy glob.
  - The path check: a fixture Policy file naming `/Users/jackcheng/…` is refused, and one naming `/Users/jack/…`,
    `~/.mdpro-redesign/…` and placeholders passes.
  - All three run in the rules check.
- **Seam 4, the template fixtures.** The verification-record template, the device-brief template's IDENTITY line, and
  the gpt and opus report shapes are each parsed by a fixture test.
- **Acceptance replay (a command, not CI).** Replay mode runs against the real records. The handoff quotes each
  decisive line:
  - **#551:** refused. The decisive line is the verifier check: no record for `5a5b0110`. It may also report
    auditor:opus, since its last report is at `d5ea3b49` and G551-1 is an old-grammar row.
  - **#549:** refused. Its verifier record is for `860db824`, not `5b55447f`. Both auditors' highest reports end at
    `66cc944c`, and gpt-auditor's r2 counts BLOCKING H1.
  - **One clean landing:** passes. The delegator names it in the brief. If no historical landing has records that meet
    the pinned grammar, the handoff says so, and the first landing after rollout serves instead.

## Out of Scope

- #556's other items. Item 1 is a precondition, not part of this. The rest each go their own route:
  - the stale rule text;
  - the launchd backstop;
  - ADR-0147's rule slimming;
  - D323's lifecycle tests;
  - the identity timeout split;
  - macOS PR CI;
  - `ai-verifier`;
  - the metrics.
- A GitHub required check that reads the records. The records stay local, and the command runs on the delegator's
  machine.
- Turning on admin enforcement for `master`.
- A per-item state or manifest file, or any workflow engine.
- Changing `docs/agents/audit-dimensions.md` or the report formats the auditors write today.
- Checking that a cited device report says PASS (Q7 binds only existence and identity), and checking the ADR-0144 AC
  text hash, which stays with the verifier. Both are known limits, recorded in the ADR.
- Migrating old Gate exception rows to the new grammar.
- Defending against deliberate evasion. The hook and command rules are a backstop against slips.

## Further Notes

- **Source:** the grill of 2026-10-30, four rounds, each answered 「全部同意」; seams confirmed 「对的」.
- **r2** answers the informal review by Opus and Fable (merged in `review-r1-merged.md`, X1–X13). It carries the
  user's four rulings of 2026-10-30, quoted above. Q6 is revised by the Policy-route ruling.
- **Parent:** #556, item 4.
- **ADR:** ADR-0159 is reserved, and its draft is `adr-draft-landing-gate.md`.
- **Rule 12 applies,** so re-approval of r2 and the plan review by both auditors come before any grant.
- **Glossary terms:** Policy file, Knowledge document, Gate exception.

