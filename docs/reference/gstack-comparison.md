# gstack vs. mdpro Claude Config — Workflow Comparison

**Date**: 2026-03-21
**gstack source**: https://github.com/garrytan/gstack
**Workflow frame**: Think → Plan → Build → Review → Test → Ship → Reflect

---

## TL;DR

| Stage | mdpro Coverage | gstack Coverage | Gap |
|-------|---------------|-----------------|-----|
| Think | Weak (prompt-enhance only) | Strong (`/office-hours`) | ❌ No premise-challenging |
| Plan | Strong (planner + spec-guardian) | Strong (3 review lenses) | ⚠️ Missing CEO/design lenses |
| Build | Strong (TDD + domain skills) | Moderate (flows from planning) | ✅ We're ahead here |
| Review | Moderate (auditor + code-review) | Strong (`/review` + `/investigate`) | ❌ No pre-landing checklist |
| Test | Moderate (test-runner + manual guide) | Strong (`/qa` browser) | ❌ No real-browser QA |
| Ship | Partial (`/bump` + release-steward) | Strong (`/ship` full pipeline) | ❌ Manual vs. automated |
| Reflect | ❌ None | Moderate (`/retro`) | ❌ No retrospectives |

---

## Stage-by-Stage Analysis

### 1. THINK

**What we have:**
- `/prompt-enhance` (global) — turns vague ideas into structured prompts
- `/gemini-review-plan` (global) — external second opinion on plans

**What gstack has:**
- `/office-hours` — YC partner persona. Six forcing questions that challenge premises before any code is written. Produces a design doc, not code. Enforces "interest ≠ demand" discipline.

**Gap:** We go straight to planning. No one challenges whether the feature is the right problem to solve, or whether the approach has hidden assumptions.

**Recommendation:** `/office-hours` is the most unique skill in gstack and has no equivalent here. Worth importing for new feature ideation sessions.

---

### 2. PLAN

**What we have:**
- `planner` agent — work item breakdown, architecture mapping
- `spec-guardian` agent — validates plans against AGENTS.md and project rules
- `impact-analyst` agent — file dependency mapping, blast radius
- `/planning` skill — creates `docs/plans/*.md` with test-first discipline
- `/gemini-review-plan` (global) — external review via Gemini

**What gstack has:**
- `/plan-ceo-review` — CEO/founder lens: 4 modes (Expand, Selective Expand, Hold, Reduce). "Find the 10-star product in the request."
- `/plan-eng-review` — Engineering Manager: locks architecture, data flow diagrams, edge cases, test strategy before any code starts
- `/plan-design-review` — Designer: rates 10 dimensions 0–10, detects AI inconsistency
- `/design-consultation` — Full design system from scratch with mockups and creative risk

**Gap:** Our planning is technically solid but single-lens (engineering). We lack strategic (is this the right scope?) and design (does this look good?) perspectives.

**Recommendation:** `/plan-ceo-review` is worth adapting as a lightweight "scope check" step in `/feature-workflow`. `/plan-eng-review` overlaps heavily with our existing planner + impact-analyst combination.

---

### 3. BUILD

**What we have:**
- `implementer` agent — TDD-first coding, reads before editing, minimal diffs
- `/fix` command — root-cause bug fixing
- `/fix-issue` command — GitHub issue → fix pipeline
- `/feature-workflow` — gated multi-agent orchestration: planner → spec-check → impact → implement → test → audit → verify → release
- Domain skills: `tauri-app-dev`, `mcp-dev`, `milkdown-dev` — project-specific reference
- Rules: `10-tdd.md` (RED→GREEN→REFACTOR), `50-codebase-conventions.md`

**What gstack has:**
- No dedicated build-phase skill. Build flows from planning docs.

**Verdict:** ✅ We are ahead. Our TDD rules, pattern catalog, and domain-specific skills give more structure than gstack provides here. gstack assumes the implementer reads the design doc and figures it out.

---

### 4. REVIEW

**What we have:**
- `auditor` agent — logic, duplication, dead code, rule compliance
- `/code-review-agent` (global) — general code review
- `/audit-fix` command — audit → fix loop

