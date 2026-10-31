# 0161. Implementors on both runtimes follow one project skill, jack-tdd-workflow, and Codex retires tdd-guardian at its go-live

**Status**: Proposed (2026-10-31). Spec [#568](https://github.com/anzchy/mdpro/issues/568); tickets #569–#571; snapshot
`docs/specs/567-tdd-skill/r2/` (r1 superseded after plan review round 1). Grill answers: round 1 「是」; round 2 「Q9 用`jack-tdd-workflow` 作为name，其他的同意」;
round 3 「Q5 Matt的Skill有codex版本,已经安装了，check一下.其他问题是」; round 4 「上面问题回答：是」; round 5 「Q15-Q16 agree」. After the
grill: 「codex 的tdd-guardian 在jack-tdd-workflow 上线之后就retire」. After plan review round 1 (2026-10-31): Codex attacker
「Same as Claude」; mid-item matrix change 「Split by kind (Recommended)」; cycle order 「Verify, then refactor (Recommended)」;
version gate 「prompt.sh + local test (Recommended)」. If accepted, this partially supersedes
[ADR-0148](0148-new-features-pass-grill-spec-and-tickets-before-implementation.md):
- decision 7's "Matrix and attack first" clause, where it names tdd-guardian's test-designer and spec-adversary;
- decision 7's "Step 4 becomes `tdd` cycles" clause: its cycle steps, and its sentence "a changed seam or behaviour is
  re-attacked before its cycle";
- decision 7's "Review" clause (refactoring in the `code-review` stage);
- decision 7's "Runtimes" clause (vendored copies for Codex, and Codex keeping tdd-guardian until a validated cycle);
- the Status line's scoping of the rule 71 step 4 replacement to gated items, widened here to every implementor item.

ADR-0148's Context line "Codex has no Matt Pocock plugin" is stale (it described the time) and is noted below, not
superseded. For both runtimes this also supersedes:
- [ADR-0138](0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md)'s `mdpro-spec-adversary` row
  of decision 2, and decision 5's sentence that re-dispatches `mdpro-spec-adversary` on `gpt-6-astra` high after the pilot;
- [ADR-0139](0139-routine-implementor-items-run-on-gpt-6-luna-high-as-a-pilot.md) decision 3, where routine items keep
  `mdpro-spec-adversary-std`.

[ADR-0133](0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md)'s
fresh-context guarantee for the adversary is kept: the attacker is still a fresh agent.

## Context
- **#564 turned tdd-guardian off for Claude.** Its two parts that mattered, the independent matrix attack (added 2026-10-20
  after three missed-case Highs) and RED receipts, are now mdpro's own. The method is spread across rule 10, rule 12,
  rule 71 § Briefs (with separate Claude and Codex variants), the brief template, `prompt.sh` and a standalone attack
  prompt. fable-auditor's carried Medium on #564: ADR-0148 decision 7 and ADR-0138 still name the plugin for Claude.
- **Codex still runs tdd-guardian**, so one brief means two procedures.
- **Codex now has Matt Pocock's skills.** `mattpocock-skills` 1.3.2 is installed and enabled for Codex; Claude has 1.3.1.
  The `SKILL.md` files of `tdd`, `diagnosing-bugs` and `codebase-design` are byte-identical across the two. `code-review`'s
  `SKILL.md` differs: 1.3.2 adds "start every sub-agent with a fresh context window". ADR-0148's "Codex has no Matt Pocock
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
2. **Matrix attack.** A fresh subagent attacks the matrix, never a fork or a resumed agent, given the skill's attack prompt,
   the brief and the matrix file. It runs once per grant, with at most one re-attack. On Claude it is an Opus subagent at
   default effort; on Codex it is a fresh Codex agent at its default model and effort. A rejected gap needs a counter-proof.
   No effort or model routing by difficulty applies to the attacker, and the `.codex/agents/mdpro-spec-adversary*` agents
   are removed.
3. **Cycles for every implementor item, gated or not.** Each cycle is one matrix case: its RED receipt `<ID>-S<n>`, the
   minimal change, `verify`, then a small refactor with tests green. A cycle has one intended assertion and records one
   `--test` file. The acceptance check, a single exit-condition test, may be recorded RED as `<ID>-ACC` before the first
   cycle and is verified when the last cycle settles. Unit REDs are never batched. A one-test fix round is one cycle. A refactor too big for one cycle goes to the
   delegator as a separate prefactor item. This replaces rule 71 step 4's "all REDs first", and ADR-0148's refactoring in
   the `code-review` stage. `code-review` still runs on the committed candidate before the handoff.
4. **Matrix amendment.** A new case inside an existing seam and AC is marked "added in cycle n" and needs no re-attack. A new
   seam, a changed behaviour, or a case that changes what an AC means or covers stops for the delegator, who decides
   whether a re-attack runs (still at most one per grant). Rule 12's new-seam stop stands.
5. **Matt Pocock's skills.** They are not vendored. Each runtime uses its installed plugin, at a minimum of 1.3.1. One
   version function enforces the minimum in three places:
   - `prompt.sh` runs it on the target runtime's installed cache before it sends a brief, and refuses to send (fail
     closed) on a missing, old or malformed install;
   - a macOS-only tooling case runs it on both real caches;
   - CI runs it on fixture caches.

   Each brief keeps its pin of the skill version.
6. **Codex retires tdd-guardian at go-live,** the landing that points both runtimes' briefs and `prompt.sh` at the skill.
   From then on no mdpro rule, brief, prompt or skill routes either runtime to tdd-guardian. Disabling it in the shared Codex
   install is the user's own step.
7. **Proof on real work.** The delegator holds the first gated Claude grant until both 0.3.6 and go-live have landed. It then
   confirms that item, and the first Codex item after go-live that runs a full matrix. It looks for:
   - a genuine assertion RED;
   - an attack file from a fresh dispatch;
   - a HELD `verify`;
   - receipts showing each cycle settled before the next.

   It records them as audit-log rows in a docs-only commit. This is a process check, not an ADR-0144 `device` AC. This ADR
   is accepted before the first of these items runs.

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
    a pin, and `prompt.sh` now refuses to send a brief where the install is missing or below it.
  - Codex loses the difficulty-routed `gpt-6-astra` adversary on hard items; its attacker runs at its default model and
    effort, like Claude's.
  - Every implementor item is now built in cycles, including the non-gated D items, which costs more receipts per item than
    "all REDs first".
- Dated guides, historical handoffs and the archived `.codex/skills/mdpro-tdd-workflow/` port keep naming the old flow.
  They are records, not instructions.
