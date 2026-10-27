# 0147. Always-on instructions become a routing map, and a Haiku doc gardener checks docs before each PR push

## Status

**Accepted, 2026-10-27, by the user:** 「Accept (Recommended)」, after two review rounds by gpt-auditor and opus-auditor
and the post-cap confirm that closed the last High (gpt-auditor, C0 H0). Proposed earlier the same day; drafted for
herdr-delegator (Claude route). The user ruled on the first draft's open questions
the same day (§ User rulings).

**Revised after plan review round 1**: gpt-auditor C0 H4 M2 L0, opus-auditor C0 H2 M7 L4; reports
`herdr-spike/{gpt-auditor,opus-auditor}/ADR-0147-r1.md`, merged as B1–B4 in
`herdr-spike/delegator/ADR-0147-r1-merged.md`. See § Review round 1 dispositions.

**Revised after round 2**, the last under
[ADR-0143](0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md): gpt-auditor C0 H1,
opus-auditor C0 H0 M3 L3 (`ADR-0147-r2.md`). gpt's H1 (an uncounted required read) was open after the cap. The user
chose 「Fix + scoped confirm (Recommended)」 under ADR-0129's post-cap route: decision 5 carries the fix, and gpt-auditor
confirms on that change only. The user also accepted the per-role caps 「Accept, as failing gates (Recommended)」.
See § Review round 2 dispositions and § User rulings 6–7.

It records items 1 and 6 of the picsee workflow comparison
([`docs/knowledge/20261027-picsee-workflow-comparison.md`](../knowledge/20261027-picsee-workflow-comparison.md)), which
the user adopted with all seven: 「建议1-7 均采用」 (2026-10-27). On the gardener's model the user chose
「Haiku, named exception (Recommended)」 (2026-10-27). Earlier the same day, answering the token-cost assessment
([`docs/knowledge/20261027-repeated-development-and-token-cost.md`](../knowledge/20261027-repeated-development-and-token-cost.md)),
the user adopted "slim always-on rules" (option 3 of four, all adopted).

**On acceptance, partially supersedes, by name** (each accepted body stays as written; forward links go into their
Status lines in the commit that implements the clause):
- **[ADR-0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md) decision 2**, where
  "rule 70 governs every clause rule 71 does not name" places that governing text inside the two rule files. The
  overlay relation stands (rule 71 replaces the rule 70 clauses it names, rule 70 governs the rest), but a clause's
  governing text may now live in the file its rule stub names (decision 3). Option 2's reason for losing (two copies
  drift) is kept: each clause has one canonical home (decision 2).
- **[ADR-0141](0141-codex-command-rules-are-scoped-by-role-and-the-delegator-lands-through-checked-scripts.md)
  decision 2's docs-only path set**, extended by one pattern, `.agents/skills/mdpro-delegator/references/*.md`, the
  moved reference files only; `references/templates/` keeps the PR path (decision 3). ADR-0141's consequence that `.claude/skills/**` and `.codex/skills/**` edits cost a PR stands for every
  other skill path.

**Amends** rule 70 § Sessions: the sentence "**Every subagent the delegator dispatches runs on Opus** (user decision,
2026-10-11)" gains one named exception (decision 7), and the stale sentence "`mdpro-fable-auditor` runs on Fable, the
one exception" is removed. That Fable exception, and ADR-0115 decision 1's phrase "the one named exception to rule 70's
'every subagent runs on Opus'", have had no live use since
[ADR-0137](0137-the-second-auditor-runs-on-opus-as-the-opus-auditor-pane.md) decision 5 put `mdpro-fable-auditor` on
Opus. ADR-0137 already partially supersedes that clause of ADR-0115, so this record does not supersede it again.
Rule 70 § Commits and branches' exception for removing a `verify-<sha7>` worktree the verifier created also covers one
the delegator creates for the gardener (decision 6).

**Relation to [ADR-0146](0146-audits-use-project-dimensions-kept-in-the-repo.md)** (Accepted 2026-10-27, `fd893163`):
ADR-0146 supersedes clauses of rule 70 item 4 and rule 71 by name. Decision 8 says how those clauses move.

## Context

**What every session reads before it starts work** (measured 2026-10-27 on `aee336b6`, re-checked by opus-auditor on
`94b87678`; `wc -c` / `wc -l`). Claude Code loads `CLAUDE.md`, the files it imports with `@path`, and every
`.claude/rules/**/*.md` that has no `paths:` frontmatter on every turn; a rule with `paths:` loads only when a matching
file is touched. Codex loads only `AGENTS.md`, whose § "Read first (Codex)" tells it to read `CLAUDE.md` and rules 10,
22, 25, 50, 60, 70 and 71 in full at the start of every session.

| File | Bytes | Lines | Loaded today |
|---|---:|---:|---|
| `CLAUDE.md` | 27,135 | 474 | Claude always; Codex by AGENTS.md |
| `AGENTS.md` | 13,084 | 163 | Codex always |
| rule 10 `tdd` | 8,109 | 113 | always (no `paths:`) |
| rule 22 `comment-maintenance` | 1,525 | 36 | always; path-scoped by decision 9 |
| rule 25 `careful-mode` | 2,231 | 44 | always |
| rule 50 `codebase-conventions` | 4,008 | 86 | always; path-scoped by decision 9 |
| rule 60 `review-checklist` | 4,379 | 70 | always |
| rule 70 `multi-session-coordination` | 35,203 | 529 | always |
| rule 71 `herdr-mixed-roster` | 29,855 | 373 | always |
| **Claude always-on set** (CLAUDE.md + the seven rules) | **112,445** | **1,725** | every turn |
| **Codex start-of-session set** (AGENTS.md + the same) | **125,529** | **1,888** | every session |
| path-scoped rules 20, 30–34, 40, 41 (not counted) | 30,723 | 667 | on matching paths |

Rules 70 and 71 are 65,058 bytes, 58 % of the Claude set. The token-cost assessment puts the always-on text at 31–36k
tokens, about 80M weighted tokens re-read plus 19.5M in cold starts
([`docs/reference/20261027-token-cost-by-item.md`](../reference/20261027-token-cost-by-item.md)). picsee's equivalent is
about 13 KB: a 6-line `CLAUDE.md` that imports `AGENTS.md`, "a map, not a manual", with roster and workflow detail in
its delegator skill.

**Who needs what.** Most of the bytes serve one role:
- the delegator: landing and audit procedure (rule 70 § Commits and branches, 13.9 KB), the roster with its routing
  history (rule 71 § Roster, 8.1 KB), pane restarts and wake-ups (rule 71 § Codex agents, 7.2 KB), device batches,
  number reservation, the user-question log;
