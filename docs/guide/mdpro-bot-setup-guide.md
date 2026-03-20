# Setting Up Multi-Bot Automation for mdpro

## Your Current State vs What's Needed

### What You Already Have

Your mdpro project is surprisingly well-prepared. You already have:

| Component | Status | Location |
|-----------|--------|----------|
| 9 Claude agents (auditor, planner, implementer, etc.) | Done | `.claude/agents/` |
| 20+ slash commands (fix-issue, codex audit, etc.) | Done | `.claude/commands/` |
| Engineering rules + TDD rules | Done | `.claude/rules/` |
| CLAUDE.md (extensive project instructions) | Done | `CLAUDE.md` |
| AGENTS.md (Codex/Gemini instructions) | Done | `AGENTS.md` |
| Vitest test setup | Done | `vitest.config.ts` |
| Rust test setup | Done | `src-tauri/Cargo.toml` |

### What's Missing (We'll Create These)

| Component | Purpose | File |
|-----------|---------|------|
| Daily audit workflow | Bot 1: Find bugs automatically | `.github/workflows/claude-audit.yml` |
| Auto-fix workflow | Bot 2: Fix audit findings automatically | `.github/workflows/claude-fix.yml` |
| PR review workflow | Bot 3: Review all PRs | `.github/workflows/claude-review.yml` |
| Cost report workflow | Bot 4: Track daily spending | `.github/workflows/claude-cost-report.yml` |
| CI test workflow | Gate: Run tests on every PR | `.github/workflows/ci.yml` |
| Issue templates | Structured bug/feature reporting | `.github/ISSUE_TEMPLATE/` |
| PR template | Consistent PR format | `.github/pull_request_template.md` |

---

## Step 0: Get Your Claude Code OAuth Token

Before any workflow works, you need a `CLAUDE_CODE_OAUTH_TOKEN`:

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key, or use Claude Code OAuth:
   - Run `claude` locally, log in with your Claude Max subscription
   - The OAuth token is stored in `~/.claude/credentials.json`
   - Copy the token value

3. Add it to your GitHub repo:
   - Go to `https://github.com/anzchy/mdpro/settings/secrets/actions`
   - Click "New repository secret"
   - Name: `CLAUDE_CODE_OAUTH_TOKEN`
   - Value: your token
   - Click "Add secret"

---

## Step 1: Bot 1 — The Auditor (Finds Bugs Daily)

Create `.github/workflows/claude-audit.yml`:

