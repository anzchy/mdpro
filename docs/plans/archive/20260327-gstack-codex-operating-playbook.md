# mdpro GStack + Codex Operating Playbook (End-to-End Order)

**Date:** 2026-03-27  
**Project:** `mdpro` (React + TypeScript + Tauri + Rust)  
**Workflow:** Think → Plan → Build → Review → Test → Ship → Reflect

This playbook is organized in strict delivery order so you can run gstack skills the same way every sprint.

## 0. Preflight (Run Once Per Environment)

Before stage work, confirm gstack is healthy in this repo.

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.agents/skills/gstack
bun run build
./setup --host codex
```

Verify:

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro
test -x .agents/skills/gstack/browse/dist/browse && echo "browse ok"
find .agents/skills -maxdepth 1 -type l -name 'gstack-*' | /usr/bin/wc -l
```

Expected:

1. `browse ok`
2. gstack symlink count in high-20s (current: 27)

How to invoke skills in Codex:

1. Use explicit skill names, for example `gstack-office-hours`, `gstack-review`, `gstack-ship`.
2. Prefer prompts like `Use gstack-investigate for this bug` instead of assuming slash commands.

---

## 1. Think

### Objective

Validate user pain and pick the narrowest wedge before architecture work starts.

### Primary Skill

1. `gstack-office-hours`

### When to Enter This Stage

1. New feature request.
2. Unclear problem framing.
3. Multiple possible directions.

### Command Template

```text
Use gstack-office-hours.
Context: mdpro is a Tauri markdown app.
Idea: <feature>
Output:
1) user pain
2) narrowest shippable wedge (<=3 days)
3) anti-goals
4) risk list
5) success metric
```

### Exit Criteria

1. You can describe the real user pain in one sentence.
2. You have a scoped wedge, not a full platform redesign.
3. You know what will be intentionally deferred.

---

## 2. Plan

### Objective

Control scope and convert idea into an implementation plan that matches mdpro architecture.

### Primary Skills

1. `gstack-plan-ceo-review`
2. Optional: `gstack-plan-eng-review` for high-risk architecture changes
3. Optional: `gstack-plan-design-review` for significant UI redesign

### Command Template

```text
Use gstack-plan-ceo-review on this proposal.
Default posture: REDUCE scope unless expansion is clearly needed this sprint.
Return:
1) decision (reduce/hold/expand)
2) keep/cut table
3) must-have deliverables for this branch
```

### mdpro Plan Structure (Required)

Plan output should map to:

1. `src/` UI/state changes.
2. `src-tauri/` command/event/capability changes.
3. `tests/` additions and regression strategy.
4. `specs/` updates if behavior contract changes.

### Exit Criteria

1. Scope decision is explicit.
2. File/module targets are listed.
3. Test strategy is defined before coding.

---

## 3. Build

### Objective

Implement only what was planned, with controlled change scope.

### Primary Skills

1. `gstack-careful`
2. `gstack-freeze` and `gstack-unfreeze` for boundary control
3. `gstack-guard` when you need both command and edit guardrails

### Recommended Build Sequence

1. Activate `gstack-careful` if touching risky commands.
2. Use `gstack-freeze` to lock edits to target modules when debugging.
3. Implement incrementally by architecture layer.
4. Keep tests close to each code change.
5. Use `gstack-unfreeze` when done.

### Build Rules for mdpro

1. Keep React/TS and Tauri/Rust changes coherent across IPC boundaries.
2. Avoid unrelated refactors inside feature branches.
3. Add or update regression tests with each bug fix.

### Exit Criteria

1. Planned scope implemented.
2. Local compile/tests are passing for touched areas.
3. No uncontrolled file drift outside feature boundary.

---

## 4. Review

### Objective

Catch production-impacting issues before final test/ship steps.

### Primary Skills

1. `gstack-review`
2. Optional: `gstack-cso` for security-sensitive changes

### Command Template

```text
Use gstack-review on the current diff.
Focus on:
1) markdown data integrity
2) editor/preview consistency
3) Tauri IPC trust boundaries
4) race conditions and data loss risks
Return findings by severity with file references.
```

### When to Add `gstack-cso`

1. New or changed IPC commands.
2. File system write/delete flows.
3. Import/export parsing surface.
4. Permission/capability changes in `src-tauri/capabilities/`.

### Exit Criteria

