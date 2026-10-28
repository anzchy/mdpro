# 12 - Feature Planning Gate (Matt Pocock's workflow)

**A gated item enters implementation only after five things exist:**
1. a `/grill-with-docs` session;
2. a `/to-spec` spec;
3. `/to-tickets` tickets the user approved;
4. the approved snapshot, committed;
5. both auditors' plan review.

**If any is missing, stop and ask the user. A vague plan is never enough.** Reasons, options and supersessions:
[ADR-0148](../../docs/adr/0148-new-features-pass-grill-spec-and-tickets-before-implementation.md) (user, 2026-10-28:
「新功能在实施前一定要先经过 /grill-with-docs ，其次 /to-spec 最后 /to-tickets ，才能进入实施状态，如果没有的话，用askuserquestion tool
提示用户，不能只有模糊的plan就开始实施」).

## Gated or not: the test, which the delegator records in the brief
- **Gated** when any of these holds:
  - a feature-ledger row is new or changes state;
  - it adds any new user-visible behaviour (an action, a setting, a menu item, a shortcut or a visible state), even inside an existing
    `Shipped` ledger row;
  - it adds a declared surface (command, HTTP route, `MENU_*` id, plugin id, store) or a contract (IPC, persisted format, preference key);
  - it is expected to take more than one PR;
  - it needs an ADR.
- **Exempt,** as long as they add no capability or contract:
  - D-item fixes that restore stated behaviour;
  - audit fix rounds;
  - CI, receipt and test-only repairs;
  - docs-only work.
- **Doubt** goes to the user. Items granted before 2026-10-28 finish under the old flow.

## Planning
- **Who runs it.** The user runs the three skills, which are user-invoked only, in the **`planner`** pane: a Claude Code session with
  `MDPRO_ROLE=planner`, in rule 70's roster. One conversation per feature, because `to-spec` synthesises the grill.
- **What the planner may do.** It publishes the spec and ticket issues to `anzchy/mdpro`. It grants nothing, reserves nothing, commits
  nothing and lands nothing.
- **Where its outputs go.** Unnumbered ADR drafts, in CLAUDE.md's ADR structure and marked Proposed, plus glossary edits and the user's
  approval words, all under `~/.mdpro-redesign/planner/<feature>/`. It hands the paths to the delegator.
- **The delegator then:**
  1. reserves the ADR numbers and commits the drafts Proposed;
  2. commits `GLOSSARY.md`;
  3. commits the snapshot `docs/specs/<feature>/r<N>/`: `spec.md`, `tickets/<T-nn>.md`, and a `manifest.md` with issue URLs, body
     SHA-256s, approval words and blocking edges;
  4. sends spec, tickets and ADR drafts to both auditors for plan review.
- **Snapshot revisions never change.** A normative issue edit becomes `r<N+1>` and needs re-approval. Before any brief cites it, both
  auditors plan-review its diff against `r<N>`; an earlier review never covers a later revision. `docs/specs/**` is never Low tier.
- **Asking.** "Ask the user" means the delegator's route question channel: `AskUserQuestion` on Claude, Codex's channel on Codex. It
  names the next missing step and the planner pane. Implementors never ask the user (rule 70).
- **Setup.** `/setup-matt-pocock-skills` runs once, by the user, with GitHub Issues. The delegator reviews and commits what it writes.

## From tickets to landing
- **One approved ticket is one brief and one PR.** It is granted only when every ticket that blocks it has landed: `ready-for-agent` is
  not a grant.
- **The brief** pins the snapshot's commit and blobs and the skill versions. It maps each AC to a ticket and a spec story or testing
  decision, tagged `unit` or `device`.
- **Precedence:** spec snapshot, then ticket, then brief, then card. This replaces CLAUDE.md's "the original plan wins" and ADR-0144's
  plan or D-row anchor for gated items. A card may quote a snapshot AC id.
- **Implementation:**
  - **Matrix and attack first.** Rule 71 steps 1–3 are unchanged on both runtimes (tdd-guardian test-designer and spec-adversary).
  - **Then the `tdd` cycle loop,** which replaces rule 71's "all REDs first" step 4. Each cycle takes one matrix case at one agreed seam:
    test, intended failure, a RED receipt `<ID>-S<n>`, the minimal change, `verify`. The cycle settles before the next begins.
  - **Seams.** The spec's Testing Decisions are the seam confirmation. A new seam stops the work and goes to the delegator.
  - **Review.** Refactor in the `code-review` stage with tests green, then `code-review` on the committed candidate, before the handoff.
- **Runtimes.**
  - Claude implementors use the installed `tdd` and `code-review` skills.
  - Codex implementors use the vendored, pinned copies in `.agents/skills/` plus the mdpro adapter. That starts only after one validated
    cycle; until then, Codex briefs keep the tdd-guardian workflow and say so.
- **Unchanged:**
  - RED receipts (rule 10);
  - briefs and self-acceptance (rule 71);
  - both auditors (ADR-0143);
  - device ACs (ADR-0144);
  - the pinned dimensions (ADR-0146);
  - the verifier, `ci-gate`, and the delegator's `--ff-only` landing.
- **Closing tickets.** After the push, the delegator closes the ticket issue with the landing record, and closes the spec issue after the
  last ticket.
- **Never:** `/implement`, `/implement-spec`, or an integration branch.

## Before the first gated grant
All of these must be done:
- the setup run;
- the `planner` roster row and its `role-guard.sh` branch;
- the brief template's snapshot fields;
- for any `device` AC, the card checker's snapshot anchor.
