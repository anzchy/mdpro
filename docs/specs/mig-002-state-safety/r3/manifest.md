# MIG-002 state-safety spec snapshot r3 (2026-11-10)

A frozen copy of the issue bodies as edited for r3 (rule 12, ADR-0148). r3 closes the round-2 plan confirm of r2 (`docs/specs/mig-002-state-safety/r2/`, committed at 8b13ccff, unchanged; merged verdict C0 H4 M5 L4) in the one extra round the user approved under ADR-0143 decision 3. r1 (6f7592a8) is also unchanged. The map from each round-2 finding to the text that closes it is the planner's `r3/findings-map.md`. r3 adds clause e-C7 (split from e-C4), changes no ticket and no edge, and changes no product behaviour or ADR.

| File | Issue | Title | File SHA-256 |
|---|---|---|---|
| `spec.md` | [#733](https://github.com/anzchy/mdpro/issues/733) | MIG-002 spec: state-safety contract and App journey harness (r3) | `bbb0d855c829ad81292ac79eab421e6cc9c48e64d0e9fba0cfb0bbd1efac765f` |
| `tickets/MIG-002a1.md` | [#735](https://github.com/anzchy/mdpro/issues/735) | MIG-002a1: App journey harness and save tracer bullet | `bae3ccbede57050fd3411a58a95cb13f75bbd2a1f8678cf46069c4a2bcbfde6b` |
| `tickets/MIG-002a2.md` | [#736](https://github.com/anzchy/mdpro/issues/736) | MIG-002a2: Save / Save As contract | `0e88d4c08e3d56e9e8814596e1cf3170bab4ca2f5b75c87621f3e84472bf62f3` |
| `tickets/MIG-002b.md` | [#737](https://github.com/anzchy/mdpro/issues/737) | MIG-002b: Tab/mode switch contract | `2ed60ae6a3a4b5a47a5a4cb03d9a52d051058a67280e7ca09e25153393f388cc` |
| `tickets/MIG-002c.md` | [#738](https://github.com/anzchy/mdpro/issues/738) | MIG-002c: Tab/window close and quit contract | `5917aea08e655c912776531cbcc819963a4cda601616ebed20953e6fe9f57e66` |
| `tickets/MIG-002d.md` | [#739](https://github.com/anzchy/mdpro/issues/739) | MIG-002d: Draft timer and recovery contract | `eec78eff069e9bc669a862595f09d53dd75d0cfeba8412749cc9c41dd6c96ec3` |
| `tickets/MIG-002e.md` | [#740](https://github.com/anzchy/mdpro/issues/740) | MIG-002e: External wholesale replace contract | `c7e8f99bbcf305f904534081c10feb4d2fa0497908324725aa06c25aa1641e70` |
| `tickets/MIG-002f.md` | [#741](https://github.com/anzchy/mdpro/issues/741) | MIG-002f: MCP write/insert contract | `c3fb77120996026100cd8e88792cc559bc7ccd07f967b9e4d334d9e0fe55b169` |
| `tickets/MIG-002g.md` | [#742](https://github.com/anzchy/mdpro/issues/742) | MIG-002g: MCP table contract | `d69961fa14d14e8f1ace307cc380087e4e15f80dcd5b38f1199d4a5fff1c7a03` |
| `tickets/MIG-002h.md` | [#743](https://github.com/anzchy/mdpro/issues/743) | MIG-002h: MCP mirror contract | `9b5b3486cdd30bd774b9b0a6d915e56f75529ef9f333b489f27edef3a8c30d31` |

Blocking edges are GitHub native dependencies and are repeated in each ticket's `## Blocked by`. Parent row: #702.

## Approval words (MM9; extended in r3)

| Decision | The user's words, quoted | Where |
|---|---|---|
| #686 decisions 1–8 (the seed) | all eight "(Recommended)", then "Yes, record it (Recommended)" | #686 |
| MIG002-r1-D1…D24 (grill) | 「all yes」, once per round, three rounds | planner pane, 2026-11-09 |
| Seams | 「yes」 | planner pane |
| MIG002-r1-D25 (nine tickets, a split into a1/a2) | 「u recommend the best practices」; confirmed to the delegator: 「确认 9 张票 (Recommended)」 | planner pane; delegator |
| MIG002-r2-D26 (budget) | 「5 s / 15 s / 5 + 5 min (Recommended)」 | planner pane |
| MIG002-r2-D27 (ADR-0144 departure named) | 「Keep #686, name departure (Recommended)」 | planner pane |
| MIG002-r2-D28 (Owner = today's state owner) | 「Today's state owner (Recommended)」 | planner pane |
| r2 as a whole | 「Approve r2 (Recommended)」 | planner pane |
| r3 extra round (after the round-2 cap) | 「Approved extra round r3 (Recommended)」 | delegator, 2026-11-10 |
| r3 as a whole | 「Approve r3 (Recommended)」 | planner pane, 2026-11-10 |