1. No unresolved critical/high issues.
2. Review findings converted into concrete fixes or explicit deferrals.

---

## 5. Test

### Objective

Prove behavior and regression safety across frontend and Rust backend.

### Core Commands for mdpro

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro
npm run test:run
npm run build
cd src-tauri && cargo test
```

### Stage Notes

1. For desktop-specific interaction paths, keep explicit manual verification checklists.
2. gstack browser-centric QA skills (`gstack-qa`, `gstack-browse`) are low-fit for core Tauri app flows.
3. Use those browser skills only for web surfaces, docs sites, or browser-hosted demos.

### Exit Criteria

1. Frontend and Rust tests are green.
2. Regression tests exist for fixed bugs.
3. Manual desktop checks complete for high-risk UX flows.

---

## 6. Ship

### Objective

Run a disciplined release pipeline from reviewed code to PR-ready output.

### Primary Skill

1. `gstack-ship`

### Command Template

```text
Use gstack-ship.
Release type: patch (or minor/major if justified).
Requirements:
1) run frontend and Rust tests
2) fail hard on critical findings
3) prepare clean commit/push/PR artifacts
```

### Ship Checklist

1. Version bump strategy matches release intent.
2. Branch and base are correct.
3. Review output is clean or accepted.
4. PR description includes test evidence and risk notes.

### Exit Criteria

1. Branch pushed.
2. PR opened and reviewable.
3. Release notes/changelog state is consistent with changes.

---

## 7. Reflect

### Objective

Use recent delivery data to improve next sprint quality and velocity.

### Primary Skill

1. `gstack-retro`

### Command Template

```text
Use gstack-retro for last 7d (or 14d/30d).
Return:
1) throughput summary
2) bug/rework hotspots
3) test health trend
4) process improvements for next sprint
```

### Weekly Cadence

1. End-of-week retro after shipping.
2. Feed action items into next Think/Plan stage.
3. Track repeated failure patterns and codify guardrails.

### Exit Criteria

1. Next sprint has at least 1 process change from evidence.
2. Repeat failure modes have explicit preventive action.

---

## Stage-to-Skill Quick Map

| Stage | Default Skills | Optional Skills | Usually Skip in mdpro |
|---|---|---|---|
| Think | `gstack-office-hours` | — | — |
| Plan | `gstack-plan-ceo-review` | `gstack-plan-eng-review`, `gstack-plan-design-review` | — |
| Build | `gstack-careful`, `gstack-freeze`, `gstack-unfreeze`, `gstack-guard` | `gstack-investigate` during bug loops | — |
| Review | `gstack-review` | `gstack-cso` | — |
| Test | project test commands | `gstack-benchmark` for perf checks | `gstack-qa`, `gstack-qa-only`, `gstack-browse` for core desktop QA |
| Ship | `gstack-ship` | `gstack-document-release` | `gstack-land-and-deploy`, `gstack-canary` unless you have a formal deploy pipeline |
| Reflect | `gstack-retro` | — | — |

---

## Troubleshooting Appendix

### Codex cannot see gstack skills

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.agents/skills/gstack
bun run build
./setup --host codex
```

Then restart Codex/new session.

### Invalid SKILL.md warning

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro/.agents/skills/gstack
bun run gen:skill-docs --host codex
./setup --host codex
```

### Shell noise (`Wayne...` or `unknown option '-l'`)

Not a gstack failure. It is from shell custom wrappers.

Use explicit binaries:

```bash
find .agents/skills -maxdepth 1 -type l -name 'gstack-*' | /usr/bin/wc -l
```

Optional cleanup in current shell:

```bash
unalias wc 2>/dev/null
unset -f wc 2>/dev/null
```

---

## One-Page Operator Runbook

```text
1) THINK
   Use gstack-office-hours

2) PLAN
   Use gstack-plan-ceo-review

3) BUILD
   Code with careful/freeze guardrails, keep scope tight

4) REVIEW
   Use gstack-review (+ gstack-cso when security-sensitive)

5) TEST
   npm run test:run
   npm run build
   (cd src-tauri && cargo test)

6) SHIP
   Use gstack-ship

7) REFLECT
   Use gstack-retro (7d/14d/30d)
```

Core rule for mdpro: use gstack primarily as a decision-quality, debugging, and release-discipline system, not as a browser QA system.

