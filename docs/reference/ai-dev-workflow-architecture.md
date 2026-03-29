# AI-Augmented Development Workflow — CTO Architecture View

**Date**: 2026-03-21
**Scope**: mdpro — all available commands, agents, skills, and plugins mapped to the full dev loop
**Frame**: Think → Plan → Build → Review → Test → Ship → Reflect

### Source Legend

| Badge | Meaning |
|-------|---------|
| `[mdpro]` | Custom-built for this project — lives in `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, or `.claude/rules/` |
| `[gstack]` | Adapted from [garrytan/gstack](https://github.com/garrytan/gstack) — ported and tailored for mdpro's Tauri/Rust context |
| `[xiaolai]` | From [xiaolai's plugin marketplace](https://github.com/xiaolai/claude-plugin-marketplace) — installed via `claude plugin install` |
| `[global]` | Personal global command in `~/.claude/commands/` — available across all projects |
| `[official]` | From `claude-plugins-official` — Anthropic's own plugin registry |

---

## Executive Summary

We now have three layers of AI tooling stacked on top of each other:

1. **Passive infrastructure** — rules, LSP, hooks, skill context. Always-on. Zero invocation cost.
2. **On-demand tools** — commands and skills invoked explicitly for a specific task.
3. **Orchestrated pipelines** — multi-agent workflows that chain tools together automatically.

The goal is not to use every tool on every task. The goal is to know which tool is the right one for the current stage, and to compose them in a way that eliminates the five biggest sources of wasted cycles in AI-assisted development:

| Waste Pattern | Root Cause | Tool That Kills It | Source |
|---|---|---|---|
| Building the wrong thing | No premise validation | `/office-hours` | `[gstack]` |
| Over-scoped features | No scope discipline | `/plan-ceo-review` | `[gstack]` |
| Test-after habit | No enforcement | `tdd-guardian` hooks | `[xiaolai]` |
| Symptom fixing | No root-cause requirement | `/investigate` | `[gstack]` |
| Repeated mistakes | No institutional memory | `echo-sleuth` | `[xiaolai]` |

---

## The Full Stack (Inventory)

### Always-On (Passive Layer)

These run without invocation. They shape every interaction.

| Tool | What It Does | Source |
|------|-------------|--------|
| Rule 25 — careful-mode | Intercepts destructive bash commands, requires confirmation | `[gstack]` |
| Rule 10 — TDD | Pattern catalog loaded into every build task | `[mdpro]` |
| Rule 30 — review checklist | Pre-landing safety criteria referenced by auditor + ship | `[gstack]` |
| Rule 50 — codebase conventions | Zustand patterns, IPC flow, event naming enforced | `[mdpro]` |
| `tdd-guardian` hooks | Blocks `git commit` / `git push` / `gh pr create` without fresh gate pass | `[xiaolai]` |
| `rust-analyzer-lsp` | Real-time Rust type checking and diagnostics | `[official]` |
| Agent SDK skill | Auto-corrects Claude Agent SDK code when patterns are detected | `[xiaolai]` |
| `claude-hud` | Status line visibility | `[official]` |

### On-Demand Tools (Commands + Skills)

Invoked explicitly for specific tasks.

| Tool | Stage | Purpose | Source |
|------|-------|---------|--------|
| `/office-hours` | Think | YC-style premise challenging, produces design doc | `[gstack]` |
| `/echo-sleuth:recall` | Think / Reflect | Mine past sessions for decisions and mistakes | `[xiaolai]` |
| `/echo-sleuth:lessons` | Think / Reflect | Extract accumulated wisdom from history | `[xiaolai]` |
| `/planning` | Plan | Create structured work items with acceptance criteria | `[mdpro]` |
| `/plan-ceo-review` | Plan | Scope challenge — expand / hold / reduce | `[gstack]` |
| `/gemini-review-plan` | Plan | Gemini external architectural review | `[global]` |
| `/codex-toolkit:review-plan` | Plan | Codex second-model plan review | `[xiaolai]` |
| `/feature-workflow` | Build | Gated 9-agent orchestration from plan to commit | `[mdpro]` |
| `/tdd-guardian:workflow` | Build / Test | Enforced TDD: plan→design→implement→coverage→mutation→review | `[xiaolai]` |
| `/investigate` | Build / Review | Iron Law debugging — root cause required before any fix | `[gstack]` |
| `/fix` | Build | Focused bug fix (use `/investigate` for complex bugs) | `[mdpro]` |
| `/loc-guardian:scan` | Build / Review | Flag files over 300 LOC, suggest extraction strategy | `[xiaolai]` |
| `tauri-app-dev` skill | Build | Tauri 2.0 IPC, events, file dialogs reference | `[mdpro]` |
| `mcp-dev` skill | Build | MCP shadow store, HTTP routes, tool patterns | `[mdpro]` |
| `milkdown-dev` skill | Build | Milkdown plugin system, ProseMirror patterns | `[mdpro]` |
| `/grill:grill` | Review | Deep 5-agent, 4-style architecture interrogation | `[xiaolai]` |
| `/codex-toolkit:audit` | Review | Independent Codex 5 or 9-dimension quality audit | `[xiaolai]` |
| `/codex-toolkit:audit-fix` | Review | Automated audit→fix→verify loop (up to 3 iterations) | `[xiaolai]` |
| `/audit-fix` | Review | Claude-native audit→fix loop | `[mdpro]` |
| `/test-guide` | Test | Manual testing guide for Tauri-specific flows | `[mdpro]` |
| `/ship` | Ship | Full pre-merge pipeline: sync→test→review→bump→commit→push→PR | `[gstack]` |
| `/bump` | Ship | 3-file version bump (package.json, tauri.conf.json, Cargo.toml) | `[mdpro]` |
| `/merge-prs` | Ship | Sequential PR merge with rebase handling | `[mdpro]` |
| `/retro` | Reflect | Git history retrospective: velocity, hotspots, test health | `[gstack]` |
| `/echo-sleuth:timeline` | Reflect | Chronological project evolution combining sessions + git | `[xiaolai]` |

### Orchestrated Agents (Pipeline Layer)

Multi-agent workflows that delegate to specialized personas.
All agents below are `[mdpro]` — custom-built for this project's Tauri/Rust/React stack.

| Agent | Stage | Role |
|-------|-------|------|
| `planner` | Plan | Work item breakdown, dependency mapping |
| `spec-guardian` | Plan | Validates plan against AGENTS.md + rule files |
| `impact-analyst` | Plan | Blast radius, minimal file set, risk edges |
| `implementer` | Build | TDD-first coding, preflight investigation, minimal diffs |
| `test-runner` | Test | Runs `pnpm build && pnpm test:run` + `cargo test` |
| `auditor` | Review | BLOCK/MUST/SHOULD/NOTE findings using rule 30 checklist |
| `manual-test-author` | Test | User-facing QA checklists, E2E scenarios |
| `verifier` | Test | Final gate re-run, acceptance checklist |
| `release-steward` | Ship | Atomic commits per work item, conventional commit format |

---

## Stage-by-Stage Playbook

### THINK — Before Writing a Line

**Goal**: Validate the problem before committing to a solution.

```
1. /echo-sleuth:recall <feature-area>    [xiaolai] → Have we tried this? What went wrong?
2. /office-hours                          [gstack]  → Challenge premises, produce design doc
```

**Primary tool**: `/office-hours` `[gstack]`
**Why**: It forces six questions that expose whether the feature is the right problem to solve. Output is a design doc with an explicit "out of scope" section. No code until the doc is approved.

**Use `/echo-sleuth:recall` `[xiaolai]` first** when the feature area has prior history. Past sessions contain the real reasons decisions were made — not the polished explanation, the actual reason.

**Skip this stage only when**: The task is a bug fix with a clear reproduction path, or a spec-defined work item with zero ambiguity.

---

### PLAN — Architecture Before Keystrokes

**Goal**: Turn a design doc into a testable, bounded implementation plan.

```
1. /planning                             [mdpro]   → Generate work items with acceptance criteria + test targets
2. /plan-ceo-review                      [gstack]  → Scope challenge: expand / hold / reduce?
3. spec-guardian agent                   [mdpro]   → Validate against project rules and AGENTS.md
4. impact-analyst agent                  [mdpro]   → Map minimal file set and blast radius
5. /codex-toolkit:review-plan            [xiaolai] → Codex second-model plan review (for complex features)
6. /gemini-review-plan                   [global]  → Gemini external architectural review (for major changes)
```

**Primary tool**: `/planning` `[mdpro]` + `spec-guardian` `[mdpro]`
**Force multiplier**: `/plan-ceo-review` `[gstack]` — the most underused step. It takes 5 minutes and prevents building a 3-week feature that should have been a 3-day one.

**Dual-model review** (`/codex-toolkit:review-plan` `[xiaolai]` + `/gemini-review-plan` `[global]`): Use both for architectural decisions that are hard to reverse — data model changes, new IPC commands, plugin system changes. One model catches what the other misses.

**The plan must include**:
- Work items with explicit acceptance criteria
- Test targets (what test will prove this works?)
- Explicit "NOT in scope" section
- Rollback notes

---

### BUILD — Implementation With Discipline

**Goal**: Write correct code, test-first, in minimal changesets.

**Standard path (new feature):**
```
/feature-workflow [work-name]                                           [mdpro]
  └── planner → spec-guardian → impact-analyst                         [mdpro]
      → implementer (TDD per work item)                                 [mdpro]
      → test-runner → auditor → manual-test-author → verifier           [mdpro]
      → release-steward                                                 [mdpro]
