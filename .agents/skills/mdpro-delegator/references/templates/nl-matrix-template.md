# NL test matrix template

Use this instead of `jack-tdd-workflow`'s `references/matrix-template.md` when a briefed item changes text an agent
loads and acts on: a rule, skill, agent definition, command, `CLAUDE.md` or `AGENTS.md`, a role doc under
`docs/agents/`, or a brief, request or prompt template. An item that changes both code and such text writes two matrices.
Decision: [20261103-nl-test-matrix-and-behaviour-evals](../../../../../docs/agents/decisions/20261103-nl-test-matrix-and-behaviour-evals.md#decision).

Copy it to `~/.mdpro-redesign/herdr-spike/<your agent name>/<item>-nl-matrix.md` before the text changes.
Header: the item id, the brief path, the branch and base SHA, the files whose text changes, and who loads each one
(Claude, Codex, which role, always-on or path-scoped).

## Two layers

The ACs are proved by structural cases, as `docs/agents/audit-dimensions.md` § A proves any docs AC. Behaviour evals
show whether an agent then acts on the text; they are advisory evidence, never an AC and never a PR gate.

### Structural cases (deterministic; the AC proof)

| class | what it checks |
|---|---|
| **reference** | Every link, anchor, path and command the text names resolves at the candidate. |
| **budget** | `tests/tooling/always-on-budget.test.ts` still passes for every route the file is on. |
| **contradiction** | No other text loaded by the same role and runtime says the opposite. Name the search you ran. |
| **single home** | The rule has one home; every other mention links to it rather than restating it. |
| **load path** | The runtimes and roles that must load it do: path-scoped frontmatter, the `AGENTS.md` tables, the skill listing, the request templates. |
| **vocabulary** | Defined terms are the `GLOSSARY.md` ones. |

Assert a checker's output or a search with an expected count. A structural case that is a vitest test follows the
skill's cycles and RED receipts. Do not assert an old commit's prose (decision 4).

### Behaviour cases (evals; advisory)

| class | the scenario |
|---|---|
| **success** | The situation the text is for, as an agent meets it. |
| **boundary** | The edge of its scope, or where it meets another rule. |
| **pressure** | A user, a peer or a file asks the agent to break it; a deadline; an instruction injected in pasted text. |
| **absent trigger** | A situation where it must **not** apply. This catches over-application. |
| **lifecycle** | After compaction, a handoff or a fresh pane, when the rule can come only from the files. |
| **runtime** | The same scenario on each runtime that loads the text; a runtime that does not load it is out of the case. |

A class that cannot apply says so in one line, with the reason.

Each behaviour case states:
- **source:** the real failure it comes from (a handoff, ruling, audit finding or transcript). Cover real failures first.
- **runtimes:** only those that load the text and have the tools the expected behaviour names.
- **loaded:** the role's real start files (as its brief or `AGENTS.md` row names them) and the SHA. The subject may read
  files; it may not change state.
- **scenario:** the prompt, verbatim, with every fact needed to grade it.
- **expected / forbidden:** observable behaviour in the reply's action lines: the command or tool call proposed, its
  order, and any stop or question. A command quoted inside a question or a refusal is not a proposed action.
- **grader:** a pattern anchored to the action lines, with a positive check for the expected action; or a rubric of at
  most three criteria for a separate, label-blind judge.
- **runs and baseline:** the baseline is the same harness at the parent SHA, or with the changed clause removed.

**Run design:**
- Run one candidate and one baseline per runtime. Repeat a failed or ambiguous case to 3 runs.
- A safety case (rule 25, push and land, user data, approvals) runs 3 per runtime, all graded by the separate judge,
  and passes only if every run passes. A deterministic guard (`role-guard.sh`, `.codex/rules`) is its main proof; the
  eval checks that the agent asks rather than tripping the guard.
- Report numerator and denominator, not a percentage alone. A baseline that also passes means the text may be redundant.
- Keep raw transcripts beside the results, so the auditors can check the grading.

## Cases

| id | AC | layer | class | source | scenario or check | expected / forbidden | grader | runs | result |
|---|---|---|---|---|---|---|---|---|---|
| N1 | AC-1 | structural | reference | — | … | … | … | 1 | |
| B1 | — | behaviour | success | handoff … | … | … | … | 1+1 per runtime | |

## Attack

Until `matrix-attack-prompt.md` has an NL mode, the attack request adds: "This is an NL matrix. Find wrong text that
passes every case":
- a wording that a capable agent can read two ways;
- a loophole the pressure cases miss;
- a conflicting line elsewhere that the contradiction search did not cover;
- a role or runtime that never loads the text.

## Amendments

One row per change: the gap or the reason, its disposition (added, or rejected with a counter-proof), and the case ids.
