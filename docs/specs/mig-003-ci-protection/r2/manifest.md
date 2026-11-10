# MIG-003 minimal CI protection spec snapshot r2 (2026-11-10)

A frozen copy of the issue bodies as edited for r2 (rule 12, ADR-0148). r2 closes the round-1 plan review of r1 (`docs/specs/mig-003-ci-protection/r1/`, committed at `8f19748a`, unchanged; merged verdict C0 H2 M8 L4, BLOCKING H2). The map from each merged finding to the text that closes it is the planner's `r2/findings-map.md`. r2 adds a fifth ticket, MIG-003c0 (#759), and the edge #755 ← #759; the other edges stand. Citations checked at master `93c7e9bb`. Parent row: #700. Blocking edges are GitHub native dependencies and are repeated in each ticket's `## Blocked by`.

| File | Issue | Title | File SHA-256 |
|---|---|---|---|
| `spec.md` | [#752](https://github.com/anzchy/mdpro/issues/752) | MIG-003 spec: minimal CI protection — risk classes, advisory lanes, fault injection, metrics (r2) | `a147887abe1ccc4159bb985cd283debdba5829c6d739cd13726c7c4c77b27f2b` |
| `tickets/MIG-003a.md` | [#753](https://github.com/anzchy/mdpro/issues/753) | MIG-003a: Risk classes from scope and the three gate fault classes | `7423eace5208b1b5acb7de8e237f5594129a23eeefb8c8fdb5e6269005b53c1c` |
| `tickets/MIG-003b.md` | [#754](https://github.com/anzchy/mdpro/issues/754) | MIG-003b: Native advisory workflow (macOS and Windows) | `dae619f42f5537c2888aa4d8aa4070d2d3daac10e9697c106376b8ac69b803ae` |
| `tickets/MIG-003c0.md` | [#759](https://github.com/anzchy/mdpro/issues/759) | MIG-003c0: Browser-safe corpus seam | `0a7ac31da530b29df67b984fd307212f2508dfa92fc4c4e431ad6a7b0869c58d` |
| `tickets/MIG-003c.md` | [#755](https://github.com/anzchy/mdpro/issues/755) | MIG-003c: WebKit advisory workflow (Vitest browser mode) | `53dd7d39464c2dbb91ee6b31352b0eb8e3a44640c01a05588b0f70d470d7bc3c` |
| `tickets/MIG-003d.md` | [#756](https://github.com/anzchy/mdpro/issues/756) | MIG-003d: CI metrics script | `b576c4f63ad46850e7bad0fd6b4d9c085c10e8d47411ea9e0a98833f4e0b8ffd` |

Edges: #754 ← #753; #755 ← #753 and #759; #759 and #756 have none. #755's grant also needs the dependency ADR accepted; #759 is sequenced by the delegator against open MIG-001 tickets (shared area).

## Approval words (extended in r2)

| Decision | The user's words, quoted | Where |
|---|---|---|
| #685 decisions 1–8 (the seed) | all eight "(Recommended)" | #685 |
| MIG003-r1-D1…D10 (grill round 1) | 「all recommended」 | planner pane, 2026-11-10 |
| MIG003-r1-D11…D18 (grill round 2) | 「all yes」 | planner pane |
| MIG003-r1-D19…D23 (grill round 3) | 「All five (Recommended)」 | planner pane |
| Seams | 「Yes, these seams (Recommended)」 | planner pane |
| MIG003-r1-D24 (handoff rule as a separate GS draft) | 「GS draft, tickets independent (Recommended)」 | planner pane |
| r1 tickets a–d | 「Approve 4 tickets (Recommended)」 | planner pane |
| Codex consult on the r2 questions | 「for the above questions, let codex weigh in」 | planner pane, 2026-11-10 |
| MIG003-r2-D25 (bootstrap; red → issue) | 「Issue, lane on, owner+date (Recommended)」 | planner pane |
| MIG003-r2-D26 (exact-mismatch list) | 「Exact-mismatch list (Recommended)」 | planner pane |
| MIG003-r2-D27 (time budgets) | 「Provisional + definitions (Recommended)」 | planner pane |
| MIG003-r2-D28 (ticket c0) | 「New ticket c0, c blocked by it (Recommended)」 | planner pane |
| r2 as a whole | 「Approve r2 (Recommended)」 | planner pane, 2026-11-10 |
