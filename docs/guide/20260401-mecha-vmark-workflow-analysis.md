# vmark Audit Workflow Analysis — What to Adopt for mdpro

> **Research date**: 2026-03-31
> **Source**: xiaolai/vmark GitHub repo (432 closed issues, 21+ days of runs)

---

## Key Discovery: vmark Does NOT Use mecha.im

The vmark maintainer calls these "mecha bots" colloquially, but the implementation
is entirely **`anthropics/claude-code-action@v1`** on GitHub Actions — no mecha.im,
no Docker, no Go binary, no local processes.

| Aspect | vmark (actual) | mdpro (current) |
|---|---|---|
| Runtime | GitHub Actions (Ubuntu runners) | Local Mac (Docker via mecha.im) |
| Trigger | Daily cron at 9am UTC + `workflow_dispatch` | launchd daily at 2am + manual |
| Auditor output | GitHub Issues (one per finding) | Local file `.mecha/audit-findings.md` |
| Fixer output | Pull Requests that auto-close issues | Local file edits (human commits) |
| Always-on | Yes (GitHub cloud) | Only when Mac is awake |
| Cost | Claude Max subscription OAuth | Claude Max subscription OAuth |

---

## The 5 Gaps Between mdpro and vmark's Workflow

### Gap 1 — No GitHub Issue Creation

**vmark**: Each finding → one `[audit]`-labeled GitHub issue with file/line/impact/fix.
Issues are searchable, trackable, referenced in PRs, and auto-closed on merge.

**mdpro now**: Findings written to `mdpro/.mecha/audit-findings.md` (local only).
No GitHub visibility. No linkage to commits.

**Fix**: Add `claude-audit.yml` GitHub Actions workflow.

---

### Gap 2 — No Automatic Fix PRs

**vmark**: After audit creates issues, `workflow_run` triggers the fixer which:
1. Reads every open `audit`-labeled issue
2. Creates branch `fix/audit-<N>`
3. Applies the fix, runs `pnpm check:all` + `cargo check`
4. Opens PR with `Closes #<N>` → GitHub auto-closes issue on merge
5. Squash auto-merge enabled for bot PRs

**mdpro now**: Fixer edits files locally. Human must `git diff`, `git add -p`, `git commit`.

**Fix**: Add `claude.yml` with `audit-fix` job triggered by `workflow_run`.

---

### Gap 3 — AGENTS.md is Shallow

**vmark**: 200-line `AGENTS.md` auto-loaded by every AI agent. Covers:
- Working agreement (git hygiene, diff focus)
- TDD rules (test-first mandatory, coverage thresholds)
- Zustand patterns (no destructuring in components, use selectors)
- Styling rules (CSS variable tokens, never hardcode colors)
- Cross-platform policy (macOS primary)
- Architecture patterns (IPC, menu sync, MCP bridge)
- i18n rules
- Cost optimization (subscription auth > API keys)

**mdpro now**: `AGENTS.md` covers only build commands, file structure, naming conventions.
AI agents don't know mdpro's Zustand patterns, logging rules, test conventions, or
architecture-specific constraints.

**Fix**: Enrich mdpro's `AGENTS.md` (see §2 below).

---

### Gap 4 — The `workflow_run` Workaround is Needed

**Why this matters**: `github-actions[bot]` created issues do NOT trigger the `issues: opened`
GitHub event. Without the `workflow_run` trigger, the fixer never runs automatically.

```yaml
# WRONG — fixer never fires for bot-created audit issues
on:
  issues:
    types: [opened]  # ← not triggered by github-actions[bot]

# CORRECT — vmark's workaround
on:
  workflow_run:
    workflows: ["Claude Periodic Audit"]
    types: [completed]
```

The fixer job then queries all open `audit` issues via `gh issue list --label audit`.

---

### Gap 5 — No General Claude Assistant (`@claude` mentions)

**vmark**: `claude.yml` also handles PR reviews, issue responses, and `@claude` mentions
in comments. The community can tag `@claude` in any issue or PR to get AI help.

**mdpro now**: No such capability — Claude Code is only used locally.