**What gstack has:**
- `/review` — Pre-landing diff review with structured checklists:
  - Critical pass: SQL safety, LLM trust boundaries, race conditions, enum completeness
  - Informational pass: side effects, magic numbers, dead code, test gaps
  - Auto-fixes mechanical issues; escalates judgment calls
  - "Boil the Lake" philosophy — completeness is cheap with AI
- `/investigate` — Iron Law debugging: **NO FIXES WITHOUT ROOT CAUSE FIRST**
  - 5-phase: gather symptoms → scope lock → pattern match → hypothesis test → fix + verify
  - 3-strike escalation rule
  - Mandatory regression test for every fix
- `/design-review` — Designer-Coder audits UI against design system

**Gap:** Our `auditor` checks rule compliance but has no production-safety checklist (SQL injection, race conditions, LLM boundaries). Our `/fix` command allows fixing without enforcing root-cause investigation first.

**Recommendation:**
- `/investigate` is worth importing as-is. The Iron Law + 3-strike rule prevents the symptom-chasing pattern our current `/fix` doesn't block.
- `/review` checklist categories (SQL safety, LLM boundaries, race conditions) should be added to our `auditor` agent's rule file.

---

### 5. TEST

**What we have:**
- `test-runner` agent — runs `pnpm test:run` and `cargo test`
- `verifier` agent — re-runs gates, final acceptance checklist
- `manual-test-author` agent — writes QA checklists and end-to-end guides
- `/test-guide` skill — manual testing guide for mdpro

**What gstack has:**
- `/qa` — QA Lead opens real Chromium, clicks through the app, finds bugs, fixes them, auto-generates regression tests
- `/qa-only` — Same methodology but report-only (no code changes)
- `/browse` — Headless Chromium automation (`$B <command>` syntax, ~100ms/command)
- `/setup-browser-cookies` — Imports cookies from Chrome/Arc/Brave/Edge for authenticated testing

**Gap:** We have no browser automation. Our QA is manual (documented checklists) or unit tests. For a Tauri app, browser automation inside the WebView would require different tooling anyway.

**Verdict:** gstack's `/qa` is designed for web apps. For mdpro (a Tauri desktop app), the browser automation approach doesn't map cleanly — our WebView is not addressable as a standalone browser URL. Our `test-guide` + `manual-test-author` approach is more appropriate for this platform.

---

### 6. SHIP

**What we have:**
- `/bump` command — updates 3 version files, commits, tags, pushes
- `release-steward` agent — atomic commits, one commit per work item
- `/release-gate` skill — runs VMark quality gates (lint/test/build)
- `/gh-pr` (global skill) — creates PRs

**What gstack has:**
- `/ship` — Fully automated pre-merge pipeline:
  - Branch detection → merge base → run tests → pre-landing review
  - Auto-bumps MICRO/PATCH; asks only for MINOR/MAJOR
  - Generates CHANGELOG from commit history + diff
  - Creates bisectable logical commits
  - Marks completed TODOs
  - Generates missing test coverage
  - Runs design review (lite) for frontend changes
  - Opens PR with full summary
  - Triggers `/document-release` to sync docs post-merge
- `/document-release` — Technical Writer syncs docs after each ship

**Gap:** Our ship process is multi-command and partially manual. `/ship` automates everything from "code done" to "PR open" including changelog generation and doc sync — steps we currently skip or do manually.

**Recommendation:** High-value adaptation target. The core loop (`merge base → test → review → bump → commit → push → PR`) maps directly to mdpro's workflow. Could adapt `/ship` to use our 3-file version bump rule and CLAUDE.md commit format.

---

### 7. REFLECT

**What we have:**
- Nothing.

**What gstack has:**
- `/retro` — Engineering Manager runs weekly retrospective:
  - Per-contributor breakdowns
  - Shipping streaks
  - Test health trends over time
  - Structured action items

**Verdict:** Low priority for a solo project but useful if the project grows. Could be adapted as a monthly `/retro` over git log.

---

## gstack Utilities — Cross-Stage

