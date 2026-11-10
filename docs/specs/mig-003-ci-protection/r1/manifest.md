# MIG-003 minimal CI protection spec snapshot r1 (2026-11-10)

A frozen copy of the issue bodies as published for r1 (rule 12, ADR-0148), written at master `ddc60447`. Parent row: #700. Blocking edges are GitHub native dependencies and are repeated in each ticket's `## Blocked by`.

| File | Issue | Title | File SHA-256 |
|---|---|---|---|
| `spec.md` | [#752](https://github.com/anzchy/mdpro/issues/752) | MIG-003 spec: minimal CI protection — risk classes, advisory lanes, fault injection, metrics (r1) | `b0ffad1f8c4b5cbb73fe887246529d273126bf6b2231dae3f2f23a4733d3913e` |
| `tickets/MIG-003a.md` | [#753](https://github.com/anzchy/mdpro/issues/753) | MIG-003a: Risk classes from scope and the three gate fault classes | `ab5313625ad2a332c3497356eba820c1b1180cad7d139df58e2e87eabdee1915` |
| `tickets/MIG-003b.md` | [#754](https://github.com/anzchy/mdpro/issues/754) | MIG-003b: Native advisory workflow (macOS and Windows) | `bf6f6f2ad9f1f95ef2ad48d7db99405b46c0076b54ce5bc51d8d4938834de5f4` |
| `tickets/MIG-003c.md` | [#755](https://github.com/anzchy/mdpro/issues/755) | MIG-003c: WebKit advisory workflow (Vitest browser mode) | `ad02d47975429582b69bdbaba9c6de3e2077f1a24c45a2c1bfa641d9838bb063` |
| `tickets/MIG-003d.md` | [#756](https://github.com/anzchy/mdpro/issues/756) | MIG-003d: CI metrics script | `e0e5463163816329a968cb9d3bdcd774ae21f2463bf685739dec8091e11065ba` |

Edges: #754 and #755 are blocked by #753; #756 has none. #755's grant also needs the dependency ADR accepted.

## Approval words

| Decision | The user's words, quoted | Where |
|---|---|---|
| #685 decisions 1–8 (the seed) | all eight "(Recommended)" | #685 |
| MIG003-r1-D1…D10 (grill round 1) | 「all recommended」 | planner pane, 2026-11-10 |
| MIG003-r1-D11…D18 (grill round 2) | 「all yes」 | planner pane |
| MIG003-r1-D19…D23 (grill round 3) | 「All five (Recommended)」 | planner pane |
| Seams | 「Yes, these seams (Recommended)」 | planner pane |
| MIG003-r1-D24 (handoff rule as a separate GS draft) | 「GS draft, tickets independent (Recommended)」 | planner pane |
| Tickets a–d | 「Approve 4 tickets (Recommended)」 | planner pane |