**Fix**: Include the `claude` job in `claude.yml` (low effort, high value).

---

## What to Do: 3-File Addition to mdpro Repo

The complete vmark-style workflow requires adding 3 files to the mdpro GitHub repo:

```
mdpro/
├── AGENTS.md                              ← ENRICH (exists, but shallow)
├── .github/
│   └── workflows/
│       ├── claude-audit.yml               ← ADD (daily auditor)
│       └── claude.yml                     ← ADD (fixer + @claude assistant)
```

Plus one GitHub Actions secret: `CLAUDE_CODE_OAUTH_TOKEN`.

### Secrets setup (one-time)

```bash
# 1. Generate a long-lived CI token (official method):
claude setup-token
# → prints: sk-ant-oat01-...

# 2. Add it as a GitHub Actions secret:
gh secret set CLAUDE_CODE_OAUTH_TOKEN \
  --repo anzchy/mdpro \
  --body "sk-ant-oat01-YOUR_TOKEN_HERE"
```

---

## Action Version Notes (as of 2026-04)

| Item | Status | What to use |
|---|---|---|
| `actions/checkout` | Use `@v6` | `actions/checkout@v6` |
| `allowed_tools:` input | **Deprecated** — silently ignored | `claude_args: \| --allowedTools ...` |
| `model:` input | **Deprecated** — silently ignored | `claude_args: \| --model claude-opus-4-6` |
| `max_turns:` input | **Deprecated** — silently ignored | `claude_args: \| --max-turns N` |
| `github_token:` input | **Redundant** unless using a custom GitHub App | Omit entirely; action uses `github.token` by default |
| `claude_args:` format | Use `\|` (literal block), not `>-` (folded) | See official examples |
| `contents: write` in audit job | Too broad — auditor only creates issues | Use `contents: read` for audit-only jobs |
| `actions: read` permission | Required if Claude reads CI logs | Add to `permissions:` block |
| `workflow_run` trigger | Not in official docs, but required workaround | See Gap 4 — bot-created issues don't fire `issues: opened` |
| `claude setup-token` | Official method for CI OAuth tokens (~1 year) | Run locally, paste token into Actions secret |

---

## §1: `claude-audit.yml` — Adapted for mdpro

