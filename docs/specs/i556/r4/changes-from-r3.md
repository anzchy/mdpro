# I556 r4: changes from r3

r4 answers the r3 round-2 plan review (gpt-auditor C0 H3 M1 L0; opus-auditor C0 H1 M3 L3), merged by herdr-delegator
as Z1–Z8 in `~/.mdpro-redesign/herdr-spike/delegator/I556-spec-r3-plan-verdict.md`. The two-round cap (ADR-0143) was
reached, and the user ruled under ADR-0129 (2026-10-30):
- 「修成 r4 + 限定复核 (Recommended)」: fix Z1–Z8 as r4, then each raiser confirms on the r3→r4 diff only;
- on Z2, 「算，强制 High (Recommended)」: the gate-bearing prose joins the gate-sensitive subset.

Only Z1–Z8 change. Everything else is r3 as committed at `a39a04ad`.

| Z | Finding | Raised by | r4 edit | Where |
|---|---|---|---|---|
| Z1 | The `audited` route did not require tier High for gate-sensitive paths, so a Low-tier audited PR passed | gpt H1 (2nd instance), opus H1 | A gate-sensitive changed path requires `tier High` in both qualifying reports, whatever the route marker; otherwise refused, naming the auditor and tier. Seam-1 case: an audited or unmarked PR on a gate-sensitive path (incl. rule 70) with Low/Medium reports is refused. ADR "Kept: ADR-0121" and decision 6 corrected | spec Solution, § route ("Gate-sensitive means High"), seam-1 tests; T-02 text and AC; ADR Kept, decision 6 |
| Z2 | Rules 60/70/71, `CLAUDE.md`, `AGENTS.md`, the delegator `SKILL.md` and guide sat outside the gate-sensitive subset | gpt H1 (1st instance); user ruling | Added: `.agents/skills/mdpro-delegator/SKILL.md`, `.agents/skills/mdpro-delegator/references/**` (replacing the `references/templates/**` entry), `.claude/rules/60-…`, `70-…`, `71-…`, `CLAUDE.md`, `AGENTS.md`. The cost (a typo fix there needs a High-tier audit) is recorded | spec path module; T-01 path module and AC; T-02 glob AC; ADR decision 6 and costs |
| Z3 | High tier was read from gpt's report only; post-cap and single-auditor forms left a security line unread | gpt H2, opus M1 | High tier when either report says `tier High` or any changed path is gate-sensitive. Each post-cap form states its security line: raiser-confirm, both clear; no-round, present, counts not read; land-open, present, covered by the pairs; single-auditor, the other's clear line plus a `security` this-landing exception. Seam-1 cases per form, and opus High beside gpt Medium | spec § Security and each post-cap form, seam-1 tests; T-02 Security and AC; T-04 forms and AC; ADR decision 2 |
| Z4 | A land-open row matched by count, not bound to real ADR-0129 D rows | gpt H3, opus L3 | Form `post-cap land-open <sha40> D<n>=<finding id>[, …]`. Against `origin/master`: every blocking C/H (security section included) named exactly once; each D exists as `<a id="d<n>">` in the sequencing doc and names the item, the finding, an owner and a fix-by. Unnamed, nonexistent, unrelated and incomplete cases refused | spec land-open form and tests; T-04 form and AC; ADR decision 4 and costs |
| Z5 | The open-row list was wrong: G518-1 and G-D340-1 are closed | gpt M1, opus L2 | Only G-D325-1 and G-D327-1 are re-recorded. A new row never reopens a closed one; a test refuses re-recording G518-1 or G-D340-1 as open | spec exceptions and tests; T-04 text and AC; ADR costs |
| Z6 | A carried standing row with a non-`verifier` token waived a whole check | opus M2 | A carried row's token must be `verifier`; `ci-gate`, `auditor:<name>`, `security` or `device:<AC>` carried is refused, with a test | spec carried rule and tests; T-04 text and AC; ADR decision 4 |
| Z7 | No sanctioned way to cut a new `release/x.y` once raw pushes are refused | opus M3 | `--create-release <tag>`: tag matches `v<x.y>.*` and exists on `origin`; `release/<x.y>` must not exist; only the tag's commit is pushed. The hook allows it (seam 2). Pass and refusal cases | spec invocation, seam-1 and seam-2; T-01 text and AC; T-06 hook text and AC; ADR decision 1 |
| Z8 | The Solution still said gpt-only security | opus L1 | Solution says "both auditors' security sections" | spec Solution |

Edges are unchanged from r3: #558 none; #559, #560 and #562 blocked by #558; #561 blocked by #558, #559 and #560;
#563 blocked by #558–#562. T-03 and T-05 have no normative change.