```

**High-discipline path (quality-critical code):**
```
/tdd-guardian:workflow                                                  [xiaolai]
  └── tdd-planner → tdd-test-designer → tdd-implementer                [xiaolai]
      → tdd-coverage-auditor → tdd-mutation-auditor → tdd-reviewer     [xiaolai]
```

**Use `tdd-guardian:workflow` `[xiaolai]` when**: The code is load-bearing (IPC commands, store actions, file operations) and you want proof — not confidence — that tests catch regressions. Mutation testing will kill your tests if they don't actually assert behavior.

**Bug path:**
```
/investigate <symptom>               [gstack]  → Root cause first, always
  → Write regression test (RED)
  → Fix (GREEN)
  → pnpm test:run
```

**Never use `/fix` `[mdpro]` for bugs that took more than 10 minutes to understand.** `/investigate` `[gstack]` enforces the Iron Law and prevents symptom-chasing.

**Passive enforcement during build:**
- `tdd-guardian` hooks `[xiaolai]` — block `git commit` if no fresh gate pass (120-min window)
- Rule 25 careful-mode `[gstack]` — blocks destructive bash commands
- `rust-analyzer-lsp` `[official]` — flags Rust type errors in real time
- `/loc-guardian:scan` `[xiaolai]` — flags files approaching 300 LOC before they become bloat

**Domain reference during build:**
- Tauri IPC patterns → `tauri-app-dev` skill `[mdpro]`
- MCP shadow store → `mcp-dev` skill `[mdpro]`
- Milkdown plugins → `milkdown-dev` skill `[mdpro]`

---

### REVIEW — Multi-Angle Interrogation

**Goal**: Find what implementation missed. Multiple lenses, not just one.

**Pre-commit review (every PR):**
```
auditor agent          [mdpro]   → Rule 30 checklist [gstack]: BLOCK/MUST/SHOULD/NOTE
/loc-guardian:scan     [xiaolai] → File size compliance
```

**Feature review (new features, post-implementation):**
```
/codex-toolkit:audit   [xiaolai] → Independent Codex 5-dimension quality check
/codex-toolkit:audit-fix [xiaolai] → If issues found: automated fix loop (up to 3x)
/codex-toolkit:verify  [xiaolai] → Verify fixes independently
```

**Architectural review (major changes, periodic health check):**
```
/grill:grill           [xiaolai]
  → choose: Architecture Review | Hard-Nosed Critique | Multi-Perspective Panel | ADR Style
  → add pressure tests: scale stress, principle violations, hidden costs