```yaml
name: Claude Periodic Audit

on:
  schedule:
    # Daily at 9am UTC (5pm Beijing time)
    - cron: "0 9 * * *"

  # Allow manual trigger from Actions tab
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
        with:
          fetch-depth: 1

      - uses: anthropics/claude-code-action@v1
        id: claude
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          show_full_output: true

          # Opus for deep analysis; restrict to read-only tools
          claude_args: "--model opus --allowedTools Bash,Read,Glob,Grep,WebSearch,WebFetch"

          prompt: |
            You are a codebase auditor for **mdpro** — a Tauri 2.0 + React 19 desktop
            Markdown editor with CodeMirror 6 source editing, Milkdown WYSIWYG, Zustand
            state management, and a Rust backend with MCP server.

            Use the run ID (${{ github.run_id }}) as a seed to **randomly pick 4-5
            dimensions** from the list below. Rotate target directories so successive
            runs cover different parts of the codebase.

            ---

            ## Audit Dimensions

            ### 1. Zustand store safety
            7 stores in `src/stores/`. Check for:
            - Missing null/undefined guards on state updates
            - Store destructuring in components (prefer selectors)
            - Stale closures: inline callbacks reading store state directly
            - Missing persist middleware edge cases

            ### 2. CodeMirror plugin correctness
            `src/plugins/codemirror/`. Check for:
            - Memory leaks in extension lifecycle (missing cleanup)
            - Edge cases: empty document, single character, very large files
            - IME composition handling (CJK input)
            - Multi-cursor correctness if applicable

            ### 3. Milkdown WYSIWYG sync
            `src/plugins/milkdown/` + `src/hooks/useMilkdown*`. Check for:
            - Content sync between WYSIWYG ↔ source ↔ document store
            - Data loss paths (editing in WYSIWYG, switching modes, content lost)
            - Paste handling edge cases (HTML, rich text, images, tables)
            - Node/mark serialization round-trip fidelity

            ### 4. Security — XSS and injection
            Check across `src/` for:
            - HTML rendering without DOMPurify (dangerouslySetInnerHTML)
            - Markdown rendering that could execute scripts
            - `javascript:` link handling in preview/WYSIWYG
            - Image/link URLs not validated before rendering
            - Pasted HTML bypassing sanitization

            ### 5. Rust backend safety
            `src-tauri/src/`. Check for:
            - `unwrap()` or `expect()` on user-controlled input (must use `map_err`)
            - Missing error propagation (bare `?` without context)
            - Panic paths reachable from Tauri commands
            - File path traversal vulnerabilities in commands
            - Race conditions in file watching (notify crate)

            ### 6. IPC and event handling
            Tauri commands in `src-tauri/src/commands/` and frontend invoke calls. Check for:
            - Missing error handling on `invoke()` calls
            - Unhandled promise rejections
            - Event listener leaks (missing cleanup in useEffect)
            - Type mismatches between Rust command signatures and TS types

            ### 7. File operations integrity
            `src/services/file*` + `src-tauri/src/services/file*`. Check for:
            - Auto-save race conditions (rapid edits while saving)
            - External file change detection edge cases
            - Encoding issues (UTF-8 BOM, CRLF, mixed line endings)
            - Large file handling (memory, performance)

            ### 8. Dead code and unused exports
            Check for:
            - Unused exports (exported but never imported elsewhere)
            - Orphaned files (not imported by anything)
            - Unused dependencies in package.json or Cargo.toml
            - Stale feature flags or commented-out code blocks

            ### 9. Type safety (TypeScript)
            Check across `src/` for:
            - `as` type casts (unsafe, prefer type guards)
            - `any` usage in non-test code
            - Swallowed errors (empty catch blocks)
            - Unhandled promise rejections (missing `.catch()` or try/catch)

            ### 10. Error handling gaps
            Check for:
            - Empty catch blocks that silently swallow errors
            - Missing error boundaries around React component trees
            - Network/file operations without timeout or retry
            - MCP server error responses not propagated to frontend

            ### 11. Test coverage gaps
            Check for:
            - Untested stores or hooks
            - Missing edge case tests (empty input, null, Unicode/CJK)
            - Tests that test implementation details instead of behavior
            - Critical paths without any test coverage

            ### 12. Performance anti-patterns
            Check for:
            - Unnecessary re-renders (missing React.memo, useMemo, useCallback)
            - Large synchronous operations blocking the UI thread
            - Unbounded data structures (arrays/maps that grow without limit)
            - Missing debounce/throttle on frequent events (scroll, resize, input)

            ---

            ## Rules

            - **High confidence only** — do not report speculative or low-confidence findings
            - **Skip cosmetics** — no style, formatting, or naming nitpicks
            - **One issue per finding** — open a separate GitHub issue for each
            - **Issue format:**
              - Title: `[audit] <category>: <concise problem>`
              - Body: file path + line, impact explanation, suggested fix
              - Labels: `audit` + one of: `bug`, `security`, `dead-code`, `type-safety`,
                `error-handling`, `performance`, `test-gap`
            - **If nothing found, create no issues**
```

### Why This Works

- **Randomized dimensions**: Each daily run picks 4-5 of 12 areas, ensuring full coverage over ~3 days
- **Read-only tools**: The auditor cannot modify code — it can only observe and report
- **Opus model**: Uses the most capable model for deep analysis
- **Structured output**: Each finding becomes a labeled GitHub issue with file paths and suggested fixes

---

## Step 2: Bot 2 — The Fixer (Resolves Audit Issues Automatically)

