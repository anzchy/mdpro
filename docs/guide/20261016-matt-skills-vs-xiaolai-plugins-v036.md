# Matt Pocock's skills vs xiaolai's plugins, worked through v0.3.6

**Asked by the user (2026-10-16):** 「那以v0.3.6的典型功能 为例，看看如何将 Matt的Skill和
/tdd-guardian 等Xiaolai中的Skill充分组合起来，或者是否全部用Matt的Skill就可以，写一个 md文档，
保存到 @docs/guide/ ，其中要包括Matt 全部Workflow和 xiaolai's marketplace的plugin全部对比
（除了tdd-guardian, xiaolai marketplace还有其他plugin或者Skill）」

**Written by:** mdpro-a6, researched on master `75d06a14`, rebased onto `56d824b1`. Revised on
`5f63d71e` after a Codex review (`/cc-suite:review-plan`, verdict NEEDS REVISION: 3 High, 21
Medium/Low); every finding was checked against the sources before it was applied. Every claim
about a skill or plugin cites the file it was read from. Short prefixes are used for paths:

| Prefix | Path |
|---|---|
| `M/` | `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.3/skills/` |
| `X/` | `~/.claude/plugins/cache/xiaolai/` (installed plugin versions) |
| `MK` | `~/.claude/plugins/marketplaces/xiaolai/.claude-plugin/marketplace.json` (18 plugins, marketplace checkout `67641be`, 2026-10-05) |
| `IP` | `~/.claude/plugins/installed_plugins.json` (what is installed, where) |

Related guides; this one links to them rather than repeating them:

- [xiaolai-claude-plugins-and-skills-tutorial.md](xiaolai-claude-plugins-and-skills-tutorial.md): the
  earlier five-plugin tutorial (grill, tdd-guardian, codex-toolkit, echo-sleuth, loc-guardian).
- [20260321-gtasck-xiaolai-dev-workflow.md](20260321-gtasck-xiaolai-dev-workflow.md): gstack combined with xiaolai.
- `20261009-multi-session-tdd-device-workflow.md`: the rule 70 loop with tdd-guardian and dtrack
  (in the main checkout's working tree, not yet committed).
- [gstack-workflow-guide.md](gstack-workflow-guide.md): `/office-hours`, `/plan-eng-review`, `/qa-only` and the rest.

---

## 1. Short answer

**Matt's skills alone are not enough for mdpro. Combine the two sets, and let mdpro's own rules decide
where each one plugs in.**

- **Matt covers the front of the work well**: the interview, a throwaway prototype, a spec with user
  stories and seams, and a vertical-slice ticket breakdown. His `/prototype` is already
  mdpro's standard for every UI question (rule 30, rule 70 § Questions and approvals).
- **Matt has no evidence layer.** His `/implement` is ten lines: "use /tdd where possible … run
  the full test suite once at the end … use /code-review … commit" (`M/engineering/implement/SKILL.md`).
  Nothing records that a test was red before it went green, nothing gates coverage or
  mutation, and the review is a same-model Standards + Spec pass (`M/engineering/code-review/SKILL.md`).
- **xiaolai supplies the evidence; mdpro's own gates enforce it**:
  - tdd-guardian's red receipts, lane gates, coverage and mutation audits, and spec strength S1–S6
    (`X/tdd-guardian/0.10.2/README.md:16-18`, `:189-196`). The receipts and lanes are real, but
    receipts are opt-in evidence: a missing one reports `NOT-RECORDED`, "not a failure"
    (`README.md:18`, `commands/implement.md:71`). And our config turns its blocking hooks off:
    `enforceOnTaskCompleted`, `blockCommitWithoutFreshGate` and `requireMutation` are all `false`
    in `.claude/tdd-guardian/config.json`;
  - cc-suite's cross-model Codex review (`/cc-suite:review-plan`, `/cc-suite:audit --mini`), which
    mdpro's landing rule depends on (rule 70 item 4, ADR-0085).
  - **The enforcement is mdpro's**: `mdpro-landing-verifier` re-runs the lanes and checks the
    receipts, the `audit --mini` must count zero Critical and zero High, and `ci-gate` must be green
    on the PR head (rule 70 item 2, ADR-0095). tdd-guardian produces what those gates read.
- **Matt assumes an issue tracker that mdpro does not use.** `/to-spec`, `/to-tickets`, `/triage` and
  `/wayfinder` publish to the tracker that `/setup-matt-pocock-skills` configures
  (`M/engineering/to-spec/SKILL.md`, `M/engineering/to-tickets/SKILL.md` § 5). mdpro's tracker is the
  D and WI rows of [the sequencing doc](../plans/20260912-frontend-backend-sequencing-order.md),
  numbered by the delegator. So use Matt's *templates*, not his *publishing*.

---

## 2. Matt's workflow map

Source: `M/engineering/ask-matt/SKILL.md` (the router) and `M/engineering/ask-matt/PHASE-BOUNDARIES.md`.

### 2.1 Main flow: idea → ship

```
/grill-with-docs ──(question needs a runnable answer?)──► /handoff → /prototype → /handoff back
      │
      ├─ multi-session build ─► /to-spec ─► /to-tickets ─► per ticket: /implement (then /clear)
      └─ single session ──────────────────────────────────► /implement
                                                   /implement = /tdd slices + /code-review + commit
```

- `/grill-with-docs` calls the two skills `grilling` and `domain-modeling`
  (`M/engineering/grill-with-docs/SKILL.md`), and leaves `CONTEXT.md` (a glossary of domain
  terms, not a decision log) and ADRs behind.
- **Context hygiene:** keep grilling → spec → tickets in one unbroken window. Each `/implement`
  starts fresh from its ticket. Don't push past the ~150k-token "smart zone" (`ask-matt/SKILL.md`
  § Context hygiene).