```yaml
name: Claude Periodic Audit
on:
  schedule:
    - cron: "0 2 * * *"        # 2am UTC daily (10am CST)
  workflow_dispatch:            # Manual trigger from Actions tab

permissions:
  contents: read         # auditor reads code only — no file writes
  issues: write
  pull-requests: write
  id-token: write
  actions: read          # lets Claude read CI logs if needed

concurrency:
  group: claude-audit
  cancel-in-progress: true

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: |
            --model claude-opus-4-6
            --max-turns 25
            --allowedTools Bash,Read,Glob,Grep,WebSearch,WebFetch
          prompt: |
            You are a codebase auditor for **mdpro** — a native macOS Markdown editor
            built with Tauri 2.0 (Rust backend) + React 19 (TypeScript frontend),
            CodeMirror 6 (source/split mode), Milkdown 7 (WYSIWYG mode), Zustand 4,
            and a built-in MCP server for AI-assisted editing.

            Use the run ID (${{ github.run_id }}) as a seed to **randomly pick 5–6 dimensions**
            from the list below. Rotate target files so successive runs cover different parts.

            ---

            ## Audit Dimensions

            ### 1. Keyboard shortcut sync
            `src-tauri/src/menu.rs` accelerators MUST match `src/types/preferences.ts`
            DEFAULT_KEYBOARD_SHORTCUTS and `docs/guide/keyboard-shortcuts.md`.
            Check: new menu items without docs, accelerator format mismatches,
            shortcuts in docs that don't match Rust menu.

            ### 2. Zustand anti-patterns
            All stores in `src/stores/`. Check for:
            - Store values destructured at component top-level (FORBIDDEN — use selectors)
            - Stale closures: callbacks reading store state directly instead of `getState()`
            - Missing TypeScript generics on `create<State>()`
            - Store not reset between tests (missing `beforeEach` reset)

            ### 3. IPC trust boundaries
            All `#[tauri::command]` functions in `src-tauri/src/commands/`. Check for:
            - Functions accepting user-supplied path/string without validation
            - `.unwrap()` / `.expect()` on invoke arguments
            - Commands returning `Option<T>` or bare value instead of `Result<T, String>`
            - MCP tool handlers not validating args before accessing shadow_store

            ### 4. Rust backend safety
            `src-tauri/src/` (~full backend). Check for:
            - `unwrap()` / `expect()` / `panic!()` on user-controlled values
            - Missing `?` propagation in Tauri command handlers
            - Unchecked array indexing on user data
            - `unsafe` blocks without justification comment

            ### 5. Draft & auto-save races
            `src/hooks/useAutoSave.ts`, `src-tauri/src/services/draft.rs`,
            `src-tauri/src/commands/draft.rs`. Check for:
            - Auto-save timer not cancelled on document close
            - Non-atomic draft file writes (partial write on crash)
            - `load_draft` not comparing timestamps before restoring
            - Race between user save and auto-save

            ### 6. File watcher correctness
            `src-tauri/src/services/file_watcher.rs`, `src/hooks/useFileWatcher.ts`.
            Check for:
            - External change events not debounced
            - Watcher not removed when document is closed
            - Self-trigger: file:changed fired for writes made by mdpro itself
            - Missing platform guards for watcher backends

            ### 7. Milkdown WYSIWYG edge cases
            `src/plugins/milkdown/`, `src/hooks/useMilkdown.ts`. Check for:
            - Plugin initialization race (not guarded against editor unmount)
            - ProseMirror schema conflicts between plugins
            - Commands dispatched after editor is destroyed
            - Circular imports between milkdown plugins
            - Missing useEffect cleanup for listener subscriptions

            ### 8. CodeMirror source mode edge cases
            `src/plugins/codemirror/`, `src/components/Editor/`. Check for:
            - IME composition events not handled (breaks CJK input)
            - Duplicate facets registered across extensions
            - Circular CM extension dependencies
            - Multi-cursor operations not accounted for

            ### 9. Plugin CSS isolation
            `src/plugins/**/*.css`, `src/styles/*.css`. Check for:
            - Plugin styles in global stylesheets instead of colocated files
            - Hardcoded color values instead of CSS variables/design tokens
            - Selectors broad enough to affect elements outside plugin scope
            - No scoped class wrapper on plugin-specific styles

            ### 10. MCP shadow store correctness
            `src-tauri/src/services/shadow_store.rs`, `src-tauri/src/commands/mcp.rs`.
            Check for:
            - Shadow store not updated when frontend opens/closes documents
            - `write_document` emitting non-serializable payload
            - `read_document` returning stale content (debounce gap)
            - Mutex held across `.await` points (potential deadlock)

            ### 11. Type safety
            `src/**/*.ts`, `src/**/*.tsx`. Check for:
            - `any` type annotations (must be typed)
            - `as SomeType` unsafe casts (prefer type guards)
            - `catch (e) { (e as Error).message }` without `instanceof` check
            - Return types omitted on exported functions

            ### 12. Logging completeness
            Recently modified files across all layers. Check for:
            - New Tauri commands missing Start + Success/Fail `log_event` pairs
            - `console.log()` in committed TypeScript code
            - `println!()` / `eprintln!()` in committed Rust code
            - `log_event` calls missing `actionId`

            ### 13. Test coverage gaps
            `src/stores/` vs `*.test.ts`, `src/hooks/` vs `*.test.ts`. Check for:
            - Store files with no corresponding test file
            - Hooks with no `renderHook` tests
            - Bug fix commits without regression tests
            - Snapshot tests instead of explicit assertions

            ### 14. Dead code
            Across all layers. Check for:
            - Exported functions/components never imported anywhere
            - Rust `mod` declarations with no usages
            - Commented-out code blocks
            - Unused dependencies in `package.json` or `Cargo.toml`

            ### 15. Export & HTML rendering
            `src/services/exportService.ts`, `src-tauri/src/commands/export.rs`. Check for:
            - Missing DOMPurify on markdown-to-HTML before export
            - User-controlled data in HTML template without escaping (XSS)
            - Image path resolution gaps across editor modes
            - Filename collisions during batch/folder export

            ### 16. Dependency health
            `package.json`, `src-tauri/Cargo.toml`. Check for:
            - npm packages with known CVEs (`npm audit`)
            - Rust crates with advisories (`cargo audit` if available)
            - Deprecated Tauri 2.x APIs
            - Dependencies declared but never imported

            ### 17. Version file sync
            `package.json` "version", `src-tauri/tauri.conf.json` "version",
            `src-tauri/Cargo.toml` [package] version — all three must match exactly.

            ---

            ## Rules
            - **High confidence only** — skip speculative or uncertain findings
            - **Skip cosmetics** — no style, formatting, or naming nitpicks
            - **One issue per finding** — open a separate GitHub issue for each
            - **Issue format:**
              - Title: `[audit] <category>: <concise problem description>`
              - Body: exact file path + line number, impact explanation, suggested fix with code
              - Labels: `audit` + one of: `bug`, `security`, `dead-code`, `error-handling`,
                `test-gap`, `performance`, `type-safety`, `convention`, `dependency`
            - **If nothing found for selected dimensions, create NO issues**