Create `.github/workflows/claude-fix.yml`:

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

    # Only one fix per issue at a time
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

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - uses: dtolnay/rust-toolchain@stable

      - uses: anthropics/claude-code-action@v1
        with:
          allowed_bots: "claude[bot]"
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          show_full_output: true

          # Full tool access for making changes
          claude_args: "--model opus --allowedTools Bash Read Write Edit Glob Grep MultiEdit"

          prompt: |
            Fix the audit issue described in GitHub issue #${{ github.event.issue.number }}.

            ## Steps

            1. Read the issue body:
               ```
               gh issue view ${{ github.event.issue.number }}
               ```

            2. Understand the problem — read the affected files, trace the logic

            3. Apply the suggested fix (or a better one if you find it)

            4. If the fix involves TypeScript changes:
               - Run `pnpm test:run` to verify tests pass
               - Run `pnpm build` to verify compilation

            5. If the fix involves Rust changes:
               - Run `cd src-tauri && cargo check` to verify compilation
               - Run `cd src-tauri && cargo test` to verify tests

            6. If the fix adds new behavior, write a test for it (follow TDD from
               `.claude/rules/10-tdd.md`)

            7. Create a PR:
               - Branch name: `fix/audit-${{ github.event.issue.number }}`
               - PR title: descriptive of the fix
               - PR body must include `Closes #${{ github.event.issue.number }}`
               - Use: `gh pr create --title "..." --body "..."`

            8. Enable auto-merge:
               ```
               gh pr merge --auto --squash
               ```

            If the fix causes test or compilation failures, adjust until gates pass.
            Do not skip tests or ignore errors.
```

### The Automation Chain

```
claude-audit.yml (9am daily)
    │
    ├── Creates issue #20: "[audit] security: XSS in preview"
    │   Labels: audit, security
    │
    └── Creates issue #21: "[audit] dead-code: unused export in fileService"
        Labels: audit, dead-code

Issue #20 created → triggers claude-fix.yml
    │
    ├── Reads issue #20
    ├── Fixes the XSS vulnerability
    ├── Runs pnpm test:run && pnpm build
    ├── Opens PR: "fix: sanitize HTML in preview to prevent XSS"
    │   Body: "Closes #20"
    └── Enables auto-merge

Issue #21 created → triggers claude-fix.yml (in parallel)
    │
    ├── Reads issue #21
    ├── Removes the unused export
    ├── Runs pnpm test:run && pnpm build
    ├── Opens PR: "chore: remove unused fileService export"
    │   Body: "Closes #21"
    └── Enables auto-merge
```

---

## Step 3: Bot 3 — The Reviewer (Reviews All PRs)

Create `.github/workflows/claude-review.yml`:

```yaml
name: Claude Code Review

on:
  # Review PRs when opened or updated
  pull_request:
    types: [opened, synchronize]

  # Respond to @claude mentions in issues/PRs
  issue_comment:
    types: [created]

  # Respond to @claude in PR review comments
  pull_request_review_comment:
    types: [created]

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  review:
    runs-on: ubuntu-latest

    # Cancel old reviews when PR is updated
    concurrency:
      group: claude-review-${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}
      cancel-in-progress: true

    if: >-
      (github.event_name == 'pull_request') ||
      (github.event_name == 'issue_comment' && !github.event.comment.performed_via_github_app && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && !github.event.comment.performed_via_github_app && contains(github.event.comment.body, '@claude'))

    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: "--model sonnet"

          # Consolidate review into one sticky comment with "Fix this" links
          use_sticky_comment: true
          include_fix_links: true
```

### What This Bot Does

- **PR opened/updated**: Automatically reviews the diff, looking for bugs, security issues, and style violations. Leaves a single sticky comment (updates on each push).
- **"Fix this" links**: Each finding includes a clickable link that triggers Claude to auto-fix that specific issue.
- **@claude mentions**: Anyone can tag `@claude` in an issue or PR comment to ask questions or request changes.
- **Uses Sonnet** (not Opus) — PR reviews are routine work; Sonnet is cheaper and fast enough.

---

## Step 4: Bot 4 — The Cost Reporter (Daily Spending Tracker)

Create `.github/workflows/claude-cost-report.yml`:

```yaml
name: Claude Daily Cost Report

on:
  schedule:
    # Daily at noon UTC (8pm Beijing time) — 3 hours after audit
    - cron: "0 12 * * *"

  workflow_dispatch:

