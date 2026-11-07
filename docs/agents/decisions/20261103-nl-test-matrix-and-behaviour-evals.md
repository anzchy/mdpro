# 2026-11-03: NL items get their own test matrix, and behaviour evals run as an advisory trial

- **Decided:** 2026-11-03, by the user. The delegator answered how an NL test matrix differs from a code one and
  proposed three steps: a separate NL template, behaviour evals that are not a PR gate, and no new tests of old
  committed prose. The user ruled: 「按照建议，1-3 都实施，写进 docs/agents/decisions/，写出NL 矩阵模板，正式上线，试跑2批看看效果」.
- **changes:**
  - `.agents/skills/mdpro-delegator/references/templates/nl-matrix-template.md` (new);
  - `.agents/skills/mdpro-delegator/references/templates/brief-template.md` (one placeholder line);
  - `docs/agents/nl-evals/` (new: the eval cases and their results);
  - this log's index.
  - The template paths sit below `references/`, so this lands on the Claude delegator route; Codex's
    `land-guard.mjs --docs-only` admits one level only.
  - Follow-ups, each a PR on its own route: the `jack-tdd-workflow` § 1 pointer; an NL mode for
    `matrix-attack-prompt.md`; a home for decision 4 in rule 10. Until the pointer lands, the brief names the template,
    and the brief wins over the skill's matrix shape (`docs/agents/implementor.md:25`).
- **supersedes:** none. ADR-0146 decision 4 and `docs/agents/audit-dimensions.md` § A are unchanged.
- **gate-sensitive:** yes (herdr-delegator, 2026-11-03): it touches what an NL item's handoff and audit weigh, which is
  next to the README trigger "a landing condition". Doubt means review.

## Decision

1. **Two matrices.** A briefed item that changes text an agent loads and acts on writes its matrix from
   `nl-matrix-template.md`. That text is a rule, skill, agent definition, command, `CLAUDE.md`, `AGENTS.md`, a role doc
   under `docs/agents/`, or a brief, request or prompt template. An item that also changes code writes both. A
   delegator docs-only change of such text puts its structural cases and any behaviour cases in its plan-review
   request, or in the commit body when no review is due.
2. **Structural cases prove; behaviour evals advise.** An NL item's ACs are proved as today (§ A: the content at the
   SHA says what the AC requires), and its structural cases (reference, budget, contradiction, single home, load path,
   vocabulary) are that proof. Behaviour evals are not ACs: they run before the handoff, their results go in a
   "Behaviour evidence" section of the handoff and the audit request, and an auditor may raise a finding from them at
   Medium at most.
3. **Where evals live.** Cases live in `docs/agents/nl-evals/`; every real failure the delegator records may add one.
4. **No new tests of old committed prose.** A new test does not read an old commit's text (by `git show <sha>` or
   otherwise) to assert wording; CI's `frontend` checkout is shallow. A hash pin of a current section and the receipt
   engine's SHA and digest checks are not prose tests. An existing history-reading text test is replaced when its item
   next touches it.

## Trial

- **Pilot:** `docs/agents/nl-evals/batch-1.md` ran against the text already landed, before the run design was fixed.
  It is exploratory: it shaped the template's run design and named candidate gaps, and it counts toward nothing below.
- **Two counted batches** then run under the template's run design: batch 2 on the next NL item's own matrix, and batch 3
  on the item after it (or on batch 1's cases rewritten to that design, if no second NL item comes first). The NL mode
  of `matrix-attack-prompt.md` lands before batch 2's item is attacked.

A second entry records the result, against the criterion fixed now: **keep** if the evals found at least one
behaviour gap the structural cases missed, at a cost under 2 hours of runs per item; **change** if they found gaps but
cost more; **drop** if they found none. It reports each counted batch's pass rates with numerator and denominator, the
baseline deltas and the cost in runs and minutes. Whether evals ever become AC proof is a separate decision, which
would have to change § A and ADR-0146 decision 4 on their own routes.