```

---

## §2: `claude.yml` — Adapted for mdpro

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
  workflow_run:
    workflows: ["Claude Periodic Audit"]
    types: [completed]

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  # Auto-fix all open audit issues after the auditor completes
  audit-fix:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    concurrency:
      group: audit-fix
      cancel-in-progress: false
    if: >-
      (github.event_name == 'issues' && contains(github.event.issue.labels.*.name, 'audit')) ||
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success')
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: actions/setup-node@v6
        with:
          node-version: 22

      - uses: dtolnay/rust-toolchain@stable

      - name: Install Tauri system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install pnpm and dependencies
        run: |
          npm install -g pnpm
          pnpm install --frozen-lockfile

      - name: Find open audit issues
        id: find-issues
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ "${{ github.event_name }}" = "issues" ]; then
            echo "ISSUE_NUMBERS=${{ github.event.issue.number }}" >> "$GITHUB_OUTPUT"
          else
            NUMBERS=$(gh issue list --state open --label audit --json number \
              --jq '.[].number' | tr '\n' ' ')
            echo "ISSUE_NUMBERS=$NUMBERS" >> "$GITHUB_OUTPUT"
          fi

      - name: Fix audit issues
        if: steps.find-issues.outputs.ISSUE_NUMBERS != ''
        uses: anthropics/claude-code-action@v1
        with:
          allowed_bots: "claude[bot]"
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          show_full_output: true
          claude_args: |
            --model claude-opus-4-6
            --max-turns 25
            --allowedTools Bash,Read,Write,Edit,Glob,Grep,MultiEdit
          prompt: |
            Fix the open audit issues. Issue numbers: ${{ steps.find-issues.outputs.ISSUE_NUMBERS }}

            For EACH issue number:
            1. Read the issue: `gh issue view <NUMBER>`
            2. Create a fix branch: `git checkout -b fix/audit-<NUMBER>`
            3. Apply the minimum correct fix described in the issue
            4. Run frontend gate: `pnpm build`
            5. If the fix touches .rs files: `cd src-tauri && cargo check --manifest-path src-tauri/Cargo.toml`
            6. If tests are relevant: `pnpm test:run`
            7. Commit: `git commit -m "fix: <issue title> (Closes #<NUMBER>)"`
            8. Push and open PR:
               `gh pr create --title "fix: <issue title>" --body "Closes #<NUMBER>" --label audit`
            9. Return to main: `git checkout main`

            Rules:
            - Apply minimum correct fix — don't refactor beyond the finding
            - If a fix requires touching more than 3 files, comment on the issue explaining
              why and skip (leave for human review)
            - If gates fail after 2 attempts, comment on the issue and move on
            - Never commit to main directly

  # General Claude assistant: PR review, @claude mentions, issue responses
  claude:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    concurrency:
      group: claude-${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}
      cancel-in-progress: true
    if: >-
      (github.event_name == 'issues' && !contains(github.event.issue.labels.*.name, 'audit') && !contains(github.event.issue.labels.*.name, 'cost-report')) ||
      (github.event_name == 'pull_request') ||
      (github.event_name == 'issue_comment' &&
        !github.event.comment.performed_via_github_app &&
        contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' &&
        !github.event.comment.performed_via_github_app &&
        contains(github.event.comment.body, '@claude'))
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1

      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          claude_args: |
            --model claude-opus-4-6
            --max-turns 15
          use_sticky_comment: true
          include_fix_links: true

      - name: Enable auto-merge for bot PRs
        if: >-
          github.event_name == 'pull_request' &&
          github.event.pull_request.user.login == 'claude[bot]'
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: gh pr merge "$PR_NUMBER" --auto --squash 2>&1 || true
```

