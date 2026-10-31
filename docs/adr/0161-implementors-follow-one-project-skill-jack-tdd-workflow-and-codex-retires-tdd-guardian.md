# 0161. Implementors on both runtimes follow one project skill, jack-tdd-workflow, and Codex retires tdd-guardian at its go-live

**Status**: Proposed (2026-10-31). Spec [#568](https://github.com/anzchy/mdpro/issues/568); tickets #569–#571; snapshot
`docs/specs/567-tdd-skill/r1/`. Grill answers: round 1 「是」; round 2 「Q9 用`jack-tdd-workflow` 作为name，其他的同意」;
round 3 「Q5 Matt的Skill有codex版本,已经安装了，check一下.其他问题是」; round 4 「上面问题回答：是」; round 5 「Q15-Q16 agree」. After the
grill: 「codex 的tdd-guardian 在jack-tdd-workflow 上线之后就retire」. If accepted, this partially supersedes
[ADR-0148](0148-new-features-pass-grill-spec-and-tickets-before-implementation.md):
- Context's "Codex has no Matt Pocock plugin";
- decision 7's "Review" clause (refactoring in the `code-review` stage);
- decision 7's "Runtimes" clause (vendored copies for Codex, and Codex keeping tdd-guardian until a validated cycle);
- decision 7's "Matrix and attack first" clause, where it names tdd-guardian's test-designer and spec-adversary.

It also partially supersedes [ADR-0138](0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md)'s
`mdpro-spec-adversary` row, for both runtimes.

## Context
- **#564 turned tdd-guardian off for Claude.** Its two parts that mattered, the independent matrix attack (added 2026-10-20
  after three missed-case Highs) and RED receipts, are now mdpro's own. The method is spread across rule 10, rule 12,
  rule 71 § Briefs (with separate Claude and Codex variants), the brief template, `prompt.sh` and a standalone attack
  prompt. fable-auditor's carried Medium on #564: ADR-0148 decision 7 and ADR-0138 still name the plugin for Claude.
- **Codex still runs tdd-guardian**, so one brief means two procedures.
- **Codex now has Matt Pocock's skills.** `mattpocock-skills` 1.3.2 is installed and enabled for Codex; Claude has 1.3.1.
  `tdd`, `diagnosing-bugs` and `codebase-design` are byte-identical across the two. ADR-0148's "Codex has no Matt Pocock
  plugin" is stale, and with it the reason for vendored copies.
- **Receipts still load the engine from the plugin cache.** #566 vendors and pins it, and blocks this work.
- **Primary sources disagree with "all REDs first".** Codex and Fable reviewed the slicing practice independently on
  2026-10-31 (`docs/reference/20261031-slicing-best-practice-{codex,fable}-review.md`). Beck's Canon TDD calls writing all the
  tests first a mistake. Beck, Google's TDD post and Fowler refactor inside each cycle, not in a later stage. Anthropic has
  agents write the acceptance check first, because it is the exit condition.

## Options considered
- **Keep the method in the rules only.** Lost: each rule change has to be repeated in several places, which is how the
  stale ADR-0148 and ADR-0138 text arose.
- **Vendor Matt Pocock's skills into the repo** (ADR-0148's plan for Codex). Lost: both runtimes now have the plugin, and
  vendored text needs an upgrade owner. A minimum-version check gives the same assurance.
- **Keep tdd-guardian for Codex until one validated cycle** (grill Q13, the first answer). Lost: the user ruled to retire
  it at go-live. Two methods would run side by side until then, for no gain mdpro doesn't already own.
- **Retire tdd-guardian for Codex at a separate, later landing.** Lost: it would leave a window in which the briefs name
  the skill but Codex prompts still route to the plugin.
- **A skill that also covers planning and audits.** Lost: those have their own skills and rules, and the larger skill would
  take up more of an agent's context.
- **One project skill, from the test matrix to the handoff table, for both runtimes; Codex retires the plugin at go-live**
  (chosen).

## Decision
1. **One skill.** `jack-tdd-workflow`, a project skill (canonical under `.agents/skills/`, linked from `.claude/skills`), holds the
   implementor's method from the test matrix to the handoff's self-acceptance table on both runtimes. The rules hold the law;
   the skill holds the method. Briefs and `prompt.sh` name the skill instead of restating the method.
2. **Matrix attack.** A fresh subagent attacks the matrix, never a fork or a resumed agent. It runs once per grant, with at
   most one re-attack. On Claude it is an Opus subagent at default effort. On Codex it is a fresh agent given the same attack
   prompt. A rejected gap needs a counter-proof. The `mdpro-spec-adversary` row of ADR-0138 no longer applies.
3. **Cycles for every implementor item, gated or not.** Each cycle is one matrix case, its RED receipt, the minimal change, a
   small refactor while green inside that cycle, then `verify`. The acceptance check may be recorded RED before the first
   cycle. Unit REDs are never batched. A one-test fix round is one cycle. A refactor too big for one cycle goes to the
   delegator as a separate prefactor item. This replaces rule 71 step 4's "all REDs first", and ADR-0148's refactoring in
   the `code-review` stage. `code-review` still runs on the committed candidate before the handoff.
4. **Matrix amendment.** A case found mid-cycle is marked "added in cycle n" and needs no re-attack. A case that changes what
   an AC means or covers stops for the delegator.
5. **Matt Pocock's skills.** They are not vendored. Each runtime uses its installed plugin, at a minimum of 1.3.1, checked by
   a tooling test.
6. **Codex retires tdd-guardian at go-live,** the landing that points both runtimes' briefs and `prompt.sh` at the skill.
   From then on no mdpro rule, brief, prompt or skill routes either runtime to tdd-guardian. Disabling it in the shared Codex
   install is the user's own step.
7. **Proof on real work.** The delegator confirms the first gated Claude item and the first Codex item after go-live: a
   genuine assertion RED, an attack file and a HELD `verify`. This ADR is accepted before the first of them runs.

## Consequences
- One method text for both runtimes; a change to the method is one edit, and briefs get shorter.
- Rule 10's receipt commands stay where they are; the receipt engine's independence from the plugin depends on #566.
- **Given up:**
  - Codex loses tdd-guardian's coverage and mutation stages. Coverage is the pnpm lanes and CI. Mutation testing is not run
    at all, as it is not on Claude today.
  - The method now lives in a skill that the rules point at. The two can drift, and the contract test checks only names
    and paths, not meaning.
  - There is no gradual rollout: if the skill is wrong, both runtimes go wrong at once. The proof run is after go-live, not
    before.
  - A Matt Pocock plugin upgrade can change `tdd` or `code-review` under the skill. The version check sets a minimum, not
    a pin.
  - Every implementor item is now built in cycles, including the non-gated D items, which costs more receipts per item than
    "all REDs first".
- Dated guides, historical handoffs and the archived `.codex/skills/mdpro-tdd-workflow/` port keep naming the old flow.
  They are records, not instructions.
