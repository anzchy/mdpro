# Mecha.im: The Complete Guide to Running an Army of AI Bots

> **Last updated**: 2026-03-29 · **Mecha version**: v4.1.14

## Table of Contents

1. [What is Mecha.im?](#1-what-is-mechaim)
2. [Architecture Overview](#2-architecture-overview)
3. [Case Study: How xiaolai Uses Mecha.im on VMark](#3-case-study-how-xiaolai-uses-mechaim-on-vmark)
4. [Setup Guide](#4-setup-guide)
5. [Creating Your First Bot](#5-creating-your-first-bot)
6. [The Audit Bot — Automated Codebase Scanning](#6-the-audit-bot--automated-codebase-scanning)
7. [The Fixer Bot — Automated Issue Resolution](#7-the-fixer-bot--automated-issue-resolution)
8. [Bot-to-Bot Communication](#8-bot-to-bot-communication)
9. [The Full Multi-Bot Pipeline](#9-the-full-multi-bot-pipeline)
9b. [Workflows — DAG-Based Multi-Bot Orchestration](#9b-workflows--dag-based-multi-bot-orchestration)
10. [Cost Management](#10-cost-management)
11. [Setting Up Mecha.im for Your Own Projects](#11-setting-up-mechaim-for-your-own-projects)
12. [Advanced Patterns and Best Practices](#12-advanced-patterns-and-best-practices)
13. [Cross-Model Verification — Claude + Codex](#13-cross-model-verification--claude--codex)
14. [Slash Commands for Power Users](#14-slash-commands-for-power-users)
15. [Real-World Numbers](#15-real-world-numbers)

---

## 1. What is Mecha.im?

**Mecha** (v4.1.14) is an open-source platform for running autonomous Claude Code bots as native OS processes. Think of it as a fleet manager for AI agents — you spawn bots via CLI, and Mecha handles:

- **Native process sandboxing** — each bot runs as an OS process isolated by `sandbox-exec` (macOS) or `bwrap` (Linux), no Docker required
- **Scheduling** — bots run prompts on recurring intervals (e.g., every hour, every day)
- **Webhooks** — bots react to external events via the built-in HTTP server
- **Bot-to-bot communication** — bots discover each other via mDNS (LAN) or Tailscale mesh
- **Cost tracking** — metering proxy tracks per-bot API spend in real time
- **Dashboard** — fleet-wide visibility via web SPA and REST API
- **Workflows** — DAG-based multi-bot orchestration with human-approval gates

**The key insight**: xiaolai doesn't just use one AI assistant. He runs an *army* of specialized bots — one audits the codebase, another fixes the issues it finds, another reviews PRs, another manages releases. Each bot has a narrow, well-defined role with safety rails.

**Repository**: [github.com/xiaolai/mecha.im](https://github.com/xiaolai/mecha.im)

---

## 2. Architecture Overview

### Daemon + Bot Process Model

```
~/.mecha/                              ~/.mecha/<botname>/
──────────────────────────              ──────────────────────
Agent daemon (port 7660)                CLAUDE.md    ← identity + system prompt
Meter proxy  (port 7600)                config.json  ← all spawn settings
MCP server   (port 7680)                state.json   ← running/stopped/error
Rendezvous   (port 7681)                logs/        ← stdout.log, stderr.log
Dashboard    (port 3457)                tmp/         ← TMPDIR for this bot
                                        .claude/projects/<ws>/
                                          *.jsonl    ← session transcripts
```

**There is no Docker.** Each bot is a native OS process sandboxed by `sandbox-exec` on macOS or `bwrap` on Linux (configurable — `auto`, `off`, or `require`). The daemon (`mecha start`) manages all bot processes and exposes a unified REST API.

### Monorepo Package Structure

The repo is organized as a TypeScript monorepo under `packages/`:

| Package | Role |
|---------|------|
| `cli` | All CLI commands |
| `agent` | HTTP agent server + SPA dashboard API |
| `runtime` | Claude Agent SDK integration |
| `process` | Bot process lifecycle management |
| `sandbox` | OS-level sandboxing (macOS/Linux) |
| `bus` | Message bus (topics + queues) |
| `teams` | Multi-bot team management |
| `workflow` | YAML workflow engine (DAG + gates) |
| `meter` | API cost metering proxy |
| `observe` | Traces + metrics |
| `connect` | P2P connectivity layer |
| `mcp-server` | Embedded MCP server |
| `core` | Shared types, schemas, constants |
| `spa` | Optional web dashboard |

### Default Ports

| Service | Port |
|---------|------|
| Agent server (daemon) | 7660 |
| Bot process range | 7700–7799 |
| Meter proxy | 7600 |
| Embedded MCP server | 7680 |
| Rendezvous server | 7681 |
| Dashboard (SPA) | 3457 |

### How Bots Work Internally

1. The daemon starts (`mecha start`), launching the agent server, meter proxy, and MCP server
2. Each spawned bot is a child process running the **Claude Agent SDK** with its `CLAUDE.md` as system prompt
3. Bots expose an HTTP endpoint on their assigned port (7700–7799)
4. The **Scheduler** fires prompts on recurring intervals (e.g., `--every 1h`)
5. The **SessionManager** tracks tasks (source: interactive / schedule / webhook / interbot)
6. Bots have MCP tools: `mecha_call` (talk to other bots), `mecha_list` (discover bots), `mecha_new_session` (reset conversation)

### Bot Discovery (Mesh Networking)

Bots discover each other via two mechanisms (no Tailscale required for LAN use):
- **mDNS** — automatic LAN discovery (added in v4.1.11)
- **Tailscale/Headscale** — cross-machine mesh networking

### Safety Rails

- **Per-bot budget cap** — configurable `maxBudgetUsd` in `config.json`
- **Session budget** — `maxBudgetUsd` per conversation
- **Aggregate budget** — `budgetLimit` across all sessions
- **Max turns** — configurable (default 25, max 100)
- **Auto-pause after errors** — bot stops scheduling on repeated failures
- **Skip if busy** — won't interrupt an active task
- **`bypassPermissions` requires sandbox** — enforced at spawn time
- **`settingSources`** — headless bots can exclude user-level Claude settings

---

## 3. Case Study: How xiaolai Uses Mecha.im on VMark

VMark is a Tauri v2 + React 19 desktop Markdown editor, **entirely written by AI under human supervision**. The project explicitly states: "We welcome issues but cannot safely merge external PRs." This is possible because xiaolai has built a fully automated pipeline using multiple cooperating bots.

### The Bot Ecosystem

xiaolai's VMark project uses **two complementary systems** that share the same philosophy:

#### System A: GitHub Actions (claude-code-action) — Cloud Bots

VMark uses Anthropic's official [`claude-code-action`](https://github.com/anthropics/claude-code-action) for its GitHub-based automation. These run as GitHub Actions workflows, triggered by events:

| Workflow | Trigger | What It Does |
|----------|---------|--------------|
| `claude-audit.yml` | Daily at 9am UTC + manual | Scans codebase, creates audit issues |
| `claude.yml` (audit-fix) | Issue with `audit` label opened | Reads issue, applies fix, opens PR |
| `claude.yml` (claude) | Issue/PR opened, `@claude` mention | Reviews issues/PRs, responds to mentions |
| `claude-cost-report.yml` | Daily at noon UTC | Aggregates Claude usage costs into an issue |

#### System B: Mecha.im — Self-Hosted Bots

Mecha.im is xiaolai's separate project for running bots on your own infrastructure — ideal for more complex, ongoing operations that need persistent state, bot-to-bot coordination, custom scheduling, or privacy (code never leaves your machines). While VMark's current automation uses GitHub Actions, Mecha.im provides the same patterns with more control and bot-to-bot mesh networking.

**When to use which:**
- **GitHub Actions (`claude-code-action`)** — simpler setup, GitHub-native triggers, no infrastructure to manage, great for open-source projects
- **Mecha.im** — self-hosted, persistent bots, bot-to-bot communication, custom scheduling, workspace mounting, fleet dashboard, suited for private repos or complex multi-bot workflows

#### The Agent Squad (defined in `.claude/agents/`)

VMark has **9 specialized agents**, each with a narrow scope:

| Agent | Role | Tools Allowed |
|-------|------|---------------|
| **auditor** | Reviews diffs for correctness, edge cases, spec compliance | Read, Grep |
| **planner** | Turns goals into modular work items with tests | Read, Grep |
| **impact-analyst** | Finds minimum correct file impact per work item | Read, Grep |
| **spec-guardian** | Validates changes against project rules and specs | Read, Grep |
| **implementer** | Implements changes with TDD (RED/GREEN/REFACTOR) | Read, Edit, Bash |
| **test-runner** | Runs tests in smallest-to-broadest order | Read, Bash |
| **verifier** | Final gate check before commit | Read, Bash |
| **manual-test-author** | Writes manual testing guides | Read, Edit, Grep |
| **release-steward** | Prepares commit messages and release notes | Read, Bash |

**Key principle**: Agents that only *analyze* get Read/Grep only. Agents that *change code* get Edit/Bash. This is deliberate — it prevents the auditor from accidentally fixing things, and prevents the implementer from bypassing review.

---

## 4. Setup Guide

### Prerequisites

- **macOS or Linux** (no Docker required)
- **Claude Code CLI** installed (for the bot runtime)
- An **Anthropic API key** — or a **Claude Pro/Max OAuth token** (see below)
- **Tailscale** (optional, for cross-machine mesh networking — LAN bots auto-discover via mDNS)

### Installation

```bash
# Install via Homebrew (recommended)
brew install xiaolai/tap/mecha

# Initialize — creates ~/.mecha/ structure, generates node ID
mecha init

# Start the daemon (agent server + meter proxy + MCP server)
mecha start

# Or start in background (daemon mode)
mecha start -d

# Check daemon status
mecha status

# Optional: health check
mecha doctor
```

### Authentication Setup

```bash
# Option 1: Environment variable (simplest)
export ANTHROPIC_API_KEY=sk-ant-...

# Option 2: Named profiles (recommended for multiple keys/bots)
mecha auth add anthropic-main sk-ant-...
mecha auth add anthropic-backup sk-ant-...

# Option 3: Claude Pro/Max OAuth (subscription-based — no API billing)
# Set this env var before spawning bots (added in v4.1.12)
export CLAUDE_SETUP_TOKEN_ACCESS=your-oauth-access-token
export CLAUDE_SETUP_TOKEN_REFRESH=your-oauth-refresh-token

# List profiles
mecha auth list
```

**Pro tip from xiaolai's AGENTS.md**: Prefer subscription auth (Claude Max) over API keys for sustained coding sessions — API billing can cost 10-30x more.

---

## 5. Creating Your First Bot

### Quick Bot Spawn

```bash
# Spawn a simple bot (daemon must be running: mecha start)
mecha bot spawn greeter --system-prompt "You greet people warmly."

# Chat with it
mecha bot chat greeter "Hello!"

# Check status of all bots
mecha bot ls

# View logs
mecha bot logs greeter

# Stop and remove
mecha bot stop greeter
mecha bot remove greeter
```

### Production Bot (with schedule + workspace)

```bash
# Spawn a reviewer bot with a workspace and recurring schedule
mecha bot spawn reviewer \
  ./myproject \
  --system-prompt "You are a code reviewer. Review PRs for bugs, security issues, and style violations. Output findings ordered by severity." \
  --model claude-sonnet-4-6 \
  --auth anthropic-main \
  --max-budget-usd 1.00 \
  --permission-mode default \
  --sandbox auto

# Add a recurring schedule (runs every 30 minutes)
mecha schedule add reviewer \
  --id pr-check \
  --every 30m \
  --prompt "Check for new unreviewed PRs."

# List schedules
mecha schedule list reviewer

# Trigger a schedule run immediately
mecha schedule run reviewer --id pr-check
```

> **Note**: Schedules use `--every <interval>` (e.g., `30s`, `5m`, `1h`, `24h`), not cron expressions. There is no cron-syntax scheduler in the current release.

### Bot Directory and Config

When you spawn a bot, Mecha creates `~/.mecha/<botname>/`:

```
reviewer/
├── CLAUDE.md           ← your --system-prompt becomes this file
├── config.json         ← all settings stored here
├── state.json          ← running/stopped/error
├── logs/
│   ├── stdout.log
│   └── stderr.log
└── .claude/projects/   ← session transcripts (.jsonl)
```

You can inspect or edit `config.json` directly:

```json
{
  "configVersion": 1,
  "port": 7700,
  "model": "claude-sonnet-4-6",
  "permissionMode": "default",
  "auth": "anthropic-main",
  "maxBudgetUsd": 1.00,
  "sandboxMode": "auto",
  "workspace": "/path/to/myproject",
  "tags": ["reviewer"],
  "expose": ["chat"],
  "sessionPersistence": true,
  "fallbackModel": "claude-haiku-4-5",
  "meter": "on",
  "settingSources": ["project", "user"]
}
```

After editing `config.json`, restart the bot: `mecha bot restart reviewer`

### Full `mecha bot spawn` Options

```
mecha bot spawn <name> [workspace-path]
  --system-prompt <text>          Full system prompt (written to CLAUDE.md)
  --append-system-prompt <text>   Append to default system prompt
  --model <model>                 LLM model (e.g. claude-opus-4-6)
  --fallback-model <model>        Fallback on overload
  --auth <profile>                Named auth profile
  --no-auth                       Spawn without credentials
  --permission-mode <mode>        default|plan|bypassPermissions|acceptEdits|dontAsk|auto
  --sandbox <auto|off|require>    Sandbox mode (default: auto)
  --max-budget-usd <N>            Max USD per session
  --budget-limit <N>              Aggregate USD cap across all sessions
  --effort <low|medium|high>      Reasoning depth
  --allowed-tools <tools>         Whitelist tools (comma-separated)
  --disallowed-tools <tools>      Blacklist tools
  --tools <tools>                 Override entire tool set
  --add-dir <dirs>                Additional allowed directories
  --agent <preset>                Named agent preset
  --tags <tags>                   Comma-separated tags
  --expose <caps>                 Capabilities to expose to mesh
  --meter <on|off>                Metering mode
  --mcp-config <paths>            MCP config file paths
  --strict-mcp-config             Only use specified MCP servers
  --disable-slash-commands        Disable all skills
  --dangerously-skip-permissions  Requires --sandbox require
  -p/--port <N>                   Override listen port
```

**Validation rules enforced at spawn time:**
- `--system-prompt` and `--append-system-prompt` are mutually exclusive
- `--allowed-tools` and `--tools` are mutually exclusive
- `--permission-mode bypassPermissions` requires `--sandbox require`
- `--dangerously-skip-permissions` requires `--sandbox require`

---

## 6. The Audit Bot — Automated Codebase Scanning

This is the most powerful pattern xiaolai uses. Here's exactly how the VMark daily audit works:

### GitHub Actions Workflow (`claude-audit.yml`)

```yaml
name: Claude Periodic Audit

on:
  schedule:
    - cron: "0 9 * * *"    # Daily at 9am UTC
  workflow_dispatch:        # Manual trigger from Actions tab

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          show_full_output: true
          claude_args: "--model opus --allowedTools Bash,Read,Glob,Grep,WebSearch,WebFetch"
          prompt: |
            You are a codebase auditor for **MyProject**.

            Use the run ID (${{ github.run_id }}) as a seed to randomly pick
            5-6 dimensions from the list below. Rotate target directories so
            successive runs cover different parts of the codebase.

            ## Audit Dimensions
            ### 1. Dead code
            ### 2. Type safety
            ### 3. Error handling
            ### 4. Performance
            ### 5. Security
            ### 6. Test coverage gaps
            ... (your project-specific dimensions)

            ## Rules
            - High confidence only — no speculative findings
            - Skip cosmetics — no style/naming nitpicks
            - One issue per finding
            - Issue format:
              - Title: `[audit] <category>: <concise problem>`
              - Body: file path + line, impact, suggested fix
              - Labels: `audit` + category label
            - If nothing found, create no issues
```

### What Makes This Audit Design Brilliant

1. **Randomized dimensions**: Each daily run picks 5-6 random audit areas from a list of 19 dimensions. This means the codebase gets thoroughly covered over time without each run being overwhelming.

2. **Rotating targets**: The run ID seeds randomization, ensuring different parts of the codebase are checked on successive runs.

3. **High-confidence only**: The prompt explicitly instructs "no speculative findings" to avoid noise.

4. **Structured output**: Each finding becomes a separate GitHub issue with the `audit` label, specific file paths, impact explanation, and suggested fix.

5. **Restricted tools**: The audit bot only gets `Read, Glob, Grep, WebSearch, WebFetch` — no `Edit` or `Write`. It can only observe and report.

### VMark's 19 Audit Dimensions (Real Example)

Here are the actual categories xiaolai uses for VMark:

1. **Menu system sync** — Check menu definitions stay in sync across Rust/TypeScript/docs
2. **Zustand store safety** — Missing null checks, incorrect persist patterns, store destructuring
3. **Hot exit & session integrity** — Race conditions, non-atomic writes, orphaned tabs
4. **MCP bridge error handling** — Missing try/catch, unhandled responses, type safety
5. **MCP sidecar reliability** — WebSocket reconnection, unhandled rejections, lifecycle gaps
6. **Plugin CSS isolation** — Style leakage, hardcoded colors, missing design tokens
7. **CodeMirror source mode edge cases** — IME composition, multi-cursor, circular deps
8. **Multi-cursor correctness** — Selection overlap, undo/redo corruption, boundary cases
9. **Rust backend safety** — unwrap() on user input, missing error propagation, panic paths
10. **Cross-platform regressions** — Hardcoded paths, missing platform guards
11. **Test coverage & quality** — Untested stores, `any` in tests, snapshot overuse
12. **Type safety** — unsafe casts, `any` usage, swallowed errors
13. **Performance** — Missing selectors, O(n^2) loops, lazy loading opportunities
14. **Data integrity** — Content loss paths, localStorage quota, file watcher races
15. **Dependency health** — CVEs, deprecated APIs, unused deps
16. **Dead code** — Unused exports, unreachable branches, orphaned files
17. **Export & network resilience** — Missing retries/timeouts, partial failure recovery
18. **Terminal subsystem correctness** — PTY spawning, IME composition, flow control
19. **Accessibility & link security** — Missing ARIA, keyboard nav gaps, rel="noopener"

### How to Adapt This for Your Project

Create your own dimension list based on your tech stack:

```yaml
# For a Next.js + Supabase project, your dimensions might be:
# 1. RLS policy gaps — tables without proper row-level security
# 2. API route safety — missing auth checks, input validation
# 3. Client-side data exposure — service role key leaks
# 4. React re-render issues — missing memoization, selector patterns
# 5. Error boundary coverage — unhandled component errors
# 6. Type safety — `any` usage, unsafe casts
# 7. Dead code — unused components, routes, API endpoints
# 8. Dependency vulnerabilities — known CVEs
# 9. Performance — N+1 queries, missing indexes, unbounded fetches
# 10. Accessibility — missing alt text, keyboard navigation
```

---

## 7. The Fixer Bot — Automated Issue Resolution

Here's the second half of the pipeline — the bot that *fixes* what the audit bot finds.

### GitHub Actions Workflow (`claude.yml` — audit-fix job)

```yaml
jobs:
  audit-fix:
    runs-on: ubuntu-latest
    concurrency:
      group: audit-fix-${{ github.event.issue.number }}
      cancel-in-progress: false

    # Only triggers on issues with the 'audit' label
    if: >-
      github.event_name == 'issues' &&
      contains(github.event.issue.labels.*.name, 'audit')

    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: actions/setup-node@v6
        with:
          node-version: 22

      # Install project dependencies so tests can run
      - uses: dtolnay/rust-toolchain@stable
      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev ...
      - name: Install dependencies
        run: npm install -g pnpm && pnpm install --frozen-lockfile

      - uses: anthropics/claude-code-action@v1
        with:
          allowed_bots: "claude[bot]"
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: "--model opus --allowedTools Bash Read Write Edit Glob Grep MultiEdit Skill Agent"
          show_full_output: true
          prompt: |
            Fix the audit issue described in GitHub issue #${{ github.event.issue.number }}.

            1. Read issue body with `gh issue view ${{ github.event.issue.number }}`
            2. Apply the suggested fix
            3. Run `pnpm check:all` to verify gates pass
            4. If Rust code touched, also run `cargo check`
            5. Create a PR that includes `Closes #${{ github.event.issue.number }}` in body
            6. Enable auto-merge: `gh pr merge --auto --squash`

            If the fix causes test or compilation failures, adjust until gates pass.
```

### The Complete Audit-to-Fix Flow

```
Daily Audit (9am UTC)
  │
  ├── Scans codebase with 5-6 random dimensions
  ├── Finds dead code in markdownPipeline
  ├── Creates issue #416: "[audit] dead-code: unused barrel re-exports"
  │     Labels: audit, dead-code
  │     Body: file paths, line numbers, impact, suggested fix
  │
  └── Creates issue #415: "[audit] dead-code: parsingCache.ts never wired"
        Labels: audit, dead-code

Issue #416 created → triggers audit-fix job
  │
  ├── Reads issue body
  ├── Removes unused re-exports
  ├── Runs pnpm check:all (tests, lint, build)
  ├── Opens PR #417: "fix: remove unused barrel re-exports"
  │     Body: "Closes #416"
  │     Author: app/claude
  └── Enables auto-merge

PR #417 merged → Issue #416 auto-closed
```

### Real Examples from VMark

Here are actual audit issues and their corresponding fix PRs:

| Audit Issue | Fix PR | What Was Found/Fixed |
|------------|--------|---------------------|
| #414 `[audit] cross-platform: bare Command::new("where")` — PATH hijacking risk | #422 `fix: use absolute path for where.exe` | Replaced bare `where` with absolute `%WINDIR%\System32\where.exe` |
| #413 `[audit] export: file read twice for size measurement` | #420 `fix: avoid reading files twice during export` | Eliminated redundant file reads |
| #412 `[audit] export: image filename collisions` | #418 `fix: deduplicate image filenames during folder export` | Added deduplication logic |
| #416 `[audit] dead-code: unused barrel re-exports` | #417 `fix: remove unused barrel re-exports` | Removed dead exports |
| #415 `[audit] dead-code: parsingCache.ts never wired` | #419 `fix: remove dead parsingCache module` | Deleted orphaned module |

Every single PR was authored by `app/claude` — no human wrote any of these fixes.

---

## 8. Bot-to-Bot Communication

Mecha bots discover and communicate with each other via two mechanisms:

- **mDNS (LAN)** — automatic zero-config discovery on the local network (no Tailscale needed, added in v4.1.11)
- **Tailscale/Headscale mesh** — cross-machine networking; manage with `mecha node` commands

For local single-machine setups, mDNS works out of the box. For multi-machine deployments, use `mecha node init` and `mecha node join <invite-token>` to connect machines.

### Built-in MCP Tools

Every mecha bot has three communication tools:

#### `mecha_call` — Send a prompt to another bot

```typescript
// Internal implementation
async function callBot(botName: string, message: string): Promise<string> {
  const url = `http://mecha-${botName}:3000/prompt`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min timeout
  });
  // Parse SSE stream, collect text response
  return result;
}
```

#### `mecha_list` — Discover available bots

Returns all bots on the mesh network with their status.

#### `mecha_new_session` — Reset a bot's conversation

Useful for giving a bot a clean slate before a new task.

### Example: Auditor Calls Fixer

```bash
# Spawn auditor bot
mecha bot spawn auditor \
  --system-prompt "You audit codebases for bugs, dead code, and security issues. When you find issues, call the fixer bot using mecha_call('fixer', 'Fix this: <description>') for each finding." \
  --model claude-opus-4-6 \
  --allowed-tools "Read,Grep,Glob"

# Add daily schedule
mecha schedule add auditor \
  --id daily-audit \
  --every 24h \
  --prompt "Audit the codebase. For each issue, call the fixer bot."

# Spawn fixer bot (writable workspace)
mecha bot spawn fixer \
  ./myproject \
  --system-prompt "You fix code issues. When called, read the description, apply the fix, run tests, and commit." \
  --model claude-sonnet-4-6 \
  --permission-mode acceptEdits
```

---

## 9. The Full Multi-Bot Pipeline

Here's the complete pipeline xiaolai has built for VMark, combining GitHub Actions and local agent definitions:

### Layer 1: Continuous Monitoring (GitHub Actions)

```
┌─────────────────────────────────────────────────────────────┐
│  claude-audit.yml (Daily 9am UTC)                          │
│  ┌─────────┐    ┌──────────┐    ┌──────────────────┐       │
│  │ Checkout │───>│ Run Opus │───>│ Create Issues    │       │
│  │ code     │    │ auditor  │    │ with [audit] tag │       │
│  └─────────┘    └──────────┘    └──────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                                          │
                                          ▼ triggers
┌─────────────────────────────────────────────────────────────┐
│  claude.yml — audit-fix job                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────┐  │
│  │ Read     │───>│ Apply    │───>│ Run      │───>│ Open │  │
│  │ issue    │    │ fix      │    │ tests    │    │ PR   │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────┘  │
└─────────────────────────────────────────────────────────────┘
                                                       │
                                                       ▼ triggers
┌─────────────────────────────────────────────────────────────┐
│  claude.yml — claude job (PR review)                        │
│  ┌─────────────────────────────────┐                        │
│  │ Review PR, leave sticky comment │                        │
│  │ with "Fix this" links           │                        │
│  └─────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  claude-cost-report.yml (Daily noon UTC)                    │
│  ┌──────────────────────────────────────────────────┐       │
│  │ Aggregate costs from all Claude runs,            │       │
│  │ create issue with token/cost breakdown           │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Layer 2: Interactive Development (Claude Code Agents)

When xiaolai works on features interactively with Claude Code, the agents in `.claude/agents/` form a pipeline:

```
User Request: "Add tab escape from auto-pairs"
        │
        ▼
┌───────────────┐     ┌─────────────────┐
│   planner     │────>│ impact-analyst  │
│ (Research +   │     │ (Min file set)  │
│  Work Items)  │     │                 │
└───────────────┘     └─────────────────┘
        │                     │
        ▼                     ▼
┌───────────────┐     ┌─────────────────┐
│ spec-guardian  │     │  implementer   │
│ (Rule check)  │     │ (TDD: RED →    │
│               │     │  GREEN → REFAC) │
└───────────────┘     └─────────────────┘
                              │
                              ▼
                      ┌─────────────────┐
                      │  test-runner    │
                      │ (Unit → Gate)   │
                      └─────────────────┘
                              │
                              ▼
                      ┌─────────────────┐
                      │   verifier      │
                      │ (Final check)   │
                      └─────────────────┘
                              │
                              ▼
                      ┌─────────────────┐
                      │ release-steward │
                      │ (Commit msg)    │
                      └─────────────────┘
```

### Layer 3: External Event Response

```
User files bug report on GitHub
        │
        ▼
claude.yml (claude job) triggers
        │
        ▼
Claude reads issue, triages, may:
  ├── Ask clarifying questions
  ├── Suggest a fix approach
  └── Apply fix + open PR (if straightforward)

User mentions @claude in PR review
        │
        ▼
claude.yml responds to the specific comment
```

---

## 9b. Workflows — DAG-Based Multi-Bot Orchestration

Mecha v4.1+ introduces a **workflow engine** that lets you define multi-step, multi-bot pipelines in YAML with dependency ordering, conditional execution, human-approval gates, and automatic rollback compensation.

### Workflow YAML Schema

```yaml
# ~/.mecha/workflows/audit-fix.yaml
name: audit-fix
description: Daily audit + auto-fix pipeline
trigger:
  schedule: "24h"
  manual: true

inputs:
  target_dir:
    type: string
    default: "./src"

budgetUsd: 10.0

steps:
  audit:
    bot: auditor
    prompt: |
      Audit the codebase in {{ inputs.target_dir }}.
      Report findings as JSON array with fields: file, line, severity, description, suggestedFix.
    output: findings
    timeout: 15m
    budgetUsd: 3.0

  human-review:
    bot: auditor          # any bot can host a gate
    depends: [audit]
    gate: human           # pauses; resume with: mecha wf approve <name> <run-id> human-review
    prompt: "Review the audit findings and approve or cancel."

  fix-issues:
    bot: fixer
    depends: [human-review]
    prompt: "Apply fixes for these findings: {{ steps.audit.output }}"
    compensate: "Revert the last commit and restore original state."
    maxRetries: 2
    budgetUsd: 5.0

outputs:
  findings: "{{ steps.audit.output }}"
```

### Running Workflows

```bash
# Run a workflow
mecha wf run audit-fix

# Run with custom input
mecha wf run audit-fix --input target_dir=./packages/core

# Dry-run (no actual bot calls)
mecha wf run audit-fix --dry-run

# List active runs
mecha wf runs audit-fix

# Approve a human gate
mecha wf approve audit-fix <run-id> human-review

# Cancel a run
mecha wf cancel audit-fix <run-id>

# Rate a completed run (1-5)
mecha wf rate audit-fix <run-id> 5
```

### Parallel Steps

Steps without `depends:` run in parallel. This enables true multi-bot fan-out:

```yaml
steps:
  audit-frontend:
    bot: auditor
    prompt: "Audit ./src/frontend"

  audit-backend:
    bot: auditor
    prompt: "Audit ./src/backend"

  synthesize:
    bot: planner
    depends: [audit-frontend, audit-backend]
    prompt: "Combine findings and prioritize: {{ steps.audit-frontend.output }} {{ steps.audit-backend.output }}"
```

---

## 10. Cost Management

### Daily Cost Reports

VMark runs a dedicated workflow (`claude-cost-report.yml`) at noon UTC that:

1. Queries all Claude workflow runs from the last 24 hours
2. Extracts token counts, costs, and durations from logs
3. Creates a GitHub issue with a detailed breakdown table:

```markdown
## Claude Cost Report — 2026-03-15

| Workflow | Run | Duration | Turns | Input Tokens | Output Tokens | Cache Created | Cache Read | Cost (USD) |
|----------|-----|----------|-------|-------------|--------------|--------------|------------|------------|
| claude-audit | #12345 | 8.2m | 15 | 250000 | 45000 | 120000 | 80000 | $2.15 |
| claude | #12346 | 3.1m | 8 | 95000 | 18000 | 0 | 60000 | $0.85 |

**Total: 2 runs, $3.00 USD**
```

### Per-Bot Budget Caps (Mecha)

```bash
# Set at spawn time
mecha bot spawn mybot --max-budget-usd 1.00

# Or update after spawn
mecha bot configure mybot --max-budget-usd 1.00

# Set aggregate cap across all sessions
mecha bot spawn mybot --budget-limit 5.00

# Monitor costs across fleet
mecha cost
mecha budget
```

The metering proxy (`mecha meter`) runs on port 7600 and intercepts all Anthropic API calls to track spend in real time. Since v4.1.13, it starts automatically with `mecha start`.

### Cost Optimization Tips

1. **Use subscription auth** — Claude Max is dramatically cheaper for sustained sessions
2. **Use `sonnet` for routine tasks** — Reserve `opus` for audits and complex fixes
3. **Restrict tools** — Fewer tools = fewer tokens = lower cost
4. **Set `max_turns`** — Prevents runaway conversations
5. **Daily limit** — Scheduler caps at 50 runs/day per bot

---

## 11. Setting Up Mecha.im for Your Own Projects

### Step 1: Project Instrumentation

Before spawning bots, your project needs to be "bot-friendly":

#### Create `AGENTS.md` (shared instructions for all bots)

```markdown
# AGENTS.md

Shared instructions for all AI agents.

## Working Agreement
- Run `git status -sb` at session start
- Read relevant files before editing
- Keep diffs focused; avoid drive-by refactors
- Do not commit unless explicitly requested
- Run `npm test` before proposing changes

## Tech Stack
- [Your stack here]

## Code Standards
- [Your standards here]

## Testing Requirements
- [Your testing approach]
```

#### Create `CLAUDE.md` (just imports AGENTS.md)

```markdown
# CLAUDE.md
@AGENTS.md
```

#### Create `.claude/agents/` (specialized agents)

Start with these three essential agents:

**`.claude/agents/auditor.md`**:
```markdown
---
name: auditor
description: Audits logic, duplication, and dead-code risks.
tools: Read, Grep
---

You review code for:
- correctness and edge cases
- dead code and unused imports
- security vulnerabilities
- performance issues

Output:
- Findings ordered by severity
- "Must fix" vs "Nice to have"
```

**`.claude/agents/implementer.md`**:
```markdown
---
name: implementer
description: Implements scoped changes with tests.
tools: Read, Edit, Bash
---

You implement one change at a time:
- Start with failing tests
- Implement minimally
- Refactor without behavior change
- Run gates before proposing commit
```

**`.claude/agents/verifier.md`**:
```markdown
---
name: verifier
description: Final verification before commit.
tools: Read, Bash
---

You verify:
- All tests pass
- No regressions introduced
- Acceptance criteria satisfied
```

### Step 2: Set Up GitHub Actions for Cloud Bots

#### Audit Workflow (`.github/workflows/claude-audit.yml`)

```yaml
name: Claude Periodic Audit

on:
  schedule:
    - cron: "0 9 * * *"
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: "--model opus --allowedTools Bash,Read,Glob,Grep,WebSearch,WebFetch"
          prompt: |
            You are a codebase auditor for this project.

            Randomly pick 3-5 areas to audit:
            1. Dead code and unused exports
            2. Type safety issues (any casts, missing types)
            3. Error handling gaps (swallowed errors, missing catch)
            4. Security issues (injection, XSS, exposed secrets)
            5. Test coverage gaps
            6. Performance anti-patterns
            7. Dependency vulnerabilities

            Rules:
            - High confidence only
            - One issue per finding
            - Title: `[audit] <category>: <problem>`
            - Body: file path, line, impact, suggested fix
            - Labels: `audit`
```

#### Fix Workflow (`.github/workflows/claude-fix.yml`)

```yaml
name: Claude Auto-Fix

on:
  issues:
    types: [opened, reopened]

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  audit-fix:
    runs-on: ubuntu-latest
    if: contains(github.event.issue.labels.*.name, 'audit')
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: "--model opus --allowedTools Bash Read Write Edit Glob Grep"
          prompt: |
            Fix the audit issue in #${{ github.event.issue.number }}.

            1. Read the issue: `gh issue view ${{ github.event.issue.number }}`
            2. Apply the fix
            3. Run `npm test` to verify
            4. Create a PR with `Closes #${{ github.event.issue.number }}`
            5. Enable auto-merge: `gh pr merge --auto --squash`
```

#### Issue/PR Responder (`.github/workflows/claude.yml`)

```yaml
name: Claude Code

on:
  issues:
    types: [opened, reopened]
  pull_request:
    types: [opened, synchronize]
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  claude:
    runs-on: ubuntu-latest
    if: >-
      (github.event_name == 'issues' && !contains(github.event.issue.labels.*.name, 'audit')) ||
      (github.event_name == 'pull_request') ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude'))
    steps:
      - uses: actions/checkout@v6
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: "--model opus"
          use_sticky_comment: true
          include_fix_links: true
```

### Step 3: Add GitHub Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions:

```
CLAUDE_CODE_OAUTH_TOKEN = your-claude-oauth-token
```

### Step 4: Set Up Mecha Bots (Self-Hosted)

```bash
# Install and initialize
brew install xiaolai/tap/mecha
mecha init

# Start the daemon
mecha start -d

# Set up auth
mecha auth add main sk-ant-...

# Spawn your audit bot (read-only, no workspace writes needed)
mecha bot spawn auditor \
  ./my-project \
  --system-prompt "You audit codebases for bugs, dead code, and security issues. Create detailed reports of your findings." \
  --model claude-opus-4-6 \
  --auth main \
  --max-budget-usd 2.00 \
  --allowed-tools "Read,Grep,Glob,Bash"

# Add a daily audit schedule (runs every 24 hours)
mecha schedule add auditor \
  --id daily-audit \
  --every 24h \
  --prompt "Audit the codebase. Focus on: 1. Dead code 2. Security vulnerabilities 3. Error handling gaps. Report findings in structured format."

# Spawn your fixer bot (writable workspace)
mecha bot spawn fixer \
  ./my-project \
  --system-prompt "You fix code issues identified by the auditor. Apply minimal, focused fixes. Run tests after each change." \
  --model claude-sonnet-4-6 \
  --auth main \
  --max-budget-usd 1.00 \
  --permission-mode acceptEdits

# Check fleet status
mecha bot ls

# Open the dashboard
mecha start --open
# Visit http://localhost:3457
```

### Step 5: Optional — Claude Code Plugins

xiaolai uses several Claude Code plugins for enhanced capabilities:

```json
// .claude/settings.json
{
  "enabledPlugins": {
    "codex-toolkit@xiaolai": true,
    "tdd-guardian@xiaolai": true
  }
}
```

Available plugins from xiaolai's marketplace:

| Plugin | Purpose |
|--------|---------|
| **codex-toolkit** | OpenAI Codex MCP integration — audit, implement, verify |
| **tdd-guardian** | Test-first workflow enforcement, coverage gates, mutation testing |
| **grill** | Deep codebase interrogation with 6 agents, 5 review styles |
| **loc-guardian** | Enforce per-file line-of-code limits |
| **docs-guardian** | Documentation freshness and accuracy checking |
| **echo-sleuth** | Mine past conversations for decisions and patterns |

### Step 6: Add Rules (`.claude/rules/`)

Break your project conventions into modular, numbered rule files:

```
.claude/rules/
├── 00-engineering-principles.md   # Core standards
├── 10-tdd.md                      # Test-driven development rules
├── 20-logging-and-docs.md         # Documentation requirements
├── 30-ui-consistency.md           # UI/design patterns
├── 40-version-bump.md             # Version management
└── 50-codebase-conventions.md     # Project-specific conventions
```

Rules are auto-loaded into Claude's context. They serve as the "law" that both human developers and AI agents follow.

---

## 12. Advanced Patterns and Best Practices

### Pattern 1: The Prompt Refinement Hook

VMark uses a Claude Code hook that intercepts user prompts starting with `>>` and refines them using Claude Haiku before submission:

```json
// .claude/settings.json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/refine_prompt.sh",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

```bash
#!/bin/bash
# .claude/hooks/refine_prompt.sh
input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# Only trigger on >> prefix
[[ "$prompt" =~ ^'>>' ]] || exit 0

text="${prompt#>>}"
# Refine with Haiku (cheap, fast)
result=$(claude -p --model haiku <<EOF
Rewrite this prompt to be clearer and more specific:
$text
EOF
)

echo "$result" | pbcopy
echo "{\"decision\":\"block\",\"reason\":\"Refined (copied):\n$result\"}"
```

### Pattern 2: Vibe Coding — Issues Only, No PRs

VMark explicitly states: "We welcome issues but cannot safely merge external PRs." The reasoning:

> VMark is vibe-coded — written entirely by AI under human supervision. When you file an issue, AI fixes it with full context of the project's conventions, test suite, and architecture.

This works because:
1. The AI has full project context (AGENTS.md, rules, settings)
2. External PRs lack this context and may violate conventions
3. The audit-fix pipeline automatically converts issues to tested, rule-compliant PRs

### Pattern 3: Concurrency Control

```yaml
# Only one fix per issue at a time
concurrency:
  group: audit-fix-${{ github.event.issue.number }}
  cancel-in-progress: false

# Cancel old reviews when PR is updated
concurrency:
  group: claude-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

### Pattern 4: Graduated Permissions

```
auditor    → Read, Grep only         (can't modify anything)
planner    → Read, Grep only         (can't modify anything)
implementer → Read, Edit, Bash       (can change code)
verifier   → Read, Bash              (can run tests, can't edit)
```

This follows the principle of least privilege. An auditor that can also edit might be tempted to "fix as it goes" — creating unreviewed changes.

### Pattern 5: Cost-Aware Model Selection

```yaml
# Audit (needs deep reasoning) → Opus
claude_args: "--model opus --allowedTools Bash,Read,Glob,Grep"

# PR review (routine) → default (Sonnet)
claude_args: "--model opus"

# Prompt refinement hook → Haiku (cheapest)
claude -p --model haiku
```

### Pattern 6: Workspace Mounting Best Practices

```bash
# Read-only workspace (default) — for auditing and analysis
mecha bot spawn auditor ./myproject --allowed-tools "Read,Grep,Glob"

# Writable workspace — only for bots that need to make changes
mecha bot spawn fixer ./myproject --permission-mode acceptEdits

# Multiple directories (add extra paths beyond workspace)
mecha bot spawn mybot ./main-project --add-dir ./shared-lib --add-dir ./config
```

When a bot has a mounted workspace:
- It loads `.claude/settings.json`, `CLAUDE.md`, and skills from the project
- It follows the project's conventions automatically
- Changes are visible on the host filesystem

### Pattern 7: The Self-Improving Codebase

xiaolai's `claude-agent-sdk-skill-autoupdated` repo shows another pattern — a bot that:

1. Watches for SDK version bumps daily
2. Researches new GitHub issues
3. Updates documentation rules
4. Keeps skills accurate as the underlying SDK evolves

This creates a "living documentation" system where docs never go stale.

---

## Quick Reference

### Mecha CLI Commands

**Daemon lifecycle:**

| Command | Description |
|---------|-------------|
| `mecha init` | Initialize `~/.mecha/`, generate node ID |
| `mecha start [-d]` | Start daemon (agent server + meter + MCP) |
| `mecha start --open` | Start daemon and open dashboard in browser |
| `mecha stop` | Stop daemon |
| `mecha status` | Show daemon status |
| `mecha doctor` | Health check (auth, port, deps) |

**Bot management (`mecha bot ...`):**

| Command | Description |
|---------|-------------|
| `mecha bot spawn <name> [path] [opts]` | Spawn a new bot |
| `mecha bot start <name>` | Start a stopped bot |
| `mecha bot stop <name>` | Stop a bot |
| `mecha bot stop-all` | Stop all bots |
| `mecha bot restart <name>` | Restart a bot |
| `mecha bot restart-all` | Restart all bots |
| `mecha bot remove <name>` | Remove a bot |
| `mecha bot ls` | List all bots |
| `mecha bot status <name>` | Bot status |
| `mecha bot logs <name>` | View bot logs |
| `mecha bot chat <name> "prompt"` | Send a prompt to a bot |
| `mecha bot configure <name> [opts]` | Update bot config |
| `mecha bot sessions <name>` | List conversation sessions |
| `mecha bot activity <name>` | View recent activity |

**Schedules (`mecha schedule ...`):**

| Command | Description |
|---------|-------------|
| `mecha schedule add <bot> --id <id> --every <interval> --prompt <text>` | Add schedule |
| `mecha schedule list <bot>` | List schedules |
| `mecha schedule remove <bot> --id <id>` | Remove schedule |
| `mecha schedule pause <bot> --id <id>` | Pause schedule |
| `mecha schedule resume <bot> --id <id>` | Resume schedule |
| `mecha schedule run <bot> --id <id>` | Trigger immediately |
| `mecha schedule history <bot>` | View run history |

Interval formats: `30s`, `5m`, `1h`, `24h` (no cron expression support)

**Workflows (`mecha workflow` or `mecha wf`):**

| Command | Description |
|---------|-------------|
| `mecha wf list` | List workflows |
| `mecha wf run <name> [--input k=v]` | Run a workflow |
| `mecha wf runs <name>` | List workflow runs |
| `mecha wf approve <name> <run-id> <step>` | Approve human gate |
| `mecha wf cancel <name> <run-id>` | Cancel run |

**Auth and observability:**

| Command | Description |
|---------|-------------|
| `mecha auth add <profile> <key>` | Add auth profile |
| `mecha auth list` | List auth profiles |
| `mecha cost` | View API costs |
| `mecha budget` | Manage budgets |
| `mecha trace list` | List traces |
| `mecha metrics bot` | Bot metrics |

### Essential File Structure

```
your-project/
├── AGENTS.md                          # Shared AI agent instructions
├── CLAUDE.md                          # Points to AGENTS.md
├── .claude/
│   ├── settings.json                  # Permissions, hooks, plugins
│   ├── agents/                        # Specialized agent definitions
│   │   ├── auditor.md
│   │   ├── implementer.md
│   │   └── verifier.md
│   ├── rules/                         # Auto-loaded convention rules
│   │   ├── 00-engineering-principles.md
│   │   └── 10-tdd.md
│   ├── skills/                        # Claude Code skills (slash commands)
│   └── hooks/                         # Prompt hooks (pre/post processing)
├── .github/
│   ├── workflows/
│   │   ├── claude-audit.yml           # Daily codebase audit
│   │   ├── claude.yml                 # Issue/PR responder + audit fixer
│   │   └── claude-cost-report.yml     # Daily cost tracking
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.yml
│       └── feature_request.yml
└── .mcp.json                          # MCP server configuration
```

### The Automation Pyramid

```
         ┌──────────┐
         │  Human   │  Strategic decisions, feature direction
         │  Owner   │  Reviews bot output, approves merges
         └────┬─────┘
              │
     ┌────────┴────────┐
     │  Opus Auditor   │  Deep analysis, finds subtle bugs
     │  (Daily cron)   │  Creates structured GitHub issues
     └────────┬────────┘
              │
     ┌────────┴────────┐
     │  Opus Fixer     │  Reads issue, applies fix, runs tests
     │  (Event-driven) │  Opens PR with auto-merge
     └────────┬────────┘
              │
     ┌────────┴────────┐
     │ Sonnet Reviewer │  Reviews all PRs (bot and human)
     │ (Event-driven)  │  Sticky comments with "Fix this" links
     └────────┬────────┘
              │
     ┌────────┴────────┐
     │  Cost Reporter  │  Tracks spending across all bots
     │  (Daily cron)   │  Creates summary issues
     └─────────────────┘
```

---

## 13. Cross-Model Verification — Claude + Codex

One of xiaolai's most sophisticated patterns is **using different AI models to check each other's work**. VMark uses Claude (Anthropic) for code generation and OpenAI Codex for auditing — deliberately pitting two different AI systems against each other.

### How It Works

The `.codex-toolkit.md` configuration sets up Codex with `gpt-5.3-codex` model, high effort, and quality-first audit focus. The `/fix-issue` slash command includes a **Codex cross-audit loop**:

```
Fix Issue Flow:
1. Claude reads the GitHub issue
2. Claude implements the fix (with TDD)
3. Claude runs tests (pnpm check:all)
4. Codex audits Claude's fix (via codex-toolkit plugin)
5. If Codex finds problems → Claude revises (max 3 iterations)
6. Only after Codex approves → PR is created
```

### Why Cross-Model Verification Matters

- **Blind spots**: Every AI model has systematic biases. Claude might consistently miss a certain class of bugs that Codex catches, and vice versa.
- **Adversarial checking**: When one model knows its output will be reviewed by a different model, the overall quality bar rises.
- **Confidence signal**: If two independent AI systems agree a fix is correct, confidence is much higher than a single model self-reviewing.

### Setting It Up

1. Install the codex-toolkit plugin:
```json
// .claude/settings.json
{
  "enabledPlugins": {
    "codex-toolkit@xiaolai": true
  }
}
```

2. The plugin provides MCP integration that lets Claude invoke Codex for audit, verification, and review tasks.

---

## 14. Slash Commands for Power Users

VMark has **6 powerful slash commands** defined in `.claude/commands/` that orchestrate complex multi-agent workflows:

### `/fix-issue` — End-to-End Issue Resolver

The most automated command. It:
1. Reads a GitHub issue
2. Plans the fix using the planner agent
3. Implements with TDD (RED → GREEN → REFACTOR)
4. Runs Codex cross-audit (up to 3 iterations)
5. Opens a PR with `Closes #N`
6. Supports **parallel multi-issue execution via git worktrees** — you can fix multiple issues simultaneously, each in its own isolated worktree

### `/feature-workflow` — Multi-Agent Feature Development

Orchestrates the full agent squad for feature development:
1. Planner → research + work items
2. Impact-analyst → minimum file set
3. Spec-guardian → rule compliance check
4. Implementer → TDD implementation
5. Test-runner → gate execution
6. Verifier → final checklist
7. Release-steward → commit message

### `/fix` — Root-Cause Bug Fixing

Focused bug fixing that emphasizes finding root causes rather than patching symptoms. Enforces TDD — every fix must start with a failing test that proves the bug exists.

### `/bump` — Version Bump

Updates version across 5 coordinated files (package.json, Cargo.toml, tauri.conf.json, etc.) to keep versions in sync.

### `/merge-prs` — Review and Merge Open PRs

Batch-reviews and merges outstanding PRs after running all gates.

### `/test-guide` — Generate Manual Testing Guide

Produces human-readable testing instructions for manual QA verification of changes.

---

## 15. Real-World Numbers

Based on actual data from the VMark repository:

### Scale of Automation

| Metric | Value |
|--------|-------|
| Total audit issues created by claude[bot] | **100+** (all closed) |
| PRs authored by app/claude | **41** (mostly auto-merged) |
| Agent definitions | **9** specialized agents |
| Claude Code rules | **13** auto-loaded rule files |
| Claude Code skills | **17** skill directories |
| Slash commands | **6** complex orchestration commands |
| Audit dimensions | **19** categories to rotate through |
| Test coverage threshold | **99.89%** statements, **99.97%** functions |

### Daily Costs (Actual VMark Data)

| Day | Cost (USD) | Notes |
|-----|-----------|-------|
| Typical low day | ~$11 | Audit + a few issue fixes |
| Typical high day | ~$44 | Audit + many issue fixes + PR reviews |
| Average | ~$18-20/day | Estimated from cost report issues |

These costs cover:
- One daily audit run (Opus model — the most expensive part)
- Multiple auto-fix runs (triggered by audit findings)
- PR reviews for both bot and human PRs
- `@claude` mention responses

### Example: A Single Day's Autonomous Output

On a typical day, the pipeline might produce:
1. **9am** — Audit bot scans 5-6 dimensions, creates 3-5 issues
2. **9:05-9:30am** — Fixer bot processes each issue, creates 3-5 PRs
3. **9:30am** — Each PR gets auto-reviewed with sticky comments
4. **Auto-merge** — PRs that pass all gates merge automatically
5. **12:00pm** — Cost report summarizes the day's spending

All of this happens with **zero human intervention**. The human (xiaolai) reviews the output at their convenience — checking merged PRs, reviewing cost reports, and steering the project's direction.

### The "Shared Agent Instructions" Pattern

A key architectural decision: **all AI agents share the same `AGENTS.md` file**. The `CLAUDE.md`, `GEMINI.md`, and Codex config all import from `AGENTS.md`. This means:

- Rules are written once, enforced everywhere
- Switching between Claude Code, Codex CLI, and Gemini CLI gives consistent behavior
- New rules immediately apply to all agents
- No drift between different AI tools

```markdown
# CLAUDE.md (entire file)
@AGENTS.md

## Claude-specific notes
- Add Claude-only guidance here if needed (keep rules in AGENTS.md).
```

```markdown
# GEMINI.md (entire file)
@AGENTS.md
```

---

## Summary

xiaolai's approach with Mecha.im represents a paradigm shift: **the human becomes the architect and supervisor, while an army of specialized AI bots handles the daily grind of code quality, bug fixing, and maintenance**.

The key principles:

1. **Specialize aggressively** — each bot does one thing well with the minimum permissions needed
2. **Audit and fix are separate** — the finder should never be the fixer (separation of concerns)
3. **Automate the pipeline** — audit creates issues → issues trigger fixes → fixes create PRs → PRs get reviewed
4. **Cross-model verification** — use Claude to write, Codex to audit — never let a model review its own work alone
5. **Budget everything** — track costs daily, cap per-bot spending, use cheaper models for routine tasks
6. **Rules are law** — AGENTS.md + `.claude/rules/` ensure every bot follows the same conventions
7. **Issues > PRs** — when AI writes the code, external PRs break context; issues let the AI fix things properly
8. **Safety rails everywhere** — daily limits, timeouts, error pausing, budget caps, permission restrictions
9. **Shared instructions** — one `AGENTS.md` file drives Claude, Codex, and Gemini identically
