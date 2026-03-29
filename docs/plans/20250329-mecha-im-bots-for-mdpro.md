# Mecha.im Bots for mdpro — Setup Plan

> **Date**: 2026-03-29
> **Scope**: Local/self-hosted audit bot + fixer bot using Mecha.im, OAuth setup, and GitHub Actions IP/VPN analysis

---

## Table of Contents

1. [Overview](#1-overview)
2. [mdpro Audit Dimensions (Adapted)](#2-mdpro-audit-dimensions-adapted)
3. [Audit Bot — Creation & Prompt](#3-audit-bot--creation--prompt)
4. [Fixer Bot — Creation & Prompt](#4-fixer-bot--creation--prompt)
5. [Bot-to-Bot Workflow (Mecha Workflow YAML)](#5-bot-to-bot-workflow-mecha-workflow-yaml)
6. [OAuth Setup](#6-oauth-setup)
7. [GitHub Actions IP Exposure Q\&A](#7-github-actions-ip-exposure-qa)
8. [VPN Routing via GitHub Actions → HK → US Residential](#8-vpn-routing-via-github-actions--hk--us-residential)

---

## 1. Overview

This plan sets up two self-hosted bots using **Mecha.im** (v4.1.14) running as native macOS processes — **no GitHub Actions, no Docker**. The pattern mirrors xiaolai's VMark audit pipeline but is adapted to mdpro's specific stack and conventions.

```
┌─────────────────┐       mecha_call       ┌─────────────────┐
│   mdpro-auditor │ ─────────────────────► │   mdpro-fixer   │
│  (Opus, RO)     │                        │  (Sonnet, RW)   │
│  Daily 2am      │                        │  Event-driven   │
└─────────────────┘                        └─────────────────┘
        │                                          │
        │ writes findings to                       │ applies fixes,
        │ ~/.mecha/mdpro-auditor/                  │ runs pnpm build,
        │   audit-findings.md                      │ cargo check,
        └──────────────────────────────────────────┘
                                                   │
                                         ┌─────────▼─────────┐
                                         │  Human reviews    │
                                         │  diff + approves  │
                                         └───────────────────┘
```

**Why local (Mecha) over GitHub Actions:**

- Code never leaves your machine
- No network round-trip to GitHub — faster iteration
- Persistent state between runs (mDNS bot-to-bot discovery)
- Dashboard at `http://localhost:3457` for fleet visibility
- Works on private repos with no GitHub setup
- No per-minute billing (uses Claude subscription via OAuth)

---

## 2. mdpro Audit Dimensions (Adapted)

These are derived from VMark's 19 dimensions but adapted for mdpro's specific stack: Tauri 2.0, React 19, CodeMirror 6, Milkdown 7, Zustand 4, MCP server, and the project's `.claude/rules/`.

### The 17 Audit Dimensions

| #  | Dimension                             | Stack Layer                                                               | VMark Inspiration                 |
| -- | ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| 1  | **Keyboard shortcut sync**            | `menu.rs` ↔ `preferences.ts` ↔ `docs/`                                    | Menu system sync                  |
| 2  | **Zustand anti-patterns**             | `src/stores/`                                                             | Zustand store safety              |
| 3  | **IPC trust boundaries**              | `src-tauri/src/commands/`                                                 | MCP bridge error handling         |
| 4  | **Rust backend safety**               | `src-tauri/src/`                                                          | Rust backend safety               |
| 5  | **Draft & auto-save races**           | `src/hooks/useAutoSave.ts`, `src-tauri/src/services/draft.rs`             | Hot exit & session integrity      |
| 6  | **File watcher correctness**          | `src-tauri/src/services/file_watcher.rs`                                  | Data integrity                    |
| 7  | **Milkdown WYSIWYG edge cases**       | `src/plugins/milkdown/`, `src/hooks/useMilkdown.ts`                       | *(mdpro-specific)*                |
| 8  | **CodeMirror source mode edge cases** | `src/plugins/codemirror/`, `src/components/Editor/`                       | CodeMirror source mode edge cases |
| 9  | **Plugin CSS isolation**              | `src/plugins/*/styles/`                                                   | Plugin CSS isolation              |
| 10 | **MCP shadow store correctness**      | `src-tauri/src/services/shadow_store.rs`, `src-tauri/src/commands/mcp.rs` | MCP sidecar reliability           |
| 11 | **Type safety**                       | `src/**/*.ts(x)`                                                          | Type safety                       |
| 12 | **Logging completeness**              | All new features                                                          | *(mdpro rule 20)*                 |
| 13 | **Test coverage gaps**                | `src/**/*.test.ts(x)`                                                     | Test coverage & quality           |
| 14 | **Dead code**                         | All layers                                                                | Dead code                         |
| 15 | **Export & HTML rendering**           | `src/services/exportService.ts`, `src-tauri/src/commands/export.rs`       | Export & network resilience       |
| 16 | **Dependency health**                 | `package.json`, `Cargo.toml`                                              | Dependency health                 |
| 17 | **Version file sync**                 | `package.json`, `tauri.conf.json`, `Cargo.toml`                           | *(mdpro rule 40)*                 |

### Detailed Dimension Descriptions

```
1. KEYBOARD SHORTCUT SYNC (Rule 41)
   Check: src-tauri/src/menu.rs, src/types/preferences.ts (DEFAULT_KEYBOARD_SHORTCUTS),
          docs/guide/keyboard-shortcuts.md
   Look for: Shortcuts defined in menu.rs not present in preferences.ts defaults,
             shortcuts in docs that don't match menu.rs accelerators,
             new menu items added without doc updates.

2. ZUSTAND ANTI-PATTERNS (Rule 50 §1)
   Check: src/stores/*.ts, src/components/**/*.tsx, src/hooks/*.ts
   Look for: Store values destructured at component top-level (should use selectors),
             stale closures in callbacks (should use useXStore.getState()),
             store not reset in beforeEach in test files,
             missing TypeScript generics on create<State>().

3. IPC TRUST BOUNDARIES (Rule 30 §IPC)
   Check: src-tauri/src/commands/*.rs
   Look for: #[tauri::command] functions that use user-supplied path/string without
             validation, .unwrap() or .expect() on invoke arguments,
             commands returning Option<T> instead of Result<T, String>,
             MCP tool handlers missing arg validation before touching shadow_store.

4. RUST BACKEND SAFETY
   Check: src-tauri/src/**/*.rs
   Look for: unwrap()/expect() on user-input-derived values (path operations,
             string parsing), missing ? propagation in command handlers,
             panic! in non-test code, unchecked index operations on user data.

5. DRAFT & AUTO-SAVE RACES (Rule 30 §Race Conditions)
   Check: src/hooks/useAutoSave.ts, src-tauri/src/services/draft.rs,
          src-tauri/src/commands/draft.rs
   Look for: Auto-save timer not cancelled on document close (save fires after close),
             save_draft writing without checking if a newer draft exists,
             non-atomic draft file writes (partial write on crash),
             load_draft not comparing timestamps before restoring.

6. FILE WATCHER CORRECTNESS
   Check: src-tauri/src/services/file_watcher.rs, src/hooks/useFileWatcher.ts
   Look for: External change events not debounced (rapid saves queue multiple reloads),
             watcher not removed when document is closed,
             file:changed events emitted for writes made by mdpro itself (self-trigger),
             missing platform guards for watcher backends.

7. MILKDOWN WYSIWYG EDGE CASES (new in 002/003 sprints)
   Check: src/plugins/milkdown/*.ts, src/hooks/useMilkdown.ts
   Look for: Plugin initialization not guarded against editor unmount race,
             ProseMirror schema conflicts between plugins,
             commands dispatched after editor destroyed,
             missing cleanup in useEffect return for listener subscriptions,
             circular imports between milkdown plugins.

8. CODEMIRROR SOURCE MODE EDGE CASES
   Check: src/plugins/codemirror/*.ts, src/components/Editor/
   Look for: IME composition events not handled (breaks CJK input),
             multi-cursor operations not tested,
             circular dependencies between CM extensions,
             extensions registering duplicate facets.

9. PLUGIN CSS ISOLATION
   Check: src/plugins/**/*.css, src/styles/*.css
   Look for: Plugin styles defined in global stylesheets (should be co-located),
             hardcoded color values instead of CSS variables/design tokens,
             selectors broad enough to affect elements outside the plugin's scope,
             missing :host or scoped class wrapper.

10. MCP SHADOW STORE CORRECTNESS
    Check: src-tauri/src/services/shadow_store.rs, src-tauri/src/commands/mcp.rs
    Look for: Shadow store not updated when frontend opens/closes documents,
              write_document emitting mcp:write_document with non-serializable payload,
              read_document returning stale content (debounce gap not handled),
              MCP tool handlers not holding the Mutex correctly (potential deadlock),
              shadow store content modified without notifying listeners.

11. TYPE SAFETY
    Check: src/**/*.ts, src/**/*.tsx
    Look for: `any` type annotations, `as SomeType` unsafe casts,
              `catch (e) { ... (e as Error).message ... }` (should narrow with instanceof),
              optional chaining missing where null is possible,
              return types omitted on exported functions.

12. LOGGING COMPLETENESS (Rule 20)
    Check: recently modified src/**/*.ts, src-tauri/src/**/*.rs
    Look for: New Tauri commands missing Start + Success/Fail log_event pairs,
              console.log() in any committed TypeScript (should use loggingService),
              println!/eprintln! in committed Rust (should use logger::log_event),
              loggingService calls missing actionId,
              new frontend features not logging ui.<component>.<action> events.

13. TEST COVERAGE GAPS (Rule 10)
    Check: src/stores/*.ts vs src/stores/*.test.ts,
           src/hooks/*.ts vs src/hooks/*.test.ts,
           src/services/*.ts vs src/services/*.test.ts
    Look for: Store files with no corresponding .test.ts,
              hooks with no renderHook tests,
              bug fix commits without regression tests,
              pure utility functions with no table-driven tests,
              tests using snapshot assertions instead of explicit assertions.

14. DEAD CODE
    Check: src/**/*.ts(x), src-tauri/src/**/*.rs
    Look for: Exported functions/components never imported anywhere,
              mod declarations in Rust with no usages,
              feature flags or commented-out code blocks,
              orphaned CSS classes,
              unused dependencies in package.json or Cargo.toml.

15. EXPORT & HTML RENDERING
    Check: src/services/exportService.ts, src-tauri/src/commands/export.rs,
           src-tauri/src/services/html_template.rs, src-tauri/src/services/markdown.rs
    Look for: DOMPurify not applied to markdown-to-HTML output before export,
              image path resolution not handling all editor modes (split/wysiwyg/source),
              filename collisions during folder export with multiple images,
              missing error handling when the output path is not writable,
              XSS vectors in HTML template (user-controlled data interpolated without escaping).

16. DEPENDENCY HEALTH
    Check: package.json, src-tauri/Cargo.toml
    Look for: npm packages with known CVEs (run `pnpm audit`),
              Rust crates with advisories (run `cargo audit`),
              deprecated Tauri 2.x APIs called (check tauri-apps/tauri changelog),
              Milkdown APIs that have changed in the latest 7.x minor.

17. VERSION FILE SYNC (Rule 40)
    Check: package.json "version", src-tauri/tauri.conf.json "version",
           src-tauri/Cargo.toml [package] version
    Look for: Any of the three files having a different version string.
              Run: grep '"version"' package.json src-tauri/tauri.conf.json
                   grep '^version' src-tauri/Cargo.toml
```

---

## 3. Audit Bot — Creation & Prompt

### Step 1: Install Mecha and start daemon

```bash
# Install
brew install xiaolai/tap/mecha

# Initialize (creates ~/.mecha/)
mecha init

# Start daemon in background
mecha start -d

# Verify
mecha status
mecha doctor
```

### Step 2: Set up auth

**Get tokens from Keychain Access.app**: open Keychain Access → search `oauth.claude`
→ right-click → Copy Password. The password is a base64-encoded JSON blob. Decode it:

```bash
security find-generic-password -a "oauth.claude" -w | python3 -c "
import json, sys, base64
d = json.loads(sys.stdin.read().strip())
parsed = json.loads(base64.b64decode(d['data']))
oauth = parsed['claudeAiOauth']
print('accessToken:', oauth['accessToken'])
print('refreshToken:', oauth['refreshToken'])
"
```

```bash
# Option A: API key (simplest, always works)
mecha auth add mdpro-main --api-key --token sk-ant-api03-YOUR_KEY_HERE
mecha auth test mdpro-main

# Option B: Claude subscription OAuth
# Note: Claude Code OAuth tokens (sk-ant-oat01-...) are scoped to claude.ai, not
# api.anthropic.com. Mecha's --oauth type may not work unless Mecha routes OAuth
# traffic to the claude.ai endpoint. Use Option A if Option B returns HTTP 401.
mecha auth add mdpro-oauth --oauth --token sk-ant-oat01-YOUR_ACCESS_TOKEN

# Register the refresh token (used to renew when access token expires)
mecha auth renew mdpro-oauth sk-ant-ort01-YOUR_REFRESH_TOKEN

mecha auth test mdpro-oauth   # must show success before proceeding
```



### Step 3: Spawn the audit bot

```bash
mecha bot spawn mdpro-auditor /Users/jackcheng/Documents/01_Coding/mac-app/mdpro --model claude-opus-4-6 --auth mdpro-main --max-budget-usd 3.00 --budget-limit 20.00 --permission-mode default --allowed-tools "Read,Grep,Glob,Bash" --sandbox auto --tags "audit,mdpro" --system-prompt "$(cat ~/.mecha/prompts/mdpro-auditor.md)"
```

> The `--system-prompt` reads from a file we create in the next step.

### Step 4: Write the audit bot system prompt

Save to `~/.mecha/prompts/mdpro-auditor.md`:

```markdown
# mdpro Audit Bot

You are a codebase auditor for **mdpro** — a local macOS Markdown editor built with
Tauri 2.0 (Rust backend) + React 19 (TypeScript frontend), CodeMirror 6, Milkdown 7,
and Zustand 4.

## Mission

Scan the codebase for bugs, safety issues, and convention violations. Each run:
1. Use the current date/time as a seed to **randomly select 4–6 dimensions** from
   the list below.
2. Rotate the files you examine so successive runs cover different parts of the repo.
3. Report each finding as a self-contained, actionable item.

## Audit Dimensions

Pick 4-6 randomly each run:

1. **Keyboard shortcut sync** — Compare menu.rs accelerators with
   src/types/preferences.ts DEFAULT_KEYBOARD_SHORTCUTS and
   docs/guide/keyboard-shortcuts.md.
2. **Zustand anti-patterns** — Store destructuring in components, stale closures
   in callbacks, missing getState() in event handlers.
3. **IPC trust boundaries** — Tauri commands accepting user input without validation,
   unwrap()/expect() on user-supplied data, commands not returning Result<T, String>.
4. **Rust backend safety** — unwrap/expect/panic in non-test command handlers,
   missing ? propagation.
5. **Draft & auto-save races** — Timer not cancelled on doc close, non-atomic writes,
   stale draft restored over newer content.
6. **File watcher correctness** — Events not debounced, self-trigger on mdpro's own
   writes, watcher not cleaned up on close.
7. **Milkdown WYSIWYG edge cases** — Plugin init race conditions, schema conflicts,
   commands dispatched after editor destroyed, circular imports.
8. **CodeMirror source mode edge cases** — IME composition not handled, duplicate
   facets, circular CM extension dependencies.
9. **Plugin CSS isolation** — Styles in global sheets, hardcoded colors, broad selectors.
10. **MCP shadow store correctness** — Stale reads, deadlock risks in Mutex usage,
    non-serializable event payloads.
11. **Type safety** — `any` annotations, unsafe `as Type` casts, missing error narrowing.
12. **Logging completeness** — console.log in TS, println!/eprintln! in Rust, missing
    Start/Success/Fail log pairs, missing actionId.
13. **Test coverage gaps** — Stores/hooks/utils without test files, no regression tests
    for bug fixes, snapshot tests over explicit assertions.
14. **Dead code** — Unused exports, orphaned Rust mods, commented-out blocks.
15. **Export & HTML rendering** — Missing DOMPurify on output, XSS vectors in template,
    image path resolution gaps, filename collisions.
16. **Dependency health** — CVEs in npm packages or Rust crates, deprecated Tauri 2.x APIs.
17. **Version file sync** — package.json, tauri.conf.json, Cargo.toml must all match.

## Output Rules

- **High confidence only** — skip if you are not sure. No speculative findings.
- **One finding per item** — do not bundle multiple issues.
- **Actionable format** for each finding:
```

### [SEVERITY] category: short problem description

**File**: `path/to/file.rs` (line N–M)
**Impact**: what breaks or what risk this creates
**Fix**: concrete change needed

```
Severity: BLOCK | MUST | SHOULD | NOTE (from .claude/rules/30-review-checklist.md)
- If no findings: output "✓ No issues found for this run" and stop.
- Do not fix anything. Do not edit files. Read-only analysis only.

## After Generating Findings

Write findings to `~/.mecha/mdpro-auditor/audit-findings.md` with a timestamp header.
Then call the fixer bot via `mecha_call('mdpro-fixer', findings_text)` for any
BLOCK or MUST severity items. Pass only those items — not SHOULD or NOTE.
```

### Step 5: Add the daily schedule

```bash
# Runs every 24h, starting from next midnight
mecha schedule add mdpro-auditor   
  --id daily-audit   
  --every 24h   
  --prompt "Run a full audit cycle. Pick 4-6 random dimensions, scan the codebase, report findings, and call the fixer for BLOCK/MUST items."

# List schedules to confirm
mecha schedule list mdpro-auditor

# Test immediately
mecha schedule run mdpro-auditor --id daily-audit
```

### Step 6: Monitor

```bash
# Watch audit bot logs
mecha bot logs mdpro-auditor

# Or tail the findings file
tail -f ~/.mecha/mdpro-auditor/audit-findings.md

# Check fleet status
mecha bot ls
```

---

## 4. Fixer Bot — Creation & Prompt

The fixer bot has write access to the workspace. It receives findings from the auditor
via `mecha_call`, applies the minimum fix, runs verification gates, and writes a
summary for human review.

### Spawn the fixer bot

```bash
mecha bot spawn mdpro-fixer /Users/jackcheng/Documents/01_Coding/mac-app/mdpro --model claude-sonnet-4-6 --auth mdpro-main --max-budget-usd 2.00 --budget-limit 15.00 --permission-mode acceptEdits --allowed-tools "Read,Edit,Bash,Glob,Grep,MultiEdit,Agent" --sandbox auto --tags "fixer,mdpro" --system-prompt "$(cat ~/.mecha/prompts/mdpro-fixer.md)"
```

### Write the fixer bot system prompt

Save to `~/.mecha/prompts/mdpro-fixer.md`:

````markdown
# mdpro Fixer Bot

You are a code fixer for **mdpro** — a local macOS Markdown editor built with
Tauri 2.0 + React 19 + TypeScript + Rust.

## Mission

Fix code issues reported by the mdpro-auditor. You receive a structured finding
(or a list of findings). For each finding:

1. **Read the affected file(s)** first. Understand the full context.
2. **Apply the minimum correct fix** — do not refactor surrounding code, add
   features, or change behavior beyond what the finding describes.
3. **Run verification gates** (see below) after each fix.
4. **Report the outcome** — what you changed, which tests pass/fail.

## Project Context

Tech stack:
- Rust 2021 Edition backend (src-tauri/), React 19 + TypeScript frontend (src/)
- CodeMirror 6 for source/split mode, Milkdown 7 for WYSIWYG mode
- Zustand 4 for state, Tauri 2.0 IPC
- Tests: Vitest (frontend), cargo test (Rust)

Key rules you MUST follow (from .claude/rules/):
- Never destructure Zustand stores at component top level
- Tauri commands must return Result<T, String>, never unwrap user input
- Logging: use loggingService.logEventSync() in TS, logger::log_event() in Rust
- Every significant feature needs Start + Success/Fail log pairs
- Keep files under ~300 lines
- Do not commit changes — human reviews diffs first

## Verification Gates

After each fix, run in this order and stop if anything fails:

```bash
# Frontend (always run)
pnpm build            # TypeScript compile + Vite build

# Rust (if any .rs file was changed)
cd src-tauri && cargo check

# Tests (if any .test.ts file was touched or new tests added)
pnpm test:run
````

If a gate fails: diagnose the error, fix it, re-run. Max 3 attempts per finding.
If still failing after 3 attempts: write a `BLOCKED: <reason>` note and move on.

## Output Format

After processing all findings, write a summary to
`~/.mecha/mdpro-fixer/fix-report-<YYYYMMDD>.md`:

```markdown
# Fix Report — <date>

## Fixed
- [finding title]: <what changed> — gates: ✓
  Files: path/to/file.ts:N

## Blocked
- [finding title]: <why it couldn't be auto-fixed>

## Skipped
- [finding title]: <why it was skipped (e.g. already fixed)>
```

## Important Constraints

- Do NOT commit anything. Human reviews the diff and commits manually.
- Do NOT open PRs (this is a local repo with no GitHub remote for bots).
- Do NOT add features, refactor unrelated code, or add comments beyond what is needed.
- If a fix requires touching more than 3 files, flag it as BLOCKED for human review.

````

---

## 5. Bot-to-Bot Workflow (Mecha Workflow YAML)

Instead of relying on the auditor calling `mecha_call` ad hoc, define a formal
workflow with a human-review gate:

Save to `~/.mecha/workflows/mdpro-audit-fix.yaml`:

```yaml
# ~/.mecha/workflows/mdpro-audit-fix.yaml
name: mdpro-audit-fix
description: Daily audit + conditional auto-fix pipeline for mdpro
trigger:
  schedule: "24h"
  manual: true

budgetUsd: 6.0

steps:
  audit:
    bot: mdpro-auditor
    prompt: |
      Run a full audit cycle. Pick 4-6 random dimensions, scan the codebase,
      and return findings as structured text (one finding per item with SEVERITY,
      category, file path, impact, and fix description).
      Return ONLY BLOCK and MUST severity items in your output.
    output: findings
    timeout: 20m
    budgetUsd: 3.0

  human-review:
    bot: mdpro-auditor
    depends: [audit]
    gate: human
    prompt: |
      Review the audit findings above and decide which to auto-fix.
      Approve to proceed with auto-fix, or cancel to handle manually.

  fix-issues:
    bot: mdpro-fixer
    depends: [human-review]
    prompt: |
      Fix these audit findings:
      {{ steps.audit.output }}

      Follow all rules in your system prompt. Run verification gates.
      Write a fix report to ~/.mecha/mdpro-fixer/fix-report.md.
    compensate: |
      Run: cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro && git checkout -- .
      This reverts all uncommitted changes.
    maxRetries: 2
    budgetUsd: 3.0

outputs:
  findings: "{{ steps.audit.output }}"
````

### Running the workflow

```bash
# Run the full pipeline
mecha wf run mdpro-audit-fix

# Approve the human gate when prompted
mecha wf approve mdpro-audit-fix <run-id> human-review

# Skip human gate (run fully automated — use with caution)
mecha wf run mdpro-audit-fix --auto-approve

# See active runs
mecha wf runs mdpro-audit-fix

# Cancel a run
mecha wf cancel mdpro-audit-fix <run-id>
```

---

## 6. OAuth Setup

### Option A: API Key (simplest)

```bash
mecha auth add mdpro-main sk-ant-YOUR_ANTHROPIC_KEY
```

Use this if you have API credits. The metering proxy tracks per-bot spend.

### Option B: Claude Pro/Max OAuth Token (subscription billing)

This uses your existing Claude subscription and is dramatically cheaper for
sustained coding sessions (API billing can be 10–30x more expensive).

#### Step 1: Get the OAuth tokens from your Claude Code CLI

Claude Code stores OAuth tokens after you authenticate. Find them:

```bash
# Claude Code credentials file (macOS)
cat ~/.claude/.credentials.json
```

You'll see something like:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1234567890000,
    "scopes": ["claude.ai", "claude_code"]
  }
}
```

> **Note**: If this file doesn't exist, run `claude` in a terminal and complete
> the OAuth flow first (`/login` in Claude Code).

#### Step 2: Register with Mecha

`--oauth` marks the profile type. Pass the access token via `--token` explicitly —
Mecha does **not** read from environment variables automatically:

```bash
mecha auth add mdpro-oauth --oauth --token sk-ant-oat01-YOUR_ACCESS_TOKEN
```

Register the refresh token separately using the `renew` subcommand:

```bash
mecha auth renew mdpro-oauth sk-ant-ort01-YOUR_REFRESH_TOKEN
```

Verify the profile works:

```bash
mecha auth test mdpro-oauth
```

#### Step 3: Use when spawning bots

```bash
# Use --auth mdpro-main in spawn commands instead of mdpro-main
mecha bot spawn mdpro-auditor ... --auth mdpro-main
```

#### Token Refresh

When the access token expires, re-run:

```bash
mecha auth renew mdpro-oauth sk-ant-ort01-YOUR_REFRESH_TOKEN
```

Get a fresh access token from Keychain Access.app (search "Claude Code-credentials")
if the refresh token itself has expired (only happens if you fully log out of Claude Code).

#### Security Notes

- Store `CLAUDE_SETUP_TOKEN_ACCESS` and `CLAUDE_SETUP_TOKEN_REFRESH` only in
  your shell profile or a `.env` file that is **gitignored**.
- Never commit tokens to the repository.
- The tokens are scoped to your Claude account — treat them like passwords.

### Option C: GitHub Actions Secret (for GH Actions bots)

If you later set up GitHub Actions bots:

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add `CLAUDE_CODE_OAUTH_TOKEN` = your `accessToken` value from above
3. Reference in workflow YAML: `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`

---

## 7. GitHub Actions IP Exposure Q\&A

### Q: If the two bots are hosted in GitHub Actions, what IP address is exposed to the Anthropic backend?

**A: GitHub Actions runners use dynamic IP addresses from Microsoft Azure's IP ranges.**

When a GitHub Actions job calls the Anthropic API:

- The outbound IP comes from Azure's published IP ranges
- GitHub publishes their exact runner IP ranges at `https://api.github.com/meta`
  (look at the `"actions"` array)
- The IPs are typically in ranges like `4.x.x.x`, `20.x.x.x`, `40.x.x.x`
  (Azure East US, West US, and related data centers)
- These IPs are **shared** — thousands of GitHub Actions jobs from different
  users run from the same pool of IPs

**Practical implications:**

| Concern                | Reality                                                   |
| ---------------------- | --------------------------------------------------------- |
| Anthropic geo-blocking | Not an issue — Anthropic API is globally accessible       |
| Rate limiting per IP   | Anthropic rate-limits by API key, not by IP               |
| IP reputation          | Azure IPs are clean/trusted — no blocklisting concern     |
| Privacy                | GitHub/Azure has access to your outbound traffic metadata |
| IP consistency         | IPs change per run — no fixed identity                    |

**The GitHub IPs are public knowledge.** You can verify at any time:

```bash
curl -s https://api.github.com/meta | jq '.actions[]' | head -20
```

---

## 8. VPN Routing via GitHub Actions → HK → US Residential

### Q: Can we set up a self-defined VPN in GitHub Actions so calls go: GH Actions → HK IP → US residential static IP → Anthropic backend?

**Short answer: Technically yes, but it provides no real benefit for Anthropic API access and adds significant latency and cost.**

### Why You Might Want This

The only scenarios where this routing would matter:

1. **Geo-restriction bypass** — If Anthropic restricted API access by geography
   (they don't currently)
2. **IP reputation management** — If you needed calls to appear from a residential
   IP rather than a known cloud IP (Anthropic doesn't check this)
3. **Regulatory compliance** — If you needed API traffic to route through a specific
   jurisdiction (not an Anthropic requirement)

**For normal Anthropic API usage, none of these apply.** The API works from any IP.

### Technical Implementation (for reference only)

If you had a legitimate reason, the architecture would be:

```
GitHub Actions Runner (Azure eastus2)
        │
        │ WireGuard tunnel
        ▼
Your HK VPS (e.g., Vultr HK)
        │
        │ SOCKS5 proxy / routing rule
        ▼
US Residential Proxy Service
(e.g., Oxylabs, Brightdata — $100+/mo for static residential IPs)
        │
        │ HTTP/HTTPS traffic
        ▼
Anthropic API (api.anthropic.com)
```

Implementation steps:

```yaml
# .github/workflows/audit.yml snippet
- name: Install WireGuard
  run: |
    sudo apt-get install -y wireguard
    # Write WireGuard config from GitHub Secret
    echo "${{ secrets.WIREGUARD_CONFIG }}" | sudo tee /etc/wireguard/wg0.conf
    sudo wg-quick up wg0

- name: Verify IP routing
  run: curl -s https://api.ipify.org   # should show HK/proxy IP

- uses: anthropics/claude-code-action@v1
  # ... rest of workflow
```

### Honest Assessment

| Factor                    | Reality                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| Complexity                | High — WireGuard config, HK VPS management, proxy service contract |
| Monthly cost              | HK VPS: \~$5/mo, US residential proxy: $50–200/mo for static IPs |
| Latency added             | 150–300ms round-trip added to every API call                       |
| Benefit for Anthropic API | **Zero** — Anthropic accepts all IPs, rate-limits by key           |
| When it makes sense       | Never, for this use case                                           |

### The Better Answer: Use Local Mecha Bots

Since you're already using Mecha (self-hosted on your Mac), the bots make API calls
directly from your machine's IP — which is cleaner than any proxy chain anyway.

If you're in a region with API access concerns, the correct solution is:

1. Use a **Claude Pro/Max subscription** (web UI — no API key needed)
2. Use **OAuth tokens** with Mecha instead of API keys (subscription billing, not API billing)
3. Run the bots locally on a machine in an unrestricted region

---

## Summary Checklist

### One-Time Setup

- [ ] `brew install xiaolai/tap/mecha && mecha init && mecha start -d`
- [ ] Create `~/.mecha/prompts/mdpro-auditor.md` (system prompt from §3)
- [ ] Create `~/.mecha/prompts/mdpro-fixer.md` (system prompt from §4)
- [ ] Set up auth: `mecha auth add mdpro-oauth --oauth --token sk-ant-oat01-...` then `mecha auth renew mdpro-oauth sk-ant-ort01-...`
- [ ] Spawn auditor: `mecha bot spawn mdpro-auditor ...` (command from §3)
- [ ] Spawn fixer: `mecha bot spawn mdpro-fixer ...` (command from §4)
- [ ] Add schedule: `mecha schedule add mdpro-auditor --id daily-audit --every 24h ...`
- [ ] Create workflow: `~/.mecha/workflows/mdpro-audit-fix.yaml` (from §5)
- [ ] Test: `mecha schedule run mdpro-auditor --id daily-audit`
- [ ] Verify findings: `cat ~/.mecha/mdpro-auditor/audit-findings.md`

### Daily Operation

- [ ] `mecha status` — confirm daemon running
- [ ] `mecha bot ls` — check bot health
- [ ] Review `~/.mecha/mdpro-fixer/fix-report-<date>.md` after runs
- [ ] `cd mdpro && git diff` — review any changes the fixer made before committing
- [ ] `mecha cost` — track API spend

### Audit Rotation

The 17 dimensions are designed so that 4–6 per run means full coverage
over approximately 3–4 days. The auditor randomizes which 4–6 dimensions
it picks each run using the current timestamp as a seed.
