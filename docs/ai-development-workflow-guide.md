# mdpro AI-Assisted Development Workflow Guide

A comprehensive guide for using the integrated `.claude/` toolkit (agents, commands, skills, rules) to implement features and fix bugs in the mdpro project, with **Claude Code as the primary coder** and **Codex as the second-opinion consultant**.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Architecture Overview](#2-architecture-overview)
3. [The Codex-as-Consultant Pattern](#3-the-codex-as-consultant-pattern)
4. [Workflow A: Implementing a New Feature](#4-workflow-a-implementing-a-new-feature)
5. [Feature Workflow: Maximizing Input Quality](#5-feature-workflow-maximizing-input-quality)
6. [Workflow B: Fixing a Bug](#6-workflow-b-fixing-a-bug)
7. [Workflow C: Audit & Harden Existing Code](#7-workflow-c-audit--harden-existing-code)
8. [Command Reference](#8-command-reference)
9. [Agent Reference](#9-agent-reference)
10. [Session Management](#10-session-management)
11. [Practical Examples](#11-practical-examples)

---

## 1. Prerequisites

### Required Tools

| Tool | Purpose | Install |
|------|---------|---------|
| **Claude Code** | Primary AI coding agent | `npm install -g @anthropic-ai/claude-code` |
| **Codex CLI** | Second-opinion consultant | `npm install -g @openai/codex` |
| **pnpm** | Package manager | `npm install -g pnpm` |
| **Rust toolchain** | Tauri backend | `rustup` |

### First-Time Setup

```bash
# 1. Verify Codex is working
codex login                    # Authenticate with OpenAI
/codex-preflight               # Check available models (run inside Claude Code)

# 2. (Optional) Initialize project-specific Codex config
/codex-init                    # Generates .codex-toolkit-for-claude.md
```

### Verify Your Setup

Inside Claude Code, run:
```
/codex-preflight
```
This probes available Codex models and reports connectivity status. You need at least one available model (e.g., `gpt-5.3-codex`) for the codex-* commands to work.

---

## 2. Architecture Overview

### How the pieces fit together

```
┌─────────────────────────────────────────────────────┐
│                    YOU (human)                        │
│         Describe feature / report bug                │
└──────────────┬──────────────────────────┬────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐    ┌──────────────────────────┐
│    Claude Code       │    │    Codex CLI (MCP)       │
│    (Primary Coder)   │◄──►│    (Second Opinion)      │
│                      │    │                          │
│ • Reads/writes code  │    │ • Read-only analysis     │
│ • Runs tests         │    │ • Independent audit      │
│ • Makes commits      │    │ • Bug root-cause search  │
│ • Orchestrates agents│    │ • Plan review            │
└──────────────────────┘    └──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│  .claude/ Toolkit                                     │
│                                                       │
│  /commands/          Slash commands you invoke         │
│  /agents/            Specialized role definitions      │
│  /rules/             Engineering principles & TDD      │
│  /skills/            Planning, auditing, verification  │
│  /scripts/           Codex preflight checker           │
│  /contexts/          Session save/load files           │
└──────────────────────────────────────────────────────┘
```

### The Two-Model Strategy

| Role | Tool | Strengths |
|------|------|-----------|
| **Primary Coder** | Claude Code | Writes code, runs tests, manages files, orchestrates workflows |
| **Second Opinion** | Codex (via MCP) | Independent analysis in a sandboxed environment, catches hallucinations, validates plans |

**Why two models?** A single model can have blind spots — it may confidently write buggy code or miss edge cases. By having Codex independently review in a **read-only sandbox**, you get a second perspective that catches issues Claude might miss. This is especially valuable for:
- Security vulnerabilities
- Logic errors in complex code
- Plan feasibility assessment
- Verifying that fixes actually resolve the issue

---

## 3. The Codex-as-Consultant Pattern

### How it works

All `/codex-*` commands follow the same pattern:

1. **Claude Code** determines what to analyze (changed files, a plan, a bug)
2. **Claude Code** sends the code/plan to **Codex MCP** in a **read-only sandbox**
3. **Codex** analyzes independently and returns findings
4. **Claude Code** acts on the findings (fixes, revises, reports)
5. Optionally loop: send fixes back to Codex for verification

### Available Codex Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/codex-preflight` | Check Codex connectivity & models | First-time setup, troubleshooting |
| `/codex-init` | Generate project-specific config | Once per project (optional) |
| `/codex-audit` | Full 10-dimension code audit | Before releases, major changes |
| `/codex-audit-mini` | Quick 6-dimension audit | After any PR-sized change |
| `/codex-audit-fix` | Audit → fix → verify loop | Complete audit cycle |
| `/codex-bug-analyze` | Root-cause bug analysis | When debugging complex issues |
| `/codex-review-plan` | Architectural plan review | Before starting implementation |
| `/codex-implement` | Delegate implementation to Codex | Large mechanical changes |
| `/codex-verify` | Verify fixes from previous audit | After fixing audit findings |
| `/codex-continue` | Continue a previous Codex session | Iterate on findings |

### Thread Continuity

Codex commands return a `threadId`. Use `/codex-continue <threadId>` to continue the conversation:
```
/codex-continue abc-123 "Now fix the 3 Critical issues you found"
```
**Note:** Threads are in-memory only — lost when MCP server restarts.

---

## 4. Workflow A: Implementing a New Feature

### Quick Path (small feature, < 3 files)

```
1. /fix "add keyboard shortcut Cmd+Shift+L for line numbers toggle"
```
Claude handles everything: reads code, writes tests, implements, verifies.

### Full Path (medium-large feature)

This is the **9-stage gated pipeline** using `/feature-workflow`:

```
/feature-workflow toc-improvements
```

#### Stage-by-Stage Breakdown

**Stage 1: Plan** (Planner agent)
- Claude creates a modular plan with Work Items
- Each Work Item has: goal, acceptance criteria, edge cases, tests, affected files
- Plan saved to `specs/` or `docs/plans/`

**Stage 2: Review Plan with Codex** (optional but recommended)
```
/codex-review-plan docs/plans/2026-02-18-toc-improvements.md
```
Codex reviews the plan for:
- Internal consistency (contradictions)
- Completeness (missing error paths, edge cases)
- Feasibility (can this actually be built?)
- Ambiguity (where would an implementer get stuck?)
- Risk & sequencing (hard parts buried at the end?)

**Stage 3: Spec Check** (Spec Guardian agent)
- Validates plan against `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*.md`
- Blocks if constraints are violated

**Stage 4: Impact Analysis** (Impact Analyst agent)
- Maps the minimal file set per Work Item
- Identifies dependency edges (UI ↔ store ↔ service ↔ Rust)
- Proposes change boundaries

**Stage 5: Implement** (Implementer agent)
- For each Work Item:
  1. **Preflight**: Trace call chain, identify test seams, brainstorm edge cases
  2. **RED**: Write failing tests first
  3. **GREEN**: Implement minimally to pass tests
  4. **REFACTOR**: Clean up without changing behavior

**Stage 6: Test** (Test Runner agent)
- `pnpm build` (frontend compilation)
- `pnpm test:run` (Vitest)
- `cd src-tauri && cargo check && cargo test` (if Rust changed)

**Stage 7: Audit with Codex** (recommended)
```
/codex-audit-mini
```
Quick 6-dimension check on your changes. Or for thorough review:
```
/codex-audit
```
Full 10-dimension audit. If issues found, loop back to implement.

**Stage 8: Verify** (Verifier agent)
- Re-runs gates, produces final pass/fail checklist

**Stage 9: Release** (Release Steward agent)
- Proposes atomic commits (one per Work Item)
- Commits only after explicit "accept + commit"

### The Recommended Feature Flow

```
┌──────────────────────────────────────────────────┐
│  1. /feature-workflow <name>                      │
│     └── Planner creates Work Items                │
│                                                    │
│  2. /codex-review-plan <plan-file>    ◄── CODEX   │
│     └── Independent feasibility check              │
│                                                    │
│  3. Claude implements (RED → GREEN → REFACTOR)    │
│                                                    │
│  4. /codex-audit-mini                 ◄── CODEX   │
│     └── Catches Claude's blind spots               │
│                                                    │
│  5. Fix any findings, verify                       │
│                                                    │
│  6. Commit                                         │
└──────────────────────────────────────────────────┘
```

---

## 5. Feature Workflow: Maximizing Input Quality

### What the command accepts

The command takes **one required input** and **one optional input**:

```
/feature-workflow <work-name> [optional: path to existing plan doc]
```

- **`work-name`**: a short slug like `image-paste`, `toc-improvements`, `export-pdf`
- **Existing plan**: a path to a plan file you've already written (e.g., `specs/008-image-paste/plan.md`)

That's it. The command itself is an **orchestrator** — it doesn't take a detailed description. The 9 agents do the heavy lifting from there.

### The problem with minimal input

If you just run `/feature-workflow image-paste` with nothing else, the Planner agent has to guess what you want. The quality of the output depends entirely on how well Stage 1 (Plan) understands your intent.

### How to maximize quality

There are three practical approaches, ordered from least to most effort:

#### Approach 1: Provide a good description after the slug

Type your intent into the conversation **before** or **right after** invoking the command:

```
I want to add image paste support to the WYSIWYG editor. When a user
pastes an image from clipboard (Cmd+V), it should:
- Save the image to the same directory as the .md file
- Insert a markdown image reference ![](./image-name.png)
- Support PNG and JPEG formats
- Show a placeholder while saving
- Handle paste of multiple images
- Reject files > 5MB with an error toast

/feature-workflow image-paste
```

The Planner agent reads the conversation context, so this description directly feeds into Work Item creation.

#### Approach 2: Write a plan doc first, then pass it in

Write a plan or spec to a file first, then reference it:

```
/feature-workflow image-paste specs/008-image-paste/plan.md
```

The Planner agent will **refine** the existing plan rather than starting from scratch. This gives you the most control — you define the Work Items, acceptance criteria, and edge cases upfront, and the Planner fills in gaps.

#### Approach 3: Use speckit to build the spec first, then workflow it

```
/speckit.specify "Add image paste support to WYSIWYG editor"
/speckit.clarify
/speckit.plan
/speckit.tasks
/feature-workflow image-paste
```

This pre-builds a complete spec → plan → task chain before the 9-stage pipeline runs.

### What the Planner agent does with your input

Regardless of approach, the Planner (Stage 1) is required to:

1. **Research** — look at how VS Code, Obsidian, Typora solve this
2. **Brainstorm edge cases** — empty input, null/undefined, max values, Unicode/CJK, concurrent access, rapid repeated actions, permission denials
3. **Break into Work Items**, each with:
   - Goal and non-goals
   - Acceptance criteria (measurable)
   - Edge cases section (exhaustive)
   - Tests to write before implementation
   - Touched files/areas
   - Rollback strategy
4. **Keep items small** — 1–3 commits each

### The key insight

The command is designed so that **your input quality directly scales the output quality**. A vague slug like `/feature-workflow stuff` forces every downstream agent to make assumptions. A detailed description with specific behaviors, constraints, and edge cases means:

- The Planner produces tighter Work Items
- The Spec Guardian has clear rules to validate against
- The Impact Analyst can map files precisely
- The Implementer writes more targeted tests
- The Auditor knows what "correct" means

**Bottom line**: the `work-name` slug is just a label. The real input is the context you provide in the conversation — the more specific you are about desired behavior, constraints, and edge cases, the higher quality the 9-stage pipeline produces.

---

## 6. Workflow B: Fixing a Bug

### Quick Fix (obvious, small scope)

```
/fix "TOC sidebar doesn't update when switching between documents"
```

This triggers the structured fix process:
1. **Reproduce** — Read relevant source, trace the call chain
2. **Diagnose** — Find root cause, check for similar patterns elsewhere
3. **Test First (RED)** — Write failing test capturing the bug
4. **Fix (GREEN)** — Address root cause, not symptom
5. **Refactor** — Clean up
6. **Verify** — `pnpm build && pnpm test:run`, plus `cargo check` if Rust

### Complex Bug (unclear root cause)

Use Codex for root-cause analysis:

```
/codex-bug-analyze "WYSIWYG editor loses cursor position when toggling between
  split view and editor-only mode. Happens only with documents > 100 lines."
```

Codex will:
1. Search the codebase for relevant code
2. Analyze logic flow, state management, data flow
3. Trace the bug to its root cause
4. Find related bugs using the same pattern
5. Produce a report with recommended fix

Then use Claude to implement the fix:
```
/fix "Apply the fix from the bug analysis: [root cause description]"
```

### GitHub Issue Fix

```
/fix-issue 42
```
Fetches the GitHub issue, classifies it (bug/feature/question), creates a branch, resolves it, runs audit, creates PR.

---

## 7. Workflow C: Audit & Harden Existing Code

### Quick Audit (uncommitted changes)

```
/codex-audit-mini
```
Reviews your changes across 6 dimensions: logic, duplication, dead code, refactoring debt, shortcuts, code comments.

### Full Audit (specific scope)

```
/codex-audit src/services/        # Audit a directory
/codex-audit commit -3             # Audit last 3 commits
/codex-audit --full                # Audit entire codebase
```
Reviews across 10 dimensions including security, performance, dependencies, compliance.

### Audit → Fix → Verify Loop

```
/audit-fix                         # Audit uncommitted changes
/audit-fix commit -1               # Audit last commit
/audit-fix src/stores/             # Audit specific directory
```

This runs an automated loop:
1. **Audit** — Codex finds issues
2. **Fix All** — Claude fixes every finding (no deferrals)
3. **Verify** — Codex re-checks
4. **Loop** — Repeat until zero findings (max 3 iterations)
5. **Gate** — Run `pnpm build && pnpm test:run`

### Codex Audit → Fix → Verify (more control)

```
/codex-audit-fix
```
Similar to `/audit-fix` but gives you more control:
- Choose which severities to fix
- Choose fixer (Claude or Codex)
- Manual iteration decisions

---

## 8. Command Reference

### Core Workflow Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/feature-workflow <name>` | Full 9-stage feature pipeline | `/feature-workflow image-paste` |
| `/fix <description>` | Root-cause bug fix with TDD | `/fix "save fails on files > 5MB"` |
| `/fix-issue <number>` | Fix a GitHub issue end-to-end | `/fix-issue 42` |
| `/audit-fix [scope]` | Audit → fix → verify loop | `/audit-fix commit -1` |
| `/bump [version]` | Version bump + commit + tag | `/bump minor` |
| `/merge-prs [#N...]` | Review and merge open PRs | `/merge-prs --mine` |

### Codex Consultant Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/codex-preflight` | Check Codex connectivity | `/codex-preflight` |
| `/codex-init` | Generate project config | `/codex-init` |
| `/codex-audit [scope]` | Full 10-dimension audit | `/codex-audit src/` |
| `/codex-audit-mini [scope]` | Quick 6-dimension audit | `/codex-audit-mini` |
| `/codex-audit-fix [scope]` | Audit → fix → verify with control | `/codex-audit-fix` |
| `/codex-bug-analyze <desc>` | Root-cause bug analysis | `/codex-bug-analyze "..."` |
| `/codex-review-plan <file>` | Plan feasibility review | `/codex-review-plan plan.md` |
| `/codex-implement <plan>` | Delegate implementation to Codex | `/codex-implement plan.md` |
| `/codex-verify <report>` | Verify fixes from previous audit | `/codex-verify` |
| `/codex-continue <id> <msg>` | Continue previous Codex session | `/codex-continue abc-123 "fix Critical issues"` |

### Speckit Commands (Spec-Driven Development)

| Command | Description |
|---------|-------------|
| `/speckit.specify <desc>` | Create feature specification |
| `/speckit.clarify` | Identify underspecified areas |
| `/speckit.plan` | Generate implementation plan |
| `/speckit.tasks` | Generate task list from plan |
| `/speckit.implement` | Execute tasks from tasks.md |
| `/speckit.analyze` | Cross-artifact consistency check |
| `/speckit.checklist` | Generate custom checklist |
| `/speckit.constitution` | Create/update project constitution |
| `/speckit.taskstoissues` | Convert tasks to GitHub issues |

---

## 9. Agent Reference

Nine specialized agents are available for the feature workflow:

| Agent | Role | Tools |
|-------|------|-------|
| **planner** | Creates modular plans with Work Items, edge cases, acceptance criteria | Read, Grep |
| **spec-guardian** | Validates plans against project rules, blocks spec drift | Read, Grep |
| **impact-analyst** | Maps minimal change set, dependency risks, change boundaries | Read, Grep |
| **implementer** | Implements via TDD (RED → GREEN → REFACTOR), delegates to subagents | Read, Edit, Bash |
| **test-runner** | Runs tests narrowest-to-broadest, reports failures clearly | Read, Bash |
| **auditor** | Reviews diffs for correctness, rule compliance, scope creep | Read, Grep |
| **manual-test-author** | Writes manual testing guides incrementally | Read, Edit, Grep |
| **verifier** | Final verification: build passes, no data-loss paths, criteria met | Read, Bash |
| **release-steward** | Prepares commits and release notes; commits only on explicit request | Read, Bash |

---

## 10. Session Management

### Saving Context

When your session is getting long or before switching tasks:
```
/save-context
```
Saves to `.claude/contexts/YYYY-MM-DD_HH-MM-SS.md` with:
- Completed/in-progress/pending tasks
- Key decisions made
- Modified files
- Resume instructions

### Loading Context

At the start of a new session:
```
/load-context
```
Reads the latest context file and presents a summary so you can pick up where you left off.

---

## 11. Practical Examples

### Example 1: Add "Export to PDF" Feature

```bash
# Step 1: Start Claude Code in the mdpro project
claude

# Step 2: Start the feature workflow
> /feature-workflow export-pdf

# Claude's Planner agent creates a plan with Work Items:
# WI-1: Add Rust PDF generation command (using weasyprint/wkhtmltopdf)
# WI-2: Add TypeScript IPC wrapper
# WI-3: Add menu item and keyboard shortcut
# WI-4: Add export progress UI

# Step 3: Review the plan with Codex (second opinion)
> /codex-review-plan docs/plans/2026-02-18-export-pdf.md
# Codex flags: "WI-1 assumes weasyprint is installed — add dependency check"

# Step 4: Claude proceeds through implementation stages
# (automatic via feature-workflow)

# Step 5: Quick audit before commit
> /codex-audit-mini

# Step 6: Commit
> /commit
```

### Example 2: Fix a Rendering Bug

```bash
# Step 1: Analyze the bug with Codex
> /codex-bug-analyze "Code blocks in WYSIWYG mode lose syntax highlighting
  after switching themes. The highlighting works in split-view mode."

# Codex report identifies root cause:
# WysiwygView.tsx:142 — theme CSS class not re-applied after Milkdown re-render

# Step 2: Fix it properly
> /fix "Code block syntax highlighting lost after theme switch in WYSIWYG mode.
  Root cause: theme CSS class not re-applied after Milkdown re-render at
  WysiwygView.tsx:142"

# Claude writes failing test, fixes root cause, runs verification

# Step 3: Verify the fix independently
> /codex-verify
```

### Example 3: Pre-Release Audit

```bash
# Full codebase audit before tagging a release
> /codex-audit --full

# Fix all findings
> /codex-audit-fix

# Bump version and tag
> /bump minor
```

### Example 4: Continue a Previous Analysis

```bash
# Previous audit returned thread ID: abc-123
> /codex-continue abc-123 "Show me the exact data flow for the race condition
  you flagged in useFileWatcher.ts"

# Codex traces the flow in detail
> /codex-continue abc-123 "Now fix it"
```

---

## Quick Decision Guide

| Situation | Command |
|-----------|---------|
| "I want to add a new feature" | `/feature-workflow <name>` |
| "There's a bug I need to fix" | `/fix <description>` |
| "I can't figure out what's causing this bug" | `/codex-bug-analyze <description>` |
| "I want to review my changes before committing" | `/codex-audit-mini` |
| "I want a thorough security/quality review" | `/codex-audit` |
| "I want to fix everything an audit found" | `/audit-fix` or `/codex-audit-fix` |
| "I wrote a plan and want a sanity check" | `/codex-review-plan <file>` |
| "I want to verify my fixes resolved audit findings" | `/codex-verify` |
| "I have a big mechanical change (renames, moves)" | `/codex-implement <plan>` |
| "I need to fix a GitHub issue" | `/fix-issue <number>` |
| "I need to bump the version" | `/bump [patch\|minor\|major]` |
| "I need to merge open PRs" | `/merge-prs` |
| "My context is getting long" | `/save-context` |
| "I'm starting a new session" | `/load-context` |
