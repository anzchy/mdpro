# MIG-003 minimal CI protection spec snapshot r3 (2026-11-10)

A frozen copy of the issue bodies as edited for r3 (rule 12, ADR-0148). r3 closes the round-2 plan review's remaining High (H1, CONFIRMED on challenge) and Mediums O-M1, O-M2, O-M3 and O-M6 plus opus Lows 2, 3 and 7, in the spec and tickets b and c only, under the user's ADR-0129 ruling 「r3 文字修复，a/c0/d 先放行 (Recommended)」. Tickets a, c0 and d are **unchanged from r2** (`docs/specs/mig-003-ci-protection/r2/`, committed at `a0749f09`); r1 (`8f19748a`) and r2 are untouched. The map from each finding to the closing text is the planner's `r3/findings-map.md`. The graph is unchanged. Citations checked at master `4dac35fb`. Parent row: #700.

| File | Issue | Title | File SHA-256 |
|---|---|---|---|
| `spec.md` | [#752](https://github.com/anzchy/mdpro/issues/752) | MIG-003 spec: minimal CI protection — risk classes, advisory lanes, fault injection, metrics (r3) | `07e4cc19342457ad16c386c422a9c01a2c71260ede0e2f6411df8b0a55443d5f` |
| r2 `tickets/MIG-003a.md` (unchanged from r2) | [#753](https://github.com/anzchy/mdpro/issues/753) | MIG-003a: Risk classes from scope and the three gate fault classes | `7423eace5208b1b5acb7de8e237f5594129a23eeefb8c8fdb5e6269005b53c1c` |
| `tickets/MIG-003b.md` | [#754](https://github.com/anzchy/mdpro/issues/754) | MIG-003b: Native advisory workflow (macOS and Windows) | `ea326a8e0eaddbf3f4d2975b4963a41dd760fe6d0553ae0c7f682600d33d65c0` |
| r2 `tickets/MIG-003c0.md` (unchanged from r2) | [#759](https://github.com/anzchy/mdpro/issues/759) | MIG-003c0: Browser-safe corpus seam | `0a7ac31da530b29df67b984fd307212f2508dfa92fc4c4e431ad6a7b0869c58d` |
| `tickets/MIG-003c.md` | [#755](https://github.com/anzchy/mdpro/issues/755) | MIG-003c: WebKit advisory workflow (Vitest browser mode) | `ac9c8aafd035655dc0766bda4fbf836e7693ba64cecf56bf05aac20c1d0496bf` |
| r2 `tickets/MIG-003d.md` (unchanged from r2) | [#756](https://github.com/anzchy/mdpro/issues/756) | MIG-003d: CI metrics script | `b576c4f63ad46850e7bad0fd6b4d9c085c10e8d47411ea9e0a98833f4e0b8ffd` |

Edges (unchanged): #754 ← #753; #755 ← #753 and #759; #759 and #756 have none. #755's grant also needs the dependency ADR accepted, and (r3, D30) waits while an open MIG-001 ticket that edits `scripts/corpus/core.ts` is in flight.

## Approval words (extended in r3)

All r2 rows stand (`r2/manifest.md` § Approval words). Added:

| Decision | The user's words, quoted | Where |
|---|---|---|
| ADR-0129 ruling after the round-2 cap | 「r3 文字修复，a/c0/d 先放行 (Recommended)」 | delegator, 2026-11-10 (`r2-merged.md`) |
| MIG003-r3-D29 (warm-cache marker step) | 「Named step on hit (Recommended)」 | planner pane, 2026-11-10 |
| MIG003-r3-D30 (shared shard check in c; core.ts edit) | 「Share it, in c (Recommended)」 | planner pane |
| MIG003-r3-D31 (accepted-mismatch file and format) | 「JSON in tests/webkit (Recommended)」 | planner pane |
| r3 as a whole | 「Approve r3 (Recommended)」 | planner pane, 2026-11-10 |