---

## §3: `ci.yml` — PR/Push CI for mdpro

Directly borrowed from vmark. Runs on every PR and push to main: frontend type-check + tests, Rust tests, security audits, cross-platform matrix.

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  frontend:
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Security audit
        run: pnpm audit --audit-level=high
        continue-on-error: ${{ github.event_name == 'pull_request' }}

      - run: pnpm build

      - run: pnpm test:run

  rust-test:
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6

      - name: Install Tauri system dependencies (Ubuntu)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev

      - uses: dtolnay/rust-toolchain@stable

      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: rust-test-${{ runner.os }}-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: rust-test-${{ runner.os }}-

      - run: cargo test --manifest-path src-tauri/Cargo.toml

      - name: Install cargo-audit
        run: cargo install cargo-audit --locked

      - name: Security audit (Rust)
        run: cargo audit
        working-directory: src-tauri
        continue-on-error: ${{ github.event_name == 'pull_request' }}
```

> **Note**: Matrix is macOS + Ubuntu only (mdpro is macOS-first; no Windows target). Remove Windows entirely unlike vmark which ships cross-platform.

---

## §4: `claude-cost-report.yml` — Daily Cost Tracking

Borrowed directly from vmark. Runs daily at noon UTC (3h after the audit). Scrapes token usage and cost from Actions logs, updates a ledger on a `data` branch, creates a GitHub issue with the daily + cumulative cost summary.

**One-time setup required**: Create the `data` branch before first run:
```bash
git checkout --orphan data
git rm -rf .
git commit --allow-empty -m "chore: init data branch"
git push origin data
```

```yaml
name: Claude Daily Cost Report
on:
  schedule:
    - cron: "0 12 * * *"   # noon UTC (3h after audit at 9am UTC / 2am CST)
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  actions: read

concurrency:
  group: cost-report
  cancel-in-progress: true

