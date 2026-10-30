# D50 spec snapshot r1 (2026-10-30)

Frozen copy of the issue bodies the user approved (rule 12, ADR-0148). A normative edit to any issue below is `r2`, which
needs re-approval and a plan review of its diff against this revision.

| File | Issue | Body SHA-256 |
|---|---|---|
| `spec.md` | [#553](https://github.com/anzchy/mdpro/issues/553) | `be46d11fd811b1d9c54e320398ae011e5f8251c8f0e72c041130595b6292eab5` |
| `tickets/T-01.md` | [#554](https://github.com/anzchy/mdpro/issues/554) | `56c9342e22fbf0d49ff57197d2e4c1e019183d6681bda63b0500599373318be6` |
| `tickets/T-02.md` | [#555](https://github.com/anzchy/mdpro/issues/555) | `b5d87cdf33045ec753ae53e177a502a2b0380dfd5b81b3799e3082b2beb2ba68` |

## Approval words (user, 2026-10-30)
- Route: 「New Windows default (gated)」.
- Grill: 「全部同意」 (Q1–Q6, `~/.mdpro-redesign/planner/D50/grill.md`).
- Seams: 「对的」.
- Ticket breakdown: 「1.yes 2.yes 3. no」 (two tickets right; blocking edges right; no merge or split).

## Blocking edges
- T-01 (#554): none.
- T-02 (#555): T-01, as a native GitHub dependency; D336–D338, the Windows driver fix (sequencing rows), named in the body.

## Related
- ADR-0158 (Proposed): the per-platform default and the options considered.
- Terms: `GLOSSARY.md` § Keyboard shortcuts.
- Evidence for the cause: `~/.mdpro-redesign/device/D50-probe-report.md` (P1 lastError 1409).

The issue bodies differ from these files only by trailing newlines, which GitHub normalises (checked with `diff` on 2026-10-30).
