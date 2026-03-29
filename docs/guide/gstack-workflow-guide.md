# gstack Workflow Guide — Think → Plan → Build → Review → Test → Ship → Reflect

**Date**: 2026-03-28
**Scope**: All gstack skills mapped to the full development loop
**Repo**: [garrytan/gstack](https://github.com/garrytan/gstack)

---

## What is gstack?

gstack is a toolkit for Claude Code that adds structured skills for every stage of software development. It ships a fast headless browser (`/browse`), review pipelines, QA agents, a shipping workflow, and a weekly retrospective — all invoked as slash commands directly in Claude Code.

**Install / update:**
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack \
  && cd ~/.claude/skills/gstack && ./setup

# Already installed? Just upgrade:
/gstack-upgrade
```

**Core rule:** Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

---

## The Workflow at a Glance

```
Think        →   /office-hours
Plan         →   /plan-ceo-review  /plan-eng-review  /autoplan
Build        →   /investigate  /browse
Review       →   /review  /codex  /cso
Test         →   /qa  /qa-only
Ship         →   /ship  /land-and-deploy  /canary
Reflect      →   /retro
```

The key discipline: **don't skip stages**. The biggest time-wasters in AI-assisted development are building the wrong thing, skipping review, and forgetting what you learned. gstack has a skill for each failure mode.

---

## Stage 1 — Think

### `/office-hours`

YC-style forcing questions that validate whether the thing you're about to build is worth building. Two modes:

| Mode | When to use |
|------|-------------|
| **Startup** | New feature or product direction — demand reality, status quo, narrow wedge |
| **Builder** | Technical design — constraints, trade-offs, build vs. buy |

**Usage:**
```
/office-hours
```

Claude will ask 6 forcing questions (adapted from YC office hours). You answer them conversationally. By the end you either have a tighter brief or you've discovered you're solving the wrong problem.

**Output:** A design doc saved to disk (referenceable in later stages).

**When to skip:** You already did this for this feature. Don't repeat for minor fixes.

---

## Stage 2 — Plan

Three tools for different levels of scrutiny:

### `/plan-ceo-review`

Strategic scope review. Challenges whether the plan is too big, too small, or pointed in the wrong direction. Four modes:

| Mode | Use when |
|------|----------|
| **Expansion** | You might be thinking too small — explore the 10x version |
| **Selective** | Hold core scope, cherry-pick high-leverage additions |
| **Hold** | Scope is right — apply maximum rigor without changing it |
| **Reduction** | You're overbuilding — cut to the essential wedge |

```
/plan-ceo-review
```

Reads your plan doc and produces a structured critique + recommendation.

### `/plan-eng-review`

Architecture and execution review. Focuses on:
- Data flow and system diagrams
- Edge cases and failure modes
- Test coverage gaps
- Performance considerations
- Dependency risks

```
/plan-eng-review
```

**Output:** Annotated plan with blockers, questions, and a go/no-go recommendation.

### `/autoplan`

Runs the full review gauntlet automatically: CEO review → design review → eng review, with auto-decisions at each gate. Surfaces only the taste decisions that require a human.

```
/autoplan
```

Use this when you want to move fast and trust the pipeline. Use the individual review skills when you want to dig into a specific dimension.

**Typical planning flow:**
```
1. /office-hours        ← validate the premise
2. Write plan.md        ← your implementation plan
3. /plan-ceo-review     ← is this the right thing to build?
4. /plan-eng-review     ← is this the right way to build it?
   (or /autoplan to run 3+4 automatically)
```

---

## Stage 3 — Build

### `/investigate`

Root-cause debugging. Enforces the Iron Law: **no fix without root cause**.

Four phases:
1. **Investigate** — reproduce the bug, gather evidence
2. **Analyze** — read the relevant code, trace the execution path
3. **Hypothesize** — form a falsifiable hypothesis about the root cause
4. **Implement** — write the minimal fix that addresses the root cause

```
/investigate
```

**3-strike rule:** If a hypothesis is wrong three times, `/investigate` escalates — it stops guessing and asks you to provide more context.

**Scope lock:** Won't refactor surrounding code while fixing. Fix only what's broken.

### `/browse`

Fast headless browser (~100ms per command). Used internally by `/qa`, `/qa-only`, `/canary`, and `/design-review`. You can also invoke it directly:

- Navigate to URLs
- Click, type, scroll
- Take annotated screenshots
- Verify page state / DOM

```
/browse
```

Useful during build for manual dogfooding: "Does this feature look right in the browser?"

---

## Stage 4 — Review

Three tools covering different angles:

### `/review`

Pre-landing PR review. Analyzes the diff for:
- SQL safety (injection, unparameterized queries)
- LLM trust boundary violations (untrusted input passed to prompts)
- Conditional side effects (side effects inside if-blocks that should be unconditional)
- Structural issues (dead code, missing tests, over-complex logic)

```
/review
```

**This is the gate before you push.** Run it on every non-trivial diff.

**Output:** Pass / Fail with annotated findings, sorted by severity.

### `/codex`

OpenAI Codex as an independent second opinion. Three modes:

| Mode | Command | Use when |
|------|---------|----------|
| **Review** | `/codex review` | Get a pass/fail verdict on your diff |
| **Challenge** | `/codex challenge` | Adversarial review — find the hardest objections |
| **Consult** | `/codex consult` | Q&A with context continuity across turns |

Use `/codex challenge` before shipping anything security-sensitive or architecturally significant. It will find objections you didn't think of.

### `/cso`

Chief Security Officer mode. Infrastructure-first security audit:
- Secrets archaeology (hardcoded credentials, leaked keys)
- Supply chain risks (dependency vulnerabilities)
- CI/CD pipeline security
- LLM-specific security (prompt injection, data leakage)
- OWASP Top 10
- STRIDE threat modeling

| Mode | Confidence threshold | Use when |
|------|---------------------|----------|
| **Daily** | 8/10 — only high-confidence findings | Fast pass before PRs |
| **Comprehensive** | 2/10 — everything including speculative | Before releases or major changes |

```
/cso
```

**Typical review flow:**
```
1. /review          ← general code quality gate
2. /codex review    ← independent second opinion
3. /cso             ← security gate (before releases)
```

---

## Stage 5 — Test

### `/qa`

Systematically tests a web app, finds bugs, and fixes them. End-to-end loop:
1. Navigate and interact with the app using `/browse`
2. Find bugs (console errors, visual regressions, broken flows)
3. Fix each bug
4. Re-verify the fix
5. Commit atomically

Three tiers:

| Tier | What's tested | When to use |
|------|--------------|-------------|
| **Quick** | Critical + high severity | Fast confidence check |
| **Standard** | + medium severity | Pre-PR default |
| **Exhaustive** | + cosmetic | Pre-release |

```
/qa
```

### `/qa-only`

Same as `/qa` but **report-only** — no code changes. Produces a structured bug report with:
- Health score (0–100)
- Bug list with severity, repro steps, and screenshots
- Recommended fix order

```
/qa-only
```

Use `/qa-only` when you want a human to triage and fix. Use `/qa` when you want Claude to fix as it goes.

---

## Stage 6 — Ship

### `/ship`

Full pre-merge pipeline in one command:

```
detect base branch
→ merge base into branch
→ run tests
→ review diff (/review)
→ bump VERSION
→ update CHANGELOG
→ commit
→ push
→ open PR
```

```
/ship
```

**This is the single command for "I'm done, ship it."** It won't proceed past any failing gate.

### `/land-and-deploy`

Picks up where `/ship` leaves off — after the PR is open:

```
merge PR
→ wait for CI
→ wait for deploy pipeline
→ verify production via canary checks
```

```
/land-and-deploy
```

Use in sequence: `/ship` → get PR approved → `/land-and-deploy`.

### `/canary`

Post-deploy monitoring. Watches the live app for:
- Console errors
- JS exceptions
- Performance regressions
- Page failures

Captures a baseline before deploy, then compares post-deploy.

```
/canary <url>
/canary https://myapp.com --duration 5m --pages /,/dashboard,/settings
/canary <url> --quick    # fast pass, critical pages only
```

**Typical ship flow:**
```
1. /ship                        ← pre-merge pipeline
2. PR review + approval
3. /land-and-deploy             ← merge, CI, deploy
4. /canary https://myapp.com    ← verify production
```

---

## Stage 7 — Reflect

### `/retro`

Weekly engineering retrospective. Analyzes:
- Commit history and velocity
- Work patterns (what got done, what got stuck)
- Code quality metrics (churn, hotspots)
- Team breakdown (per-person, if in a team repo)
- Trend tracking vs. previous weeks

```
/retro
```

**Output:** Structured retrospective doc with wins, issues, and next-week focus areas.

Run this every Friday (or at the end of each sprint). The institutional memory it builds prevents repeating the same mistakes.

---

## Utility Skills

### `/benchmark`

Performance regression detection. Establishes baselines for key user flows, then measures them after changes.

```
/benchmark
```

### `/design-review`

Designer's-eye QA pass: visual inconsistency, spacing issues, typography, contrast, responsiveness.

```
/design-review
```

### `/setup-browser-cookies`

Import cookies from your real browser (Chrome, Arc, Brave) into gstack's headless browser. Required for testing behind authentication.

```
/setup-browser-cookies
```

### `/setup-deploy`

Configure deployment settings for `/land-and-deploy`. Detects your deploy provider and sets up the integration.

```
/setup-deploy
```

### `/careful`

Safety guardrails for destructive commands. Warns before `rm -rf`, `git reset --hard`, `DROP TABLE`, etc.

```
/careful
```

### `/freeze` / `/unfreeze`

Restrict Claude edits to a specific directory for the session. Use when you want to scope work tightly.

```
/freeze src/components/Editor
/unfreeze
```

### `/guard`

Full safety mode: destructive command warnings + directory-scoped edits combined.

```
/guard
```

---

## Quick Reference

```
THINK     /office-hours
PLAN      /plan-ceo-review  /plan-eng-review  /autoplan
BUILD     /investigate  /browse
REVIEW    /review  /codex review  /codex challenge  /cso
TEST      /qa  /qa-only
SHIP      /ship  /land-and-deploy  /canary <url>
REFLECT   /retro
SAFETY    /careful  /freeze  /guard  /unfreeze
MAINTAIN  /gstack-upgrade  /setup-browser-cookies  /setup-deploy  /benchmark
```

---

## Common Workflows

### New Feature (full cycle)
```
/office-hours           → validate premise
write plan.md           → draft implementation
/autoplan               → run review gauntlet
[implement feature]
/investigate            → debug any issues
/review                 → pre-push gate
/qa                     → find and fix bugs
/ship                   → pre-merge pipeline
/land-and-deploy        → merge and deploy
/canary https://...     → verify production
/retro                  → capture what you learned
```

### Quick Bug Fix
```
/investigate            → root cause first
[implement fix]
/review                 → gate
/ship                   → ship
```

### Pre-Release Security Check
```
/cso                    → comprehensive audit
/codex challenge        → adversarial review
/qa                     → exhaustive QA pass
/ship
/canary <prod-url>
```

### Friday Retro
```
/retro                  → weekly retrospective
```