```

**The 3-model review stack:**

| Model | Tool | Source | Lens |
|-------|------|--------|------|
| Claude | `auditor` + rule 30 | `[mdpro]` + `[gstack]` | Rule compliance, IPC safety, data loss paths |
| Codex (OpenAI) | `/codex-toolkit:audit` | `[xiaolai]` | Independent quality: logic, duplication, security, perf |
| Gemini | `/gemini-review-plan` | `[global]` | Architectural consistency, completeness |

Running all three on a major change gives you the highest confidence signal available without a human reviewer. Each model has different training data and different blind spots — disagreement between them is the most valuable signal.

**Review severity rubric (from rule 30 `[gstack]`):**
- **BLOCK**: Data loss, silent failure, IPC trust violation — never ship past this
- **MUST**: Rule violation, correctness issue — fix in this PR
- **SHOULD**: Test gap, code quality — fix now if cheap
- **NOTE**: Observation only

---

### TEST — Proof, Not Confidence

**Goal**: Prove the code works under the conditions that matter, including conditions that haven't happened yet.

```
test-runner agent           [mdpro]   → pnpm build && pnpm test:run + cargo test
verifier agent              [mdpro]   → Final gate re-run, acceptance checklist
manual-test-author agent    [mdpro]   → User-facing QA scenarios for Tauri-specific flows
/tdd-guardian:workflow      [xiaolai] → Mutation testing to verify test quality
```

**The mutation testing gate** (from `tdd-guardian` `[xiaolai]`) is the most underused power tool in the stack. It systematically introduces small bugs into your code and checks whether your tests catch them. If tests pass with mutations present, the tests are proving nothing. This is the difference between "tests pass" and "tests work."

**Test assertion quality (from `tdd-guardian` `[xiaolai]` rubric):**

| Level | Type | Quality |
|-------|------|---------|
| 1-3 | Output / side-effect / real integration | Best |
| 4-5 | State verification + mock with output check | Good |
| 6 | Mock call arguments only | Weak |
| 7 | Mock invocation only | **Rejected** |

Tests that only verify mocks were called (Level 7) are rejected by `tdd-guardian`. They waste coverage budget without providing safety.

**For Tauri-specific flows** (file open/save, menu events, drag-drop): Use `manual-test-author` `[mdpro]` to generate a QA checklist. These can't be unit-tested — they require the actual Tauri window. Document the exact steps so they can be reproduced reliably.

---

### SHIP — Automated Pre-Merge Pipeline

**Goal**: Get from "code done" to "PR open" without manual steps, missed gates, or version drift.

```
/ship [patch|minor|major]                                               [gstack]
  ├── Step 1: Branch check (refuse to ship from master)
  ├── Step 2: Sync with master (merge origin/master)
  ├── Step 3: pnpm build && pnpm test:run + cargo test
  ├── Step 4: Rule 30 pre-landing review [gstack] (fix BLOCKs, collect SHOULDs)
  ├── Step 5: /bump [patch|minor|major] [mdpro] (updates all 3 files per rule 40 [mdpro])
  ├── Step 6: Update CHANGELOG.md
  ├── Step 7: git commit (type(scope): summary + Co-Authored-By)
  ├── Step 8: git push + gh pr create
  └── Step 9: Sync docs if IPC/shortcuts changed
