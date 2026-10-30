# I556 r2: changes from r1

The sources are the findings in `../review-r1-merged.md` (X1–X13 and the carried Mediums) and the review reports
(O = Opus, F = Fable). "Spec" means `r2/spec.md`, "T-nn" means `r2/tickets/T-nn.md`, and "ADR" means
`r2/adr-draft-landing-gate.md`.

| Id | Finding | r2 answer |
|---|---|---|
| X1 | The #551 replay outcome is false | Spec, story 32 and Acceptance replay: #551 is refused, decisively on the missing verifier record. T-01 adds replay mode (explicit parent, merged PR accepted, nothing written). T-06 lists the outcomes. |
| X2 | ADR-0129 d6 and ADR-0143 d3/d4 leave one auditor on an older head | Spec, "Post-cap rulings": a post-cap row, per the user's ruling. T-04 defines the row and its waived-auditor AC. The ADR keeps ADR-0129 and ADR-0143 (5b, with 5a rejected). |
| X3 | Policy and Knowledge have no path list | Spec, "Policy and Knowledge paths come from one module", with `docs/agents/**` as Policy per the ruling. T-01 builds the module and the classify-once fixture. T-05 consumes it. |
| X4 | `tree-identity.sh` is not a proof | Spec, "An accepted rebase is proved by range-diff". T-02 AC 5. ADR option 8. |
| X5 | Exception rows can't be parsed; `until` rows | Spec, "The only override", which pins the grammar for new rows and makes `--exception` repeatable. T-04's ACs. Old rows match nothing. |
| X6 | No verification template; varied names and spellings; SECURITY COUNT | Spec, "Record grammar and discovery are fixed". T-01 adds the template and verifier discovery. T-02 accepts both spellings and reads the BLOCKING line. `audit-dimensions.md` is untouched (F-M3). |
| X7 | The Claude route can't run land-guard; MDPRO_ROLE is unset; ADR-0141 d4 | Spec, "Hook backstop and the Claude route", per the ruling. T-06 adds the overlay install, the pane relaunch and the hook AC. The ADR supersedes ADR-0141 d4. |
| X8 | Routine Policy PRs have no landing mode; ADR-0121 tier | Spec, "Policy file route", per the ruling: a `Policy route:` marker and a Low gpt mini audit. T-02 has the acceptance AC. Revised at approval: both auditors at Low tier (「No, both auditors」), no verifier record (「ci-gate + audit only (Recommended)」). The ADR supersedes ADR-0121's tier and rule 70 item 2's verifier condition for these PRs only; ADR-0143 is untouched. |
| X9 | The path check fails on Ubuntu CI | Spec, "Policy tests": a denylist of known-wrong prefixes. T-05 AC 4. |
| X10 | Device identity vs ADR-0144 d5 | Spec, Device evidence and the IDENTITY line. T-03 computes the d5 identity diff and amends the device-brief template. |
| X11 | No ADR-0159 draft | `r2/adr-draft-landing-gate.md`. T-06 flips it to Accepted on the user's word. |
| X12 | The records-folder setting is a bypass | Spec, the records root: fixed, overridable only under `MDPRO_GUARD_TEST=1` within the tmpdir. T-01 AC 5. |
| X13 | Edges; `--item` breaks the Codex route | T-04 is now blocked by #558, #559 and #560. T-05 is blocked by #558. `--item` is optional until T-06 updates the Codex Skill call (T-01 AC 9). |
| M (O-M4, F-M7) | Raw landing described in other docs | Spec, "Landing docs that move". T-06's Docs list, plus the landing-stash AC. |
| M (O-M5, F-M10) | #549's refusal reason | Spec, Acceptance replay, and T-06: verifier at `860db824`, auditors at `66cc944c`, gpt blocking H1. |
| M (O-M7) | #556 item 1 as a precondition | Spec, "Precondition", and T-06's Blocked by. |
| M (O-M8, F-M8) | The Codex delegator rule lives in `install-role.mjs` | Spec, the Codex bullet. T-06 has the installer AC and the named execpolicy skip. |
| M (F-M4) | Device-report grammar and template | T-03 amends the device-brief template. |
| M (F-M11) | No AC for the waived auditor | T-04's waived-auditor and waived-device ACs. |
| M (F-M12) | Codex route between T-01 and T-06 | T-01 AC 9 (`--item` optional). T-06 makes it required. |
| M | PROSE_ROOT_FILES owner | T-05 owns moving `AGENTS.md` and `CLAUDE.md` off the prose list. The `#556 item 3` overlap is noted for the delegator to settle in #556. |
| O-L1 | PR number for the exception match | T-01 (PR query) and T-04. |
| O-L2 | Duplicate glossary AC | Removed from T-05. The glossary is committed with the snapshot under rule 12. |
| O-L3 | 300-line limit | T-01's module split. |
| O-L4 | Quote forms | Spec and T-04: 「…」 or “…”. |
| O-L5 | Codex verifier is self-attested | ADR, Known limits. |
| O-L6 | Push spellings | Spec and T-06 list them. |
| F-L1 | gh unreachable plus an exception waives CI | ADR, Consequences. |
| F-L2 | "24 commits" | Spec now says "about two dozen". |
| F-L3 | Glossary section | Spec, `## Landing`. |

## Grill decisions changed

- **Q6** is revised by 「Low-tier gpt audit (Recommended)」, then at approval by 「No, both auditors」 and 「ci-gate + audit
  only (Recommended)」. Routine Policy PRs now get a Low mini audit by both auditors and no verifier record.
- **Q9:** the "proven by the existing tree-identity check" clause is replaced by range-diff (X4). This is a finding, not
  a ruling, so the user should note it at re-approval.
- **Q5** gains repeatability and the `until`/`any` match (X5). "Names this item's PR" now includes open `until` rows
  for any PR, which is also flagged for re-approval.
- **Q11:** the #551 expectation changes from "passes only with G551-1" to "refused, no verifier record", per the
  ruling.

## Open for the user at re-approval

- Resolved at approval: routine Policy PRs need no verifier record (「ci-gate + audit only (Recommended)」), and keep
  both auditors (「No, both auditors」).
- `glossary-edits.md`'s Policy file definition should name `docs/agents/**` as an example. The r2 spec's path list
  governs.