| Skill | What It Does | mdpro Equivalent | Verdict |
|-------|-------------|------------------|---------|
| `/careful` | Warns before destructive ops (rm -rf, DROP TABLE, force-push) | None | ⚠️ Worth importing |
| `/freeze` | Locks edits to one directory during debugging | None | ⚠️ Useful in complex debug sessions |
| `/guard` | `/careful` + `/freeze` combined | None | ⚠️ Useful |
| `/unfreeze` | Removes freeze boundary | — | Paired with above |
| `/codex` | Second opinion via OpenAI Codex; three modes: review, adversarial, consultation | `oracle` skill (global) | ⚠️ Overlap — we have `oracle` |
| `/gstack-upgrade` | Self-updates gstack installation | None | N/A |

---

## Conflict Analysis

### Hard Conflicts (would need resolution before importing)

| Conflict | Our Side | gstack Side | Resolution |
|----------|---------|-------------|------------|
| `CLAUDE.md` | Project-specific with Tauri/Rust rules, logging standards, IPC patterns | gstack's own CLAUDE.md with different conventions | Keep ours; don't import gstack's CLAUDE.md |
| `AGENTS.md` | Multi-agent personas (auditor, implementer, planner, etc.) | 7 gstack specialist personas | Merge carefully — our agents are more task-granular |
| `/ship` vs `/bump` + `release-steward` | `/bump` requires explicit version; `release-steward` does atomic commits per work item | `/ship` auto-bumps micro/patch, generates changelog, opens PR in one flow | If importing `/ship`, wrap it to use our 3-file bump rule and commit format |
| `/investigate` vs `/fix` | `/fix` is flexible, allows fixing without full root-cause protocol | Iron Law: no fix without root cause investigation | If importing `/investigate`, deprecate `/fix` or redirect to `/investigate` |

### Soft Conflicts (behavioral friction, not breakage)

| Conflict | Description |
|----------|-------------|
| Review philosophy | Our `auditor` checks rule compliance; `/review` checks production safety. Running both could produce duplicate or contradictory findings. |
| Commit granularity | gstack `/ship` creates "bisectable logical commits" (infrastructure → models → controllers). Our CLAUDE.md splits by architectural layer (backend → services → stores → hooks → components). Different ordering. |
| Version bump triggers | gstack asks only for MINOR/MAJOR bumps. Our `/bump` is always explicit. A merged `/ship` needs an override for our versioning rule. |
| `/codex` vs `oracle` | Both provide second-opinion reviews via external models. Running both wastes tokens and could give contradictory advice. |

### No Conflict (safe to import)

- `/office-hours` — no equivalent, pure addition
- `/careful` / `/freeze` / `/guard` — no equivalent, pure addition
- `/retro` — no equivalent, pure addition
- `/plan-ceo-review` — complements our existing planning (different lens)
- `/review` checklist categories — can be added to `auditor` agent rules without conflict

---

## Recommendation Matrix

### Option A: Cherry-Pick (Recommended for mdpro)

Import only the skills that fill genuine gaps without conflicting:

| Priority | gstack Skill | Integration Approach |
|----------|-------------|---------------------|
| 🔴 High | `/investigate` | Add as new command. Consider redirecting `/fix` to it for complex bugs. |
| 🔴 High | `/careful` | Add globally. Prevents accidental destructive ops. |
| 🟡 Medium | `/office-hours` | Add as global skill for new feature ideation. Keep out of automated workflows. |
| 🟡 Medium | `/ship` | Adapt, not adopt. Replace auto-bump logic with our 3-file bump rule. Wrap to enforce our commit format. |
| 🟡 Medium | `/review` checklist | Extract SQL safety / race condition / LLM boundary categories into `auditor` agent rules — don't import the full skill. |
| 🟢 Low | `/plan-ceo-review` | Optional. Useful for big new features to pressure-test scope. |
| 🟢 Low | `/retro` | Optional. Adapt for solo dev as monthly git-log retrospective. |
| ⚪ Skip | `/qa` / `/browse` | Browser automation doesn't apply to Tauri desktop app architecture. |
| ⚪ Skip | `/plan-eng-review` | Overlaps with existing planner + impact-analyst + spec-guardian combination. |
| ⚪ Skip | `/design-review` / `/design-consultation` | No DESIGN.md or design system in mdpro. |
| ⚪ Skip | `/codex` | We have `oracle` skill. Avoid dual second-opinion tools. |
| ⚪ Skip | `/document-release` | Our `20-logging-and-docs.md` rule handles this inline per commit. |
| ⚪ Skip | `AGENTS.md`, `CLAUDE.md` | Ours is more specific to Tauri/Rust. Would be a downgrade. |