```

**Escalation gates** (always ask user):
- MINOR or MAJOR version bumps
- BLOCK findings from rule 30 `[gstack]`
- Logic-level merge conflicts
- Diff > 500 lines

**The key insight**: `/ship` `[gstack]` is not a shortcut — it's a checklist enforcer. Every step it runs is a step that would otherwise be skipped under time pressure. The value is not speed; it's completeness.

---

### REFLECT — Institutional Memory

**Goal**: Extract learning from the work and store it where it can be retrieved.

```
Weekly:
/retro [7d|14d|30d]                     [gstack]  → Commits, velocity, hotspots, test health, wins/improvements

After a complex feature:
/echo-sleuth:lessons [feature-area]     [xiaolai] → What worked, what didn't, what to do differently

After a major decision:
Memory system (auto-saved)              [mdpro]   → Non-obvious learnings, validated approaches, things to avoid

Periodic (monthly):
/grill:grill                            [xiaolai] → Codebase health check, architectural drift detection
/echo-sleuth:timeline                   [xiaolai] → Full project chronology
```

**The two-tier memory model:**

| Layer | Tool | Source | Retention | Best For |
|-------|------|--------|-----------|---------|
| Session history | `echo-sleuth` | `[xiaolai]` | Full conversation context | Decisions, mistakes, "why we did X" |
| Persistent memory | Memory system (`/memory/`) | `[mdpro]` | Cross-session notes | Non-obvious patterns, validated approaches, feedback |

`echo-sleuth` `[xiaolai]` mines the raw record. The memory system `[mdpro]` stores the distilled lessons. Together they prevent the knowledge loss that makes every session feel like starting from scratch.

---

## Decision Tree: Which Tool for Which Situation?

```
Starting a new feature?
  └─ Has this area had problems before?
      ├─ YES → /echo-sleuth:recall [xiaolai] first, then /office-hours [gstack]
      └─ NO  → /office-hours [gstack] directly

