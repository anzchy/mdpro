# 567-tdd-skill spec snapshot r4 (2026-10-31)

A frozen copy of the issue bodies as published (rule 12, ADR-0148). It supersedes [r3](../r3/manifest.md); r1–r3 stay as the
record. Any later normative edit is `r5`, which needs re-approval and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#568](https://github.com/anzchy/mdpro/issues/568) | `5d813fc2718279912daa858dd14c62b9c9cfe690ed1739fbdd28b3b0808831aa` |
| `tickets/T-01.md` | [#569](https://github.com/anzchy/mdpro/issues/569) | `dfb6c08057034c8b5f1a199c5e46b4f6842f86b821f1fc175c5afd68b033a367` (unchanged from r3) |
| `tickets/T-02.md` | [#570](https://github.com/anzchy/mdpro/issues/570) | `e9ad8f5a3a2d1b1352be35ae5be8da37f019a2abad8b9e57269ce0ff22395636` (unchanged from r3) |
| `tickets/T-03.md` | [#571](https://github.com/anzchy/mdpro/issues/571) | `9a5e09bf8c49508a3b2d94f6b80b11d689682c51dfd4343b791c6719a7967245` (unchanged from r3) |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-10-31.

## Why r4
gpt-auditor's ADR-0129 post-cap confirm of r3 (`gpt-auditor/T567-spec-r3-confirm.md`) kept R2-H1 open. r3 fixed T-03 and
ADR-0161 decision 7, but the spec's Testing Decisions (r3 `spec.md:125,129`) still said "no brief or PR" and "a docs-only
commit", and rule 12 ranks the spec above the ticket. r4 changes only those two lines, to T-03's own brief and PR carrying
the rows. The ADR-0161 Status line now points at r4.

## Approval words (user, 2026-10-31)
- r1–r3's words carry over; see [r3](../r3/manifest.md).
- The ADR-0129 return to the user: 「r4: fix the two spec lines (Recommended)」, which also approves r4.

## Blocking edges (native GitHub dependencies, unchanged)
- T-01 (#569): #566.
- T-02 (#570): T-01 (#569); also the user's acceptance of ADR-0161, named in the body.
- T-03 (#571): T-02 (#570); also 0.3.6 shipping, named in the body.
