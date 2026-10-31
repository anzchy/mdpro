# 567-tdd-skill spec snapshot r3 (2026-10-31)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). It supersedes [r2](../r2/manifest.md) after plan
review round 2; r1 and r2 stay as the record. Any later normative edit to an issue below is `r4`, which needs re-approval
and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#568](https://github.com/anzchy/mdpro/issues/568) | `be9bfeea1e9c9d35a335c90abca7c4af725507648c051d5c4f1a774b84227252` |
| `tickets/T-01.md` | [#569](https://github.com/anzchy/mdpro/issues/569) | `dfb6c08057034c8b5f1a199c5e46b4f6842f86b821f1fc175c5afd68b033a367` |
| `tickets/T-02.md` | [#570](https://github.com/anzchy/mdpro/issues/570) | `e9ad8f5a3a2d1b1352be35ae5be8da37f019a2abad8b9e57269ce0ff22395636` |
| `tickets/T-03.md` | [#571](https://github.com/anzchy/mdpro/issues/571) | `9a5e09bf8c49508a3b2d94f6b80b11d689682c51dfd4343b791c6719a7967245` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-10-31.

## Why r3
Plan review round 2 (the cap) at `dbe26389` (blob `d06cc4ab`): opus-auditor READY, C0 H0 M0 L3; gpt-auditor NOT READY,
C0 H1: T-03 closed with no brief and no PR, against rule 12 ("one approved ticket is one brief and one PR") and ADR-0148
decision 6. The user ruled the open High (ADR-0143 cap): T-03 gets a brief and a PR that carries the audit-log rows,
audited at Low tier. r3 also folds in opus-auditor's three Lows:
- T-01's "byte-unchanged" becomes "unchanged by this PR";
- T-01's live check also reads, without writing, that the plugin is enabled on both runtimes;
- the Codex attacker is a new `codex exec` process with no resumed session (spec story 8, the spec's method, T-02,
  ADR-0161 decision 2), and the spec's stale "`/to-tickets` decides" note is corrected.

The merged verdict is at `~/.mdpro-redesign/herdr-spike/delegator/T567-spec-r2-plan-merged.md`. Under ADR-0129 the
raiser, gpt-auditor, confirms the r2→r3 diff before the first brief cites r3.

## Approval words (user, 2026-10-31)
- r1's and r2's words carry over; see [r2](../r2/manifest.md).
- Round-2 ruling on T-03: 「T-03 gets a brief and PR (Recommended)」.
- r3 approval: 「Approve r3 (Recommended)」.

## Blocking edges (native GitHub dependencies, unchanged)
- T-01 (#569): #566.
- T-02 (#570): T-01 (#569); also the user's acceptance of ADR-0161, named in the body.
- T-03 (#571): T-02 (#570); also 0.3.6 shipping, named in the body.
