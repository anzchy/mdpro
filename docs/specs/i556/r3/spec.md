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

One landing command for both delegator routes, for `master` and for `release/x.y` hotfix branches. Before it
fast-forwards and pushes, it checks the evidence that already exists for that exact SHA:
- the landing verifier's PASS record;
- each auditor's latest report showing zero blocking Critical and High, or a recorded post-cap ruling;
- on a High-tier landing, gpt-auditor's security section showing zero Critical and High;
- a green `ci-gate`;
- the device reports the verifier cites, with their build identity matching under ADR-0144.

If any check fails or cannot be run, the command refuses and names every failed check. There are two ways past it, and
both are rulings the user has already approved and the published audit log already records. One is a Gate exception
scoped to this landing. The other is a narrow standing exception, which counts only when the verifier itself names it as
carried.

The delegator's docs-only path keeps working, for Knowledge documents only. A Policy file now goes by PR, with CI, the
policy tests and an audit:
- a routine Policy PR gets a Low-tier mini audit by both auditors, and needs no verifier record;
- a Policy PR that touches a gate-sensitive path, or that changes a gate, a landing condition, a role's permissions or
  the audit rules, gets a High-tier audit by both auditors and the verifier. For gate-sensitive paths, the command
  decides this from the paths, not from what the PR says.

A hook stops the delegator from merging into or pushing to `master` or a `release/*` branch any other way, including
through GitHub's own merge, as a backstop against habit.

## User Stories

1. As the user, I want nothing to reach `master` unless its verifier, audit, CI and device evidence all match its exact
   SHA (for a routine Policy PR, its audit and CI), so that the landing rules I approved actually hold.
2. As the user, I want a refused landing to name every check that failed, so that I know what is missing without
   reading logs.
3. As the user, I want the only override to be a Gate exception that I already approved and the published audit log
   already records, so that no one can bypass a check by passing a flag, pointing the command at another folder, or
   writing a row that was never pushed.
4. As the user, I want a Policy file change to go through a PR with CI, so that a change to how agents behave is never
   invisible.
5. As the user, I want Policy file changes that alter gates, landing conditions, role permissions or audit rules to be
   audited at High tier by both auditors, so that the process cannot be weakened quietly.
6. As the user, I want routine Policy file changes (wording, history moves, alias updates) to need only a cheap
   Low-tier mini audit by both auditors and no verifier run, so that every Policy change is read by two models without
   adding a full audit and lane re-run to two dozen commits a week.
7. As the user, I want one exact list of which paths are Policy files and which are Knowledge documents, so that the
   landing command, change classification and the path check never disagree.
8. As the user, I want the command, not a marker in the PR, to send a change to the gate's own code, hooks, command
   rules, receipts, record templates or audit dimensions down the audited route, so that a gate-weakening PR cannot
   declare itself routine.
9. As the user, I want a narrow exception I approved (one lint set, one flaky test, one CI step) to stay narrow, so that
   it never becomes a waiver of a whole check for every PR.
10. As the delegator on either runtime, I want one command that checks and lands, so that "checked" and "merged" cannot
    drift apart.
11. As the delegator, I want my Knowledge-document commits (audit-log rows, device records, sequencing fills) to keep
    landing directly through the same command's docs-only mode, so that record-keeping stays cheap.
12. As the delegator, I want docs-only mode to refuse a commit that touches a Policy file and point me to the PR route,
    so that I cannot use the cheap path by mistake.
13. As the delegator, I want the landing command to read the records I already write (verifier records, auditor
    reports, device reports, the audit log) at fixed locations, so that landing needs no new state file.
14. As the delegator, I want a landing to be refused when the verifier record is for a different SHA, says ISSUES or
    BLOCKED, is missing, or conflicts with another record for the same SHA, so that a stale or failed verification
    never passes.
15. As the delegator, I want a landing to be refused when either auditor's highest-round report names a range that does
    not end at the SHA, or counts a blocking Critical or High, so that a confirm round on an older head is never
    mistaken for one on this head.
16. As the delegator, I want a High-tier landing to be refused when either auditor's report has no security count
    line, has one only on an older head, or counts a Critical or High in it, so that the security review is part of the
    gate on both sides (user, 2026-10-30: 「两个都强制」).