- implementors: briefs, the attacked test matrix, self-acceptance, receipts, fix-session limits;
- auditors: the read barrier, the downgrade counter-proof rule, the pre-existing-High proof, report shape;
- the device tester: the Mac mini and launch-by-path clauses.

Many clauses bind two roles at once: one acts, the delegator checks or decides (the review found six such clauses).
About a third of rules 70 and 71 is history: superseded routing (dtrack, claude-imple-1, mdpro-a3), dated quotes, and
incident narratives (the observer agent, the dim prompt text).

**Rule churn and drift.** Rules 70 and 71 took 34 commits in 11 days (token-cost assessment, cause 7). Text that
contradicts ADR-0143 (both auditors on every audit, two rounds) is in:
- `CLAUDE.md` § Plan Status Tracking, **Branch** ("the required `gpt-auditor` audit (with optional Opus …)");
- rule 70 item 4 ("Every audit runs twice … Fable", "**At most three rounds** … ADR-0120", "two confirms");
- rule 71 § Delegator runtime route, § Roster's opus-auditor row, § Fresh context's "Opus is never required", § Audits
  under herdr. Rule 71's preamble says "ADR-0143 wins" over them;
- the delegator's `SKILL.md` step 7 ("at most three rounds") and `references/guide.md` § 2 (opus-auditor optional).