Have a plan. Is it over a week of work?
  └─ YES → /plan-ceo-review [gstack] before /feature-workflow [mdpro]
  └─ NO  → /planning [mdpro] + spec-guardian [mdpro], then /feature-workflow [mdpro]

Implementing. Hit a bug.
  └─ Understand root cause in < 10 min?
      ├─ YES → /fix [mdpro]
      └─ NO  → /investigate [gstack] (Iron Law)

Implementation done. What review?
  └─ Routine feature   → auditor [mdpro] + /codex-toolkit:audit [xiaolai]
  └─ New IPC / data model → + /grill:grill [xiaolai]
  └─ Major architectural change → all three + /gemini-review-plan [global]

About to commit.
  └─ tdd-guardian hook [xiaolai] will check → do gates pass?
      ├─ YES → /ship [gstack]
      └─ NO  → fix failures first, re-run /tdd-guardian:workflow [xiaolai]

End of week.
  └─ /retro [gstack] + /echo-sleuth:lessons [xiaolai]
     → update memory [mdpro] if anything non-obvious learned
```

---

## The "Claude Teams" Operating Mode

Anthropic's internal teams reportedly operate with multi-agent loops where Claude writes code, a second instance reviews it, a third runs tests, and the loop is automated. The closest approximation with our current stack:

### Fast Loop (daily work)
```
/feature-workflow [work-name]    [mdpro]
```
Single command orchestrates 9 `[mdpro]` agents from plan to commit. The human's job: provide the goal, review agent outputs at each gate, approve commits.

### Quality Loop (critical changes)
```
/office-hours                    [gstack]  → Premise validation
/planning → /plan-ceo-review     [mdpro] + [gstack]  → Right-sized plan
/tdd-guardian:workflow           [xiaolai] → TDD with mutation proof
/codex-toolkit:audit             [xiaolai] → Second model review
/ship                            [gstack]  → Automated pipeline
```

### Architecture Loop (periodic, major refactors)
```
/echo-sleuth:timeline            [xiaolai] → Where have we been?
/grill:grill                     [xiaolai] → Where are we now?
/plan-ceo-review                 [gstack]  → Where should we go?
/gemini-review-plan              [global]  → External sanity check
```

### The Multiplier Principle

The force multiplier isn't any single tool — it's the **parallel agent execution** inside pipelines. `grill` `[xiaolai]` runs 5 agents simultaneously. `tdd-guardian:workflow` `[xiaolai]` runs 6 agents sequentially with hard gates. `feature-workflow` `[mdpro]` runs 9 agents with human checkpoints.

A solo developer running these pipelines gets coverage equivalent to a 3-person team doing sequential review. The ceiling is how fast you can process agent outputs and make decisions at the gates.

---

## What We Deliberately Don't Use

| Skipped Tool | Source | Reason |
|---|---|---|
| `/qa` / `/browse` | `[gstack]` | Browser automation doesn't apply to Tauri desktop app |
| `/plan-eng-review` | `[gstack]` | Overlaps with `planner` + `impact-analyst` + `spec-guardian` `[mdpro]` |
| `/design-review` / `/design-consultation` | `[gstack]` | No DESIGN.md or design system in mdpro |
| `/codex` | `[gstack]` | Duplicate of `codex-toolkit` `[xiaolai]` |
| `/document-release` | `[gstack]` | Rule 20 `[mdpro]` handles doc sync inline per commit |
| `agent-sdk-dev` plugin | `[official]` | Not building Agent SDK apps in mdpro |
| `docs-guardian` plugin | `[xiaolai]` | Rules 20 + 22 `[mdpro]` handle this |

---

## Tool Composition Matrix

| Stage | Must Run | Should Run | Optional (high-value) |
|-------|----------|------------|----------------------|
| Think | — | `/office-hours` `[gstack]` | `/echo-sleuth:recall` `[xiaolai]` |
| Plan | `/planning` `[mdpro]` + `spec-guardian` `[mdpro]` | `/plan-ceo-review` `[gstack]` | `/codex-toolkit:review-plan` `[xiaolai]`, `/gemini-review-plan` `[global]` |
| Build | `implementer` `[mdpro]` (TDD) | `/feature-workflow` `[mdpro]` | `/tdd-guardian:workflow` `[xiaolai]` (quality-critical) |
| Review | `auditor` `[mdpro]` (rule 30 `[gstack]`) | `/codex-toolkit:audit` `[xiaolai]` | `/grill:grill` `[xiaolai]` (major changes) |
| Test | `test-runner` `[mdpro]` + `verifier` `[mdpro]` | `tdd-guardian` hooks `[xiaolai]` | mutation testing pass `[xiaolai]` |
| Ship | `/ship` `[gstack]` | — | `/merge-prs` `[mdpro]` (multi-PR) |
| Reflect | `/retro` `[gstack]` (weekly) | `/echo-sleuth:lessons` `[xiaolai]` | `/grill:grill` `[xiaolai]` (monthly health) |

---

## Source Distribution Summary

| Source | Count | What It Contributes |
|--------|-------|---------------------|
| `[mdpro]` | 9 agents + 7 commands + 3 skills + 5 rules | Domain expertise — Tauri/Rust/React specifics, TDD patterns, codebase conventions |
| `[xiaolai]` | 5 plugins (grill, tdd-guardian, codex-toolkit, echo-sleuth, loc-guardian) + agent SDK skill | Quality enforcement, multi-model review, conversation memory, LOC control |
| `[gstack]` | 5 commands + 2 rules | Workflow discipline — premise validation, scope control, Iron Law debugging, ship pipeline |
| `[global]` | 1 command (gemini-review-plan) | External Gemini review for plans |
| `[official]` | rust-analyzer-lsp, claude-hud | IDE-grade Rust diagnostics, status visibility |
