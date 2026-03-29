# Tutorial: xiaolai's Claude Code Plugin Marketplace & Agent SDK Skill

A comprehensive guide to two community-maintained repositories that significantly enhance Claude Code's capabilities:

1. **[claude-plugin-marketplace](https://github.com/xiaolai/claude-plugin-marketplace)** — A curated collection of 5 Claude Code plugins for code quality, testing, auditing, and review.
2. **[claude-agent-sdk-skill-autoupdated](https://github.com/xiaolai/claude-agent-sdk-skill-autoupdated)** — An auto-updating skill that provides always-current Agent SDK documentation and correction rules.

---

## Table of Contents

- [Part 1: Plugin Marketplace](#part-1-plugin-marketplace)
  - [What Is It?](#what-is-it)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Plugin Overview](#plugin-overview)
  - [Plugin 1: grill — Deep Codebase Interrogation](#plugin-1-grill--deep-codebase-interrogation)
  - [Plugin 2: tdd-guardian — Test-Driven Development Enforcement](#plugin-2-tdd-guardian--test-driven-development-enforcement)
  - [Plugin 3: codex-toolkit — OpenAI Codex Integration](#plugin-3-codex-toolkit--openai-codex-integration)
  - [Plugin 4: echo-sleuth — Conversation History Mining](#plugin-4-echo-sleuth--conversation-history-mining)
  - [Plugin 5: loc-guardian — Lines of Code Enforcement](#plugin-5-loc-guardian--lines-of-code-enforcement)
  - [Plugin Management](#plugin-management)
- [Part 2: Agent SDK Skill (Auto-Updated)](#part-2-agent-sdk-skill-auto-updated)
  - [What Is It?](#what-is-it-1)
  - [Why You Need It](#why-you-need-it)
  - [Installation](#installation-1)
  - [What It Provides](#what-it-provides)
  - [When It Activates](#when-it-activates)
- [Part 3: When to Use What — Decision Guide](#part-3-when-to-use-what--decision-guide)
  - [Scenario Matrix](#scenario-matrix)
  - [Recommended Workflows](#recommended-workflows)
- [Part 4: Combining Both for Maximum Effect](#part-4-combining-both-for-maximum-effect)
- [Appendix: Troubleshooting](#appendix-troubleshooting)

---

## Part 1: Plugin Marketplace

### What Is It?

The Claude Code plugin system (introduced in v1.0.33+) allows third-party extensions — skills, agents, hooks, and MCP servers — to be packaged, shared, and installed via marketplaces. xiaolai's marketplace is a community-maintained collection of five developer-focused plugins hosted on GitHub.

Each plugin is a standalone GitHub repository. The marketplace is a registry that indexes them under a single namespace (`@xiaolai`), allowing one-command installation.

### Prerequisites

- **Claude Code v1.0.33+** — Run `claude --version` to verify. Update if needed.
- **For codex-toolkit**: [Codex CLI](https://github.com/openai/codex) v0.101.0+ (`npm install -g @openai/codex`) and authentication via `codex login`.
- **For loc-guardian**: [tokei](https://github.com/XAMPPRocky/tokei) installed (`brew install tokei` on macOS).

### Installation

#### Step 1: Add the Marketplace

Run this once to register xiaolai's marketplace:

```
/plugin marketplace add xiaolai/claude-plugin-marketplace
```

This tells Claude Code where to find the plugin index.

#### Step 2: Install Plugins

Install individual plugins or all of them:

```bash
# Install all plugins (user-level, available in all projects)
claude plugin install codex-toolkit@xiaolai --scope user
claude plugin install tdd-guardian@xiaolai --scope user
claude plugin install echo-sleuth@xiaolai --scope user
claude plugin install loc-guardian@xiaolai --scope user
claude plugin install grill@xiaolai --scope user
```

Or for a specific project (shared with teammates via `.claude/plugins.json`):

```bash
claude plugin install grill@xiaolai --scope project
```

#### Scope Reference

| Scope   | Flag              | When to Use                                           |
|---------|-------------------|-------------------------------------------------------|
| User    | `--scope user`    | Personal toolbox, available everywhere (default)      |
| Project | `--scope project` | Team workflows, shared via `.claude/plugins.json`     |
| Local   | `--scope local`   | Machine-specific, not version controlled              |

**Recommendation**: Install `grill` and `echo-sleuth` at user scope (useful everywhere). Install `tdd-guardian` and `loc-guardian` at project scope (enforcement policies should be team decisions).

---

### Plugin Overview

| Plugin           | Version | What It Does                                                        | Key Commands                        |
|------------------|---------|---------------------------------------------------------------------|-------------------------------------|
| **grill**        | 1.0.0   | Multi-angle architecture review with 5 agents and 4 review styles   | `/grill:grill`                      |
| **tdd-guardian** | 0.5.0   | Enforces TDD discipline with coverage gates and mutation testing    | `/tdd-guardian:init`, `/tdd-guardian:workflow` |
| **codex-toolkit**| 0.3.0   | Delegates audit/implement/verify tasks to OpenAI Codex              | `/codex-toolkit:audit`, `/codex-toolkit:implement`, etc. |
| **echo-sleuth**  | 0.2.0   | Mines past Claude Code conversations for decisions and mistakes     | `/echo-sleuth:recall`, `/echo-sleuth:lessons`, etc. |
| **loc-guardian** | 0.1.0   | Enforces per-file LOC limits with refactoring suggestions           | `/loc-guardian:init`, `/loc-guardian:scan` |

---

### Plugin 1: grill — Deep Codebase Interrogation

**When to use**: Before a major release, when inheriting a codebase, during architecture reviews, or when you want an honest, multi-perspective assessment of code quality.

**What it does**: Launches 5 specialized agents in parallel to interrogate your codebase from different angles, then synthesizes findings into a chosen review format.

#### The 5 Agents

| Agent               | Focus Area                          |
|---------------------|-------------------------------------|
| `grill:recon`       | Quick codebase survey (runs first)  |
| `grill:architecture`| Core architecture analysis          |
| `grill:error-handling`| Error handling & observability    |
| `grill:security`    | Security surface analysis           |
| `grill:testing`     | Testing & CI/CD analysis            |

#### The 4 Review Styles

When you run `/grill:grill`, you choose one:

1. **Architecture Review + Rewrite Plan** — Full redesign proposal with 10 deliverables: architecture changes, data model, reliability/security/testing/performance plans, migration path.
2. **Hard-Nosed Critique + Roadmap** — Critical flaws with specific examples, 80/20 rewrite plan, prioritized 15-item backlog ranked by impact/risk/effort.
3. **Multi-Perspective Panel** — Six expert personas (staff backend, security, SRE, performance, product, junior dev) each give their top 3 changes, then produce a unified plan.
4. **ADR Style** — 8-12 Architecture Decision Records with Context, Decision, Alternatives, Consequences, and Migration notes.

#### 8 Add-on Pressure Tests

You can select multiple:

- **Scale stress**: "What breaks at 100x traffic?"
- **Hidden costs**: "5 hidden operational/debugging/onboarding costs"
- **Principle violations**: "SRP, dependency inversion, least privilege violations"
- **Strangler fig**: "Minimal incremental migration plan"
- **Success metrics**: "Define and measure lead time, MTTR, p95 latency, defect rate"
- **Before vs after**: "1-page component + data flow diagram"
- **Assumptions audit**: "List and validate assumptions"
- **Compact & optimize**: "Find code to consolidate or eliminate"

#### Usage Example

```
/grill:grill
```

Claude will:
1. Run the recon agent to survey the codebase
2. Ask you to choose a review style + add-ons
3. Launch 4 deep-dive agents in parallel
4. Synthesize findings with evidence-backed recommendations
5. End with an executive summary: verdict, top 3 actions, confidence levels

**Best situations**:
- Onboarding to an inherited codebase
- Pre-release architecture review
- Periodic health check (monthly/quarterly)
- Before a major refactor to understand what exists

---

### Plugin 2: tdd-guardian — Test-Driven Development Enforcement

**When to use**: On projects where test discipline matters — you want to guarantee RED → GREEN → REFACTOR is actually followed, not just aspirational.

**What it does**: Enforces TDD through automated quality gates. It blocks git commits and PR creation unless tests pass, coverage meets thresholds, and (optionally) mutation testing confirms test robustness.

#### Setup

```
/tdd-guardian:init
```

This auto-detects your tech stack and generates `.claude/tdd-guardian/config.json` with sensible defaults.

#### Key Configuration Options

| Setting                    | Default          | Purpose                                       |
|----------------------------|------------------|-----------------------------------------------|
| `enabled`                  | `true`           | Master switch                                 |
| `enforceOnTaskCompleted`   | `true`           | Auto-run gates when tasks finish              |
| `blockCommitWithoutFreshGate` | `true`        | Block commits without recent passing gates    |
| `gateFreshnessMinutes`     | `120`            | How long a passing gate remains valid         |
| `testCommand`              | `"pnpm test"`    | Your test runner                              |
| `coverageCommand`          | `"pnpm test -- --coverage"` | Coverage command                  |
| `requireMutation`          | `false`          | Enable mutation testing gate                  |

#### Running the Full TDD Pipeline

```
/tdd-guardian:workflow
```

This orchestrates 6 sequential subagents:

1. **tdd-planner** — Breaks your task into work items with acceptance criteria
2. **tdd-test-designer** — Creates behavior-driven tests (RED phase)
3. **tdd-implementer** — Implements features in small batches (GREEN phase)
4. **tdd-coverage-auditor** — Enforces coverage thresholds (default: 100%)
5. **tdd-mutation-auditor** — Validates test robustness via mutation analysis
6. **tdd-reviewer** — Final quality review of code and tests (REFACTOR phase)

The pipeline halts immediately if any gate fails.

#### Enforcement Hooks

TDD Guardian installs two hooks automatically:

- **PreToolUse hook**: Intercepts `git commit`, `git push`, `gh pr create`, and `npm publish` — blocks them unless a recent gate pass exists.
- **TaskCompleted hook**: Auto-runs tests, coverage, and mutation checks when Claude completes a task.

#### Test Quality Philosophy

Tests are graded by assertion quality:

| Level | Type                                | Quality        |
|-------|-------------------------------------|----------------|
| 1-3   | Output/side-effect/real integration | Best           |
| 4-5   | State verification; mock + output   | Good           |
| 6     | Mock call arguments                 | Weak           |
| 7     | Mock invocation only                | **Rejected**   |

Tests containing only Level 6-7 assertions are rejected and must be strengthened.

#### Bypass (Emergency Only)

```bash
TDD_GUARD_BYPASS=1 claude
```

**Best situations**:
- New projects where you want to establish TDD culture from day one
- Teams transitioning from "tests after" to "tests first"
- Projects with strict quality requirements (fintech, healthcare, infrastructure)
- When you want proof that your tests actually catch bugs (mutation testing)

---

### Plugin 3: codex-toolkit — OpenAI Codex Integration

**When to use**: When you want a "second brain" — an independent AI model reviewing Claude's work, catching blind spots and hallucinations through dual-model verification.

**What it does**: Integrates OpenAI's Codex CLI as an MCP server, enabling Claude Code to delegate tasks to Codex for independent auditing, implementation, and verification.

#### Prerequisites

```bash
npm install -g @openai/codex
codex login  # Prefer ChatGPT Plus/Pro subscription over API key
```

#### Commands

| Command                         | Purpose                                                  |
|---------------------------------|----------------------------------------------------------|
| `/codex-toolkit:preflight`      | Verify Codex connectivity, discover available models     |
| `/codex-toolkit:init`           | Generate project config (`.codex-toolkit.md`)            |
| `/codex-toolkit:audit`          | Fast 5-dimension or thorough 9-dimension code audit      |
| `/codex-toolkit:implement`      | Delegate implementation plan to Codex                    |
| `/codex-toolkit:verify`         | Verify fixes from a previous audit                       |
| `/codex-toolkit:bug-analyze`    | Root cause analysis using Codex                          |
| `/codex-toolkit:review-plan`    | Architectural review of implementation plans             |
| `/codex-toolkit:audit-fix`      | Automated audit → fix → verify loop (up to 3 iterations)|
| `/codex-toolkit:continue`       | Continue a previous Codex session                        |

#### Audit Dimensions

**Mini audit** (default, 5 dimensions): logic, duplication, dead code, debt, shortcuts

**Full audit** (9 dimensions): adds security, performance, compliance, dependencies, documentation

#### Dual-Model Workflow Example

```
# 1. Write your feature with Claude
# 2. Quick quality check
/codex-toolkit:audit

# 3. If issues found, auto-fix loop
/codex-toolkit:audit-fix

# 4. Verify fixes independently
/codex-toolkit:verify
```

The audit-fix loop runs iteratively (up to 3 cycles) and reports final status: **ACCEPTED**, **PARTIAL**, or **UNCHANGED**.

**Best situations**:
- Before merging PRs — independent review catches what self-review misses
- After completing a feature — dual-model verification
- Debugging complex issues — fresh perspective from a different model
- Architecture reviews — Codex brings different training data and biases

---

### Plugin 4: echo-sleuth — Conversation History Mining

**When to use**: When you want to learn from past sessions — find decisions, recall why something was done, avoid repeated mistakes, or build a timeline of project evolution.

**What it does**: Analyzes past Claude Code conversation sessions (stored locally) to extract decisions, mistakes, patterns, and wisdom — with zero external dependencies.

#### Commands

| Command                    | Purpose                                                     |
|----------------------------|-------------------------------------------------------------|
| `/echo-sleuth:recall <topic>` | Search past conversations for a topic, decision, or mistake |
| `/echo-sleuth:lessons [topic]`| Extract accumulated wisdom from past sessions               |
| `/echo-sleuth:recap [N]`     | Summarize recent sessions (default: last 5)                 |
| `/echo-sleuth:timeline`      | Chronological timeline combining sessions + git history     |

#### Usage Examples

```bash
# "Why did we choose PostgreSQL over MongoDB?"
/echo-sleuth:recall database decision

# "What mistakes have we made in the auth module?"
/echo-sleuth:lessons authentication --category mistakes

# "What happened in the last 3 sessions?"
/echo-sleuth:recap 3

# "Show me the full project history"
/echo-sleuth:timeline --since 2026-01-01
```

#### Scope Options

- `--scope current` (default): Only the current project
- `--scope all`: All projects on this machine

**Best situations**:
- Onboarding a new team member — "here's what happened and why"
- Before making a decision — "have we tried this before?"
- Retrospectives — "what went wrong this sprint?"
- Context recovery after long breaks — "where did we leave off?"
- Avoiding repeated mistakes — "what did we learn last time?"

---

### Plugin 5: loc-guardian — Lines of Code Enforcement

**When to use**: When files keep growing beyond maintainability. The 300-line guideline is meaningless without enforcement.

**What it does**: Uses [tokei](https://github.com/XAMPPRocky/tokei) to accurately count pure lines of code (excluding comments, blanks, tests) and flags violations against a configurable threshold. When violations exist, an AI-powered optimizer suggests concrete refactoring strategies.

#### Setup

```bash
brew install tokei  # macOS
/loc-guardian:init
```

This creates `.claude/loc-guardian.local.md` with your threshold (default: 350 LOC) and extraction rules.

#### Usage

```bash
# Scan entire project
/loc-guardian:scan

# Scan only Python files
/loc-guardian:scan python

# Scan a specific directory
/loc-guardian:scan src/
```

#### How It Works

1. **Counter Agent** — Runs tokei, parses output, flags files exceeding the threshold
2. **Optimizer Agent** — Only activates when violations exist; reads over-limit files and suggests concrete refactoring (extract class, split module, etc.) based on your configured extraction rules

**Best situations**:
- Projects with a "no file over N lines" rule
- Before code reviews — catch bloated files proactively
- During refactoring sprints
- Maintaining codebase health over time

---

### Plugin Management

```bash
# List all installed plugins
claude plugin list

# Update a specific plugin
claude plugin update grill@xiaolai

# Temporarily disable a plugin
claude plugin disable tdd-guardian@xiaolai

# Re-enable
claude plugin enable tdd-guardian@xiaolai

# Uninstall completely
claude plugin uninstall loc-guardian@xiaolai
```

---

## Part 2: Agent SDK Skill (Auto-Updated)

### What Is It?

A Claude Code **skill** that provides comprehensive, always-current documentation and auto-correction rules for the Claude Agent SDK (both TypeScript and Python). Unlike static documentation that goes stale, this skill updates itself daily via an automated pipeline.

The key difference from the plugin marketplace: this is a **skill**, not a **plugin**. Skills are loaded into Claude's context and influence its behavior passively. You don't invoke them with slash commands — they activate automatically when relevant.

### Why You Need It

Both Agent SDKs are pre-1.0 with frequent breaking changes:

- TypeScript SDK: v0.2.59 (changes weekly)
- Python SDK: v0.1.44 (changes weekly)

A static reference would teach outdated patterns within days. This skill:

- Tracks SDK version bumps on npm/PyPI daily
- Audits the actual API surface (type definitions, function signatures)
- Monitors GitHub issues for new bugs and workarounds
- Auto-corrects your code when you use deprecated or broken patterns

### Installation

#### Step 1: Clone into Claude Code's Skills Directory

```bash
git clone https://github.com/xiaolai/claude-agent-sdk-skill-autoupdated \
  ~/.claude/skills/claude-agent-sdk-skill-autoupdated
```

Claude Code automatically loads skills from `~/.claude/skills/`.

#### Step 2: (Optional) Set Up Auto-Updates

Add a daily cron job to pull the latest changes:

```bash
(crontab -l 2>/dev/null; echo "0 9 * * * cd ~/.claude/skills/claude-agent-sdk-skill-autoupdated && git pull -q") | crontab -
```

This runs at 09:00 UTC daily. Alternatively, manually pull when needed:

```bash
cd ~/.claude/skills/claude-agent-sdk-skill-autoupdated && git pull
```

#### Step 3: Restart Claude Code

```bash
claude  # Skills are loaded at startup
```

### What It Provides

#### Complete API Reference

Covers the full API surface for both SDKs:

| Area               | TypeScript                              | Python                                 |
|--------------------|-----------------------------------------|----------------------------------------|
| Core API           | `query()`, async generator              | `query()`, `ClaudeSDKClient`           |
| Tool Definition    | `tool()` function + Zod schemas         | `@tool()` decorator                    |
| MCP Servers        | stdio, HTTP, SSE, in-process SDK        | stdio, HTTP, SSE, in-process SDK       |
| Hooks              | 18 event types with matchers            | 10 event types with matchers           |
| Permissions        | 5 modes + custom `canUseTool` callback  | 4 modes + custom `can_use_tool`        |
| Subagents          | Via `Task` tool + `agents` config       | Via `Task` tool + `agents` config      |
| Structured Output  | JSON Schema with Zod                    | JSON Schema (dict)                     |
| Sessions           | Resume, fork, list, read messages       | Resume, fork, file checkpointing       |
| Sandbox            | Filesystem, network, command restrictions| Filesystem, network, command restrictions|

#### Known Issues Database

Real GitHub issues with workarounds. Examples from the TypeScript SDK:

| Issue | Problem | Workaround |
|-------|---------|------------|
| #3  | MCP missing `type` field → opaque "exit code 1" | Add `type: "http"` or `type: "sse"` |
| #12 | Hook `permissionDecision: 'deny'` → API 400 error | Use `'allow'` with modified input |
| #15 | `ANTHROPIC_LOG=debug` corrupts JSON protocol | Use `debug: true` option instead |
| #20 | Structured output with Zod undefined | Specify `target: "draft-07"` in `toJSONSchema()` |

#### Auto-Correction Rules

Trigger conditions:
- **TypeScript**: When editing files matching `*agent*.ts`
- **Python**: When editing files matching `*agent*.py`

The rules automatically correct:
- Deprecated API patterns (e.g., `maxThinkingTokens` → `thinking` option)
- Missing required fields (e.g., `type: "http"` on URL-based MCP servers)
- Known broken patterns (e.g., `permissionDecision: 'deny'` in hooks)
- Naming convention mismatches between TS (camelCase) and Python (snake_case)

### When It Activates

You don't need to do anything. The skill activates when:

1. You're working on Agent SDK code (Claude detects from file patterns and imports)
2. You ask questions about the Agent SDK
3. You're debugging Agent SDK errors
4. You're writing hooks, tools, or MCP server configurations

Claude will automatically reference the correct, up-to-date documentation and warn you about known issues.

---

## Part 3: When to Use What — Decision Guide

### Scenario Matrix

| Scenario | Tool to Use | Why |
|----------|-------------|-----|
| "Is this codebase healthy?" | `/grill:grill` | Multi-angle, evidence-based architecture review |
| "Are my tests actually good?" | `/tdd-guardian:workflow` | Coverage + mutation testing proves test quality |
| "Did Claude introduce bugs?" | `/codex-toolkit:audit` | Independent second model catches blind spots |
| "Why did we do X?" | `/echo-sleuth:recall X` | Mines conversation history for decisions |
| "This file is too long" | `/loc-guardian:scan` | Counts pure LOC and suggests extraction |
| "Build me an Agent SDK app" | Agent SDK Skill (auto) | Provides correct, current API patterns |
| "My agent keeps crashing" | Agent SDK Skill (auto) | Known issues database with workarounds |
| "Start a new TDD project" | `/tdd-guardian:init` then `/tdd-guardian:workflow` | Sets up enforcement from day one |
| "Review before release" | `/grill:grill` + `/codex-toolkit:audit` | Architecture + code quality dual check |
| "What happened last week?" | `/echo-sleuth:recap 7d` | Session summaries over time period |

### Recommended Workflows

#### New Feature Development

```
1. /tdd-guardian:init          # Set up TDD enforcement (once per project)
2. Plan your feature           # Use Plan Mode
3. /tdd-guardian:workflow       # TDD pipeline: plan → test → implement → verify
4. /codex-toolkit:audit        # Independent quality check
5. /echo-sleuth:lessons        # Learn from past mistakes on similar work
```

#### Codebase Audit (Inherited or Periodic)

```
1. /grill:grill                # Deep multi-angle review
2. /loc-guardian:scan           # File size violations
3. /codex-toolkit:audit --full  # 9-dimension code audit
4. Prioritize findings          # Combine all reports into action items
```

#### Bug Investigation

```
1. /echo-sleuth:recall <bug-area>    # Has this happened before?
2. /codex-toolkit:bug-analyze <desc> # Root cause analysis via Codex
3. Fix the bug with TDD              # Write failing test first
4. /codex-toolkit:verify             # Verify fix independently
```

#### Agent SDK Development

```
1. Install the Agent SDK skill       # One-time setup
2. Write your agent code             # Skill auto-corrects patterns
3. /codex-toolkit:audit              # Quality check the agent code
4. /tdd-guardian:workflow             # Ensure agent behavior is tested
```

---

## Part 4: Combining Both for Maximum Effect

The plugin marketplace and the Agent SDK skill serve different purposes but complement each other:

```
┌─────────────────────────────────────────────────┐
│                 Your Claude Code                  │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ Agent SDK Skill (passive, always-on)         │ │
│  │ - Correct API patterns                       │ │
│  │ - Known issue warnings                       │ │
│  │ - Auto-correction rules                      │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  grill   │ │tdd-guard │ │  codex-toolkit   │ │
│  │ /grill   │ │/workflow │ │  /audit /verify  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐                       │
│  │echo-sleu │ │loc-guard │                       │
│  │ /recall  │ │  /scan   │                       │
│  └──────────┘ └──────────┘                       │
│                                                   │
│  Plugins: invoked on demand via /commands         │
└─────────────────────────────────────────────────┘
```

**The skill** ensures Claude always writes correct Agent SDK code. **The plugins** ensure the code is high quality, tested, maintainable, and reviewed from multiple angles.

### Full Setup (All Tools)

```bash
# 1. Add the plugin marketplace
# (Inside Claude Code)
/plugin marketplace add xiaolai/claude-plugin-marketplace

# 2. Install all plugins
claude plugin install grill@xiaolai --scope user
claude plugin install tdd-guardian@xiaolai --scope user
claude plugin install codex-toolkit@xiaolai --scope user
claude plugin install echo-sleuth@xiaolai --scope user
claude plugin install loc-guardian@xiaolai --scope user

# 3. Install the Agent SDK skill
git clone https://github.com/xiaolai/claude-agent-sdk-skill-autoupdated \
  ~/.claude/skills/claude-agent-sdk-skill-autoupdated

# 4. (Optional) Auto-update the skill daily
(crontab -l 2>/dev/null; echo "0 9 * * * cd ~/.claude/skills/claude-agent-sdk-skill-autoupdated && git pull -q") | crontab -

# 5. Install Codex CLI (required for codex-toolkit)
npm install -g @openai/codex
codex login

# 6. Install tokei (required for loc-guardian)
brew install tokei

# 7. Restart Claude Code
claude
```

---

## Appendix: Troubleshooting

### Plugin Issues

| Problem | Solution |
|---------|----------|
| `/plugin` command not found | Update Claude Code: `npm update -g @anthropic-ai/claude-code` (need v1.0.33+) |
| Plugin commands don't appear | Restart Claude Code after installation |
| `codex-toolkit` commands fail | Run `/codex-toolkit:preflight` to check connectivity |
| `loc-guardian:scan` errors | Verify tokei is installed: `tokei --version` |
| TDD gates blocking everything | Set `TDD_GUARD_BYPASS=1` temporarily, or adjust config thresholds |
| Duplicate Codex MCP servers | If Codex is already in `~/.claude/config.json`, remove the duplicate |

### Skill Issues

| Problem | Solution |
|---------|----------|
| Skill not loading | Verify path: `ls ~/.claude/skills/claude-agent-sdk-skill-autoupdated/SKILL.md` |
| Stale SDK information | Run `cd ~/.claude/skills/claude-agent-sdk-skill-autoupdated && git pull` |
| Auto-correction not triggering | Check file naming — rules trigger on `*agent*.ts` or `*agent*.py` patterns |
| Skill conflicts with project rules | Project `.claude/` rules take precedence over user-level skills |

### General

- **Plugins** are invoked explicitly via `/plugin-name:command`. If nothing happens, the plugin may not be installed or enabled.
- **Skills** are passive. You don't invoke them. If Claude isn't using the SDK skill, check that the skill directory exists and restart Claude Code.
- Both repos are MIT-licensed and maintained by xiaolai. The SDK skill costs ~$3-6/day to maintain (paid by the maintainer); users pay nothing.

---

*Last updated: 2026-02-27*
