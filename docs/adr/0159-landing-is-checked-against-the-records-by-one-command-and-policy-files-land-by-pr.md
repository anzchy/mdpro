# 0159. Landing is checked against the records by one command, and Policy files land by PR

**Status**: Proposed (2026-10-30, drafted by herdr-delegator for I556 r2; snapshot `docs/specs/i556/r2/`).
The decision rests on these user words, all from 2026-10-30:
- the grill of #556 item 4, four rounds, each answered 「全部同意」;
- seams confirmed 「对的」;
- four r2 rulings: 「Accept ruling row (Recommended)」, 「Low-tier gpt audit (Recommended)」, 「docs/agents/**」 and
  「Yes, both (Recommended)」;
- two r2 approval rulings: 「No, both auditors」 (routine Policy PRs keep both auditors) and 「ci-gate + audit only
  (Recommended)」 (routine Policy PRs need no verifier record), then 「Approve, proceed (Recommended)」.

**Supersedes:**
- ADR-0141 decision 2: the clause "the script enforces only what it can check mechanically, and says so", and the
  entries `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md` and `.claude/agents/*.md` in the docs-only direct-commit set;
- ADR-0141 decision 4: "On the claude route the Codex rules do not apply to the delegator, and nothing changes";
- ADR-0121 decision 1's tier for routine Policy-file PRs, which becomes Low (any unlisted path was High);
- rule 70 § Commits item 2's verifier-PASS condition, for routine Policy-file PRs only;
- rule 70 § Commits item 2's raw `git merge --ff-only` and `git push origin master`, and rule 70's sentence that no
  role set means no checks for the delegator;
- rule 71's raw git on the Claude delegator route.

**Kept, and now enforced by the command:**
- ADR-0095: `ci-gate` is a landing gate;
- ADR-0143: both auditors on every audit, routine Policy-file PRs included, capped at two rounds;
- ADR-0144: device ACs are proved in the real app, under decision 5's identity;
- ADR-0129: the post-cap rules, read through a recorded row;
- ADR-0121: the tiers, for every other path;
- ADR-0146: the audit dimensions file and its route;
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
- auditor reports come in two VERDICT spellings, varied file names, and a `SECURITY COUNT` line after `COUNT`;
- device reports state identity in four ways;
- Gate exception rows are prose.

Two accepted ADRs also let a landing proceed with one auditor's last report on an older head: ADR-0129 decision 6
(only the raiser confirms a post-cap fix) and ADR-0143 decisions 3 and 4. And `tree-identity.sh`, cited for docs-only
rebases, compares only `src`, `tests` and `src-tauri`, and always exits 0.

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
- **5b. Accept the raiser's confirm plus the non-raiser's pre-ruling report, through a recorded post-cap row.** Chosen.

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

For the docs-only rebase proof:
- **8a. `tree-identity.sh`.** Lost: it covers three trees and never fails.
- **8b. `git range-diff`, with every pair `=`.** Chosen.

## Decision

1. **One landing command for both routes.** `land-guard.mjs <sha> [--item <id>] [--exception <id>]…` checks and then
   does the fast-forward and push itself. It also has a docs-only mode, a dry run and a read-only replay mode.
2. **It checks four kinds of evidence at the SHA:**
   - the verifier's PASS record;
   - each auditor's highest-round report, with a range ending at the SHA, or at an audited head the SHA is an accepted
     rebase of, and zero blocking Critical and High;
   - a green `ci-gate` on the PR whose head is the SHA;
   - the cited device reports, whose `IDENTITY releaseId` SHA has the landing SHA's ADR-0144 decision 5 identity.
3. **Fail closed.** A check that cannot run, or a record that cannot be read or parsed, refuses the landing. Every
   refusal names each failed check.
4. **The only override** is a Gate exception row, in the grammar the spec pins, quoting the user. It may cover one check
   for this PR and SHA, or be an open `until` row for any PR. A post-cap row records an ADR-0129 or ADR-0143 ruling.
   Old rows match nothing.
5. **Records stay where they are, but their formats are pinned.**
   - The records root is fixed, and overridable only in test mode.
   - One verification-record template serves both producers.
   - Auditor reports are read in both live spellings, by their BLOCKING line. `docs/agents/audit-dimensions.md` does
     not change.
   - Device reports carry one IDENTITY line.
6. **Policy files and Knowledge documents** are classified by one path module:
   - **Policy files** are `.claude/**`, `.agents/**`, `.codex/**`, `scripts/codex-rules/**`, `CLAUDE.md`, `AGENTS.md`
     and `docs/agents/**`. They land only by PR, with `ci-gate` and the policy tests. A routine change gets a
     Low-tier mini audit by both auditors and needs no verifier record. A change to a gate, a landing condition, a
     role's permissions or the audit rules gets the High-tier two-auditor audit and the verifier. The PR states which.
   - **Knowledge documents** go by docs-only, through the same command.
7. **The policy tests:** change classification treats Policy files as code, and a path check refuses known-wrong
   prefixes.
8. **The backstop.**
   - On the Claude route, the role guard's delegator branch refuses a raw merge into `master` and every push to
     `master`. The main checkout carries the delegator overlay, and the pane runs with `MDPRO_ROLE=delegator`.
   - On Codex, the delegator overlay forbids `git merge`; shared rules already forbid `git push`.
9. **Enforced from the first landing after rollout**, with no warn-only mode. Before rollout, replays on real records
   show #551 and #549 refused and one clean landing passing.

## Consequences

- The four landing conditions are checked by the same code on both routes. A skipped verifier, a stale audit round or
  an unverified device run no longer lands unnoticed.
- **Given up and costs:**
  - **GitHub must be reachable to land.** When it is not, landing waits, unless a `ci-gate` exception row exists, which
    then lets CI be waived with GitHub down.
  - **Every routine Policy PR costs two Low-tier mini audits and a CI run,** where it used to be a direct commit.
    This includes every `CLAUDE.md` wording edit.
  - **A routine Policy PR skips the verifier,** so nothing re-checks its lanes or receipts. A routine PR that touches
    a code path is refused and must go `audited`.
  - **The Claude delegator now carries a Codex overlay file** in the main checkout and a role variable at launch.
    Both must be restored after any reset of the pane.
  - **Old records do not fit the pinned grammar.** Old exception rows match nothing, so a historical replay may refuse
    landings that were proper at the time, #551 among them. G551-1 is not re-recorded.
  - **More records must be written exactly.** A post-cap ruling now also needs an audit-log row. On Claude, the
    verifier's output must be saved as a file.
- **Known limits:**
  - On Codex, the verifier record is written by the agent that lands.
  - The command does not check that a device report says PASS, and does not check the ADR-0144 AC-text hash. Both stay
    with the verifier.
  - The path check catches only denylisted prefixes, not every wrong path.
  - The hook and the command rules stop slips, not deliberate evasion.
- **Precondition:** #556 item 1 fixes the three agent definitions before the switch-over.