`AGENTS.md` and rule 71 link the `mdpro-delegator` skill, which is untracked. ADR-0141 WI-2 commits it (PR #534 was
folded into WI-2 by the user's ruling, 2026-10-27, per the delegator heartbeat).

**What pins the current text.**
- Citations of rule 70 and 71 sections in many forms: by heading (`rule 70 § Commits and branches`), by heading prefix
  (`rule 70 § Commits`, cited by always-on rule 10), by item number (`rule 70 item 4`, 13 times), by bold label
  (`rule 71 § Restart`), by anchor link (`71-herdr-mixed-roster.md#delegator-runtime-route`), and once by a heading
  that never existed (`session-size-guard.sh`: `rule 70 § 会话轮换`). They sit in ADRs, `.claude/agents/`, rule 10,
  `docs/`, `AGENTS.md`, `CLAUDE.md` and the hooks. `rule 70 § When a session is idle` is an H3.
- `.claude/hooks/role-guard.sh` cites rule 70, and exits with no checks for any role but `implementor` and
  `real-device-tester`.
- `tests/tooling/red-receipt.test.ts` asserts that rule 71 contains `scripts/tdd/red-receipt.mjs` and `2 workers`.
- Rule 60's documentation-sync item names "the events table below" the key commands in `CLAUDE.md`.
- `scripts/codex-rules/land-guard.mjs` treats `docs/**`, `design/*.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`,
  `.claude/rules/*.md` and `.claude/agents/*.md` as docs-only; `tests/` and `.agents/skills/` are not.

**The doc gardener.** `docs/feature-ledger.md` and the sequencing row must change in the commit that changes the
behaviour (CLAUDE.md § Feature Ledger and § Plan Status Tracking; rule 60's documentation-sync items), and
`pnpm ledger:check` cannot tell whether a sentence is still true. Nobody checks the prose before a PR is pushed; the
auditors read code. picsee runs a Haiku `picsee-doc-gardener` before every PR push
(`picsee/.claude/agents/picsee-doc-gardener.md`, procedure in `picsee/docs/agents/doc-gardening.md`). picsee's gardener
edits the ledger itself (cautious edits only), has Bash, and can return BLOCK.

## Options considered

**Where delegator-only text goes**
1. **Leave it in rules 70 and 71** (today). Lost: every role pays for it every turn, and it is most of the bytes.
2. **Path-scoped rules** (`paths:` frontmatter). Lost: roles are not paths. Auditors and the tester touch neither
   `docs/` nor `src/`, and a docs edit by an implementor would load the delegator's text.
3. **`docs/agents/delegator/`.** Lost: it already has the docs-only change path, but the user adopted "the delegator
   skill's references" by name, and the templates and scripts the procedure drives already live in the skill.
4. **`.agents/skills/mdpro-delegator/references/`, with that Markdown path added to the docs-only set.** Chosen: the
   user's named destination, loaded only by the delegator, and the moved text keeps the change path it has today.
   Without the docs-only extension every procedure edit would need a High-tier PR with two auditors, which nobody
   chose (opus M2).

**Where implementor, auditor and tester text goes**
1. **The delegator skill's references.** Lost: the implementor would depend on a delegator-owned file (ADR-0146
   option 3 lost for the same reason).
2. **`.claude/agents/` or `.codex/` per runtime.** Lost: two copies, one per runtime, which drift.
3. **`docs/agents/<role>.md`, named by the brief or request.** Chosen: both runtimes read it by path, it is versioned,
   and it sits beside ADR-0146's `docs/agents/audit-dimensions.md`.

**Clauses that bind more than one role**
1. **Copy the clause into each role's file.** Lost: two copies drift, ADR-0124 option 2's failure.
2. **The delegator reads every role file every session.** Lost: it puts the bytes back on the delegator's turns.
3. **One canonical home, in the file of the role that acts; a binding pointer in the file of every other role it
   binds; and the delegator skill's step names the anchor it applies at that step.** Chosen.

**Rules 70 and 71 as files**
1. **Merge them into one short rule.** Lost for now: it re-points every rule 71 citation, the red-receipt pin and
   AGENTS.md at once, and reopens ADR-0124's overlay decision without a new force.
2. **Delete the rule files; the skill becomes the law.** Lost: Codex implementors and auditors would have no
   always-loaded statement of who may land, ask the user or push, and `role-guard.sh` would cite a skill.
3. **Keep both files as short summaries; every existing H2 and H3 survives as a stub that names where its detail
   lives.** Chosen.

**Stopping regrowth**
1. **A convention only** ("keep it short"). Lost: rule 70 alone was 30 KB on 2026-10-18 (ADR-0124 option 1); rules 70
   and 71 are now 65 KB under that convention.
2. **A gate script in `scripts/`, wired into CI separately.** Lost: more machinery than the check needs.
3. **A byte count of the named files.** Lost in review: an `@` import, a nested rule, a catch-all `paths:`, or text moved
   into a role file every session reads would all escape it (opus H2, gpt H1).
4. **A test that computes what each runtime and role actually loads, from machine-readable read lists, and caps each
   set.** Chosen.

**The doc gardener**
1. **No gardener; rely on rule 60's checklist and the auditors.** Lost: the user adopted item 6.
2. **picsee's gardener as is** (edits the ledger, Bash, returns BLOCK). Lost: an edit after the implementor's gates
   changes the head SHA, which breaks tree identity and the verifier's run; Bash in a live worktree can destroy another
   agent's state; and a BLOCK from a Haiku reader would be a third gate nobody chose.
3. **Read-only tools on a detached tree, mismatches only; the delegator rules on each, and confirmed breaches of a
   same-commit rule are rule 60 MUSTs.** Chosen.
4. **On Opus**, keeping rule 70's rule unbroken. Lost: the user chose Haiku as a named exception.

## Decision

1. **Always-on text is a routing map.** `CLAUDE.md`, rule 70, rule 71 and `AGENTS.md` state what every session needs
   and point to where the rest lives. Every paragraph removed from those four files gets one of three dispositions,
   listed in the implementing PR:
   - **moved verbatim** to its canonical home (proved by `grep -F` on the destination);
   - **rewritten to ADR-NNNN**: the old text goes verbatim to the history file, and the handoff cites the new text and
     the ADR it follows. Every clause that contradicts ADR-0143 (Context, "Rule churn and drift") is rewritten, never
     moved verbatim (opus M3);
   - **dropped**, as a duplicate of a named file or superseded by a named ADR.

2. **Destinations.** Key: **K** keep in the always-on file, condensed; **D** delegator references
   (`.agents/skills/mdpro-delegator/references/`); **I** `docs/agents/implementor.md`; **A** `docs/agents/auditor.md`;
   **T** `docs/agents/device-tester.md`; **H** history, `docs/reference/20261027-rules-70-71-history.md` (verbatim,
   with anchors). A two-letter key such as **A+D** means the clause binds both roles: it lives in the first file, and
   the second carries a binding pointer.

   **The rule for deciding** (closes B1):
   - A clause that binds every session, including a session the user tasks directly and whoever writes an ADR or a
     commit, is **K**.
   - A clause that binds one role goes to that role's file.
   - A clause that binds several roles has one canonical home, the file of the role that **acts** (does the thing the
     clause constrains). Each other role it binds gets a **binding pointer** in its own file: one line naming the anchor,
     that it binds this role, and the moment it applies ("When merging verdicts, apply `docs/agents/auditor.md#downgrades`").
   - Where the other role is the delegator, `SKILL.md`'s step for that moment also names the anchor, so the delegator
     reads it when it applies, not every session.
   - A role's request or brief template links its role file inside its read list (decision 5), so a Codex agent cannot
     miss it.

   **`CLAUDE.md`** (27.1 KB → at most 10 KB)

   | Section | Bytes | Destination |
   |---|---:|---|
   | gstack, Lessons Learned, Project Overview, Prerequisites, Development and Rust commands, Architecture | 2.0 K | K |
   | Design System | 1.1 K | K, four lines: the design file, rules 30–34 path-scoped, no deviation without approval |
   | IPC: Commands | 0.7 K | K |
   | IPC: Events table | 2.9 K | `docs/guide/architecture.md` § Events; K one-line link; rule 60's doc-sync item re-pointed |
   | Menu System | 0.4 K | `docs/guide/keyboard-shortcuts.md`; K link |
   | Release Workflow | 1.1 K | `docs/guide/release-runbook.md` (already has it); K two lines: rule 40, never `gh release create` |
   | Git Commit Conventions | 1.8 K | K: format, types, and the commit checklist (every committer, the delegator included); splitting strategy **I** |
   | User questions and answers | 3.1 K | criteria already in the file's own header; K one line (a directly asked session answers, then sends the delegator the question and a 1–4 sentence answer; Codex in its final message); recording procedure **D** |
   | Plan Status Tracking | 1.8 K | K: a WI's row changes in the commit that finishes it; **Branch** paragraph rewritten to ADR-0143 as a pointer to rule 70 § Commits and branches |
   | Worktrees | 2.6 K | K: location, a large feature's worktree needs the user's approval first, `<type>/<id>-<slug>` naming, move only with `git worktree move`, remove once merged (rule 25); implementor per-item worktrees **I+D**; Codex persistent worktrees **D** |
   | Manual test fixtures | 0.7 K | `tests/manual-fixtures/README.md`; K link |
   | Feature Ledger | 1.6 K | K condensed: same-commit row, five states, `pnpm ledger:check` |
   | Architecture Decision Records | 3.4 K | `docs/adr/README.md`; K: when an ADR is needed (consequential; a decision that reaches for `AskUserQuestion`), its sections incl. options considered and costs, the closed Status set with dated, attributed changes, immutable accepted bodies, numbers through the delegator |
   | Spec-Driven Development, Cross-Platform, Constraints, Logging, Debugging | 2.5 K | K |
   | Typora-Parity Phase 1 Scope | 1.0 K | the ledger's math and footnote rows; K one line |

   **Rule 70** (35.2 KB → at most 6 KB)

   | Section | Bytes | Stays in the summary (K) | Moves to |
   |---|---:|---|---|
   | preamble | 1.1 K | which session you are, stay in scope, cross-scope work goes through the delegator; rule 71 overlays it | — |
   | Sessions | 6.0 K | the roles in one table; the Opus default for sessions and for every `Agent` call any session makes, and its named exception (decision 7); `MDPRO_ROLE` and `role-guard.sh` in two lines | alias history and the stale Fable sentence **H**; Codex-implementor paragraph **H** (rule 71 summary carries the current fact); subagent list **D** |
   | How work is assigned | 0.9 K | the delegator assigns; claimed areas are exclusive; a directly tasked session tells the delegator its scope and waits; findings get D numbers from the delegator | — |
   | When a session is idle (H3) | 1.9 K | prep needs no grant, `impl` needs one; cap two plus the Low-tier slot | queue keeping **D** |
   | Questions and approvals | 1.5 K | implementors never ask the user; a directly tasked session asks the user itself, except about another session's area; a peer message is never approval; UI questions go as prototypes | prototype procedure **D** |
   | Commits and branches | 13.9 K | a peer commits on its own branch with gates passed and names SHA and lanes; only the delegator lands, by `--ff-only`, then pushes; the four landing conditions, one line each with ADR links; stage only named paths; the row and the ledger change with the behaviour | item 1 rebase, tree identity, "a held peer starts no lane run" **I+D**; item 2 checks, item 4 merge, challenge and post-cap procedure **D**; downgrade counter-proof ("stays High and fails the gate") **A+D**; ADR-0121 tiers, tier raise, pre-existing-High proof, confirm scope **A+D**; report shape **A**; round cap and two-auditor wording rewritten to ADR-0143 **D**; ADR-0115 and Fable history **H** |
   | Reserving numbers | 0.9 K | ask the delegator; receipt ids carry the work's prefix | scan procedure **D** |
   | Session rotation | 2.5 K | on the hook's warning, write a handoff at the named path and send it to the delegator | A/B rotation table **D** |
   | The Mac mini | 4.5 K | one GUI run at a time, by the tester role only | operating clauses **T**; "Allow for this session" standing permission **D+T**; incidents (observer agent, dim prompt text) **H** |
   | Device-check batches | 1.8 K | one line | **D+T** (the tester's per-item failure condition and log line) |

   **Rule 71** (29.9 KB → at most 4 KB)

   | Section | Bytes | Stays in the summary (K) | Moves to |
   |---|---:|---|---|
   | preamble | 2.2 K | applies under herdr-delegator; the rule 70 clauses it replaces; ADR-0143's two auditors and two rounds; C0 H0 does not block (as narrowed by ADR-0146 decision 4) | the long "unchanged" list **D** |
   | Delegator runtime route | 1.8 K | one line: the route script picks the Codex or Claude flow | **D**, rewritten to ADR-0143 |
   | Roster | 8.1 K | current names, role, model, how each gets work and reports; opus-auditor rewritten to ADR-0143 | superseded routing (dtrack, claude-imple-1, mac-test) **H**; current device routing **T+D** |
   | Codex agents | 7.2 K | no `SendMessage`; reports go to `herdr-spike/<name>/`; the guard files | wake-up mechanics, restart steps, model and effort table **D**; receipts **I+D** (the verifier checks them) |
   | Fresh context | 3.4 K | every request and every later fix round starts fresh, from files | read barrier **A+D** (it binds what the delegator sends); fix 1 in the same session only with one or two findings and ≤ 12 % **D+I**; 20 % / compaction rotation **I+D**; "Opus is never required" rewritten to ADR-0143 **D** |
   | Briefs and self-acceptance | 5.3 K | the implementor accepts its own work against the brief before the delegator confirms | brief sections **D** (the brief template); attacked matrix, `ATTACK-NOT-RUN` stop, self-acceptance table **I+D**; "the delegator confirms by checking the table … sends the item back" **D+I** |
   | Audits under herdr | 0.9 K | one line | **D**, rewritten to ADR-0143 |
   | Slots | 1.0 K | two lines | Low-tier slot handling **D** |

   **`AGENTS.md`** (13.1 KB → at most 7 KB). § Read first (Codex) carries the machine-readable read list of decision 5:
   `CLAUDE.md`, rules 10, 25 and 60, then the role file your brief or request names. **Codex never opens rule 70 or 71
   because a file mentions it.** It reads one only when its brief or request lists it in the request's own read list,
   or when it holds `herdr-delegator` (then it runs the delegator skill). The path-trigger table gains rules 22 and 50
   (decision 9); the command guards and the Codex substitutions table stay. Sections that repeat `CLAUDE.md` shrink to
   one line each with a pointer; Code Review Guidelines stay, because `@codex review` reads only this file.

3. **The rules stay the law.** Rules 70 and 71 remain authoritative. A moved block carries the authority of the clause
   it came from. Its stub says "Governing text: `<path>#<anchor>`". The moved block carries its provenance as an HTML
   comment, `<!-- moved-from: rule 70 § <name> (ADR-0147) -->`, which is a record, not a read directive (gpt H1).
   - **Change path.** A destination changes the way the rule text changed before the move. `docs/agents/*.md` (other
     than ADR-0146's `audit-dimensions.md`) and the moved reference files `.agents/skills/mdpro-delegator/references/*.md`
     are docs-only: a delegator commit, with the user's word for a rule change, as rules 70 and 71 are today. WI-1 adds
     that pattern to `land-guard.mjs`'s docs-only set. **`references/templates/` is excluded** (opus round 2 N4). The
     request templates carry ADR-0146's dimension-file pin, the merged-verdict shape and the read blocks the budget
     counts, so they keep ADR-0141's PR path.
   - **ADR-0146's stricter path is not extended.** ADR-0146 took only the dimension file off the docs-only path,
     because auditors pin it by blob id as their input. The read barrier, the downgrade rule and the pre-existing
     proof lived in rules 70 and 71 on the docs-only path under ADR-0146, and moving them does not change that.
   - The guide's line "when this guide and a rule disagree, the rule wins" stays true for the guide's own prose, not for
     moved blocks.

4. **Citations keep resolving.** Every H2 and H3 heading in rules 70 and 71 stays, with its anchor, as a stub.
   `docs/reference/adr-0147-rule-section-map.json` (following the ADR-0098 move-map precedent) maps every label that is
   not a heading: `item 1`–`item 5`, `§ Restart`, `§ Codex`, `§ Briefs`, `§ Questions`, `会话轮换`. **A row may list
   several targets, one per clause**: `rule 70 item 4` maps to the D procedure, the A downgrade and pre-existing
   anchors, the H Fable history, and each clause ADR-0146 names. Accepted ADRs are not edited. `role-guard.sh` keeps
   citing rule 70, whose § Sessions still states the role limits it enforces.

   `tests/tooling/rule-citations.test.ts` scans every tracked `*.md`, `.claude/hooks/*` and `.claude/agents/*` for the
   grammar `rule 7[01]('s)? (§ <label>|item <n>|<label> item <n>)` and for links to `7[01]-*.md#<anchor>`. A label
   resolves by exact heading, by the prefix of exactly one heading, or by a map row; an anchor resolves to a heading
   that exists. Every "Governing text" link and every binding pointer must resolve too.

5. **The budget** (closes B2). The user ruled 「42 KB now (Recommended)」: 42,000 bytes for the Claude always-on set and
   40,000 for the Codex shared start-of-session set. Rules 10, 25 and 60 are not condensed in this record.
   `tests/tooling/always-on-budget.test.ts` computes what each runtime and each role loads, and caps each set:
   - **Claude always-on set**: `CLAUDE.md`, every file it imports with `@path`, resolved transitively, and every
     `.claude/rules/**/*.md` (recursive) that is not path-scoped. A rule counts as path-scoped only when every
     `paths:` pattern is in the test's allowlist of scoped patterns **and** none matches a probe set of files every
     role touches (`docs/x.md`, `docs/agents/x.md`, `.agents/skills/x/SKILL.md`, `CLAUDE.md`, `AGENTS.md`). A catch-all
     pattern therefore counts as always-on. Cap 42,000; projected about 34.7 KB (CLAUDE.md 10 + rules 10/25/60 14.7 +
     70 6 + 71 4).
   - **Codex shared set**: `AGENTS.md` plus every file in its machine-readable read list, a fenced block between
     `<!-- read-every-session:begin -->` and `<!-- read-every-session:end -->`. Cap 40,000; projected about 31.7 KB.
   - **Read routes are the fixtures** (round 2, gpt H1). A role's set is measured per route, the way a session of that
     role actually starts. The test has one fixture per route:
     - delegator, initial dispatch: the Claude shared set, `SKILL.md`, and every file `SKILL.md` requires before the
       first dispatch (today `references/guide.md`, 12,981 bytes);
     - implementor: brief route and fix-brief route;
     - auditor: audit, confirm, challenge and plan-review routes;
     - device tester: device route.

     Each implementor, auditor and tester route is the runtime's shared set, plus the role file, plus the route's
     template file itself (its whole body, not only its read block), plus every file reached through a read block of
     any file already in the route, transitively, whatever its directory or link spelling. Rules 22 and 50 are in
     `implementor.md`'s read block (decision 9), so they count for the Claude implementor too. A file reached twice
     counts once.
   - **A mandatory read lives only in a read block.** A read block is a fenced list between
     `<!-- read-every-session:begin -->` and `<!-- read-every-session:end -->`. In `AGENTS.md`, `SKILL.md`, every
     `docs/agents/*.md` role file, and every brief and request template:
     - a link to any repository file outside a read block must carry an anchor (`#…`). That makes it a citation, opened
       only when the clause is needed;
     - a sentence outside a read block that tells the reader to read something before work, first, once, in full, or
       every time (a fixed list of patterns in the test, such as `read … before`, `read … first`, `read … once`,
       `read … in full`, `before your first`) fails the test.

     So `SKILL.md`'s "read [the guide] once before your first dispatch" must become a read-block entry, and then it is
     counted. Prose admitted outside a block can no longer require a read. A hand-written brief is not a fixture; its
     template is.
   - **Caps, as failing gates** (user: 「Accept, as failing gates (Recommended)」): implementor 48,000, auditor 50,000,
     device tester 42,000, delegator 50,000 bytes per route, in both runtimes. The test fails until the real files fit.
     The implementation measures and trims; it never raises a cap without the user's quoted word. The Claude routes bind
     (the Claude shared set is about 3 KB larger than Codex's). At the projected 34,719-byte Claude shared set, the room
     left for each role's own files is:

     | Route (Claude) | Fixed part | Cap | Room for role file, template and their blocks |
     |---|---:|---:|---:|
     | delegator initial dispatch | 34,719 | 50,000 | 15,281 for `SKILL.md` + required guide (today 18,862: over by 3,581) |
     | implementor brief | 34,719 + rules 22/50 5,533 | 48,000 | 7,748 for `implementor.md` + brief template (template today 3,804) |
     | auditor audit | 34,719 + `audit-dimensions.md` allowance 11,500 | 50,000 | 3,781 for `auditor.md` + request template (template today 1,458) |
     | device tester | 34,719 | 42,000 | 7,281 for `device-tester.md` + device template (template today 3,257) |

   - **What is trimmed first.** In this order, and never by dropping a binding clause:
     1. text in a route that repeats a file already counted in it is replaced by an anchor citation;
     2. history, examples and incident narratives go to the history file (**H**);
     3. text needed only on one route moves into that route's template. A confirm-only clause lives in the confirm
        template, and the delegator guide's on-need sections (§ 2 roster, which repeats rule 71's summary; § 3 cheat
        sheet; § 10 trials and errors; § 11 state) become citations, leaving a guide core in the read block. The
        delegator route must shed at least 3.6 KB this way;
     4. only then `CLAUDE.md` below its 10,000-byte per-file cap, which frees room on every route.
   - **ADR-0146's dimension file** has an allowance of 11,500 bytes inside the auditor cap (the reviewed draft is
     11,499). A PR that grows it past the allowance fails this test. That PR's owner trims it, or asks the user to raise
     the allowance; this record does not.
   - Per-file caps for the shared files: `CLAUDE.md` 10,000; rule 70 6,000; rule 71 4,000; `AGENTS.md` 7,000;
     `doc-gardening.md` 10,000. Role files, templates, `SKILL.md` and the guide have no per-file cap; the route caps
     bind them. The test prints every route's size and pins that rules 22 and 50 carry `paths:`.
   - **Where the tests run.** Every file these two tests read can change by a docs-only commit, which runs no CI (opus
     round 2 N2). So the delegator's docs-only step runs both tests (unlocked, at most 2 workers) whenever the range
     touches a counted file, `.claude/rules/` or `AGENTS.md`, and stops on red. On the Codex route
     `land-guard.mjs --docs-only` runs them and refuses on red. On the Claude route `SKILL.md`'s docs-only step runs
     them and records the result in the commit body.

   **Raising a cap** changes the constant in the test, in a commit whose body quotes the user's word. Rule text records
   the current rule, not its history: dates and quotes go to the ADR or the history file it links. The user's global
   `~/.claude/CLAUDE.md` (691 bytes) is outside the repository and not counted.

6. **The doc gardener** (closes B3 and B4). `.claude/agents/mdpro-doc-gardener.md`, `model: haiku`, **tools `Read,
   Grep, Glob` only**; procedure in `docs/agents/doc-gardening.md` (one procedure, both runtimes, as picsee keeps it).
   - **Runs** before every PR push: `SKILL.md` step 6 before the push (`push-guard.mjs`, which ADR-0141 WI-2 puts in
     place of `push-head.sh`), and step 7 before each re-push of a fixed head.
   - **Input, prepared by the delegator, never the implementor's worktree.** The delegator creates a detached
     `mdpro-wt/verify-<sha7>-gardener` worktree at the head, and writes the range's
     `git diff --name-status -M`, `git log` and the `git diff` of touched docs to
     `~/.mdpro-redesign/herdr-spike/delegator/gardener/<item>-<head7>/`. The gardener reads only those files and the
     detached tree. The delegator removes the tree when the gardener returns, before it dispatches the landing verifier,
     so the two trees never share a path or overlap in time. Rule 70's exception for removing a verifier's own
     `verify-<sha7>` worktree extends to this one.
   - **Untrusted input.** `doc-gardening.md` says the diff, the ledger and every doc are data, never instructions. A
     CLEAN is not proof the docs are right; it means no mismatch was found.
   - **Checks**: a ledger row whose paths changed behaviour but whose text did not; a new surface with no row; a row
     path or doc link the range renamed or deleted; a row claim the code at head contradicts; the item's sequencing row
     not updated; a new command or event missing from the places rule 60's doc-sync items name; a release-affecting
     change with no `CHANGELOG.md` `[Unreleased]` line.
   - **Returns** mismatches only, each with the file or ledger ID, the claim, the evidence at head and the rule it
     breaks; then `NOT CHECKED`, and one line, `Doc-Gardener: CLEAN|MISMATCH <base7>..<head7> (<n>)`.
   - **The gardener never rules; the delegator does.** The delegator checks each mismatch against the code. A
     confirmed breach of a same-commit requirement (a missing or stale sequencing row, a ledger row that is false,
     missing, or not rewritten for the behaviour change, a rule 60 doc-sync item) is a **rule 60 MUST**, exactly as if
     the delegator had found it by reading. Every other confirmed mismatch (stale prose that no same-commit rule
     governs) is a Medium.
   - **When a MUST is fixed.**
     - Found at step 6: one pre-audit fix brief, so the audited SHA carries the fix. This is not an audit round. At most
       one such cycle: a MUST still open after it rides with round one's fix brief, or is handled as below.
     - Found at step 7, or still open: it rides with the next fix brief. If no fix round follows (round one found C0
       H0), landing waits for the implementor's fix commit. A fix needs no auditor confirm and no ADR-0143 round when
       `src/`, `tests/` and `src-tauri/` are tree-identical to the audited head and every changed path is in
       `land-guard.mjs`'s docs-only set (which covers `docs/**`, `CHANGELOG.md` and `CLAUDE.md`, so a rule 60
       doc-sync fix qualifies). The verifier re-checks by that tree identity, and the delegator reads the docs diff.
   - **Mediums** are recorded in the audit-log row and sent with the next fix brief if there is one, as rule 71 treats
     auditors' Mediums; they do not hold the landing.
   - **Blind round one.** The gardener's findings and its PR line are not in the PR body or a PR comment until both
     round-one reports are in; the delegator posts them with the merged verdict.
   - **Not a landing condition by itself.** If the gardener cannot run, the record says `NOT RUN <reason>` and the
     delegator reads the ledger and sequencing rows itself.
   - **On the Codex route** there is no Haiku subagent; the Codex delegator follows `doc-gardening.md` itself, on the
     same prepared input.

7. **The Haiku exception.** Rule 70 § Sessions gains: "Named exception: `mdpro-doc-gardener` runs on Haiku (ADR-0147;
   user, 2026-10-27: 「Haiku, named exception (Recommended)」). It has read-only tools and rules on nothing." The stale
   Fable sentence goes to the history file. No other subagent may run on Haiku without its own record.

