# What mdpro can take from picsee's dev workflow (2026-10-27)

Asked by the user: 「use subagent to check picsee related workflows and rules, claude skills, check 如何用来提升当前project的dev workflow」.
A read-only Opus subagent compared picsee (`/Users/jack/Documents/mac-app/picsee`) with mdpro. The user adopted all
seven recommendations: 「建议1-7 均采用」.

## picsee in brief
- **Always-on text is small**: `CLAUDE.md` is 6 lines and pulls in `AGENTS.md` (134 lines, "a map, not a manual").
  No `.claude/rules/`, no hooks. Roster and workflow detail live in the `picsee-delegator` skill.
- **Audit**: one in-repo dimension file, D1–D12 (`docs/agents/audit-dimensions.md`), with "concurrency and
  cancellation" and "do the tests prove each AC" on every tier, a `COVERAGE` line, and a per-AC
  PROVED / NOT PROVED / WRONG verdict.
- **Device**: a short skill plus a runbook; `scripts/device/doctor.sh` prints identity lines after launch (build
  SHA, signature, single instance, window). UI parity is checked in batches only.
- **Doc gardener**: a Haiku subagent checks docs against the diff before each PR push.

## Size of always-on text
picsee about 13 KB; mdpro about 117 KB (`CLAUDE.md` 27 KB, `AGENTS.md` 13 KB, rule 70 35 KB, rule 71 30 KB, rules
10/22/25/50/60 about 20 KB), and Codex is told to read rules 70 and 71 in full every session.

## Adopted, and where each went
| # | Improvement | Where |
|---|---|---|
| 1 | Always-on files become a routing map; delegator-only clauses move into the delegator skill; Codex reads rules 70/71 only when its role needs them | ADR-0147 (reserved); waits for the user's own edits to rule 71, `CLAUDE.md`, `AGENTS.md` to be committed |
| 2 | Project audit dimensions in the repo, with concurrency/lifecycle and tests-prove-AC on every tier, a COVERAGE line and per-AC verdicts | ADR-0146 |
| 3 | "WI-0: probe the risky platform seam first" in every brief | Delegator brief template § 2b (2026-10-27) |
| 4 | Open questions with defaults the implementor follows; standing allowance for test-fixture edits | Delegator brief and fix-brief templates § 2, § 2a (2026-10-27) |
| 5 | One command that launches a device build by path and proves its identity | [D326](../plans/20260912-frontend-backend-sequencing-order.md#d326); per-feature recipes are ADR-0144's cards |
| 6 | A Haiku doc gardener before each PR push, a named exception to rule 70's Opus rule (user: 「Haiku, named exception (Recommended)」) | ADR-0147 |
| 7 | "A suspicion without a trace is at most Medium"; a range over about 400 changed production lines gets a Medium recommending a split | ADR-0146 |

## Not adopted, and why
- **Batch-only device checks for UI**: contradicts ADR-0144. mdpro's costliest escapes were platform-ordering bugs
  found only in post-landing batches.
- **`gh pr merge --rebase`**: rewrites SHAs, which breaks tree-identity checks and receipt fingerprints.
- **Fix rounds up to about 80 % context**: contradicts ADR-0131 and ADR-0133 and mdpro's own cost data.
- **Auditor overrides that follow quota**: picsee changed auditors three times in two days; ADR-0143 settles it here.
- **Dropping hooks**: `role-guard.sh` and `session-size-guard.sh` are cheap and were earned.