17. As the delegator, I want a rebase after the audit to be accepted only when the range-diff shows every commit pair
    unchanged and the new base is on `origin/master`, so that a master move does not force a re-audit and a changed
    commit never slips through.
18. As the delegator, I want each post-cap ruling the accepted ADRs allow to be accepted when the audit log records it
    in its own row form, and refused otherwise, so that the gate enforces accepted ADRs instead of refusing what they
    allow. The rulings are: only the raiser confirms the fix, the fix lands with no further round, a single-auditor
    round, and a finding landed open.
19. As the delegator, I want a landing to be refused when a device report cited in the verifier record is missing, or
    when its build identity does not match the landing SHA under ADR-0144, so that device PASS is bound to what lands.
20. As the delegator, I want a landing to be refused when `ci-gate` is not green on the PR head, or the PR head is not
    the SHA, so that CI tested what lands.
21. As the delegator, I want a landing to be refused when GitHub is unreachable or a record cannot be read or parsed,
    so that a broken check never counts as a pass.
22. As the delegator, I want each `--exception <id>` (repeatable) to be accepted only when its row exists in the
    published audit log, is open, is scoped to this landing's PR and SHA, quotes the user, and names the failing check,
    so that an exception for another PR, another SHA or another check cannot be reused.
23. As the delegator, I want a standing (`until`) exception to count only when the verifier record names it as carried
    and still says PASS, so that the verifier still runs everything the exception does not cover.
24. As the delegator, I want a waived auditor or device AC to count only through such an exception or a post-cap row,
    so that a missing report never silently passes.
25. As the delegator, I want the hook to refuse, outside the landing command, my raw merge, any push to `master` or
    `release/*`, and GitHub's PR merge, so that an old habit cannot skip the checks.
26. As the delegator, I want the landing command's own git calls to be unaffected by that hook, so that the one
    sanctioned path keeps working.
27. As the Claude delegator, I want the main checkout to carry the delegator overlay and my pane to run with
    `MDPRO_ROLE=delegator`, so that the landing command runs for me and the hook knows my role.
28. As a Codex delegator, I want the same refusals from the Codex command rules, and the landing command to work with
    or without `--item`, so that both runtimes behave alike at every ticket.
29. As an auditor, I want the landing command to read the report shape that `docs/agents/audit-dimensions.md` already
    pins, under the file name my request names, and the delegator to re-ask me for any line that does not conform, so
    that the gate reads the shape I report in.
30. As the landing verifier, I want one verification-record template that both delegator routes use, and on Claude to
    write my own record, so that the landing command cannot misread my verdict, device and carried lines.
31. As a device tester, I want one fixed `IDENTITY releaseId` line in my report, for dev and release-type builds, so
    that the landing command can bind the report to the build it tested.
32. As a maintainer, I want the record grammar pinned by fixture tests against the templates, so that a template edit
    that breaks parsing fails a test instead of a landing.
33. As a maintainer, I want a check that no Policy file names a known-wrong path prefix, so that a machine-specific
    stale path fails CI on any runner.
34. As a maintainer, I want change classification to treat every Policy file as code, so that the tests that read those
    files run when they change.
35. As a maintainer, I want the landing command enforced from its first landing, with no warn-only mode, so that it
    does not stay advisory forever.
36. As a maintainer, I want the command proved before rollout by read-only replays on real records, so that both the
    pass path and the refusals are shown on real records:
    - #551 is refused on exactly the verifier, opus-auditor and device checks;
    - #549 is refused, because its verifier and auditor records are stale at `5b55447f`;
    - one clean landing passes.
37. As a future reader, I want an ADR recording which earlier decisions this supersedes, extends or only enforces, so
    that the landing rules are not re-argued from scratch.

## Implementation Decisions