8. **Sequencing.**
   - **ADR-0141 WI-2 lands first.** WI-2 commits `.agents/skills/mdpro-delegator/` (with PR #534 folded in) and puts
     `push-guard.mjs` in place of `push-head.sh`. The moved delegator text needs a tracked destination, and the links
     from AGENTS.md and rule 71 stop dangling only then. Whatever ADR-0143 alignment WI-2 makes to `SKILL.md` and
     `guide.md` is kept; WI-1 does the rest.
   - **The user's pending edits are no longer a precondition.** On `94b87678` the four files are clean; only the
     untracked skill remains, which WI-2 covers.
   - **ADR-0146's named clauses.** ADR-0146 supersedes four clauses of rule 70 item 4, rule 71's "zero Critical and
     zero High does not block", and rule 71 § Briefs' "sends the item back before any audit starts". Whichever
     implementation lands second re-points the other's clauses:
     - if ADR-0146's lands first, WI-1 moves the amended text, keeps ADR-0146's wording, and adds one map row per
       ADR-0146-named clause pointing at its new home;
     - if WI-1 lands first, the map rows exist from WI-1, and ADR-0146's implementation edits the clauses at the
       homes they name.
     Either way `docs/agents/auditor.md` links `audit-dimensions.md`.

9. **Rules 22 and 50 become path-scoped** (user: 「Path-scope them (Recommended)」). Both govern how code is written,
   and the delegator, auditors and tester do not write code.
   - **Rule 22** (comment maintenance) gets `paths:` for `src/**`, `src-tauri/**`, `tests/**`, `scripts/**`,
     `.claude/hooks/**` and `.agents/skills/**/scripts/**`. Its trigger is a `Purpose:` header or `//!` doc, and those
     are not app-only: 113 files under `scripts/`, `.claude/hooks/` and the skills' scripts carry a `Purpose:` header
     (`role-guard.sh` among them).
   - **Rule 50** (codebase conventions) gets `paths:` for `src/**`, `src-tauri/**` and `tests/**`, not `scripts/`. Its
     content is the app's: Zustand stores, the IPC layers, the editor plugins, the MCP shadow store, error narrowing, a
     300-line limit written for app modules. `tests/` is in because its store-reset convention governs tests.
   - **Codex** loads neither by path. `docs/agents/implementor.md` lists both in its read block (counted, decision 5),
     and AGENTS.md's path-trigger table gains the two rows.

## Implementation

Two work items, both High tier (ADR-0121: gate tooling and rule text), `standard` difficulty. Each is a PR: they add
tests and change `land-guard.mjs`, which the land guard does not treat as docs-only.

**WI-1: the routing map and the budget.**
- RED first: `always-on-budget.test.ts` and `rule-citations.test.ts`, plus a land-guard case for the new docs-only
  pattern. The budget test fails on today's sizes; the citation test fails on today's unmapped labels. The budget
  test's fixtures are the read routes of decision 5. It has its own red cases: a role file that requires a
  `docs/guide/` read in prose outside a block, a block entry outside `docs/agents/` (the delegator guide), and a link
  with no anchor outside a block. Each must fail.
- Trim to fit, in decision 5's order, until every route is under its cap. The delegator route must shed at least
  3.6 KB from `SKILL.md` plus the guide. No cap is raised without the user's quoted word.
- `land-guard.mjs --docs-only` and `SKILL.md`'s docs-only step run the two tests when the range touches a counted
  file (decision 5, "Where the tests run").
- Created: `docs/agents/implementor.md`, `auditor.md`, `device-tester.md`; `docs/adr/README.md`;
  `tests/manual-fixtures/README.md`; `docs/reference/20261027-rules-70-71-history.md`;
  `docs/reference/adr-0147-rule-section-map.json`; delegator references `roster-and-routing.md`,
  `landing-and-audit.md`, `codex-panes.md`, `device-batches.md`, `session-ops.md`.
- Changed: `CLAUDE.md`, `AGENTS.md` (read block), rules 70 and 71, rules 22 and 50 (`paths:`), rule 60's doc-sync
  item, `docs/guide/architecture.md` (events table), `docs/guide/keyboard-shortcuts.md` (menu),
  `scripts/codex-rules/land-guard.mjs` (docs-only pattern `references/*.md`, templates excluded, and the test run),
  `SKILL.md` (each step names the anchors it applies) and
  `guide.md`, and the brief, fix-brief, audit, confirm, challenge and device templates (each has a read block naming
  its role file).
- **ADR-0143 alignment**, as "rewritten" dispositions: CLAUDE.md § Plan Status Tracking **Branch**; rule 70 item 4's
  "every audit runs twice … Fable", "at most three rounds", "two confirms"; rule 71 § Delegator runtime route, § Roster's
  opus-auditor row, § Fresh context's "Opus is never required", § Audits under herdr; `SKILL.md` step 7; `guide.md` § 2.
  None of these reach a destination in their old wording.
- `tests/tooling/red-receipt.test.ts` reads `docs/agents/implementor.md` in place of rule 71 for its two strings.
- The handoff lists every removed paragraph with its disposition and proof (decision 1).
- The stray untracked `.agents/skills/mdpro-delegator/references/templates/.claude/` folder is excluded: not staged,
  not a destination. Removing it is the user's call (rule 25).
- ADR-0124's and ADR-0141's Status lines get their forward links.
- No ledger row: no user-visible behaviour changes.

**WI-2: the doc gardener.**
- Created: `.claude/agents/mdpro-doc-gardener.md` (`tools: Read, Grep, Glob`, `model: haiku`),
  `docs/agents/doc-gardening.md`.
- Changed: `SKILL.md` steps 6 and 7 (input preparation, dispatch with `model: "haiku"`, routing), rule 70 § Sessions
  (decision 7) and its `verify-<sha7>` removal exception, the merged-verdict template (gardener line posted with it).
- Proved on three runs: a range with a stale ledger row and an untouched sequencing row returns MISMATCH naming both;
  a clean range returns CLEAN; a range whose diff contains an instruction to run a command returns its mismatches and
  does nothing else. In every run the implementor's worktree `HEAD` and `git status --porcelain` are unchanged.

## Consequences

- **Gained.**
  - The Claude always-on set falls from 112 KB to at most 42 KB, about 35 KB projected (roughly 10k tokens instead of
    31–36k). The Codex shared set falls from 126 KB to at most 40 KB, about 32 KB. Every role's whole start of session,
    per route and per runtime, is counted and capped at 42–50 KB.
  - Every text a role must read is counted, so the size cannot creep back through an import, a nested rule, a broad
    `paths:`, a role file, a template, or a prose read directive. A docs-only commit that breaks a budget or a citation
    is stopped before it lands.
  - Each role reads a file written for it, clauses binding two roles have one home and a pointer, and history stops
    masquerading as rule text.
  - The ADR-0143 contradictions are removed from every file, including the ones that were about to be moved.
  - Stale ledger and sequencing rows are caught before audit, by a reader that costs a fraction of an auditor and
    cannot write.
- **Costs.**
  - The delegator does not get much cheaper: moved text lands in references it reads at the step that needs them, and
    every role takes one more hop to find a clause. A brief template without its read block leaves a Codex agent
    without its rules; the budget test catches a missing block only for the templates, not for a hand-written brief.
  - One large rewrite of the most-cited files, while 34 commits in 11 days show they are still moving.
  - Rule text now lives in about ten more files; binding pointers can go stale in meaning while their anchors still
    resolve.
  - Extending the docs-only set to the delegator's reference files lets the delegator change its own procedure without
    an audit, as it can change rules 70 and 71 today. The request templates, which are audit inputs, stay on the PR
    path.
  - The budget test parses read blocks, `paths:` globs and a fixed list of read-directive phrasings: more test
    machinery than a byte count, and a new way for a rule edit to fail. A read directive in a wording outside the list
    still escapes. Docs-only commits to counted files now cost a test run.
  - The route caps are failing gates from WI-1's first run: WI-1 cannot land until the delegator guide, the role
    files and the templates are trimmed, and the auditor route has about 3.8 KB of room beside ADR-0146's dimension
    file.
  - Hard caps will force trimming at awkward moments, and a cap raised by habit is no cap.
  - The gardener adds a detached worktree and a dispatch per push, and a confirmed MUST can hold a landing that
    ADR-0143's auditors had cleared. Haiku will miss subtle mismatches and raise false ones; checking them costs the
    delegator's time.
  - A second model exception weakens "every subagent on Opus" as a blanket statement.
  - Path-scoped rules 22 and 50 reach a Claude session only when it touches a matching path. A session that writes
    code elsewhere (`design/`, a root config file) no longer sees them.
- **Foreclosed.** History or dated quotes in rule text; an uncounted always-read file; the gardener editing files,
  running commands, or ruling on its own findings without a new record.

## User rulings

The first draft left five open questions. The user ruled on two on 2026-10-27; the delegator decided the other three
on the draft's defaults.

**By the user:**
1. **The budget.** 「42 KB now (Recommended)」. 42,000 bytes for the Claude always-on set and 40,000 for the Codex shared
   start-of-session set, with the per-file caps in decision 5. Rules 10, 22, 25, 50 and 60 are not condensed in this
   record; the budget is revisited after it lands.
2. **Rules 22 and 50.** 「Path-scope them (Recommended)」. Decision 9.

**By the delegator, on the draft's defaults:**
3. **The gardener is not a landing condition by itself.** Its output is advisory; a MUST holds a landing only after the
   delegator confirms it (decision 6).
4. **No Codex gardener wrapper now.** The Codex delegator follows `doc-gardening.md` itself.
5. **Rules 70 and 71 are not merged** in this record.

**By the user, after review round 2** (2026-10-27):
6. **Per-role caps.** 「Accept, as failing gates (Recommended)」: implementor 48 KB, auditor 50 KB, device tester 42 KB,
   delegator 50 KB. The test fails until the real files fit. The implementation measures and trims, and never raises a
   cap without the user's quoted word (decision 5).
7. **gpt-auditor's round-2 H1** (an uncounted required read) was still open after the last round. The user chose the
   ADR-0129 post-cap route 「Fix + scoped confirm (Recommended)」: the fix is decision 5's read routes and read-block
   rule, and gpt-auditor, which raised the finding, confirms on that change only.

## Review round 1 dispositions

| Merged | Raised by | Disposition |
|---|---|---|
| **B1** clauses binding several roles assigned to one role's file | gpt H2, opus H1, M6 | Closed. Decision 2 states the rule (canonical home in the acting role's file, binding pointer elsewhere, `SKILL.md` steps name the anchors; every-session clauses stay K) and re-walks the tables: the ADR-0121 pre-existing proof, tier raise and confirm scope are **A+D** and every audit and confirm template links `auditor.md` in its read block (gpt's close); opus's six clauses are **A+D**, **D+I** or **I+D**; CLAUDE.md keeps the worktree approval, naming and removal rules, the ADR authoring essentials and the commit checklist (M6); L3's unassigned clauses are placed. Both closes are satisfied: gpt's by the auditor file and request link, opus's by the pointer rule. |
| **B2** budget test bypassable; Codex role reads uncounted | gpt H1, opus H2 | Closed. Decision 5 counts `@` imports, nested rules, catch-all `paths:` (probe set and allowlist), and per-role sets for both runtimes from machine-readable read blocks; a read directive outside a block fails the test. Provenance labels are HTML comments, and Codex never opens rule 70/71 because a file mentions it (gpt's non-triggering close and opus's per-role close, both). Per-role caps added; Consequences corrected. |
| **B3** gardener has a write-capable tool in a live worktree | gpt H4, opus M4 | Closed. Tools `Read, Grep, Glob` only; the delegator prepares the diff and a detached `verify-<sha7>` tree; inputs are data; WI-2 proves the implementor's `HEAD` and status unchanged on CLEAN, MISMATCH and injected-instruction runs. No Bash, so no allowlist is needed (gpt's and opus's closes both offered this route). |
| **B4** missing sequencing row treated as advisory | gpt H3, opus M5 | Closed. Decision 6: a confirmed breach of any same-commit requirement (sequencing row, ledger row false, missing or not rewritten, rule 60 doc-sync) is a rule 60 MUST; the gardener never rules. The step-7 case, the one-cycle cap and the docs-only fix path without an extra audit round are written out. |
| gpt M: stale `push-head.sh` insertion point | gpt | Closed: `push-guard.mjs`, after ADR-0141 WI-2. |
| gpt M: ADR-0115 forward link added before the Haiku exception exists | gpt | Closed: ADR-0115 is no longer superseded (L1); forward links go in the commit that implements each clause. |
| opus M1 citation test misses real citations | opus | Closed: decision 4's grammar, scope (all tracked `*.md`, hooks, agents), prefix resolution, H3 stubs, multi-target map rows, `会话轮换` mapped. |
| opus M2 change path of D and A | opus | Closed: decision 3 extends the docs-only set to the references' Markdown (superseding ADR-0141 decision 2's set by one pattern) and says why ADR-0146's stricter path is not extended. |
| opus M3 verbatim moves carry ADR-0143 contradictions | opus | Closed: decision 1's "rewritten to ADR-NNNN" disposition; the alignment list in WI-1 includes rule 70 item 4's round cap and two-auditor wording. |
| opus M5 "never blocks" vs MUST routing; step 7 | opus | Closed with B4. |
| opus M6 every-session rules moved away | opus | Closed with B1. |
| opus M7 ADR-0146's named clauses | opus | Closed: decision 8, one map row per ADR-0146 clause, whichever lands second re-points. ADR-0146 is Accepted (`fd893163`). |
| opus L1 Haiku bookkeeping | opus | Closed: ADR-0115 not superseded again (ADR-0137 already did); the stale Fable sentence goes to history. |
| opus L2 stale precondition | opus | Closed: decision 8 restated. |
| opus L3 clauses without disposition | opus | Closed in the tables (directly tasked sessions, the Codex-implementor paragraph, every `Agent` call, the standing permission). |
| opus L4 blind round one and the PR body | opus | Closed: the gardener's line is posted with the merged verdict, after round one. |