jobs:
  report:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout data branch (ledger lives here)
        uses: actions/checkout@v6
        with:
          ref: data

      - name: Collect runs and generate report
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          set -euo pipefail

          SINCE=$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ')
          TODAY=$(date -u '+%Y-%m-%d')

          echo "## Claude Cost Report — $TODAY" > report.md
          echo "" >> report.md
          echo "| Workflow | Run | Duration | Turns | Input Tokens | Output Tokens | Cache Created | Cache Read | Cost (USD) |" >> report.md
          echo "|----------|-----|----------|-------|-------------|--------------|--------------|------------|------------|" >> report.md

          TOTAL_COST=0; TOTAL_RUNS=0; TOTAL_INPUT=0; TOTAL_OUTPUT=0
          TOTAL_CACHE_CREATE=0; TOTAL_CACHE_READ=0

          for WORKFLOW in claude.yml claude-audit.yml; do
            RUN_IDS=$(gh run list --workflow="$WORKFLOW" --created ">=$SINCE" --json databaseId --jq '.[].databaseId' 2>/dev/null || echo "")
            for RUN_ID in $RUN_IDS; do
              LOG=$(gh run view "$RUN_ID" --log 2>&1)
              COST=$(echo "$LOG" | grep -o '"total_cost_usd": [0-9.]*' | head -1 | grep -o '[0-9.]*$' || echo "0")
              [ -z "$COST" ] && continue
              TURNS=$(echo "$LOG" | grep -o '"num_turns": [0-9]*' | tail -1 | grep -o '[0-9]*$' || echo "0")
              DURATION_MS=$(echo "$LOG" | grep -o '"duration_ms": [0-9]*' | tail -1 | grep -o '[0-9]*$' || echo "0")
              INPUT=$(echo "$LOG" | grep '"type": "result"' -A 30 | grep -o '"input_tokens": [0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
              OUTPUT=$(echo "$LOG" | grep '"type": "result"' -A 30 | grep -o '"output_tokens": [0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
              CACHE_CREATE=$(echo "$LOG" | grep '"type": "result"' -A 30 | grep -o '"cache_creation_input_tokens": [0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
              CACHE_READ=$(echo "$LOG" | grep '"type": "result"' -A 30 | grep -o '"cache_read_input_tokens": [0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
              DURATION_MIN=$(echo "scale=1; ${DURATION_MS:-0} / 60000" | bc 2>/dev/null || echo "?")
              COST_FMT=$(printf '%.2f' "$COST" 2>/dev/null || echo "$COST")
              WORKFLOW_SHORT="${WORKFLOW%.yml}"
              echo "| $WORKFLOW_SHORT | [#${RUN_ID}](https://github.com/${GH_REPO}/actions/runs/${RUN_ID}) | ${DURATION_MIN}m | $TURNS | $INPUT | $OUTPUT | $CACHE_CREATE | $CACHE_READ | \$${COST_FMT} |" >> report.md
              TOTAL_COST=$(echo "$TOTAL_COST + $COST" | bc 2>/dev/null || echo "$TOTAL_COST")
              TOTAL_INPUT=$(echo "$TOTAL_INPUT + $INPUT" | bc 2>/dev/null || echo "$TOTAL_INPUT")
              TOTAL_OUTPUT=$(echo "$TOTAL_OUTPUT + $OUTPUT" | bc 2>/dev/null || echo "$TOTAL_OUTPUT")
              TOTAL_CACHE_CREATE=$(echo "$TOTAL_CACHE_CREATE + $CACHE_CREATE" | bc 2>/dev/null || echo "$TOTAL_CACHE_CREATE")
              TOTAL_CACHE_READ=$(echo "$TOTAL_CACHE_READ + $CACHE_READ" | bc 2>/dev/null || echo "$TOTAL_CACHE_READ")
              TOTAL_RUNS=$((TOTAL_RUNS + 1))
            done
          done

          TOTAL_COST_FMT=$(printf '%.2f' "$TOTAL_COST" 2>/dev/null || echo "$TOTAL_COST")
          if [ "$TOTAL_RUNS" -eq 0 ]; then
            echo "No Claude runs in the last 24h."
            echo "SKIP=true" >> "$GITHUB_ENV"
            exit 0
          fi

          echo "" >> report.md
          echo "**Today: ${TOTAL_RUNS} runs, \$${TOTAL_COST_FMT}**" >> report.md

          LEDGER=".github/cost-reports/ledger.json"
          mkdir -p .github/cost-reports

          STATS=$(python3 - "$LEDGER" "$TODAY" "$TOTAL_RUNS" "$TOTAL_COST" "$TOTAL_INPUT" "$TOTAL_OUTPUT" "$TOTAL_CACHE_CREATE" "$TOTAL_CACHE_READ" <<'PYEOF'
          import json, sys
          ledger_path = sys.argv[1]
          new_entry = {
              "date": sys.argv[2], "runs": int(sys.argv[3]), "cost_usd": float(sys.argv[4]),
              "input_tokens": int(sys.argv[5]), "output_tokens": int(sys.argv[6]),
              "cache_creation_tokens": int(sys.argv[7]), "cache_read_tokens": int(sys.argv[8]),
          }
          try:
              with open(ledger_path) as f: ledger = json.load(f)
          except (FileNotFoundError, json.JSONDecodeError): ledger = []
          ledger = [e for e in ledger if e["date"] != new_entry["date"]]
          ledger.append(new_entry)
          ledger.sort(key=lambda e: e["date"])
          with open(ledger_path, "w") as f: json.dump(ledger, f, indent=2); f.write("\n")
          total_cost = sum(e["cost_usd"] for e in ledger)
          avg_7d = sum(e["cost_usd"] for e in ledger[-7:]) / len(ledger[-7:])
          avg_30d = sum(e["cost_usd"] for e in ledger[-30:]) / len(ledger[-30:])
          print(f"{total_cost:.2f} {len(ledger)} {avg_7d:.2f} {avg_30d:.2f}")
          PYEOF
          )
          read CUMULATIVE_COST CUMULATIVE_DAYS AVG_7D AVG_30D <<< "$STATS"

          echo "" >> report.md
          echo "### Cumulative" >> report.md
          echo "" >> report.md
          echo "| Metric | Value |" >> report.md
          echo "|--------|-------|" >> report.md
          echo "| All-time total ($CUMULATIVE_DAYS days) | \$${CUMULATIVE_COST} |" >> report.md
          echo "| 7-day daily average | \$${AVG_7D} |" >> report.md
          echo "| 30-day daily average | \$${AVG_30D} |" >> report.md
          echo "" >> report.md
          echo "*Costs are API-equivalent pricing even on subscription plans.*" >> report.md
          cat report.md

          echo "TODAY=$TODAY" >> "$GITHUB_ENV"
          echo "TOTAL_COST_FMT=$TOTAL_COST_FMT" >> "$GITHUB_ENV"
          echo "CUMULATIVE_COST=$CUMULATIVE_COST" >> "$GITHUB_ENV"

      - name: Commit ledger to data branch
        if: env.SKIP != 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .github/cost-reports/ledger.json
          git diff --cached --quiet && echo "No ledger changes" && exit 0
          git commit -m "chore: update cost ledger (${{ env.TODAY }})"
          git push

      - name: Close previous cost-report issues
        if: env.SKIP != 'true'
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          ISSUE_IDS=$(gh issue list --state open --label cost-report --json number --jq '.[].number' 2>/dev/null || echo "")
          for ID in $ISSUE_IDS; do
            gh issue close "$ID" --comment "Superseded by today's rolling report." 2>/dev/null || true
          done

      - name: Create today's report issue
        if: env.SKIP != 'true'
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          REPORT_TITLE: "Claude cost — ${{ env.TODAY }} ($$${{ env.TOTAL_COST_FMT }} today, $$${{ env.CUMULATIVE_COST }} total)"
        run: |
          gh issue create \
            --title "$REPORT_TITLE" \
            --body "$(cat report.md)" \
            --label "cost-report"
```

> **Labels needed**: Add `cost-report` to your repo labels alongside the audit labels.

---

## §5: Enriched AGENTS.md Additions for mdpro

The current mdpro `AGENTS.md` covers structure and commands but lacks the rules that
make vmark's AI agents reliably follow project conventions. Add these sections:

```markdown
## Working Agreement
- Run `git status -sb` at session start.
- Read relevant files before editing. Understand before changing.
- Keep diffs focused — do not refactor surrounding code not mentioned in the task.
- Do not commit unless explicitly requested.
- Keep code files under ~300 lines; split proactively.

## Zustand Patterns (MANDATORY)
- NEVER destructure store values at component top-level — use selectors.
  BAD:  `const { mode } = useEditorStore()`
  GOOD: `const mode = useEditorStore(s => s.mode)`
- Inside callbacks/event handlers, use `useXStore.getState()` — never read stale closure state.
- All stores use `create<State>()` with explicit TypeScript generic — never untyped.

## Tauri IPC Rules
- Every `#[tauri::command]` must return `Result<T, String>` — never `unwrap()` on user input.
- Log every command with Start + Success/Fail pairs using `logger::log_event()`.
- New commands need capability entry in `src-tauri/capabilities/default.json`.

## Logging (MANDATORY for all new features)
- TypeScript: use `loggingService.logEventSync()` — never `console.log()` in committed code.
- Rust: use `logger::log_event()` — never `println!()` / `eprintln!()` in committed code.
- Every significant user action needs: `[ActionName] Start` → `[ActionName] Success/Fail`.
- Include `actionId` in every log call.

## Styling Rules
- NEVER hardcode colors (hex, rgb, rgba) — use CSS variables (`--color-text`, `--color-bg`, etc.).
- Plugin styles live ONLY in their colocated `<name>.css` file, not in `src/styles/globals.css`.
- Dark mode uses `.dark-theme` class selector (not `[data-theme]`).

## Test Rules
- Every new store file needs a corresponding `*.test.ts`.
- Every bug fix needs a regression test that would have caught it.
- Never use snapshot tests for logic — use explicit assertions.
- Edge cases to always consider: empty input, null/undefined, Unicode/CJK, concurrent access.

## Version Sync (Rule 40)
- `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` must always match.
- Update all three when bumping version — never update just one.

## Verification Gates (run after any change)
- `pnpm build` — always
- `cd src-tauri && cargo check` — if any .rs file changed
- `pnpm test:run` — if any .test.ts touched or new tests added
```

---

## Role of Local mecha.im After Adding GitHub Actions

The local mecha setup we built is still valuable alongside GitHub Actions:

| Use case | Local mecha | GitHub Actions |
|---|---|---|
| Quick ad-hoc audit during development | ✓ Best | ✗ Too slow (Actions queue) |
| Daily automated audit without human | ✗ Mac must be awake | ✓ Always on |
| GitHub issue creation + PR fix loop | ✗ Not designed for it | ✓ Native |
| Test new audit dimensions before committing | ✓ Instant iteration | ✗ |
| Deep single-dimension focus | ✓ Flexible prompt | ✗ Fixed workflow |
| Works on local-only repo (no GitHub remote) | ✓ | ✗ |
| Cost (Claude Max subscription) | Both use same OAuth token | Both use same OAuth token |

**Recommendation**: Keep both. Local mecha for development; GitHub Actions for production daily cycle.

---

## Implementation Checklist

### Step 1: Enrich mdpro's AGENTS.md (15 min)
- [ ] Add Working Agreement section
- [ ] Add Zustand Patterns section
- [ ] Add Tauri IPC Rules section
- [ ] Add Logging rules section
- [ ] Add Styling Rules section
- [ ] Add Test Rules section
- [ ] Add Version Sync rule
- [ ] Add Verification Gates

### Step 2: Add GitHub Actions workflows (45 min)
- [ ] Create `mdpro/.github/workflows/claude-audit.yml` (from §1)
- [ ] Create `mdpro/.github/workflows/claude.yml` (from §2)
- [ ] Create `mdpro/.github/workflows/ci.yml` (from §3)
- [ ] Create `mdpro/.github/workflows/claude-cost-report.yml` (from §4)
- [ ] Create `data` branch for cost ledger: `git checkout --orphan data && git commit --allow-empty -m "init" && git push origin data`
- [ ] Verify `pnpm build` and `pnpm test:run` scripts exist in `package.json`
- [ ] Create GitHub repo labels: `audit`, `bug`, `security`, `dead-code`, `error-handling`, `test-gap`, `performance`, `type-safety`, `convention`, `dependency`, `cost-report`

### Step 3: Set secrets (5 min)
- [ ] Add `CLAUDE_CODE_OAUTH_TOKEN` to `anzchy/mdpro` Actions secrets
- [ ] (Optional) Enable auto-merge in repo settings: Settings → General → Allow auto-merge

### Step 4: First test run (5 min)
- [ ] Go to Actions tab in mdpro repo → "Claude Periodic Audit" → Run workflow
- [ ] Watch issues appear with `[audit]` prefix and labels
- [ ] Watch fixer auto-trigger and open PRs
- [ ] Review a PR — `git diff` equivalent is right there in GitHub

### Step 5: Monitor for one week
- [ ] Check Actions cost: $COST_PER_DAY ≈ auditor + fixer per run
  (vmark runs at ~$17/day; mdpro has fewer dimensions, likely $5-10/day)
- [ ] Tune audit dimensions that produce false positives
- [ ] Adjust `--max-turns` if runs time out or finish too fast