### Option B: Import All gstack

**Pros:**
- Full Think→Plan→Build→Review→Test→Ship→Reflect coverage
- Battle-tested workflow from a production-focused team
- `/ship` alone would save significant manual effort

**Cons:**
- Hard conflicts in `CLAUDE.md`, `AGENTS.md`, version bump logic
- Many skills (browser QA, design review, Supabase references) are web-app-centric, not Tauri
- Adds ~20 commands to the namespace, most unused for a macOS desktop app
- `/ship`'s auto-merge and changelog behavior could conflict with our atomic commit by layer convention

**Verdict:** Over-engineered for a solo-dev macOS app. Cherry-pick is the right call.

---

## What We Do Better Than gstack

It's worth noting where mdpro's config exceeds gstack's defaults:

| Area | mdpro Advantage |
|------|----------------|
| TDD discipline | `10-tdd.md` has 5 pattern catalogs (stores, hooks, plugins, utils, components) with anti-pattern table. gstack assumes TDD but doesn't specify patterns. |
| Domain knowledge | `tauri-app-dev`, `mcp-dev`, `milkdown-dev` provide in-context reference that prevents looking up docs mid-task. |
| Codebase conventions | `50-codebase-conventions.md` captures undocumented patterns (Zustand destructuring rule, IPC 3-layer flow, event naming). gstack has no equivalent. |
| Structured logging | Mandatory logging for every new feature with JSONL format and event naming convention. gstack has no logging standard. |
| Spec-driven development | `spec-guardian` agent validates work against specs before implementation starts. gstack plans → builds without a spec validation gate. |
| Atomic commits by layer | CLAUDE.md defines splitting strategy (backend → services → stores → hooks → components). gstack splits by logical type but doesn't specify layer ordering. |
| Multi-agent orchestration | `/feature-workflow` provides gated pipeline with 8 specialized agents. gstack's workflow is more sequential and persona-based. |

---

## Integration Status (2026-03-21)

All cherry-picked items have been integrated into `.claude/`:

| Item | Status | File |
|------|--------|------|
| `/investigate` (High) | ✅ Done | `.claude/commands/investigate.md` |
| `/careful` guardrails (High) | ✅ Done | `.claude/rules/25-careful-mode.md` |
| `/ship` adapted (Medium) | ✅ Done | `.claude/commands/ship.md` |
| `/review` checklist (Medium) | ✅ Done | `.claude/rules/30-review-checklist.md` |
| Auditor updated (Medium) | ✅ Done | `.claude/agents/auditor.md` — now references rule 30 |
| `/office-hours` (Medium) | ✅ Done | `.claude/commands/office-hours.md` |
| `/plan-ceo-review` (Low) | ✅ Done | `.claude/commands/plan-ceo-review.md` |
| `/retro` (Low) | ✅ Done | `.claude/commands/retro.md` |

### Key Adaptations Made

- **`/investigate`**: Iron Law preserved; failure patterns updated for mdpro (IPC contract mismatch, file watcher, Zustand stale closure, encoding errors).
- **`/careful`**: Implemented as a permanent always-on rule (rule 25) rather than session-scoped hook. Safe exceptions include `target/` (Rust build artifacts).
- **`/ship`**: Auto-bump replaced with `/bump` command call (our 3-file rule 40 procedure). Commit format enforces our `type(scope): summary + Co-Authored-By` convention. Rust gate added.
- **`/review` checklist (rule 30)**: Web/SQL patterns removed; replaced with IPC trust boundaries, MCP handler validation, file watcher race conditions, and Tauri-specific data loss paths.
- **`/office-hours`**: Reads `specs/` and `docs/guide/` for mdpro context. Escape hatch added. Removed YC application closing (not relevant for solo dev tool).
- **`/plan-ceo-review`**: Simplified to solo-dev scope. Added mdpro-specific review dimensions (IPC, encoding edge cases, logging).
- **`/retro`**: Runs `pnpm test:run` and `cargo test`. No team breakdown (solo dev). Churn analysis retained.