**Not closed by text alone:** the per-role caps (48 / 50 / 42 / 50 KB) are the delegator's proposal; the user's ruling
covered only the shared 42 KB and 40 KB caps. (Closed after round 2 by the user's ruling, § User rulings 6.)

## Review round 2 dispositions

Round 2, the last under ADR-0143: gpt-auditor C0 H1 M0 L0, opus-auditor C0 H0 M3 L3; reports
`herdr-spike/{gpt-auditor,opus-auditor}/ADR-0147-r2.md`. B1, B3 and B4 closed in both reports, and B2 closed in
opus's. In the challenges, opus confirmed gpt's round-1 B3 High and refuted B4's High as Medium (a missed row is
rewritten by the delegator's landing checklist, so it is not left false on `master`). The routing in decision 6 stands
either way.

| Finding | Raised by | Disposition |
|---|---|---|
| **H1** the role budget permits an uncounted required read (the delegator guide; auditor and delegator arithmetic) | gpt | Fixed under the post-cap route (§ User rulings 7); gpt-auditor confirms on the change only. Decision 5 does both of gpt's options: (a) read routes are the fixtures, including the delegator's initial dispatch and every request route, and every read-block target counts whatever its directory or spelling, the guide included; (b) a mandatory read lives only in a read block, an unanchored link or a listed read-directive phrasing outside a block fails the test, with red cases in WI-1. The arithmetic table shows the delegator route over by 3,581 bytes and the auditor route with 3,781 bytes of room; the implementation trims in a stated order, and the caps are failing gates. |
| N1 (M) per-role caps cannot be met as specified | opus | Folded: decision 5's route table covers the Claude routes, which bind (Codex routes are about 3 KB smaller); role-file per-file caps are dropped so the route caps alone bind; a file reached twice counts once; `audit-dimensions.md` gets an 11,500-byte allowance, owned by the PR that grows it. Moved text is trimmed only by the dispositions of decision 1 (moved to a route template, to H, or replaced by a citation), so the verbatim proof survives. |
| N2 (M) budget files change by docs-only commits that run no CI | opus | Folded: decision 5 "Where the tests run". `land-guard.mjs --docs-only` (Codex route) and `SKILL.md`'s docs-only step (Claude route) run both tests when a counted file changes, and stop on red. |
| N3 (L) read check covers two prefixes and no prose | opus | Folded with H1: any repository link outside a block needs an anchor; listed prose directives fail; the template body counts. |
| N4 (M) docs-only pattern takes in the request templates | opus | Folded: the pattern is narrowed to `references/*.md`; templates keep ADR-0141's PR path (Status, decision 3, Implementation, Costs). |
| L1 (L) gardener tree collides with the verifier's | opus | Folded: `verify-<sha7>-gardener`, removed before the verifier is dispatched. |
| L2 (L) docs-only fix exemption lists three paths | opus | Folded: the exemption is tree identity of `src/`, `tests/` and `src-tauri/` with every changed path in land-guard's docs-only set. |

Nothing else is left open. Two residuals are recorded under Costs: a read directive worded outside the test's list,
and a hand-written brief that drops its read block.