- **The landing guard becomes the single landing command for both routes.**
  - **Invocation:** a SHA, an optional item id, a repeatable exception id, and an optional `--target release/<x.y>`
    (default `master`). It also has the existing docs-only mode, a dry run, and a replay mode.
  - **Target:** with `--target release/<x.y>`, the PR's base must be that branch. The command fast-forwards and pushes
    that branch only, with every check the same as for `master`. The push guard's refusal of PR-branch pushes to
    `release/*` is unchanged, since it covers a different command.
  - **Replay mode:** read-only. It takes an explicit historical parent, accepts a merged PR, writes nothing, and
    reports every check's outcome.
  - **Order:** it checks first, then performs the fast-forward and the push itself. It composes with the
    saved-landing-stash workflow the delegator guide describes.
  - **`--item`:** optional at every ticket.
    - With it, records are found by item and SHA.
    - Without it, every record is found by scanning for the SHA.
    - A landing whose auditor evidence sits on an older head (an accepted rebase or a post-cap row) needs `--item`.
      Without it, the auditor check refuses and names `--item`.
    - No check is ever skipped because `--item` is missing.
  - **Module split:** the record parsers, the exception reader and the path list each get their own module under
    `scripts/codex-rules/`, within rule 50's file-size limit.
- **Policy and Knowledge paths come from one module.** Its exports are read by the landing command's docs-only mode and
  route check, by change classification, and by the path check. A fixture test classifies every `git ls-files` path
  exactly once.
  - **Policy files:** `.claude/**`, `.agents/**`, `.codex/**`, `scripts/codex-rules/**`, `CLAUDE.md`, `AGENTS.md`,
    `docs/agents/**`.
  - **Gate-sensitive Policy files**, a subset that the same module exports. A change to any of them alters what the
    gate checks, how a role is guarded, or how records are written or read:
    - `scripts/codex-rules/**`: the landing command, the push guard, the role installer and the new modules;
    - `.claude/hooks/**` and `.claude/scripts/**`: the role guard and the other executable hooks;
    - `.claude/settings*.json`: the hook wiring;
    - `.claude/agents/**`: the landing verifier, the number registrar and the fable auditor;
    - `.claude/tdd-guardian/**`: receipts, evidence and the TDD gate config;
    - `.codex/rules/**` and `.codex/agents/**`: the Codex command rules, and the spec-adversary and reviewer configs;
    - `.agents/skills/*/scripts/**`: the delegator and device scripts;
    - `.agents/skills/mdpro-delegator/references/templates/**`: the record and request templates the command's grammar
      is pinned against;
    - `docs/agents/audit-dimensions.md`.

    The fixture test also checks that this subset contains, under any Policy prefix, every tracked file with mode
    `100755` and every `*.mjs`, `*.py`, `*.sh` and `*.json` file.
  - **Knowledge documents:** every other path under `docs/`, plus `design/**/*.md`, `GLOSSARY.md`, `progress.md` and
    `CHANGELOG.md` (user ruling, 2026-10-30: 「docs/agents/**」 is the only borderline path classed as Policy).
  - **Neither (code):** everything else. Code is refused by docs-only mode and by the routine route, as today.
- **The evidence checked, all bound to the SHA:**
  - **Verifier.** A record whose VERDICT line says PASS at that SHA, with no qualifier inside the verdict token. Its
    optional `CARRIED` line is read under the exception rules below.
  - **Auditors.** For each auditor, the report found under the discovery rule below must meet one of these:
    - it names a range ending at the SHA, and its COUNT line shows zero blocking Critical and High;
    - it names a range ending at an audited head of which the SHA is an accepted rebase (below), and is clear;
    - it falls under a matching post-cap row (below).
  - **Security, on High-tier landings.** A High-tier landing is one whose qualifying gpt report has `tier High` in its
    VERDICT line.
    - Both auditors' qualifying reports must carry a security count line with zero Critical and zero High (user,
      2026-10-30: 「两个都强制」). gpt-auditor stays rule 71's named security reviewer; opus-auditor's line is
      required as well.
    - A missing, stale or blocking security line on either side refuses the landing, naming `security`.
    - **Template.** `audit-request-template.md` and `confirm-request-template.md` ask both auditors, opus-auditor
      included, for the High-tier security section and its count line.
  - **CI.** The item's open PR has the SHA as its head, the target branch as its base, and a green required `ci-gate`
    on the head. The PR number is read for the exception match.
  - **Device.**
    - Every report cited in the verifier record's DEVICE line exists.
    - Each report's `IDENTITY releaseId` SHA must resolve to a commit with the landing SHA's ADR-0144 decision 5
      identity, which the command computes as a tree diff.
    - An AC cited as `waived:<id>` needs that id among this landing's `--exception` ids, as a valid `device:<AC>` row.
- **An accepted rebase is proved by range-diff, not tree identity.** Three things must hold:
  - `git range-diff <audited-base>..<audited-head> <new-base>..<sha>` shows every commit pair as `=`, with none added
    or dropped;
  - the new base is an ancestor of the fetched `origin/master`, or of the fetched target branch;
  - the auditor's report range equals `<audited-base>..<audited-head>`.

  `tree-identity.sh` stays as a lane-rerun aid only. It compares three trees and always exits 0, so it is not a proof.
- **Post-cap rulings are read from the audit log** (user ruling, 2026-10-30: 「Accept ruling row (Recommended)」).
  ADR-0159 extends ADR-0129 decision 8's row grammar with a third scope kind, `post-cap`, beside `this landing only` and
  `until`. Every post-cap row:
  - names the item's PR;
  - quotes the user's ruling;
  - has the check token `auditor:<name>` for the auditor whose clearance it replaces.

  Its scope takes one of four forms, one for each ruling the accepted ADRs allow:
  - **`post-cap raiser-confirm <pre sha40> → <landing sha40>`**, for ADR-0129 decisions 6 and 7: only the raiser
    confirms the fix. The named auditor is the non-raiser. Three things must hold:
    - (a) the named auditor's last report ends at the pre-ruling head, and is itself clear (zero blocking Critical and
      High);
    - (b) the landing SHA descends from the pre-ruling head, or is an accepted rebase of a commit that does;
    - (c) the other auditor, the raiser, has a clear confirm whose range ends at the landing SHA and starts at or
      before the pre-ruling head.
  - **`post-cap no-round <pre sha40> → <landing sha40>`**, for ADR-0143 decision 3: a fix with no further round.
    - It takes one row per auditor.
    - Each named auditor's last report ends at the pre-ruling head. Its blocking count is not read.
    - (b) must hold.
    - The verifier and `ci-gate` still gate, as ADR-0143 says.
  - **`post-cap land-open <sha40> D<n>[, D<n>…]`**, for ADR-0143 decision 3 and ADR-0129: the finding lands open. The
    named auditor's report is at the SHA, or at an audited head of which the SHA is an accepted rebase. Its blocking
    Critical plus High count may be at most the number of D rows listed.
  - **`single-auditor <sha40>`**, for ADR-0143 decision 4: the user directed a single-auditor round. The named
    auditor's report is not required for that head. The other auditor's report must be clear at the SHA.

  ADR-0129 and ADR-0143 stay in force. The rows record their rulings so that the command can read them.
- **Record grammar and discovery are fixed.** Records are read where they are written today, but their formats are
  pinned.
  - **Records root:** `<home>/.mdpro-redesign`, where `<home>` is the user's home directory from the password database
    (`os.userInfo().homedir`). Outside test mode, the command refuses when `HOME` differs from it. It has fixed
    subfolders:
    - `herdr-spike/delegator/` for verifier records;
    - `herdr-spike/gpt-auditor/` and `herdr-spike/opus-auditor/` for auditor reports;
    - `device/` for device reports.

    Only under `MDPRO_GUARD_TEST=1` may another root be used, and then only one whose realpath is under `os.tmpdir()`,
    as in the existing test-mode rule.
  - **Verifier records:**
    - **Template.** A new `verification-record-template.md` serves both producers: the landing verifier on Claude, which
      now writes its own record file, and the delegator's own procedure on Codex.
    - **File and lookup.** The file is `<item>-verify-<sha7>.md`. The command finds a record by scanning for a VERDICT
      line that names the SHA, as a sha7-or-longer prefix of the 40-character SHA. Two records with different verdicts
      for one SHA mean a refusal.
    - **VERDICT line:** `VERDICT PASS|ISSUES|BLOCKED @ <sha> (parent <sha7>)`.
    - **DEVICE line:** `none`, or a comma-separated list in which each AC is `<AC>=<report basename>@<releaseId sha40>`
      or `<AC>=waived:<exception id>`. Example: `DEVICE AC-3=D50-r1-report.md@<sha40>, AC-5=waived:G560-2`.
    - **CARRIED line,** optional: `CARRIED <exception id>[, <id>…]` names the standing exceptions the verifier relied
      on.
  - **Auditor reports.** The command parses the shape that `docs/agents/audit-dimensions.md` pins in its § Report
    shape, and that file does not change.
    - **File name.** The audit and confirm request templates name the output file `<item>-r<n>.md`. Round numbers carry
      on through post-cap rounds. For records written before rollout, `<item>-r<n>pc.md` and `<item>-r<n>postcap.md`
      are also read. A report under any other name is not discovered.
    - **Discovery.** With `--item`, the highest round wins, and a `pc` or `postcap` file outranks the plain file of the
      same round. Without `--item`, the command scans each auditor folder for reports whose VERDICT head names the SHA,
      and takes the highest round among them.
    - **VERDICT line.** `VERDICT <mode> · <item> @ <sha7+>`, then a parenthesis that starts with `range a..b` or
      `fix range a..b`, then `tier <T>`.
      - The report's head is the `@` SHA, and the range must end at it.
      - A short SHA matches when it is a sha7-or-longer prefix of the 40-character SHA, the same rule as for verifier
        records.
      - The line may sit inside a code fence.
    - **COUNT line:** the first line matching `COUNT C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>` outside a
      `## Security review` section.
    - **Security line:** `SECURITY C<n> H<n> M<n> L<n>`, optionally with the word `COUNT` after `SECURITY`, and
      optionally followed by a BLOCKING pair. Clear means zero Critical and zero High, or zero blocking when the pair
      is present.
    - **A report that does not conform** has no conforming VERDICT or COUNT line: for example, a bold COUNT, a COUNT
      without `·`, or no VERDICT at all. It is refused. The delegator re-asks the auditor for the missing lines in the
      same round, under the dimensions file's re-ask rule, and the re-ask is not a new round.
  - **Device reports.** The device-brief template is amended so that every report carries one line:
    `IDENTITY releaseId <version>[-dev]@<sha40>`. The `-dev` suffix is absent for a release-type verify build.
  - **Parse failure.** An unparseable line is a refusal.
- **Fail closed.** An unreachable GitHub, a missing or unreadable record, or an unparseable line refuses the landing and
  names the check.
- **Exceptions.** The audit log is read from the fetched `origin/master`: the command runs `git fetch`, then reads the
  blob at `origin/master`, never the working tree. A row is therefore published before it is used. Every row is read in
  the new grammar only:
  - its id exists in the Gate exceptions section, and its Closed cell is empty or `open`;
  - its Gate waived cell starts with one check token from the closed set
    `verifier | auditor:gpt | auditor:opus | security | ci-gate | device:<AC>`, followed by `:`;
  - its Ruling cell quotes the user in 「…」 or “…”.

  A row can be used in two ways:
  - **`--exception <id>`, repeatable.**
    - The row's scope must be `this landing only (PR #<n>, <sha40>)`, naming this PR and the landing SHA, or one of the
      `post-cap` forms above.
    - Its token must name a failing check.
    - It waives that one check, for this landing.
  - **Carried by the verifier.**
    - A row with PR `any` and an open `until <condition>` scope is never accepted through `--exception`.
    - It counts only when the verifier record lists its id on the `CARRIED` line beside `VERDICT PASS`, and only while
      the row is open.
    - The verifier still runs, and its PASS still covers everything else.
    - A carried `ci-gate` row is refused: a `ci-gate` exception is always `this landing only`, with the SHA.

  Old rows stay as written and match nothing. G551-1 is not re-recorded. Each open `until` row (G-D325-1, G-D327-1,
  G-D340-1, G518-1) needs a new-grammar row before it can be carried.
- **Docs-only mode takes Knowledge documents only.**
  - **Policy files:** it refuses any commit that touches one, and names the PR route.
  - **The audit dimensions file** keeps its existing ADR-0146 High-tier PR rule.
- **Policy file route.** It rests on these user rulings:
  - 2026-10-30: 「Low-tier gpt audit (Recommended)」, which revises grill Q6;
  - then 「No, both auditors」 and 「ci-gate + audit only (Recommended)」;
  - the r3 ruling, 「好，按方案一起草 r3」.

  A Policy file change goes by PR, with a green `ci-gate` and the policy tests. The PR body carries
  `Policy route: routine | audited`, and the command reads it.
  - **The command decides first.** It refuses `routine`, naming the route check, when any of these holds:
    - a changed path is a gate-sensitive Policy file;
    - a changed path is code;
    - either qualifying auditor report's VERDICT says a tier above Low.
  - **`routine`:**
    - every changed path must be a Policy file that is not gate-sensitive, or a Knowledge document;
    - both auditors' mini reports at Low tier are required, as ADR-0143 has it for every audit;
    - **no verifier record is required**: the command checks `ci-gate` and both auditors' reports only, since a routine
      text change has no lanes or receipts to re-run.
  - **`audited`:** required for every gate-sensitive path, and for any change to a gate, a landing condition, a role's
    permissions or the audit rules. It takes the High-tier two-auditor audit and the verifier, like any other landing.
  - **An auditor may raise `routine` to `audited`** by reporting a higher tier. The command then refuses `routine`.
- **Policy tests:** the existing rules check, plus:
  - **The path check.** No Policy file may name a path that starts with a denylisted, known-wrong prefix. The first
    entry is `/Users/jackcheng/`. It runs the same on macOS and on Ubuntu CI.
  - **Change classification.** It treats every Policy file as code, which moves `AGENTS.md` and `CLAUDE.md` off the
    prose list.
- **Hook backstop and the Claude route** (user ruling, 2026-10-30: 「Yes, both (Recommended)」).
  - The main checkout gets the delegator overlay, through the existing installer's delegator role, so the landing
    command runs on the Claude route.
  - The herdr-delegator pane is launched with `MDPRO_ROLE=delegator`.
  - **In the main worktree, an unset `MDPRO_ROLE` counts as `delegator`.** Rule 70's sentence "No role set means no
    checks, so the delegator and the user's own sessions run unchanged" becomes: "No role set means no checks, except
    in the main checkout, where an unset role counts as `delegator`."
  - **The role guard's delegator branch refuses:**
    - a raw `git merge` on `master` or on a `release/*` branch;
    - any push to `master` or `release/*`, in every spelling: `HEAD:<branch>`, `+<branch>`, `refs/heads/<branch>`, a
      bare `git push` or `git push origin` on that branch, `--all` and `--mirror`. It reuses the existing refspec
      helper;
    - `gh pr merge` in any form, and `gh api` with a `pulls/<n>/merge` path.
  - **It allows** ordinary git, `git commit` on `master` for docs-only commits, and the landing command. The landing
    command's child git calls are not affected.
  - **Codex:** the shared rules already forbid every `git push` and `gh pr merge`. The installer's delegator overlay
    body gains a forbidden `git merge` rule. At rollout the overlay is reinstalled and the pane restarted.
  - This guards against slips, not deliberate evasion.
- **Landing docs that move to the landing command:**
  - rules 70 and 71;
  - the delegator Skill and its guide;
  - the delegator templates: `landing-docs-checklist.md`, and the audit and confirm request templates, which also pin
    the report file name;
  - the codex-rules README;
  - `AGENTS.md` § Delegator routing;
  - `CLAUDE.md` § Release Workflow and § Plan Status;
  - the landing command's own output strings.
- **Unchanged.**
  - `master`'s admin enforcement stays off. It is revisited with #556 item 9's metrics.
  - These ADRs stay in force and are now enforced, not changed:
    - ADR-0095: `ci-gate`;
    - ADR-0143: both auditors on every audit, routine Policy PRs included;
    - ADR-0144: device ACs and identity;
    - ADR-0129: post-cap rulings, with its row grammar extended;
    - ADR-0146: the audit dimensions;
    - ADR-0083: release branches;
    - ADR-0121: tiers, except for routine Policy paths.
- **ADR-0159** is committed Proposed at
  `docs/adr/0159-landing-is-checked-against-the-records-by-one-command-and-policy-files-land-by-pr.md`.
  - **It supersedes:**
    - ADR-0141 decision 2's clause "the script enforces only what it can check mechanically", and the `CLAUDE.md`,
      `AGENTS.md`, `.claude/rules/*.md` and `.claude/agents/*.md` entries in its docs-only set;
    - ADR-0141 decision 4: "On the claude route the Codex rules do not apply to the delegator, and nothing changes";
    - ADR-0121's tier for routine (not gate-sensitive) Policy paths, which becomes Low;
    - rule 70 § Commits item 2's verifier condition, for routine Policy PRs only (no verifier record is required);
    - rule 70 § Commits item 2's raw fast-forward and push, and rule 70's "no role set" sentence;
    - rule 71's raw git on the Claude route.
  - **It extends** ADR-0129 decision 8's Gate exceptions row grammar with the `post-cap` scope and the check tokens.
- **Glossary.** The `## Landing` section committed with r2 holds Policy file, Knowledge document and Gate exception. r3
  adds no term.
- **Precondition.** #556 item 1 (the `/Users/jackcheng` paths in three agent definitions) lands before the switch-over
  ticket. The Claude-route verifier records depend on it, and the path check would refuse those files.

## Testing Decisions

- **A good test drives the command or the hook from outside and checks the outcome:** a refusal naming the failed
  checks, or the target branch on the bare origin moving to the SHA. It never checks how records are parsed internally.
- **Seam 1, the landing command, at process level.** Prior art: the existing land-guard tests, which use a temporary
  repo, a bare origin and a fake `gh` on `PATH`, under `MDPRO_GUARD_TEST=1`. New fixture records roots hold:
  - verifier records;
  - auditor reports in the pinned shape, plus the pre-rollout `pc`/`postcap` names;
  - device reports;
  - an audit log committed on the fixture origin's `master`.

  Cases:
  - **Pass paths:**
    - all evidence present: lands;
    - the same with `--target release/<x.y>`: the release branch moves, and `master` does not;
    - an accepted rebase by range-diff: lands;
    - each of the four post-cap forms, with its requirements met: lands;
    - a valid exception, or two: lands, and names them;
    - a carried `until` row named on the verifier's `CARRIED` line beside `VERDICT PASS`: lands;
    - a routine Policy PR with clear Low reports from both auditors and no verifier record: lands;
    - no `--item`, with records found by SHA: lands.
  - **Each check alone:** missing, stale (another SHA), failing (ISSUES, BLOCKED, a blocking High), unparseable, or in
    conflict (two verifier records). Each is refused, naming that check.
  - **Auditor history:**
    - the latest round is on an older head: refused;
    - a bold COUNT line, a COUNT line without `·`, or no VERDICT line: refused, naming the auditor;
    - two COUNT lines, the first inside `## Security review`: the one outside is read;
    - a range-diff with any `!` or a dropped commit: refused;
    - a rebase or post-cap landing without `--item`: refused, naming `--item`.
  - **Security:**
    - a High-tier landing whose gpt report has no security line, has one only on an older head, or has a High in it:
      refused, naming `security`;
    - an opus report with no security line, one only on an older head, or one with a High: refused;
    - clear security lines from both auditors: lands;
    - a `security` exception for this landing: lands.
  - **Post-cap requirements:** these are refused:
    - a raiser-confirm row whose named auditor's pre-ruling report is not clear (a);
    - a raiser-confirm row whose landing SHA does not descend from the pre-ruling head (b);
    - a raiser-confirm row whose raiser confirm does not cover the pre-ruling head (c);
    - a land-open row that lists fewer D rows than the blocking count.
  - **Device:**
    - an identity mismatch under the ADR-0144 diff: refused;
    - a docs-only change between the release SHA and the landing SHA: passes;
    - a release-type `IDENTITY` line without `-dev`: parses;
    - `<AC>=waived:<id>` with a valid `device:<AC>` exception: lands; without the exception: refused.
  - **GitHub unreachable:** refused.
  - **Exceptions:** each of these is refused:
    - a row for another PR, another SHA or another check, a closed row, or a row with no quoted words;
    - an `until` row passed by `--exception`;
    - a carried `ci-gate` row;
    - a carried row that is closed;
    - a row that is in the working tree but not on `origin/master`.
  - **Records root:** an override outside test mode is ignored, and a `HOME` that differs from the password-database
    home is refused.
  - **Policy routes:**
    - a routine Policy PR touching code: refused;
    - a routine Policy PR touching a gate-sensitive glob: refused, naming the route check (one case per glob);
    - a routine Policy PR where either report says `tier High` or `tier Medium`: refused;
    - docs-only touching a Policy file: refused;
    - docs-only on Knowledge documents: lands.
  - **Claude route:** with the delegator overlay and no Codex runtime, it lands.
- **Seam 2, the role-guard hook.** Prior art: the existing role-guard hook tests, which feed tool-call JSON in and read
  allow or deny out. The test's current "delegator passes" case is rewritten. For the delegator role, and for an unset
  role in the main worktree:
  - **Refused:**
    - a raw merge on `master` or `release/*`;
    - a push to `master` or `release/*`, in each listed spelling;
    - `gh pr merge`;
    - `gh api` with a `pulls/<n>/merge` path.
  - **Allowed:** ordinary git, `git commit` on `master`, `gh pr view`, and the landing command.
  - **Unchanged:** an unset role outside the main worktree.

  The Codex installer's delegator body gets the matching cases in the existing installer and role-rules tests. The
  `codex execpolicy` cases are a named skip in CI and run locally before landing.
- **Seam 3, the policy tests.**
  - The path-list fixture classifies every `git ls-files` path exactly once, and checks that every executable or script
    file under a Policy prefix is gate-sensitive.
  - The existing change-scope tests cover change classification, extended to every Policy glob.
  - The path check refuses a fixture Policy file naming `/Users/jackcheng/…`, and passes one naming `/Users/jack/…`,
    `~/.mdpro-redesign/…` and placeholders.
  - All three run in the rules check.
- **Seam 4, the template fixtures.** A fixture test parses each of these:
  - the verification-record template, including `CARRIED` and `waived:`;
  - the device-brief template's IDENTITY line, in both build forms;
  - the report shape in `docs/agents/audit-dimensions.md`, including its SECURITY line;
  - the output file name in the audit and confirm request templates.
- **Acceptance replay (a command, not CI).** Replay mode runs against the real records. The handoff quotes each
  decisive line:
  - **#551:** refused, on exactly three checks:
    - verifier: there is no record for `5a5b0110`;
    - auditor:opus: its last report, `ADR0149-entry-r2.md`, is at `d5ea3b49`;
    - device: the check cannot run, because there is no verifier record to hold a DEVICE line.
  - **#549:** refused.
    - Its verifier record is for `860db824`, not `5b55447f`.
    - Both auditors' highest reports end at `66cc944c`, and gpt-auditor's r2 counts BLOCKING H1.
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
- Changing `docs/agents/audit-dimensions.md` or the report shape it pins.
- Checking that a cited device report says PASS, since Q7 binds only existence and identity. Checking the ADR-0144 AC
  text hash, which stays with the verifier. Both are known limits, recorded in the ADR.
- Judging whether a carried `until` exception's condition still holds, or whether a failure falls within its narrow
  wording. The verifier judges that; the command checks only that the row is open and carried.
- Migrating old Gate exception rows to the new grammar.
- Defending against deliberate evasion. The hook and the command rules are a backstop against slips.

## Further Notes

- **Source:** the grill of 2026-10-30, four rounds, each answered 「全部同意」; seams confirmed 「对的」.
- **r2** answered the informal review by Opus and Fable (X1–X13). The merged review is planner-local, under
  `~/.mdpro-redesign/planner/I556/`, and is not in this snapshot. r2 carried the user's four rulings of 2026-10-30,
  quoted above. The Policy-route ruling revises Q6.
- **r3** answers the formal round-one plan review of r2 by gpt-auditor (C0 H2 M2) and opus-auditor (C0 H2 M7 L7).
  - The reports and the merged verdict are planner-local.
  - The user ruled 「好，按方案一起草 r3」: option 1 for Y1, which keeps the routine route and has the command force
    the audited route for gate-sensitive paths.
  - The map from findings to edits is `changes-from-r2.md`.
- **Parent:** #556, item 4.
- **ADR:** ADR-0159, committed Proposed under `docs/adr/`.
- **Rule 12 applies,** so re-approval of r3 and the round-two plan review by both auditors come before any grant.
- **Glossary terms:** Policy file, Knowledge document, Gate exception.

