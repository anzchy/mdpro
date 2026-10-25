# Codex role rules and checked pushes

The tracked `.codex/rules/mdpro.rules` applies to every role. It forbids direct
`git push` and `gh pr merge`. The ignored `.codex/rules/mdpro-role.rules` adds
implementor or auditor restrictions, or marks the main checkout as delegator.
Codex prefix rules check only the command they see. The scripts below also
check the worktree, role and Git destination at runtime.
Each push uses `--no-follow-tags` so a local `push.followTags=true` setting
cannot publish annotated tags alongside the checked branch ref.

Before the shared rule change lands, the delegator installs restricted roles in
every Codex worktree and verifies policy composition. The delegator alone runs:

```sh
node scripts/codex-rules/install-role.mjs --worktree /absolute/codex/worktree --role implementor
codex execpolicy check --rules /absolute/codex/worktree/.codex/rules/mdpro.rules --rules /absolute/codex/worktree/.codex/rules/mdpro-role.rules -- git push origin x
```

Use `--role auditor` for an auditor. Omitting `--role` defaults to implementor.
Only the main checkout at `/Users/jack/Documents/mac-app/mdpro` can receive
`--role delegator`. Installation replaces the local overlay atomically and
refuses a symlink target. Existing panes must restart to load changed rules.

The delegator pushes a named commit to a PR branch with:

```sh
node scripts/codex-rules/push-guard.mjs <sha> <branch> [--dry-run]
```

For a rebase, first observe the full old remote OID `A` and the one open PR
whose head is `A`, then run:

```sh
node scripts/codex-rules/push-guard.mjs <new-sha> <branch> --expected-remote-oid <A>
```

The script leases `A` and checks the PR head again after pushing. If that
last query fails, it exits nonzero and reports that the push may already have
happened. Inspect the remote and PR before deciding the next action.

After the verifier, audits and PR CI pass, the delegator lands the audited SHA:

```sh
node scripts/codex-rules/land-guard.mjs <sha> [--dry-run]
```

The script checks the main checkout, delegator overlay, approved origin,
local `master`, clean index, fetched ancestry, exactly one matching open PR,
and its green `ci-gate`. It fast-forwards local `master` and pushes the exact
SHA. The script does **not** check the verifier PASS or audit verdict; the
delegator checks those before invoking it.

For the delegator's docs-only direct commits, use:

```sh
node scripts/codex-rules/land-guard.mjs --docs-only [--dry-run]
```

This mode checks every changed path in the net range from fetched remote
`master` to local `HEAD`. It permits `docs/**`, Markdown under `design/`,
`CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, and direct Markdown children of
`.claude/rules/` or `.claude/agents/`. It does not consult PR or CI. Both
landing modes push without force.

In production, only the two approved GitHub origin URLs are accepted. Test
mode uses `MDPRO_GUARD_TEST=1` with a main checkout and bare origin that both
resolve under the system temporary directory; while enabled it refuses the
GitHub URLs. All modes refuse Git URL rewrite configuration and Git config
environment overrides. Run `pnpm rules:check` for the policy and Git fixture
tests; Codex-dependent cases show named skips when `codex` is unavailable.