### 2.2 On-ramps

| On-ramp | When | Merges at | Source |
|---|---|---|---|
| `/triage` | Raw incoming issues you didn't create; never tickets from `/to-tickets` | `/implement` | `M/engineering/triage/SKILL.md` |
| `/diagnosing-bugs` | A hard bug: one that resists a first look, flakes, or regressed. No theory before a red feedback loop | Fix + regression test; may hand off to `/improve-codebase-architecture` | `M/engineering/diagnosing-bugs/SKILL.md` |
| `/wayfinder` | A foggy effort too big for one session; produces decision tickets, not code | `/to-spec` | `M/engineering/wayfinder/SKILL.md` |

### 2.3 Phase boundaries

At a boundary, the first **yes** wins (`PHASE-BOUNDARIES.md` § The tree):

1. **Continue**: the next phase needs this one as a primary source, and it still fits in the
   smart zone (~150k tokens is the source's approximate size, not a hard count).
2. **`/clear`**: the context is irrelevant to what comes next.
3. **`/handoff`**: only for a new harness, a new directory, a colleague, or forking a side task.
4. **Subagent**: the task can run AFK, e.g. an automated review.
5. **`/compact`**: the default, at the bottom.

**mdpro mapping.** mdpro's version of 3 and 5 is rule 70 § Session rotation. A hook counts
compactions, and at 5 or 10 the session writes `~/.mdpro-redesign/handoff/<alias>-<ts>.md`
(the local `mdpro-handoff` skill), then `/clear` in place or a new session. That is Matt's
tree with a hard trigger added. Matt's question 4 (subagent for AFK work) matches the global
CLAUDE.md orchestration rule ("delegate only when it clearly pays").

### 2.4 Every Matt skill, and whether mdpro uses it

`manual` = `disable-model-invocation: true` (only reachable by typing it). "Used" means named
in a rule or a standing workflow; "mentioned" means it appears only in plans or reference docs.

| Skill | Bucket | Inv. | What it does (from its SKILL.md) | In mdpro |
|---|---|---|---|---|
| ask-matt | engineering | manual | Router over the skills and flows | No |
| grill-with-docs | engineering | manual | grilling + domain-modeling; writes CONTEXT.md and ADRs | Mentioned. mdpro's ADR rules (CLAUDE.md § ADR) are stricter than `domain-modeling/ADR-FORMAT.md` |
| prototype | engineering | model | Throwaway code for one design question: LOGIC.md (one HTML state demo) or UI.md (variants on one route, URL-param switch); kept on a `prototype/<name>` branch | **Yes**, rules 30 and 70; 11 `prototype/*` branches, e.g. `prototype/d260-settings-rail` |
| to-spec | engineering | manual | Synthesise the thread into a spec: Problem, Solution, **User Stories**, Implementation and **Testing Decisions**, Out of Scope; seams agreed first; publishes to the tracker | Mentioned. Borrow the template (§ 6) |
| to-tickets | engineering | manual | Tracer-bullet vertical slices with blocking edges; expand–contract for wide refactors; quiz the user; publish | Mentioned. Overlaps tdd-guardian:plan |
| implement | engineering | manual | /tdd at agreed seams, full suite once, /code-review, commit | No. tdd-guardian:workflow replaces it |
| tdd | engineering | model | Red → green, one vertical slice per cycle, tests only at pre-agreed seams; anti-patterns (implementation-coupled, tautological, horizontal slicing) | Partly matches rule 10. Matt's seams are confirmed with the user and refactor sits outside the loop; rule 10 is RED → GREEN → REFACTOR. mdpro's rules win; the driver is tdd-guardian |
| code-review | engineering | model | Two parallel subagents: Standards (+ Fowler smell baseline) and Spec, against a fixed point | No. The landing gate is cc-suite audit; usable as an extra self-review |
| diagnosing-bugs | engineering | model | Feedback loop → minimise → hypothesise → instrument → fix → regression test | No (0 references). A good fit for flakes like D254, but its Phase 5 accepts "no correct seam" as a finding (`SKILL.md:116-120`); rule 10 still requires a regression test |
| triage | engineering | manual | State machine of triage roles, agent-ready briefs | No. Conflicts with D-number registration |
| wayfinder | engineering | manual | A map of decision tickets for efforts too big for one session | No. mdpro's equivalent is a plan doc with § 0 decisions |
| improve-codebase-architecture | engineering | manual | Find deepening opportunities, HTML report, grill the chosen one | No |
| codebase-design | engineering | model | Deep-module vocabulary: module, interface, depth, seam, adapter, leverage, locality | No; useful with rule 50 § 6 (300-line extraction) |
| domain-modeling | engineering | model | Sharpen domain terms, CONTEXT.md, ADRs | Mentioned |
| research | engineering | model | Background agent, primary sources, a cited Markdown file | No. mdpro uses `docs/reference/` by hand |
| resolving-merge-conflicts | engineering | model | Resolve by intent hunk by hunk; never `--abort` | No. mdpro rebases have scripted receipts and sequencing-row rules |
| wizard | engineering | model | Interactive bash script for steps only a human can do | No |
| setup-matt-pocock-skills | engineering | manual | Configure issue tracker, triage labels, doc layout | Mentioned; not run |
| grill-me | productivity | manual | Stateless grilling | No |
| grilling | productivity | model | The interview primitive | No |
| handoff | productivity | manual | Compact the thread into a handoff file | Mentioned. mdpro uses `mdpro-handoff` (rule 70) |
| teach | productivity | manual | Multi-session teaching workspace | No |
| to-questionnaire | productivity | manual | A questionnaire for the person who holds the answer | No |
| wait-what | productivity | manual | Re-pitch a message that didn't land | No |
| writing-for-agents | productivity | model | How to write skills, AGENTS.md, CLAUDE.md | No. nlpm scores the same artifacts |
| git-guardrails-claude-code | misc (source present; not exposed in `plugin.json`) | model | Hooks that block push, reset --hard, etc. | No. mdpro has `role-guard.sh` and rule 25 |
| setup-pre-commit | misc (not exposed) | model | Husky + lint-staged + typecheck + tests | No |
| migrate-to-shoehorn, scaffold-exercises | misc (not exposed) | model | TS test-data and course tooling | No |
| claude-handoff, implement-spec, loop-me, pr, retro, setup-ts-deep-modules, writing-beats/-fragments/-shape | in-progress | mostly manual | Beta, not shipped in the plugin (`M/in-progress/README.md`) | No |

---

## 3. Every xiaolai plugin

Commands, agents and hooks are read from each installed version's `commands/`, `agents/`,
`skills/` and `hooks/hooks.json`. Shared partials (`codex-call`, `scope-parse`, `load-config` and
the like) are left out. Plugins that are not installed are described from `MK` and the
marketplace `README.md`; their command lists are **not verified from package contents**.

**A hook in `hooks.json` is not a hook that fires.** Several are gated by config:

- tdd-guardian's `pretool_guard.js` and `taskcompleted_gate.js` block only when
  `blockCommitWithoutFreshGate` / `enforceOnTaskCompleted` are on (`pretool_guard.js:116`,
  `taskcompleted_gate.js:380`); both are `false` in `.claude/tdd-guardian/config.json`.
- docs-guardian's `commit-guard.js` reads `hookStrictness` from `.claude/docs-guardian/config.json`
  (`scripts/docs-guardian/commit-guard.js:14`). mdpro's file sets `strictness: "warn"`, a different key,
  but no `hookStrictness`, so the hook defaults to `off`.
- cc-suite's Stop hook is an opt-in review gate (`config.stopReviewGate`, set through `/cc-suite:setup`).

**Status in mdpro**, from `IP` and the `enabledPlugins` in `~/.claude/settings.json` (user) and
`.claude/settings.json` (project):

- **Enabled**: cc-suite, nlpm, docs-guardian and rich-terminal (user scope); tdd-guardian and
  echo-sleuth (project scope). Enabled is not the same as required: only cc-suite's audit and
  tdd-guardian are named in a rule.
- **Installed elsewhere only**: ui-tokenize, ui-responsive and mac-it-guy-pro.
- **Disabled**: claude-english-buddy.

| Plugin (installed / marketplace) | Commands | Agents · hooks | In mdpro |
|---|---|---|---|
| **cc-suite** 2.3.5 / 2.3.5 | `audit [--full\|--mini]` (9 or 5 dimensions), `audit-fix`, `audit-{agent,command,nlp,plugin,rules,skill}`, `verify`, `review-plan`, `implement` (Codex runs a plan, then offers to commit), `bug-analyze`, `continue`, `result`, `status`, `cancel`; setup `codex-preflight`, `setup` (the opt-in Stop review gate), `migrate-google`, `refresh-knowledge`; bridges `init`, `bridge-{hooks,mcp,skills,tools}`, `sync-mcp`, `repair`, `update`, `unbridge`, `sweep`, `diagnose`; other CLIs `agy`, `grok`, `qwen-review` and their preflights; advisor agents `add-agent`, `list-agents`, `remove-agent` | 13 skills (`claude-plan`, `claude-review`, `claude-debug`, …) · hooks SessionStart, SessionEnd, Stop (`stop-review-gate-hook.mjs`, opt-in) | **Used daily**: `audit --mini` is the landing gate (rule 70 item 4); `review-plan` reviewed the menu plan (plan § 9) |
| **tdd-guardian** 0.10.2 / 0.10.2 | `workflow` (plan → design-tests with adversarial attack → implement per WI with red receipts → audit-coverage → audit-mutation → review; halts on any gate failure), `plan`, `design-tests`, `implement`, `gate`, `audit-coverage`, `audit-mutation`, `review`, `status`, `probe`, `init` | 7 agents: planner, test-designer, spec-adversary, implementer, coverage-auditor, mutation-auditor, reviewer · 7 skills · hooks PreToolUse Bash (`pretool_guard.js`), TaskCompleted (`taskcompleted_gate.js`), both non-blocking under our config | **Used for every WI** (global CLAUDE.md § TDD Guardian; rule 10). Lanes are in `.claude/tdd-guardian/config.json`; receipts in `receipts.json`. `workflow` never commits (`commands/workflow.md:16`) |
| **echo-sleuth** 0.4.4 / 0.4.4 | `recall [--lite]`, `recap`, `timeline`, `lessons`, `extract`, `audit`, `prune`, `dashboard` | recall, analyze, file-historian, memory-auditor, schema-scout; 4 skills | Enabled (project scope); named in 5 docs, used ad hoc to recover past decisions |
| **docs-guardian** 0.3.0 / 0.3.0 | `audit`, `coverage`, `generate`, `init` | staleness-detector, accuracy-checker, coverage-scanner, quality-rater, doc-writer · 13 skills · hook PreToolUse Bash (`commit-guard.js`, `off` here: no `hookStrictness` set) | Enabled (user scope); not mandated by any rule. `pnpm ledger:check` does the repo-specific part |
| **nlpm** 1.4.3 / 1.4.3 | `score`, `check`, `fix`, `test`, `ls`, `report`, `trend`, `security-scan`, `spec-sync`, `vocab-init`, `vocab-drift`, `init` | scorer, checker, scanner, tester, vague-scanner, vocab-drift-scanner, security-scanner, spec-researcher (scorer and checker default to sonnet, vague-scanner to haiku) · 17 skills · hook PostToolUse Write/Edit (`check-artifact.sh`) | Enabled (user scope); 0 references in rules. Fits edits to `.claude/rules/` and skills |
| **ui-tokenize** 0.4.6 / 0.4.6 | `audit`, `fix`, `catalog`, `propose`, `review`, `metrics`, `init` | token-reviewer · hooks SessionStart, PreToolUse (rewrite-first), PostToolUse | **Not installed here** (reader3-pro only). mdpro has its own token gate: rule 31 and the "untokenized literal" test (CHANGELOG 0.3.4) |
| **ui-responsive** 0.1.4 / 0.1.4 | `audit [--strict]`, `catalog`, `init` | hooks SessionStart, PostToolUse (advisory only) | Not installed. Low value: mdpro has one breakpoint (960px in `src/styles/sections/responsive.css`, imported by `index.css`), so there is little for it to coach |
| **rich-terminal** 1.0.0 / 1.0.0 | `/rich list`, `/rich open`, `/rich on\|off`, `/rich status [setup\|check\|<action>]` (Mermaid in replies, status line) | hook modules | Enabled (user scope); cosmetic |
| **english-buddy** 0.7.0 installed as `claude-english-buddy` / 0.8.0 | `review`, `drill`, `mistakes`, `preview`, `stats`, `today`, `config` | 4 agents (no skills) · hooks UserPromptSubmit, SessionEnd | Disabled |
| **mac-it-guy-pro** 1.9.1 / 1.9.6 | `checkup`, `fix`, `cleanup`, `backup`, `network`, `organize`, `automate`, `toolbox`, `learn`, `profile`, `onboard`, `open-internet` | diagnostician, janitor, librarian, toolsmith · 7 skills · hooks PreToolUse, SessionStart | Not here (omarchy only); unrelated to dev work |
| **codex-toolkit** 0.7.4 / (gone from `MK`) | The Codex half of cc-suite over MCP, 16 commands: `audit`, `audit-fix`, `audit-{agent,command,nlp,plugin,rules,skill}`, `verify`, `review-plan`, `implement`, `bug-analyze`, `continue`, `init`, `preflight`, `refresh-knowledge` | cross-validator · 1 skill | Legacy; superseded by cc-suite. Not here |
| **loc-guardian** — / 0.4.2 | Per-file pure-LOC limits via tokei, extraction plans, `--check` for CI | — | Not installed. Overlaps rule 50 § 6 (300 lines) |
| **grill** — / 1.4.0 | Codebase interrogation: three-finding quick review by default, full multi-agent review, 5 styles, 8 pressure tests | — | Not installed. **Not** Matt's grill: it reviews code; Matt's interviews the user |
| **reason-grill** — / 0.4.0 | Argument interrogation, adversarial panel | — | Not installed |
| **north-star** — / 0.1.5 | A 260-token system prompt against RLHF presumptions | — | Not installed |
| **eou-foundry** — / 0.8.4 | Governance for "Executable Operating Units", 12 skills | — | Not installed |
| **bureau** — / 1.0.6 | Sessions → human-reviewed knowledge base with trust tiers, MADR ADR pages | — | Not installed. Overlaps mdpro's `docs/adr/` and Q&A doc |
| **xros** — / 0.3.4 | Research OS: `compile`, `sharpen`, `run`, `reason`; "no verification, no claim" | — | Not installed. Overlaps Matt `/research` |
| **compute-ladder** — / 0.2.0 | Effort routing and a cheap-model worker | — | Not installed. mdpro pins Opus everywhere (rule 70) |

---

## 4. Head to head, stage by stage: the proposed combination

This section is a **proposal**, not current practice; the rules quoted in each row are what
binds today. "mdpro's own" names the rule, skill, agent or hook in this repo that already owns
the stage.

| Stage | Matt | xiaolai | mdpro's own | Winner here, and why |
|---|---|---|---|---|
| Idea / interview | `/grill-with-docs`, `/grill-me` | (grill reviews code, not ideas) | gstack `/office-hours`; the delegator's AskUserQuestion | **Matt** for a new feature's shape; decisions go to a numbered ADR. Questions inside the skill go through the delegator for an implementor (rule 70) |
| Research | `/research` | xros (not installed) | `docs/reference/` by hand | **Matt** `/research`, writing into `docs/reference/` |
| Prototype | `/prototype` (UI.md variants) | — | rules 30/70: every UI question is a prototype on `prototype/<id>-<slug>` | **Matt**, already standard |
| Spec / plan | `/to-spec` template | `tdd-guardian:plan` (WIs + acceptance) | `docs/plans/` with § 0 decisions; gstack `/plan-eng-review`; `planning` skill | **mdpro's plan doc**, borrowing to-spec's User Stories and Testing Decisions (seams) |
| Plan review | — | **`/cc-suite:review-plan`** (Codex) | `plan-audit` skill | **xiaolai**: cross-model; the menu plan got 26 findings this way (plan § 9) |
| Decomposition | `/to-tickets` (vertical slices, blocking edges, expand–contract) | `tdd-guardian:plan` | WI table with an explicit order (menu plan § 6) | **Overlap.** Use to-tickets' slicing *rules* in the plan's WI table; don't publish tickets |
| Test design | `/tdd` seams, anti-patterns | **`tdd-guardian:design-tests` + spec-adversary**, S1–S6 | rule 10 test matrix | **xiaolai**: the adversary attacks the matrix before any code exists |
| Implement | `/implement` | **`tdd-guardian:workflow` / `:implement`**; `cc-suite:implement` (Codex writes code) | rule 70 implementor sessions | **tdd-guardian**. Never stack it with Matt `/implement` or `cc-suite:implement` on one item (see § 6 for why) |
| Gates | "full suite once at the end" | red receipts, `gate`, `audit-coverage`, `audit-mutation`: evidence, with blocking hooks off in our config | **`mdpro-landing-verifier`** (lanes + receipts), **`audit --mini` C0/H0**, **`ci-gate`** (ADR-0095); `heavy-lock.sh`; `receipt-rustfmt-guard.sh`; `ledger:check` | **mdpro enforces, xiaolai supplies the evidence**. Matt has no gate |
| Code review / audit | `/code-review` (same model, Standards + Spec) | **`/cc-suite:audit --mini`** (Codex), `verify`, `tdd-guardian:review` | `mdpro-landing-verifier`; rule 60 checklist | **xiaolai** is the gate (C0/H0). Matt's review is an optional pre-handoff pass |
| Bug diagnosis | **`/diagnosing-bugs`** | `cc-suite:bug-analyze` (Codex RCA) | `progress.md` post-mortems | **Matt** for the loop, cc-suite for a second opinion. Override Phase 5: rule 10 requires a regression test that fails without the fix, so "no correct seam" means build the seam (or record the user's deferral), and the fix itself goes through tdd-guardian. The D row records it |
| Docs and NL artifacts | `writing-for-agents` | **nlpm** (score/check), docs-guardian, cc-suite `audit-rules` / `audit-skill` | rule 22 (comments), ledger gate | **xiaolai**: measurable; Matt's is a style reference |
| UI tokens | — | ui-tokenize (not installed) | rule 31; the untokenized-literal test; DESIGN.md | **mdpro's own.** Don't add a rewrite-first hook on top of an existing gate |
| Memory and recall | — | **echo-sleuth** | `docs/reference/user-question-and-answer.md`, ADRs, `progress.md` | **echo-sleuth** to find; the repo docs to keep |
| Handoff | `/handoff`, phase tree | — | `mdpro-handoff`, `mdpro-pause/resume`, session-size hook (rule 70) | **mdpro's own**, with Matt's phase tree as the thinking aid |

**Overlaps to watch:**

- **Matt `grill-with-docs` vs xiaolai `grill`.** Same word, different jobs: an interview of the
  user vs a review of the code. They don't overlap in practice.
- **Matt `/implement` vs `cc-suite:implement` vs `tdd-guardian:implement`.** These are three
  different implementers. Pick one per item: tdd-guardian.
- **Matt `/to-tickets` vs `tdd-guardian:plan`.** Both decompose work. Keep `tdd-guardian:plan` for
  WIs and receipts, and apply to-tickets' slicing rules while writing the plan.
- **Matt `/code-review` vs `cc-suite:audit`.** The second is the gate; the first is optional.

**From a plan WI to tdd-guardian.** `tdd-guardian:implement` reads `### WI-N:` headings from the
latest `.claude/tdd-guardian/plan-*.md` and its `tests-*.md`, not from `docs/plans/`. The adapter:

1. The delegator grants the WI and its file scope (rule 70 § When a session is idle).
2. `/tdd-guardian:plan` on that WI, keeping the plan's own WI ids in the generated headings.
3. `/tdd-guardian:design-tests`, then `/tdd-guardian:implement <ID>`.
4. Receipt ids carry the prefix (`D260-WI-1`, never a bare `WI-1`; rule 70 § Reserving numbers).

**Gaps neither set fills:** device checks (dtrack briefs, `remote-windows-device-test`), the
multi-session landing protocol, and the feature ledger. All three are mdpro's own.

---

## 5. v0.3.6 walkthroughs

### 5.1 D260: Settings rail icons, no footer Close

Row: [D260](../plans/20260912-frontend-backend-sequencing-order.md#d260). Prototype branch:
`prototype/d260-settings-rail` (`e7e9da62` three options, `42b09e41` variant D, `218c86f7` the
verdict "D VMark-style outline rail").

| # | Step | Who | Command / tool | Rule |
|---|---|---|---|---|
| 1 | Register D260, quote the user, assign | delegator | — (row edit, docs commit) | rule 70 § How work is assigned |
| 2 | Build the options | implementor (mdpro-a3) | `/mattpocock-skills:prototype` → UI.md branch: variants A–C, then D, switchable on one page; worktree `mdpro-wt/`, branch `prototype/d260-settings-rail` | rules 30, 70 § Questions (prototype, never prose) |
| 3 | The user picks | delegator asks | AskUserQuestion on the running prototype | rule 70: only the user's quoted words count |
| 4 | Record the verdict on the prototype branch | implementor | commit (`218c86f7`); the branch never lands | prototype SKILL rule 6; rule 70 |
| 5 | Fold into the design | implementor (mdpro-a3), landed by the delegator | `docs/design/mdpro-ui-new/DESIGN.md` § Settings dialog and § Icons, prototype HTML as `prototypes/d260-settings-rail.html` (done: `56d824b1`) | CLAUDE.md § Design System |
| 6 | ADR if a convention changes | delegator (number) + author | an ADR only if outline → solid; verdict D kept outline, so "no ADR; three rail exceptions in DESIGN.md" | CLAUDE.md § ADR |
| 7 | Plan the implementation | implementor | the existing plan P WI-4.2 row; add to-spec-style **Testing Decisions** (seams: the rail's ARIA tree, the dialog's close paths) | — |
| 8 | Implement | implementor | `/tdd-guardian:workflow` (or `:implement` per WI), receipt `D260-WI-n` | rule 10; global CLAUDE.md |
| 9 | Pre-handoff gates | implementor | rule 60 self-review; full unit lane + `typecheck:tests` + build under `scripts/heavy-lock.sh`; the D260 row and the ledger row rewritten **in the behaviour commit**; `pnpm ledger:check`, and `pnpm ledger:build` when the ledger markdown changed | rules 10, 60; CLAUDE.md § Feature Ledger, § Plan Status Tracking |
| 10 | Land | delegator | `mdpro-landing-verifier` ∥ the auditor's `/cc-suite:audit --mini` on `<parent>..<sha>` (needs C0/H0) ∥ push the SHA as the PR head → `ci-gate` green on that head. All three hold → `git merge --ff-only <sha>`, then `git push origin master` | rule 70 item 2, 4; ADR-0085, ADR-0095 |
| 11 | Device check | real-device-tester | a dtrack brief in a UI batch; both themes; focus ring per rule 33 | rule 70 § Device-check batches |

Matt's skills are used at steps 2 and 7 (template only). Everything from step 8 on is xiaolai plus mdpro.

### 5.2 The menu reorganisation + D255 (incl. the ⌘F find popup)

Plan: [20261015-plan-menu-reorganisation.md](../plans/20261015-plan-menu-reorganisation.md).
Its § 0 records the decisions: D1 layout, D2 VMark keys, D3 disabled items, D7 merged with
[D255](../plans/20260912-frontend-backend-sequencing-order.md#d255). The order is in § 6:
**M2 (spike) → M0 (ADR) → M1a → M3 → M1b → M4 ∥ M5 → M6 → M7**.

| # | Step | Command / tool | Notes |
|---|---|---|---|
| 1 | Shape the question | (done) the plan's comparison § 4 + user decisions § 0 | `/grill-with-docs` would have produced the same § 0. mdpro asks through the delegator instead |
| 2 | Review the plan | `/cc-suite:review-plan` (Codex) → triage → revise | Done: NEEDS REVISION, 26 findings (plan § 9; the plan quotes a `--full` flag, but `review-plan` takes only `[plan-file] [--background \| --wait]`). Next: the scoped re-review |
| 3 | Menu layout options | `/mattpocock-skills:prototype` | `prototype/menu-ui` (`3da26338`, three options) |
| 4 | ⌘F find popup | `/mattpocock-skills:prototype`, UI branch; the user picks | Needed by D255 (D7: "new UI … goes to the user"). Its own `prototype/` branch |
| 5 | Spike M2 | throwaway `spike/menu-m2` branch; device runs on both platforms | Never landed. It decides K3, C10 and C16. **The spike's native build and the device runs decide the actual ⌥⌘Q routing**; a Matt `/prototype` LOGIC page can only explain the intended routing model, since it runs in a browser, not in the native menu |
| 6 | ADR (M0) | delegator reserves the number; written after M2's record | Supersedes clauses of ADR-0096 and ADR-0090 by name, and ADR-0031 step 4 decision D-b (what an empty `""` shortcut means, and the default repair), as plan § 6 row M0 lists |
| 7 | Slice the WIs | the plan's § 6 table, checked against to-tickets' rules | Each WI is "coherent on its own" (§ 6): a vertical slice in Matt's sense; M1a is the "expand" of an expand–contract |
| 8 | Each WI | `/tdd-guardian:workflow` through the adapter in § 4; receipts `D255-WI-n` or the plan's prefix from the delegator | One worktree per WI (rule 70); rule 50 § 6 extraction commit first where a file is over 300 lines; the sequencing and ledger rows change in the behaviour commit, as 5.1 step 9 |
| 9 | Land each WI | verifier ∥ `audit --mini` ∥ `ci-gate` → ff-only → push | As 5.1 step 10 |
| 10 | Device checks | dtrack batch "menu bar" (macOS) and `remote-windows-device-test` (`menuclick`, `menus.txt`) | Plan § 6.1: the evidence follows each item's route |

Where Matt would differ: he would publish M0–M7 as tickets with blocking edges and run
`/implement` per ticket with `/clear` between. In mdpro the sequencing row and the plan's WI
table already hold the edges, and the delegator hands out one WI at a time.

---

## 6. Recommendations

**Adopt:**

1. **Matt's `/prototype` for every UI question**, as now. Its LOGIC branch can explain an intended
   state model to the user (e.g. M2's routing table) before a spike exists, but it decides nothing
   about native behaviour: the M2 spike's native build and device runs decide actual ⌥⌘Q routing.
2. **to-spec's sections in module plans.** Add a **User Stories** list and a **Testing Decisions**
   section that names the seams to the plan template, before the WI table. tdd-guardian's
   test-designer then has seams to work from (`M/engineering/to-spec/SKILL.md` step 2;
   `M/engineering/tdd/SKILL.md` § Seams).
3. **to-tickets' slicing rules when writing a WI table.** Use vertical slices, prefactor first,
   and expand–contract for wide renames (`M/engineering/to-tickets/SKILL.md` § 3).
4. **`/diagnosing-bugs` for flakes and regressions** (e.g. D254), with one override: its Phase 5
   lets "no correct seam" stand as a finding (`SKILL.md:116-120`), but rule 10 requires a
   regression test that fails without the fix. Build the seam, or get the user's deferral quoted
   in the D row; then fix through tdd-guardian. Record the feedback-loop command in the D row.
5. **Matt's phase tree** when deciding between continuing, `/clear` and a handoff. Rule 70's
   hook still sets the hard limit.
6. **nlpm `score` / `check`** on edits to `.claude/rules/` and local skills. It is enabled and
   unused. Its scorer and checker agents default to sonnet and its vague-scanner to haiku, so
   either pass `model: "opus"` when dispatching them (rule 70) or run the shipped `bin/nlpm-check`.

**Skip:**

- `/setup-matt-pocock-skills`, `/triage`, `/to-tickets` publishing and `/wayfinder`'s
  tracker map. They create a second backlog beside the D/WI rows and the delegator's numbering
  (rule 70 § Reserving numbers).
- ui-tokenize and ui-responsive in mdpro: rule 31's tests already gate tokens, and the app has
  a single 960px breakpoint, too little for a coaching hook to earn its noise.
- codex-toolkit: superseded by cc-suite.
- compute-ladder: rule 70 pins Opus.

**Don't stack:**

- **Matt `/implement`, `cc-suite:implement` and `tdd-guardian:workflow` on the same item.** Not
  because all three commit: `tdd-guardian:workflow` never does (`commands/workflow.md:16`), Matt's
  `/implement` does, and `cc-suite:implement` offers to. The reasons are:
  - **scope ownership**: each one plans and edits files on its own terms, inside one granted scope;
  - **duplicated orchestration**: two loops each decide when the suite runs and when the item is done;
  - **evidence continuity**: a receipt records a red that only its own loop saw, so code another
    loop wrote reaches green with no red on record.
- **Matt `/code-review` in place of `cc-suite:audit --mini`.** It is same-model and has no
  severity line; the landing gate reads C/H counts (rule 70 item 4).
- **`grill-with-docs`' ADRs next to mdpro's ADR rules.** If you use it, point its ADR output at
  `docs/adr/` with a number from the delegator, in mdpro's ADR shape. Its `CONTEXT.md` is a
  glossary, not a decision record; if one is kept, it needs a chosen home (e.g. `docs/reference/`)
  rather than the repo root, and decisions still go to ADRs.
- **Matt's question routing inside an implementor.** Matt's skills ask the user directly; in an
  implementor session every such question goes to the delegator by `SendMessage` (rule 70 §
  Questions and approvals).

---

## 7. Sources

- Matt Pocock skills 1.2.3:
  - `M/engineering/ask-matt/SKILL.md`, `PHASE-BOUNDARIES.md`;
  - `M/engineering/{implement,to-spec,to-tickets,tdd,code-review,prototype,grill-with-docs,triage,wayfinder,diagnosing-bugs}/SKILL.md`;
  - `M/{engineering,productivity,misc,in-progress,deprecated}/README.md`.
- xiaolai:
  - `X/cc-suite/2.3.5/commands/*.md` (incl. `audit.md`: 9 or 5 dimensions);
  - `X/tdd-guardian/0.10.2/{commands/workflow.md,commands/implement.md,README.md}`;
  - `X/cc-suite/2.3.5/commands/{implement,setup,review-plan}.md`; `X/nlpm/1.4.3/{agents,bin}/`;
  - `X/<plugin>/<version>/hooks/hooks.json`;
  - `MK`, and the marketplace `README.md` beside it.
- Installation state: `IP`, `~/.claude/settings.json` and `.claude/settings.json` (`enabledPlugins`).
- Hook activation: `.claude/tdd-guardian/config.json`, `.claude/docs-guardian/config.json`,
  `X/docs-guardian/0.3.0/scripts/docs-guardian/commit-guard.js:14`.
- mdpro:
  - rules 10, 25, 30, 50, 60 and 70 under `.claude/rules/`; ADR-0031, ADR-0085, ADR-0095;
  - `src/styles/sections/responsive.css`;
  - [sequencing doc](../plans/20260912-frontend-backend-sequencing-order.md) rows D255 and D260;
  - [menu plan](../plans/20261015-plan-menu-reorganisation.md) § 0, § 6 and § 9;
  - branches `prototype/d260-settings-rail` (`218c86f7`) and `prototype/menu-ui` (`3da26338`).
