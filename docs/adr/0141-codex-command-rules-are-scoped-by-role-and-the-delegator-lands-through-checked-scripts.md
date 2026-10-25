# 0141. Codex command rules are scoped by role, and the delegator pushes and lands only through checked scripts

## Status

Accepted, 2026-10-25. Decided by the user, recorded by herdr-delegator (Claude route). The user's words:
「Accept both (Recommended)」, answering whether to accept ADR-0140 and ADR-0141. Reviewed over three rounds by opus-auditor alone (`plan`; Codex usage exhausted, by the user's direction): r1 C0 H3, r2 C0 H2, r3 C0 H0 M6.

Proposed, 2026-10-25, by herdr-delegator (Claude route). The user's direction:
- 「how to tackle the codex delegator problems, figure out the best practice, recommend how to fix, I still want the route mechanism of delegator」;
- 「yes」, answering whether to reserve an ADR number and draft this ADR and an implementation brief;
- 「create a new opus-auditor, and audit adr-0141, codex uasge is out, now only opus-auditor」 (2026-10-25), so
  opus-auditor is this ADR's only reviewer while Codex usage is exhausted.

**Revision 2** follows opus-auditor's round 1 (`herdr-spike/opus-auditor/ADR-0141-r1.md`): C0 H3 M8 L3, blocking H3.
- H1: nothing enforced "`--role delegator` only on the main checkout", so an implementor could install the delegator
  role in its own worktree and push or land with the sanctioned scripts. Decisions 1 and 2 now refuse that.
- H2: the design took away the delegator's push of its docs-only direct commits, and the first such commit would
  strand every later landing. Decision 2 adds a docs-only mode.
- H3: the overlays went on in WI-2, after WI-1 had removed the bans from the shared file. Decision 3 now installs
  them before WI-1 lands.

**Revision 3** follows opus-auditor's round 2 (`ADR-0141-r2.md`): F1 and F3 CLOSED; C0 H2 M11 L4, blocking H2.
- F2 PARTIAL: `docs/` alone was narrower than the delegator's real direct commits (49 of the last 150 `docs(...)`
  commits touch `.claude/rules/`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md` or `design/`). Decision 2 widens the
  docs-only allowlist to that path set.
- F4 (new): the brief's environment override of the main-checkout path reopened F1. Decision 2 now confines test mode
  to temporary directories and local bare remotes.
- Mediums taken: the script names are `.mjs` throughout; the restricted overlay also bans the main checkout's absolute
  script paths; decision 3 says how a Codex worktree created before WI-2 is provisioned. Low: `reset-codex.sh` does
  no detached checkout, so that clause is gone.

Round 3 (`ADR-0141-r3.md`): F2 and F4 CLOSED, **C0 H0 M6 L0, blocking 0, READY**. Its six Mediums are taken as
one-line hardenings: the PR cost of out-of-set direct commits is named in Costs; a recovery step for an out-of-set
commit made on `master` by mistake; test-mode paths pinned by `realpath` and a bare-repository check; URL rewrites
(`insteadOf`, `GIT_CONFIG_*`) refused; the between-window provisioning goes into the delegator's wake checklist; and
this ADR is accepted only with or after ADR-0140.

Builds on [ADR-0140](0140-a-codex-session-may-hold-the-delegator-role.md) (Proposed), whose decision 3 says
landing "binds unchanged" but gives a Codex delegator no way to run it. On acceptance it partially supersedes
[ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md) and rule 71 § Codex
agents, "The guard": `.codex/rules/mdpro.rules` stops being one file that binds every Codex pane alike.

## Context

- **What happened.** Codex took the delegator role at about 12:15 on 2026-10-24. The last product commit was
  `77d53ba6` at 15:10; nothing reached a PR or `master` before the pause at 21:15. Its own evidence
  (`herdr-spike/delegator/codex-pr-guard-rule-evidence-20261024.md`): `codex execpolicy check` returns `forbidden`
  for `gh pr create`, `git push origin master` and `gh workflow run release.yml` against the committed
  `.codex/rules/mdpro.rules`. Codex's automatic approval reviewer (`guardian_approval`, on by default) also rejected
  `gh pr create` twice. Codex correctly refused to get round the rule with a wrapper or `gh api`.
- **Why.** `.codex/rules/mdpro.rules` (commit `f1bac1cd`, 2026-10-20) ports two different things into one file:
  rule 25's destructive-command guard, which binds everyone, and `role-guard.sh`'s implementor limits, which under
  Claude fire only when `MDPRO_ROLE` is set. The file is tracked, so it loads in the main checkout too, where the
  delegator runs. Every delegator action in rule 70 § Commits item 2 is on its forbidden list.
- **What execpolicy can and cannot express** (Codex CLI 0.164.0, checked 2026-10-25):
  - a `prefix_rule` has `pattern`, `decision`, `justification`, `match`, `not_match`; no role, environment or path
    predicate;
  - when several rules match, the most restrictive decision wins, so an added `allow` never lifts a `forbidden`;
  - matching is by argv prefix, so a ban on `git push -f` misses `git push origin --force`;
  - project rules load from the trusted project's `.codex/rules/*.rules`, per worktree;
  - only the command Codex runs is checked, not what a script it runs does.
- **picsee solved the same problem the same day.** picsee PR #93 (`56cff82`, "separate delegator and restricted
  worktree policies"; `39c4565`, "guard delegator topic pushes"), merged 2026-10-24 06:57. Its Codex delegator then
  merged eleven PRs by 11:44. picsee keeps shared rules in a tracked `picsee.rules`, writes a gitignored per-worktree
  `picsee-role.rules` with `scripts/codex-rules/install-role.py --role delegator|implementor|auditor`, forbids plain
  `git push` for every role, and lets the delegator push only through `push-guard.py`, which checks the role marker,
  the branch and the remote. It lands with `gh pr merge --rebase`.
- **Where mdpro differs.** mdpro lands the audited SHA itself by `git merge --ff-only` and `git push origin master`
  (rule 70, ADR-0085, ADR-0095). GitHub's rebase merge rewrites commit SHAs, so the landed commit would not be the one
  the verifier, the auditor and `ci-gate` checked. picsee's `push-guard.py` refuses `main`, so it cannot land for mdpro
  either.
- **The route mechanism stays.** ADR-0140 decision 2 routes by the Herdr runtime kind (`delegator-route.sh`). The user
  asked to keep it.

## Options considered

1. **Delete the implementor bans from the shared file.** Lost: implementors and auditors would lose their only push
   and PR guard; AGENTS.md alone did not stop the 2026-10-10 incidents that `role-guard.sh` was written for.
2. **Add `allow` rules for the delegator to the shared file.** Lost: the most restrictive decision wins, so they would
   never apply.
3. **Run the Codex delegator without the project rules** (untrusted project, or a separate `CODEX_HOME`). Lost: it also
   drops rule 25's destructive-command guard and the project's Codex skills and agents, and makes the delegator's
   guard depend on a launch flag nobody can see from the repo.
4. **Copy picsee as is, landing by `gh pr merge --rebase`.** Lost: breaks the audited-SHA-lands property above.
5. **picsee's role split, plus a checked landing script for mdpro's fast-forward.** Chosen.
6. **Keep a Claude delegator only.** Lost: the user wants both runtimes, routed (ADR-0140).

## Decision

1. **Shared rules stay tracked; role rules are per worktree.**
   - `.codex/rules/mdpro.rules` keeps rule 25's destructive commands, blanket staging, `git checkout/switch master`,
     `gh release`, and gains a ban on plain `git push` **for every role**.
   - The implementor and auditor bans (`gh pr create|merge|close`, `gh workflow`) move to the tracked template
     `scripts/codex-rules/restricted-role.rules`.
   - `scripts/codex-rules/install-role.mjs --worktree <abs> --role implementor|auditor|delegator` writes the gitignored
     `.codex/rules/mdpro-role.rules` atomically. Its first line is `# Local mdpro role: <role>`. The default role is
     `implementor`; it refuses an unknown role and a symlink target.
   - The delegator overlay adds `gh workflow run` with `decision = "prompt"`, so every release dispatch stops for the
     user (ADR-0073's user-approved draft). `gh pr merge` stays forbidden for every role: mdpro never lands through
     GitHub's merge button.
   - Only the delegator installs a role, and `--role delegator` goes only on the main checkout, on the user's word.
     **The installer enforces it:** it refuses `--role delegator` unless the target is a main working tree
     (`git rev-parse --git-dir` equals `--git-common-dir`) whose top level is the configured main-checkout path
     (`/Users/jack/Documents/mac-app/mdpro`, ADR-0134).
   - The restricted overlay also forbids running `scripts/codex-rules/install-role.mjs`, `push-guard.mjs` and
     `land-guard.mjs` (as `node <path>` and as the path itself, both relative and as the main checkout's absolute
     path). This is a prefix backstop only; the scripts'
     own main-checkout check is the guard.
2. **The delegator pushes and lands only through two checked scripts** under `scripts/codex-rules/`. Each refuses
   unless it runs in the main working tree at the configured main-checkout path (the installer's check above) **and**
   that worktree's overlay starts with `# Local mdpro role: delegator`. A copy of the script in any other worktree
   refuses whatever its overlay says. Each passes only arguments it built.
   - **Test mode cannot reach GitHub.** Tests may substitute the main-checkout path and the approved remote only
     under `MDPRO_GUARD_TEST=1`, and then only with a substitute main path that resolves under `os.tmpdir()` and an
     `origin` that is a local bare repository under `os.tmpdir()`. In test mode any other push URL, the GitHub URLs
     included, is refused before anything is pushed. "Under `os.tmpdir()`" is judged on `fs.realpathSync` of both
     paths, and the bare repository by `git --git-dir <p> rev-parse --is-bare-repository`.
   - **No URL rewriting, in either mode.** Each script refuses if `git config --get-regexp '^url\..*\.(push)?insteadof$'`
     returns anything or `GIT_CONFIG_COUNT` / `GIT_CONFIG_PARAMETERS` is set, so the URL it checked is the URL git
     pushes to.
   - `push-guard.mjs <sha> <branch> [--expected-remote-oid <full-oid>]`: pushes `<sha>` to `refs/heads/<branch>` on the
     one approved `origin` URL. It refuses `master`, `release/*`, `frontend-backend-redesign`, tags and any `refs/`
     name. A lease is only for a branch with an open PR, and only with a full OID (the standing rule 25 exception,
     ADR-0095). It replaces `push-head.sh`'s bare `git push`.
   - `land-guard.mjs <sha>`: in the main checkout on `master`, it checks that `origin/master` is an ancestor of
     `<sha>`, that the open PR whose head is `<sha>` has a green `ci-gate` on `<sha>`, and that the working tree has
     no staged changes. Then it runs `git merge --ff-only <sha>` and `git push <origin-url> <sha>:refs/heads/master`
     with no force option. The verifier PASS and the zero-blocking verdict stay the delegator's own conditions (rule
     70); the script enforces only what it can check mechanically, and says so.
   - `land-guard.mjs --docs-only`: pushes local `master` for the delegator's docs-only direct commits (rule 70: device
     records, sequencing-row SHA fills, the release-freeze paragraph, the Q&A file; no PR, no CI). It refuses unless
     the current branch is `master`, there are no staged changes, the fetched remote `master` is an ancestor of
     `HEAD`, and every path in `git diff-tree --no-commit-id --name-only -r <remote-master>..HEAD` is in the delegator's
     direct-commit set: `docs/**`, `design/**/*.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`,
     `.claude/agents/*.md`. Anything else (`src*`, `tests/`, `scripts/`, `.codex/`, `.github/`, `.claude/hooks/`,
     `.claude/settings*.json`, `package.json`, lockfiles, `src-tauri/`) is refused and goes through a PR and
     `land-guard.mjs <sha>`. The check is on the net range, so an intermediate commit that changes and reverts a
     refused path passes; the tree that lands is still in the set. If the delegator commits an out-of-set path on
     `master` by mistake, it moves the commit to a branch (`git branch <b>`), runs a non-hard
     `git reset origin/master`, and opens a PR; it never pushes `master` around the guard.
     Then it runs `git push <origin-url> HEAD:refs/heads/master` with no force option. Rule 70's docs-only clause and
     ADR-0140 decision 3 stay as written; this is how a Codex delegator carries them out.
3. **Every Codex pane gets its overlay, and the overlays go on before the shared file changes.**
   - **Before WI-1 lands:** the delegator runs the WI-1 branch's installer (`--role implementor` or `auditor`) on
     every Codex worktree (`mdpro-wt/gpt-imple-{1,2,3}`, `mdpro-wt/gpt-auditor`, and any other a Codex pane runs in),
     and checks each with `codex execpolicy check` on the shared file plus the overlay. An overlay next to the old
     shared file only repeats its bans, so it is safe to install early. Once WI-1 lands the overlay is gitignored,
     so it survives later checkouts. Only then is WI-1 fast-forwarded.
   - **Between WI-1 and WI-2:** every Codex worktree created in that window is provisioned by hand with the installer
     before its first pane starts, and each wake re-checks that every live Codex worktree still has its overlay (a
     `git stash -u` or `git clean` can remove it before `.gitignore` covers it). Both steps are written into the
     delegator Skill's wake checklist and the heartbeat until WI-2 lands.
   - **From WI-2 on:** `reset-codex.sh` and the § Restart steps run `install-role.mjs` before `herdr agent start`; a
     pane whose overlay is missing is not started.
   - Existing sessions are restarted to load the change.
4. **The route checks the guard.** `delegator-route.sh` keeps choosing the Codex or Claude flow by the Herdr runtime
   kind. On the `codex` route it also refuses unless the main checkout's overlay says `delegator`. `prompt.sh` refuses
   to send to a pane whose worktree overlay is missing or is not `implementor` or `auditor`. On the `claude` route the
   Codex rules do not apply to the delegator, and nothing changes.
5. **AGENTS.md names the scripts as the delegator's sanctioned route**, so Codex's approval reviewer sees the
   authorization in the instructions, and names any other push or PR spelling as evasion.
6. **A Codex delegator asks rulings at once.** A gate waiting on the user ends the delegator's turn with the question
   as its final message (options and a recommendation) and a Herdr notification. A ruling is never queued in a file
   while other work goes on.

## Consequences

- **Gained.**
  - A Codex delegator can push PR heads, open PRs, land by fast-forward and push `master`, and the audited SHA is
    still the landed SHA.
  - Implementors and auditors keep their push and PR bans, now as a per-worktree overlay, provided it was installed
    before the shared file changed (decision 3) and on every pane since.
  - A Codex delegator can push its docs-only direct commits, so rule 70's docs-only clause keeps working.
  - A plain `git push` is refused for every role, which closes the option-after-remote gap the old ban only partly
    covered.
  - The route and the guard check each other, so a delegator pane without the delegator overlay stops before
    dispatch instead of stalling for hours.
- **Costs.**
  - The role is set by which file is installed, not proven. An agent that edits its own overlay, or runs another
    executable, is not stopped; like `role-guard.sh`, this is a backstop, not a security boundary.
  - One more launch step per Codex pane. A worktree created by hand without `install-role.mjs` has no PR or workflow
    ban until it is provisioned; the default role and the route check narrow that window but do not close it.
  - execpolicy checks only the top-level command, so the scripts are the guard for pushes. A bug in them pushes the
    wrong thing; they carry their own tests.
  - The `codex execpolicy` composition tests need the `codex` binary, which CI does not have; CI runs only the static
    checks, and the full check runs locally before landing.
  - `push-head.sh` callers change to `push-guard.mjs`.
  - Direct commits to paths outside the docs-only set (`design/**/*.html` mockups, root `DESIGN.md` / `TODOS.md`,
    `.claude/skills/**`, `.claude/commands/**`, `.codex/skills/**`) now each cost a PR and a CI run; in opus-auditor's
    probe that was 14 of the last 150 `docs(...)` commits.
  - It depends on ADR-0140 (a Codex session may hold the delegator role), still Proposed; it is accepted only with or
    after ADR-0140.
  - The scripts and the installer carry the main-checkout path, so moving the main checkout means changing them too
    (ADR-0134 fixes it today).
- **Unchanged.** Landing's three conditions, the audits, receipts, rule 25 and its standing force-with-lease exception,
  the delegator's docs-only direct commits (rule 70, ADR-0140 decision 3), the GUI and heavy locks, and ADR-0140's
  runtime routing.
- **Foreclosed.** Landing through GitHub's merge button, for either runtime.