permissions:
  issues: write
  actions: read

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - name: Generate cost report
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          set -euo pipefail

          SINCE=$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ')
          TODAY=$(date -u '+%Y-%m-%d')

          echo "## Claude Cost Report — $TODAY" > report.md
          echo "" >> report.md
          echo "| Workflow | Run | Duration | Turns | Input Tokens | Output Tokens | Cost (USD) |" >> report.md
          echo "|----------|-----|----------|-------|-------------|--------------|------------|" >> report.md

          TOTAL_COST=0
          TOTAL_RUNS=0

          for WORKFLOW in claude-audit.yml claude-fix.yml claude-review.yml; do
            RUN_IDS=$(gh run list --workflow="$WORKFLOW" --created ">=$SINCE" --json databaseId --jq '.[].databaseId' 2>/dev/null || echo "")

            for RUN_ID in $RUN_IDS; do
              LOG=$(gh run view "$RUN_ID" --log 2>&1 || echo "")
              COST=$(echo "$LOG" | grep -o '"total_cost_usd": [0-9.]*' | head -1 | grep -o '[0-9.]*$' || echo "0")
              TURNS=$(echo "$LOG" | grep -o '"num_turns": [0-9]*' | tail -1 | grep -o '[0-9]*$' || echo "0")
              DURATION_MS=$(echo "$LOG" | grep -o '"duration_ms": [0-9]*' | tail -1 | grep -o '[0-9]*$' || echo "0")
              INPUT=$(echo "$LOG" | grep '"type": "result"' -A 30 | grep -o '"input_tokens": [0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
              OUTPUT=$(echo "$LOG" | grep '"type": "result"' -A 30 | grep -o '"output_tokens": [0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")

              DURATION_MIN=$(echo "scale=1; ${DURATION_MS:-0} / 60000" | bc 2>/dev/null || echo "?")
              COST_FMT=$(printf '%.2f' "$COST" 2>/dev/null || echo "$COST")

              WORKFLOW_SHORT="${WORKFLOW%.yml}"
              echo "| $WORKFLOW_SHORT | [#${RUN_ID}](https://github.com/${GH_REPO}/actions/runs/${RUN_ID}) | ${DURATION_MIN}m | $TURNS | $INPUT | $OUTPUT | \$${COST_FMT} |" >> report.md

              TOTAL_COST=$(echo "$TOTAL_COST + $COST" | bc 2>/dev/null || echo "$TOTAL_COST")
              TOTAL_RUNS=$((TOTAL_RUNS + 1))
            done
          done

          TOTAL_COST_FMT=$(printf '%.2f' "$TOTAL_COST" 2>/dev/null || echo "$TOTAL_COST")

          echo "" >> report.md
          echo "**Total: ${TOTAL_RUNS} runs, \$${TOTAL_COST_FMT} USD**" >> report.md

          cat report.md

          if [ "$TOTAL_RUNS" -gt 0 ]; then
            gh issue create \
              --title "Claude cost report — $TODAY (\$${TOTAL_COST_FMT})" \
              --body "$(cat report.md)" \
              --label "cost-report"
          else
            echo "No Claude runs in the last 24h, skipping report."
          fi
```

---

## Step 5: CI Gate — Run Tests on Every PR

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:run

  test-rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: dtolnay/rust-toolchain@stable

      - name: Install Tauri system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Cargo check + test
        working-directory: src-tauri
        run: |
          cargo check
          cargo test
          cargo clippy -- -D warnings
```

This ensures that **no PR (from bots or humans) can merge without passing tests**.

---

## Step 6: Issue Templates

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug Report
description: Report a bug in mdpro
labels: ["bug"]
body:
  - type: textarea
    id: description
    attributes:
      label: Bug Description
      description: What happened? What did you expect?
      placeholder: "When I do X, Y happens instead of Z"
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Minimal steps to reproduce the issue
      placeholder: |
        1. Open a markdown file
        2. Switch to WYSIWYG mode
        3. ...

  - type: dropdown
    id: view-mode
    attributes:
      label: View Mode
      options:
        - Split
        - Editor-only
        - Preview-only
        - WYSIWYG
        - All modes

  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: OS version, mdpro version
      placeholder: "macOS 15.3, mdpro v0.2.1"
```

Create `.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: Feature Request
description: Suggest a new feature for mdpro
labels: ["enhancement"]
body:
  - type: textarea
    id: description
    attributes:
      label: Feature Description
      description: What would you like mdpro to do?
    validations:
      required: true

  - type: textarea
    id: use-case
    attributes:
      label: Use Case
      description: Why do you need this? What problem does it solve?

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: Have you found any workarounds?
```

Create `.github/pull_request_template.md`:

```markdown
## Summary

<!-- 1-3 bullet points describing what this PR does -->

## Related Issues

<!-- Closes #N or Fixes #N -->

## Changes

<!-- List the key changes made -->

## Test Plan

- [ ] `pnpm test:run` passes
- [ ] `pnpm build` succeeds
- [ ] `cd src-tauri && cargo check` passes (if Rust changes)
- [ ] Manual testing: describe what you tested

## Screenshots

<!-- If UI changes, add before/after screenshots -->
```

---

## Step 7: Create the `audit` and `cost-report` Labels

Run this once to create the labels your workflows need:

```bash
# Create labels (run from your terminal)
gh label create audit --color "d93f0b" --description "Automated audit finding" -R anzchy/mdpro
gh label create cost-report --color "0e8a16" --description "Daily Claude cost report" -R anzchy/mdpro
gh label create dead-code --color "fbca04" --description "Dead or unused code" -R anzchy/mdpro
gh label create type-safety --color "5319e7" --description "Type safety issue" -R anzchy/mdpro
gh label create error-handling --color "e99695" --description "Error handling gap" -R anzchy/mdpro
gh label create performance --color "006b75" --description "Performance issue" -R anzchy/mdpro
gh label create test-gap --color "1d76db" --description "Missing test coverage" -R anzchy/mdpro
gh label create security --color "b60205" --description "Security vulnerability" -R anzchy/mdpro
```

---

## Step 8: Enable Auto-Merge in GitHub Settings

For the fixer bot to auto-merge its PRs:

1. Go to `https://github.com/anzchy/mdpro/settings`
2. Scroll to "Pull Requests"
3. Check **"Allow auto-merge"**
4. Optionally: under "Branch protection rules" for `master`:
   - Require status checks to pass (select `test-frontend` and `test-rust` from CI workflow)
   - This ensures bot PRs can only merge after tests pass

---

## Complete File Tree to Create

Here's everything you need to add to your repo:

```
.github/
├── workflows/
│   ├── claude-audit.yml          # Bot 1: Daily codebase audit
│   ├── claude-fix.yml            # Bot 2: Auto-fix audit issues
│   ├── claude-review.yml         # Bot 3: PR review + @claude
│   ├── claude-cost-report.yml    # Bot 4: Daily cost tracking
│   ├── ci.yml                    # Gate: Tests on every PR
│   └── release.yml               # (already exists)
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml
│   └── feature_request.yml
└── pull_request_template.md
```

---

## How the Full Pipeline Works

```
 ┌─────────────────────────────────────────────────────────┐
 │  9am UTC: claude-audit.yml runs                         │
 │                                                         │
 │  Opus scans codebase with 4-5 random dimensions         │
 │  Creates issues: [audit] security: XSS in preview       │
 │                  [audit] dead-code: unused export        │
 │                  [audit] error-handling: empty catch     │
 └──────────────────────┬──────────────────────────────────┘
                        │ triggers (for each issue)
                        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  claude-fix.yml runs (one job per issue, concurrent)    │
 │                                                         │
 │  Opus reads issue → applies fix → runs tests            │
 │  Opens PR: "fix: sanitize HTML in preview"              │
 │  Body: "Closes #20"                                     │
 │  Enables auto-merge                                     │
 └──────────────────────┬──────────────────────────────────┘
                        │ triggers
                        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  ci.yml runs (test gate)                                │
 │                                                         │
 │  pnpm test:run + pnpm build + cargo check + cargo test  │
 │  Must pass before merge                                 │
 └──────────────────────┬──────────────────────────────────┘
                        │ triggers
                        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  claude-review.yml runs                                 │
 │                                                         │
 │  Sonnet reviews the PR diff                             │
 │  Sticky comment with findings + "Fix this" links        │
 └──────────────────────┬──────────────────────────────────┘
                        │ if CI passes + review OK
                        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  Auto-merge squashes PR into master                     │
 │  Issue auto-closed via "Closes #N"                      │
 └─────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────┐
 │  12pm UTC: claude-cost-report.yml runs                  │
 │                                                         │
 │  Collects all Claude workflow costs from last 24h       │
 │  Creates issue: "Claude cost report — $15.50"           │
 └─────────────────────────────────────────────────────────┘
```

---

## Quick Copy-Paste Setup Commands

Run all of these from your mdpro project root:

```bash
# 1. Create directories
mkdir -p .github/workflows .github/ISSUE_TEMPLATE

# 2. Create labels
gh label create audit --color "d93f0b" --description "Automated audit finding" -R anzchy/mdpro
gh label create cost-report --color "0e8a16" --description "Daily Claude cost report" -R anzchy/mdpro
gh label create dead-code --color "fbca04" --description "Dead or unused code" -R anzchy/mdpro
gh label create type-safety --color "5319e7" --description "Type safety issue" -R anzchy/mdpro
gh label create error-handling --color "e99695" --description "Error handling gap" -R anzchy/mdpro
gh label create performance --color "006b75" --description "Performance issue" -R anzchy/mdpro
gh label create test-gap --color "1d76db" --description "Missing test coverage" -R anzchy/mdpro
gh label create security --color "b60205" --description "Security vulnerability" -R anzchy/mdpro

# 3. Add GitHub secret (do this in the web UI)
# Go to: https://github.com/anzchy/mdpro/settings/secrets/actions
# Add: CLAUDE_CODE_OAUTH_TOKEN

# 4. Enable auto-merge
# Go to: https://github.com/anzchy/mdpro/settings
# Check "Allow auto-merge"

# 5. Copy the workflow files from this guide into the directories
# (or use the scaffolding script below)

# 6. Commit and push
git add .github/
git commit -m "ci: add multi-bot Claude automation pipeline"
git push origin master

# 7. Test it! Manually trigger the audit:
gh workflow run claude-audit.yml -R anzchy/mdpro
```

---

## Estimated Daily Cost

| Bot | Model | Frequency | Est. Cost/Day |
|-----|-------|-----------|---------------|
| Auditor | Opus | 1x daily | $2-5 |
| Fixer | Opus | 0-5x daily (per audit finding) | $1-3 each |
| Reviewer | Sonnet | Per PR | $0.50-1 each |
| Cost Reporter | None (bash script) | 1x daily | $0 |
| **Total** | | | **$5-20/day** |

Cost depends on codebase size and how many issues the auditor finds. The first few runs will likely find more issues (tech debt). Over time, daily findings decrease as the codebase improves.

---

## Bonus: Handle Your 10 Existing Open Issues

Your repo already has 10 open issues (#6-#15) from what looks like a manual audit. You can use the fixer bot to knock them out:

```bash
# Add the 'audit' label to trigger auto-fix for each
gh issue edit 6 --add-label audit -R anzchy/mdpro
gh issue edit 7 --add-label audit -R anzchy/mdpro
gh issue edit 8 --add-label audit -R anzchy/mdpro
# ... repeat for each issue you want auto-fixed

# Or fix them all at once:
for i in $(seq 6 15); do
  gh issue edit $i --add-label audit -R anzchy/mdpro
done
```

Each will trigger a separate `claude-fix.yml` run, creating a PR with a fix.

**Warning**: This will run 10 Opus sessions in parallel (~$10-30 total). Consider doing a few at a time to control costs.

---

## GitHub Actions (Cloud) vs Mecha.im (Self-Hosted): What's the Difference?

Everything above (Steps 1-8) runs on **GitHub's cloud servers** via GitHub Actions. Mecha.im is a **separate, self-hosted system** where bots run in Docker containers on your own machine. They're complementary.

```
┌────────────────────────────────┐     ┌────────────────────────────────┐
│  GitHub Actions (Cloud Bots)   │     │  Mecha.im (Self-Hosted Bots)  │
│                                │     │                                │
│  Runs on GitHub's servers      │     │  Runs in Docker on YOUR machine│
│  Triggered by GitHub events    │     │  Persistent, always-on agents  │
│  Stateless (fresh each run)    │     │  Stateful (remembers context)  │
│  No bot-to-bot communication   │     │  Bots talk to each other       │
│  Free infra (GitHub Actions)   │     │  Your hardware + electricity   │
│  Simple YAML setup             │     │  More powerful, more control   │
│                                │     │                                │
│  What VMark actually uses      │     │  What mecha.im provides        │
│  What Steps 1-8 set up         │     │  What the section below covers │
└────────────────────────────────┘     └────────────────────────────────┘
```

### When to Use Which

| Scenario | Use GitHub Actions | Use Mecha.im |
|----------|-------------------|--------------|
| Daily code audit + auto-fix | Yes | Yes |
| Respond to GitHub issues/PRs | Yes (native) | Possible (via webhooks) |
| Bot-to-bot delegation | No | Yes |
| Private codebase (never leaves your machine) | No (code goes to GitHub runners) | Yes |
| Persistent memory across tasks | No (stateless) | Yes |
| Fleet dashboard to monitor all bots | No | Yes |
| Interactive chat with bots | No | Yes (`mecha chat`) |
| Terminal access inside bot | No | Yes (PTY + WebSocket) |
| Cost | GitHub Actions minutes + API | Your machine + API |
| Setup complexity | Low (just YAML files) | Medium (Docker + config) |

---

## Setting Up Mecha.im Locally for mdpro

Yes, you install it locally and run bots in Docker on your machine.

### Step 1: Install

```bash
# Prerequisites: Node.js 22+, Docker running
# If using Colima on macOS:
colima start

# Install mecha globally
npm install -g mecha

# Initialize (builds the Docker image — takes a few minutes)
mecha init
```

### Step 2: Set Up Auth

```bash
# Option A: API key
mecha auth add anthropic sk-ant-api03-YOUR_KEY_HERE

# Option B: OAuth (if you have Claude Max subscription — much cheaper)
mecha auth add claude-oauth YOUR_OAUTH_TOKEN
```

### Step 3: Create Bot Configs

Create these YAML files in your mdpro project root:

**`bots/auditor.yaml`** — scans your codebase daily:

```yaml
name: mdpro-auditor
system: |
  You are a codebase auditor for mdpro — a Tauri 2.0 + React 19
  desktop Markdown editor with CodeMirror 6, Milkdown WYSIWYG,
  and Zustand state management.

  When you audit, focus on:
  - Security (XSS, path traversal, unsanitized HTML)
  - Data loss paths (editing → save → content lost)
  - Dead code and unused exports
  - Error handling gaps (empty catch, unhandled promises)
  - Type safety (any casts, unsafe assertions)
  - Zustand store correctness

  For each finding, create a GitHub issue:
  - Title: [audit] <category>: <concise problem>
  - Body: file path + line, impact, suggested fix
  - Use: gh issue create --title "..." --body "..." --label "audit"

model: opus
auth: anthropic
max_turns: 25
max_budget_usd: 5.00

schedule:
  - cron: "0 9 * * *"
    prompt: |
      Audit the codebase. Randomly pick 4-5 areas to examine.
      Create GitHub issues for each finding.
      If nothing significant found, report "No issues found."

workspace: .
# Read-only by default — auditor should NOT modify code
```

**`bots/fixer.yaml`** — fixes issues when asked:

```yaml
name: mdpro-fixer
system: |
  You fix code issues in the mdpro project. When given an issue:

  1. Read the issue description carefully
  2. Read the affected files and understand the context
  3. Apply the minimal correct fix
  4. Write a test if the fix adds new behavior
  5. Run: pnpm test:run && pnpm build
  6. If Rust changes: cd src-tauri && cargo check && cargo test
  7. Commit with: fix(scope): description
  8. Create a PR: gh pr create --title "..." --body "Closes #N"

  Follow TDD from .claude/rules/10-tdd.md.
  Keep diffs focused. No drive-by refactors.

model: sonnet
auth: anthropic
max_turns: 25
max_budget_usd: 2.00

workspace: .
workspace_writable: true    # Fixer needs write access

webhooks:
  accept:
    - "issues.opened"
    - "issues.labeled"
```

**`bots/reviewer.yaml`** — reviews PRs:

```yaml
name: mdpro-reviewer
system: |
  You review pull requests for the mdpro project.
  Focus on:
  - Correctness and edge cases
  - Security issues
  - Whether tests cover the changes
  - Whether the change follows project conventions (CLAUDE.md)

  Leave constructive, specific feedback.
  Approve if the PR is solid. Request changes if not.

model: sonnet
auth: anthropic
max_turns: 15
max_budget_usd: 1.00

workspace: .

webhooks:
  accept:
    - "pull_request.opened"
    - "pull_request.synchronize"
```

### Step 4: Spawn the Bots

```bash
cd /path/to/mdpro

# Spawn each bot (each gets its own Docker container)
mecha spawn bots/auditor.yaml
mecha spawn bots/fixer.yaml
mecha spawn bots/reviewer.yaml

# Check they're running
mecha ls
```

Output:
```
NAME              STATUS    MODEL    SCHEDULE         COST
mdpro-auditor     running   opus     0 9 * * * (1)    $0.00
mdpro-fixer       running   sonnet   —                $0.00
mdpro-reviewer    running   sonnet   —                $0.00
```

### Step 5: Open the Dashboard

```bash
mecha dashboard
# Opens http://localhost:7700
```

The dashboard shows all bots with status, costs, schedule, and a communication map. Click any bot to see its individual dashboard with chat, tasks, logs.

### Step 6: Interact with Bots

```bash
# Chat with the auditor
mecha chat mdpro-auditor "Audit the Zustand stores for safety issues"

# Ask the fixer to fix issue #7
mecha chat mdpro-fixer "Fix GitHub issue #7: XSS in WYSIWYG"

# View logs
mecha logs mdpro-auditor -f

# Stop a bot
mecha stop mdpro-reviewer

# Remove a bot
mecha rm mdpro-reviewer
```

---

## The Killer Feature: Bot-to-Bot Communication

This is what mecha.im can do that GitHub Actions **cannot**. Bots can talk to each other:

```yaml
# bots/coordinator.yaml
name: mdpro-coordinator
system: |
  You coordinate code quality. You can call other bots:
  - Use mecha_call("mdpro-auditor", "...") to request an audit
  - Use mecha_call("mdpro-fixer", "...") to request a fix
  - Use mecha_list() to see all available bots

  Workflow:
  1. Ask the auditor to scan a specific area
  2. Review the auditor's findings
  3. For each valid finding, ask the fixer to resolve it
  4. Verify the fix looks correct

model: opus
auth: anthropic
max_turns: 50
max_budget_usd: 10.00

workspace: .
workspace_writable: true
```

```bash
# The coordinator orchestrates other bots
mecha chat mdpro-coordinator "Audit the security of src/plugins/milkdown/ and fix anything you find"
```

The coordinator:
1. Calls `mecha_call("mdpro-auditor", "Audit src/plugins/milkdown/ for XSS risks")`
2. Gets back findings
3. Calls `mecha_call("mdpro-fixer", "Fix this XSS: ...")` for each finding
4. Reports the results

---

## Recommended Phased Approach for mdpro

**Start with GitHub Actions (Steps 1-8 above).** It's simpler, free infrastructure, and covers the core use case.

**Add Mecha.im later when you need:**
- Interactive bot conversations ("audit this specific file")
- Bot-to-bot coordination
- Private codebase that shouldn't leave your machine
- Persistent bot memory across sessions
- More control over scheduling and behavior

```
Phase 1 (Now):     GitHub Actions — daily audit, auto-fix, PR review
Phase 2 (Later):   Mecha.im — coordinator bot, interactive debugging, fleet management
Phase 3 (Scale):   Mecha.im + Tailscale — bots across multiple machines
```

Both systems read the same `CLAUDE.md`, `AGENTS.md`, and `.claude/rules/` — so your bots behave consistently regardless of where they run.
