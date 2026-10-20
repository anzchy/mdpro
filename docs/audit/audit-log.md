# Audit log

One row per audited range, and one row per Critical or High finding
([ADR-0121](../adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md)
Decision 6). The delegator is the only writer. A row is written when its
merged verdict is posted on the PR, updated at each confirm, and closed at the
final outcome. The rows come from the merged-verdict PR comments.

It starts with audits requested after `811e5047`, the commit that accepted
ADR-0121. WI-009 and WI-4.3a finished under the earlier order and are not
backfilled.

## Ranges

- **Tier**: High / Medium / Low (rule 70 item 4, "Effort follows risk").
- **Base**: `git merge-base master <head>` at audit time. It moves with each rebase, so a row
  lists every base it had.
- **Counts**: each detector's raw `C/H/M/L`, then the merged blocking count `BLOCKING C<n> H<n>`.
- **Outcome**: `landed <sha>` / `superseded by <PR>` / `abandoned` / `open`.

| PR | Item | Tier | Base → head | Rounds | Codex | Fable | security-review | Blocking | Reports | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| #512 | M3a | High | `9b485752` → `c575e2e4` | 1 | C0 H0 M3 L1 (gpt-auditor) | C0 H0 M6 L6 (fable-auditor) | C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #512 comments (Codex r1, Fable r1, security-review, merged r1) | landed `c575e2e4` |
| #511 | D289 | High | `10806dca` → `9b485752` | 1 | C0 H0 M1 L1 (gpt-auditor) | C0 H0 M3 L4 | C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #511 comments (Fable r1, merged r1, security-review) | landed `9b485752` |
| #510 | D286 | High | `af72940d` → `10806dca` | 1 | C0 H0 M0 L1 (gpt-auditor) | C0 H0 M2 L1 | C0 H0 M0 L0 (Opus fork, run after landing) | C0 H0 | PR #510 comments (Fable r1, merged r1, security-review) | landed `10806dca` |
| #508 | WI-4.3b | High | … → `098d339d` (base `af72940d` at round 4) | 4 + round 5 open | round 4: C0 H3 M1 | round 4: C0 H0 M3 L3, confirmed all three Highs on challenge | — | C0 H3 | PR #508 comment 6251108116 (merged r4) | open: round 5 granted past ADR-0120's cap, user: 「Fix now, gpt-imple-2」 |
| #507 | D284 | High | `06308c46` → `286eae60` | 1 | C0 H0 M0 L0 | C0 H0 M1 L1 | C0 H0 M0 L0 | C0 H0 | PR #507 comments (Codex, security-review, Fable r1, merged r1) | landed `286eae60` |
| #506 | D274 | High | `e04f35f0` → `76d5f04b` | 1 | C0 H0 M0 L0 | C0 H0 M0 L2 | C0 H0 M0 L0 | C0 H0 | PR #506 comments (Codex, security-review, Fable r1, merged r1) | landed `76d5f04b` |

## Findings

- **Id**: `F<PR>-<n>`, stable once posted.
- **Detectors**: Codex, Fable, `security-review`, or several of them.
- **Class**: the bug class it names. The same class raised on a second PR goes into
  `REVIEW.md` or becomes a lint-test D item.
- **Outcome**: `fixed <sha>` / `refuted` (with the counter-proof's link) / `pre-existing D<n>` /
  `ruled by the user` (quoted).

| Id | PR | Severity | Detectors | Class | file:line | Outcome |
|---|---|---|---|---|---|---|
| F508-1 | #508 | High | Codex; Fable confirmed | a late or stale settings read/write overrides a newer confirmed value (1a: timeout rollback after a late success; 1b: an older read applied after newer writes) | `src/components/common/settings/settingsWriterRegistry.ts` | open (round 5) |
| F508-2 | #508 | High | Codex; Fable confirmed | a remounted Image page's queued write resets sibling leaves to defaults | `settingsWriterRegistry.ts`, Image settings page | open (round 5) |
| F508-3 | #508 | High | Codex; Fable confirmed | a whole-group write from one window overwrites another window's newer save | `settingsWriterRegistry.ts`, `src-tauri/src/commands/preferences.rs` | open (round 5) |
