# I556 r3: changes from r2

The base is r2, committed at `af0f630a` (`docs/specs/i556/r2/`, ADR-0159 Proposed). The inputs are the r2 round-1 plan
review (gpt-auditor C0 H2 M2, opus-auditor C0 H2 M7 L7) and the merged verdict
`~/.mdpro-redesign/herdr-spike/delegator/I556-spec-r2-plan-verdict.md`. The user's ruling: 「好，按方案一起草 r3」
(Y1 option 1).

## Finding → edit

| Finding | Merged as | Edit in r3 | Where |
|---|---|---|---|
| gpt H1 | Y1 | The command, not the `Policy route:` marker, decides. `routine` is refused for any gate-sensitive path (a mechanical glob list plus every executable and data file under a Policy prefix), for code, and when either report's tier is above Low. | spec § Policy route, § Gate-sensitive subset, story 8; T-01 (path module, executable-subset fixture); T-02 (one AC per glob, tier refusal); T-05 (refusal names `audited`); ADR options 9a/9b/9c, decision 6 |
| opus H1 | Y1 | Same edit as gpt H1. | same |
| gpt H2 | Y2 | On a High-tier landing, both auditors' clear SECURITY lines are required (user 「两个都强制」); the request templates ask opus-auditor for the section too. The `security` check token is added. Seam-1 cases cover a missing, blocking or stale line. | spec § Security, story 16; T-02 (check); T-04 (`security` exception); ADR options 11a/11b/11c, decision 2 |
| opus H2 | Y3 | `--exception` takes only `this landing only (PR #n, sha40)` rows and post-cap rows. An `any`/`until` row counts only when the verifier carries it on a `CARRIED` line while it is open. A carried `ci-gate` row is refused. | spec § Exceptions, stories 9, 23; T-01 (`CARRIED` parse, refused until T-04); T-04 (acceptance rules); ADR options 10a/10b, decision 4 |
| gpt M1 | Post-cap | Four post-cap forms. raiser-confirm needs (a) the non-raiser's clear report at the pre-ruling head, (b) descent from that head and (c) the raiser's confirm covering it; then no-round, land-open and single-auditor. ADR-0129 decision 8's row grammar is extended. | spec § Post-cap, story 18; T-04; ADR § Extends, option 5b |
| opus M6 | Post-cap | Same as gpt M1. T-04 also owns the audit-log § Gate exceptions header edit and the `merged-verdict-template.md` ruling-row edit. | T-04 § Docs |
| gpt M2 | Pointers | The snapshot and ADR pointers now name the committed paths (`docs/specs/i556/r<N>/`, `docs/adr/0159-…`, Proposed). | spec § ADR pointer, § Further notes; ADR Status line |
| opus L7 | Pointers | Same as gpt M2. | same |
| opus M1 | Side door | The hook refuses `gh pr merge` and `gh api … pulls/<n>/merge` on the delegator branch. | spec § Hook, story 25; T-06; ADR decision 8 |
| opus M2 | Side door | `--target release/<x.y>`: the PR base must be that branch, and only that branch moves. The hook refuses raw merges and pushes on `release/*`. ADR-0083 is kept. | spec § Invocation; T-01; T-06; ADR options 12a/12b, § Kept |
| opus M3 | Reports | The report shape pinned in `audit-dimensions.md` is parsed: VERDICT with `range` or `fix range` and a sha7+ prefix, the first COUNT outside `## Security review`, and the live SECURITY spellings. The request templates pin `<item>-r<n>.md`. A non-conforming report is re-asked in the same round. Story 25 is corrected (now story 29). | spec § Auditor reports, story 29; T-02 |
| opus M4 | Discovery | `--item` is optional at every ticket. Records are found by SHA scan. A rebased or post-cap landing without `--item` is refused, naming `--item`. | spec § `--item`, story 28; T-01; T-02; T-04; T-06 |
| opus M5 | Device | A DEVICE entry `<AC>=waived:<id>` is accepted through a `device:<AC>` exception row. | spec § Verifier; T-01 (template); T-03 (parse); T-04 (accept) |
| opus M7 | Exceptions | The audit log is read from the fetched `origin/master`, never the working tree. | spec § Exceptions; T-04 (working-tree-only row refused) |
| opus L1 | Replay | #551's refused set is exactly verifier, auditor:opus (`ADR0149-entry-r2.md` at `d5ea3b49`) and device. | spec § #551 replay, story 36; T-06; ADR decision 9 |
| opus L2 | Root | The records root is the password-database home. Outside test mode, a differing `HOME` is refused. | spec § Records root; T-01 |
| opus L3 | Verifier | On Claude, the verifier agent writes its own record file. The known limit now applies to Codex only. | spec § Verifier, story 30; T-01; ADR decision 5, § Known limits |
| opus L4 | Hook | In the main worktree an unset `MDPRO_ROLE` counts as `delegator`. Rule 70's sentence is rewritten (text given in T-06). | spec § Hook; T-06; ADR option 7b, decision 8, § Costs |
| opus L5 | Identity | `IDENTITY releaseId <version>[-dev]@<sha40>`: a release-type verify build has no `-dev` suffix (G543-2). | spec story 31; T-03 |
| opus L6 | Docs | The docs list adds `landing-docs-checklist.md` (which still says to raw-merge on Claude) and the audit and confirm request templates. | spec § Docs list; T-06 |

## Changes to r2 decisions (flag for the user)

These revise rulings or r2 text that the user approved. The user confirmed all seven on 2026-10-30: 「同意收紧 (Recommended)」 (1), 「同意 (Recommended)」 (3), 「两个都强制」 (4, which chose the stricter reading), and 「release/x.y 纳入范围, 带开放问题落地, 扩大门禁文件列表, routine 路由收窄」 (2, 5, 6, 7):

1. **Exceptions are stricter than r2's Q5 extension.** In r2, `--exception` accepted an open `until` row for any PR.
   In r3 it does not. Standing rows count only when the verifier carries them, and `ci-gate` can never be standing. The
   four open standing rows (G-D325-1, G-D327-1, G-D340-1, G518-1) need new-grammar rows before they can be carried.
2. **The routine route is narrower.** The route the user approved with 「ci-gate + audit only」 still exists, but the
   command refuses it for the gate-sensitive subset and for any tier above Low. That is the user's r3 ruling; it is
   listed here only because it narrows an approved route.
3. **The unset role in the main checkout counts as `delegator`.** The user's own sessions there lose raw merge, raw push
   to `master` and `release/*`, and `gh pr merge`.
4. **Security strictness.** Resolved by the user, 2026-10-30: 「两个都强制」. Both auditors' SECURITY lines are required.
5. **The `release/x.y` route is in scope** (full route), rather than deferred.
6. **The `post-cap land-open` form** (blocking C+H ≤ the number of listed D rows) is derived from ADR-0143 decision 3
   and ADR-0129. No user ruling names it directly.
7. **The gate-sensitive subset goes beyond the minimum.** It includes `.claude/agents/**`, `.codex/agents/**`,
   `.claude/scripts/**` and the delegator templates.

## Blocking edges

Unchanged from r2:
- T-01 → T-02, T-03, T-05;
- T-01 + T-02 + T-03 → T-04;
- all of T-01 … T-05 → T-06;
- T-06 keeps the precondition #556 item 1.

New work was placed inside existing tickets:
- `CARRIED` and `waived:` parsing goes in T-01 and T-03, and acceptance in T-04;
- the security check goes in T-02, and its token in T-04;
- the release target goes in T-01, and its hook in T-06;
- the audit-log header and ruling-template edits go in T-04;
- the request-template file name goes in T-02.
