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
| #515 | D290 | High | `bcfd4415` → `0ee486d2` (r1) → `82dbce98` (r2) → `2dbcff7a` → `4775f410` (r3, rebased) → `ab06bc9e` (r4) | 4 (r4 a user-ruled exception to ADR-0120: 「Allow 4th fix round (Recommended)」) | r1: C0 H2 (H1 close during the preferences await; H2 relaunch batch guarded once); r2: H1, H2 CLOSED, new H3 (an epoch check silently drops a valid Save) C0 H1 M1; r3: H3 CLOSED, new H4 (Reload then typing revives a stale Save over the disk) C0 H1 M1; r4: H4 CLOSED, C0 H0 M1 | r1: H1 confirmed, H2 called pre-existing and rejected because the PR claims the property; r2: C0 H0 M4 L7, CONFIRMED H3 on challenge; r3: C0 H0 M3 L8, CONFIRMED H4 on challenge (master also writes the stale buffer); r4: H4 CLOSED, C0 H0 M3 L8 | r1 C0 H0 M0 L2; r2–r4 delta C0 H0 (Opus fork) | C0 H0 | PR #515 comments (each round's reports plus merged r1–r4) | landed `ab06bc9e` |
| #514 | M3b | High (raised from Medium by gpt-auditor, ADR-0121) | `bcfd4415` → `c5d5c7c9` (r1) → `f9845e90` (r2) | 2 | r1: C0 H1 M4 L1; r2: H1 CLOSED, C0 H0 M4 L1 | r1: C0 H0 M2 L8 (mini + tier-High top-up), CONFIRMED H1 on challenge; r2: H1 CLOSED, C0 H0 M1 L8 | C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #514 comments (Codex r1, Fable r1, merged r1, merged r2) | landed `f9845e90` |
| #513 | D293 | High | `d50d0096` → `bcfd4415` | 1 | C0 H0 M0 L1 (gpt-auditor) | C0 H0 M1 L4 (fable-auditor) | C0 H0 M0 L1 (Opus fork) | C0 H0 | PR #513 comments (Codex r1, Fable r1, merged r1) | landed `bcfd4415` |
| #512 | M3a | High | `9b485752` → `c575e2e4` | 1 | C0 H0 M3 L1 (gpt-auditor) | C0 H0 M6 L6 (fable-auditor) | C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #512 comments (Codex r1, Fable r1, security-review, merged r1) | landed `c575e2e4` |
| #511 | D289 | High | `10806dca` → `9b485752` | 1 | C0 H0 M1 L1 (gpt-auditor) | C0 H0 M3 L4 | C0 H0 M0 L0 (Opus fork) | C0 H0 | PR #511 comments (Fable r1, merged r1, security-review) | landed `9b485752` |
| #510 | D286 | High | `af72940d` → `10806dca` | 1 | C0 H0 M0 L1 (gpt-auditor) | C0 H0 M2 L1 | C0 H0 M0 L0 (Opus fork, run after landing) | C0 H0 | PR #510 comments (Fable r1, merged r1, security-review) | landed `10806dca` |
| #508 | WI-4.3b | High | … → `098d339d` (base `af72940d`, r4) → `aecb0165` (base `f1bac1cd`, r5) | 5 | r4: C0 H3 M1; r5: C0 H1 M2 L1 | r4: C0 H0 M3 L3, confirmed all three on challenge; r5: C0 H0 M3 L4, then CONFIRMED F508-1b on challenge (reproduced) | r5: C0 H0 M0 L1 (Opus fork) | r5: C0 H1 | PR #508 comments (merged r4 6251108116; r5 reports and merged r5) | landed `aecb0165` with F508-1b deferred as D293, user: 「Land now, defer as a D item」 |
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
| F514-1 | #514 | High | Codex; Fable confirmed (rated Medium on reachability: no emitter of `editor.paragraph.table` yet) | the Insert Table menu adapter dropped the insertion result, so a failed insert inside a table closed the modal as a success | `src/utils/editorMenuCommands.ts:126` | fixed `f9845e90` (receipt M3-WI-15) |
| F508-1 | #508 | High | Codex; Fable confirmed | a late or stale settings read/write overrides a newer confirmed value (1a: timeout rollback after a late success; 1b: an older read applied after newer writes) | `src/components/common/settings/settingsWriterRegistry.ts`; r5 remainder `AdvancedSettings.tsx:50-53`, `loggingService.ts:138-141` | 1a fixed `aecb0165`; 1b partial, deferred D293 (user: 「Land now, defer as a D item」) |
| F508-2 | #508 | High | Codex; Fable confirmed | a remounted Image page's queued write resets sibling leaves to defaults | `settingsWriterRegistry.ts`, Image settings page | fixed `aecb0165` |
| F508-3 | #508 | High | Codex; Fable confirmed | a whole-group write from one window overwrites another window's newer save | `settingsWriterRegistry.ts`, `src-tauri/src/commands/preferences.rs` | fixed `aecb0165` |
