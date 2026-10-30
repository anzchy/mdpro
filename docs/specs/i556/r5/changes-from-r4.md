# I556 r5: changes from r4

r5 answers the post-cap raiser confirms of r4. opus-auditor marked every finding CLOSED
(`~/.mdpro-redesign/herdr-spike/opus-auditor/I556-spec-r4-confirm.md`). gpt-auditor kept **H3 OPEN**
(`~/.mdpro-redesign/herdr-spike/gpt-auditor/I556-spec-r4-confirm.md`, COUNT C0 H1 M0 L0 · BLOCKING C0 H1): the r4
land-open check read only the item, the finding, the owner and the fix-by from the D row. It did not check the rest of
ADR-0129 decision 4's full record: the compensating control (or "none" with the reason), the `CHANGELOG.md` Known issues
line for product code, and the user's words in the row, the audit log and the PR.

Under ADR-0129 (one return to the user, no second fix), the user ruled on 2026-10-30:
「Narrow: refuse every land-open (Recommended)」. The landing command refuses every `post-cap land-open` row, failing
closed. Landing a Critical or High open always goes to the user by hand under ADR-0129, outside the command. Every other
form is unchanged: raiser-confirm, no-round, single-auditor, carried rows, `this landing only` rows and the rest.

Only H3 changes. Everything else is r4 as committed at `81bc8384`. T-01, T-02, T-03, T-05 and T-06 are byte-identical
to r4. Line ranges are r4 → r5.

| File | r4 lines → r5 lines | Edit | Reason |
|---|---|---|---|
| `spec.md` | after 38 → 39–42 | Solution: a new paragraph says the command refuses every `post-cap land-open` row and that landing a finding open is the user's by-hand ADR-0129 path | H3; ruling |
| `spec.md` | 92–95 → 96–101 | User story 18: the accepted rulings are raiser-confirm, no-round and single-auditor; a finding landed open is always refused and goes to the user | H3; ruling |
| `spec.md` | 231 → 237–238 | Post-cap forms: the command accepts three of the four and always refuses `land-open` | H3; ruling |
| `spec.md` | 248–258 → 255–262 | The land-open form: its pass rules (the pair mapping, the `<a id="d<n>">` existence check, and the item, finding, owner and fix-by fields) and its security line are replaced by an unconditional fail-closed refusal that reads no D row and names the manual path | H3: the partial D-row check passed an incomplete ADR-0129 record; ruling |
| `spec.md` | 326 → 330 | `--exception` accepts only the post-cap forms the command accepts; a land-open row is refused | H3; ruling |
| `spec.md` | 405 → 409–410 | Unchanged ADRs: ADR-0129's land-open stays its manual path, outside the command | H3; ruling |
| `spec.md` | 442 → 447–448 | Seam-1 pass case: "each of the four post-cap forms" becomes the three accepted forms | H3: no land-open pass case remains |
| `spec.md` | 462 → 468 | Security case: "each post-cap form" becomes "each accepted post-cap form" | H3: land-open has no security line to read |
| `spec.md` | 467–471 → 473–481 | The four land-open refusal cases (unnamed finding, nonexistent, unrelated, incomplete D row) become a "Land-open, always refused" group: a well-formed row with a complete D row and every other gate present, the same by `--exception`, the same at High tier with a clear security line, and the kept malformed cases (unnamed finding, nonexistent D row). Each names the row and the manual path; the target branch does not move | H3; ruling. The unrelated and incomplete D-row cases are dropped, since no D row is read |
| `spec.md` | after 545 → 556–557 | Out of Scope: landing a finding open after the cap; the command checks none of that record | ruling |
| `spec.md` | 574 → 586–591 | Further Notes: an r5 bullet; rule 12 now needs the plan review of r4→r5 and the user's re-approval of r5 | rule 12, ADR-0148 |
| `tickets/T-04.md` | after 4 → 5–8 | An `r5: changed` banner quoting the ruling | H3; ruling |
| `tickets/T-04.md` | 34–36 → 38–40 | `--exception` accepts a post-cap row other than `land-open` (rewrapped) | H3; ruling |
| `tickets/T-04.md` | 47 → 51 | Post-cap rows: three accepted, `land-open` always refused | H3; ruling |
| `tickets/T-04.md` | 59–66 → 63–67 | The land-open form's pass rules, D-row checks and security line are replaced by the fail-closed refusal | H3; ruling |
| `tickets/T-04.md` | 75 → 76–77 | The audit-log § Gate exceptions header also states that a land-open row is refused and taken by the user by hand | ruling |
| `tickets/T-04.md` | 106–112 → 108–114 | AC: the land-open pass case and the unrelated and incomplete D-row cases are replaced by "every land-open row is refused" (complete record, `--exception`, High tier, malformed) | H3; ruling |
| `tickets/T-04.md` | 114 → 116 | Security AC: land-open is dropped from the per-form security refusals | H3: land-open never reaches a security check |
| ADR-0159 | 3–4 → 3–4 | Status: revised for r5, snapshot `docs/specs/i556/r5/` | rule 12 |
| ADR-0159 | 21 → 21–31 | The r5 ruling joins the user words; an r5 revision note | ruling |
| ADR-0159 | 63 → 73–74 | Extends: the post-cap forms, with land-open always refused | H3; ruling |
| ADR-0159 | 71 → 82–83 | Kept: ADR-0129's land-open stays its manual path | H3; ruling |
| ADR-0159 | after 171 → 184–193 | Options 13a (r4's partial check, lost on H3), 13b (a full mechanical check, lost: a second fix after the cap, and judgment fields), 13c (refuse every land-open, chosen) | ruling; CLAUDE.md ADR rules ask for the losing options |
| ADR-0159 | 194–195 → 216–218 | Decision 4: land-open leaves the accepted `--exception` forms and is always refused | H3; ruling |
| ADR-0159 | after 256 → 280–286 | Costs: no mechanical land-open; the user lands it by hand from their own shell, with no check of the record or of the other gates | ruling; the cost is recorded |
| ADR-0159 | 267–268 → 297 | Costs: a post-cap row is one of the three accepted forms; the D-row prerequisite is dropped | H3; ruling |

Edges are unchanged from r4: #558 none; #559, #560 and #562 blocked by #558; #561 blocked by #558, #559 and #560;
#563 blocked by #558–#562.
