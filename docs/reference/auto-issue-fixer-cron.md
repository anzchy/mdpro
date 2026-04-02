# Auto Issue Fixer: Scheduled Workflow via System Cron

Fully autonomous pipeline that picks the oldest open GitHub issue every hour,
fixes it with Claude Code, opens a PR, reviews it, and merges if clean.

---

## How the Pieces Fit

```
macOS cron (launchd/crontab)
  └─ auto-fix-issues.sh (bash guard + coordination)
       └─ claude -p "..." --dangerously-skip-permissions
            ├─ find oldest open issue (gh CLI)
            ├─ create branch
            ├─ diagnose + fix + write test  (fix-issue workflow)
            ├─ pnpm build && pnpm test:run
            ├─ gh pr create
            ├─ review diff                  (review workflow)
            └─ gh pr merge --merge (if clean)
```

---

## Why `--dangerously-skip-permissions` + prompt instruction

Claude Code has two independent layers of user interaction:

| Layer | What it gates | Flag to bypass |
|---|---|---|
| Tool permissions | Bash, Edit, Write, etc. asking "allow?" | `--dangerously-skip-permissions` |
| `AskUserQuestion` | Model asking for strategic input | Prompt instruction only |

`--dangerously-skip-permissions` silences tool permission dialogs but **does not
suppress `AskUserQuestion`**. The model calls `AskUserQuestion` when it hits genuine
ambiguity. The fix: tell it in the prompt that it is running autonomously and must
make all decisions itself. The model respects this reliably.

Combined invocation:

```bash
claude -p "<prompt>" \
  --dangerously-skip-permissions \
  --output-format text \
  --max-budget-usd 2.00
```

`--max-budget-usd` is a cost ceiling per run. $2 is enough for a straightforward
bug fix. Raise to $5 for feature work.

---

## Prerequisites

```bash
# 1. gh CLI installed and authenticated
gh auth status

# 2. Claude Code CLI installed
claude --version

# 3. pnpm and Rust toolchain present
pnpm --version
cargo --version

# 4. Repo has a clean master branch to start from
git -C /path/to/repo status --porcelain
```

---

## The Script

Save as `~/.claude/scripts/mdpro-auto-fix.sh` and `chmod +x` it.

```bash
#!/usr/bin/env bash
# mdpro-auto-fix.sh
# Picks the oldest open GitHub issue, fixes it with Claude Code,
# reviews the PR, and merges if clean.
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────
REPO_DIR="/Users/jackcheng/Documents/01_Coding/mac-app/mdpro"
LOG_FILE="$HOME/.mdpro/auto-fix.log"
LOCK_FILE="/tmp/mdpro-auto-fix.lock"
MAX_BUDGET_USD="2.00"
# Issues with these labels are skipped (too risky to auto-fix)
SKIP_LABELS="epic,blocked,needs-design,wontfix"
# ────────────────────────────────────────────────────────────────────────

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Lock: prevent concurrent runs ───────────────────────────────────────
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    log "SKIP: previous run (PID $LOCK_PID) still active"
    exit 0
  fi
  log "WARN: stale lock found, removing"
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ── Log rotation: keep last 500 lines ───────────────────────────────────
mkdir -p "$(dirname "$LOG_FILE")"
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 500 ]; then
  tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

log "──── auto-fix run start ────"

# ── Guard: working tree must be clean ───────────────────────────────────
cd "$REPO_DIR"
git fetch origin master --quiet
git checkout master --quiet
git pull origin master --quiet

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "ABORT: working tree is dirty — manual intervention required"
  git status --short >> "$LOG_FILE"
  exit 1
fi

# ── Guard: no stale fix/* branches (previous run left unmerged) ─────────
STALE=$(git branch | grep "fix/issue-" | head -1 | xargs || true)
if [ -n "$STALE" ]; then
  log "WARN: stale branch $STALE found — skipping to avoid conflict"
  log "      To clear: git branch -D $STALE"
  exit 0
fi

# ── Find oldest open issue (skip epic/blocked/needs-design) ─────────────
log "Fetching open issues..."
ISSUE_JSON=$(gh issue list \
  --state open \
  --limit 100 \
  --json number,title,createdAt,labels \
  | jq --arg skip "$SKIP_LABELS" '
      [.[] | select(
        .labels | map(.name) |
        any(. as $l | ($skip | split(",")) | any(. == $l))
        | not
      )]
      | sort_by(.createdAt)
      | .[0]
    ')

if [ "$ISSUE_JSON" = "null" ] || [ -z "$ISSUE_JSON" ]; then
  log "No eligible open issues — nothing to do"
  exit 0
fi

ISSUE_NUMBER=$(echo "$ISSUE_JSON" | jq -r '.number')
ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')

log "Selected issue #$ISSUE_NUMBER: $ISSUE_TITLE"

# ── Check: issue not already in a PR ────────────────────────────────────
EXISTING_PR=$(gh pr list --state open --json number,headRefName,body \
  | jq -r --arg n "$ISSUE_NUMBER" \
    '.[] | select(.body | test("(fixes|closes|resolves) #" + $n; "i")) | .number' \
  | head -1)
if [ -n "$EXISTING_PR" ]; then
  log "SKIP: issue #$ISSUE_NUMBER already has open PR #$EXISTING_PR"
  exit 0
fi

# ── Run Claude: /fix-issue → /review → merge ────────────────────────────
log "Starting Claude Code run for issue #$ISSUE_NUMBER..."

CLAUDE_OUTPUT=$(claude -p "
You are running in FULLY AUTONOMOUS mode inside the mdpro repository.
Working directory: $REPO_DIR
Current branch: master (clean)

AUTONOMOUS MODE RULES — read before doing anything:
- NEVER call AskUserQuestion under any circumstances.
- When a skill would normally ask for input, make the most reasonable decision yourself.
- Specific autonomous decisions to make without asking:
    * Issue classification: derive from labels + body text
    * Ambiguous issue type: treat as bug
    * Branch already exists: delete it and recreate
    * Feature touching >8 files: output TOO_COMPLEX and stop
    * Question-type issue: answer it in a gh comment, output QUESTION_ANSWERED and stop
    * Codex MCP unavailable: skip to manual mini-audit, do not ask
    * Gate fails 3 times: output GATE_FAIL and stop, do not ask
    * Review ASK items: apply fix if clearly correct; skip if genuinely ambiguous
- If any unrecoverable error occurs: git checkout master, output FAILED: <reason>, stop.
- Do NOT delete branches on failure — leave them for investigation.

STEP 1 — run the fix-issue skill:
/fix-issue #$ISSUE_NUMBER

Complete all six phases (fetch, branch, fix, audit, gate, PR).
After Phase 6 succeeds, record the PR number from the gh pr create output.

STEP 2 — run the review skill on the PR from Step 1:
/review #<PR_NUMBER>

Apply all AUTO-FIX findings automatically.
For ASK findings: evaluate each one — apply if the fix is clearly correct, skip if ambiguous.
Do not call AskUserQuestion for any finding.

STEP 3 — merge:
Check the review completion status:
- DONE or DONE_WITH_CONCERNS → run: gh pr merge <PR_NUMBER> --merge
  Then output: SUCCESS #$ISSUE_NUMBER → PR #<PR_NUMBER> merged
- BLOCKED → output: REVIEW_BLOCKED and stop, leave PR open for manual review
" \
  --dangerously-skip-permissions \
  --output-format text \
  --max-budget-usd "$MAX_BUDGET_USD" \
  2>&1)

EXIT_CODE=$?
log "Claude exit code: $EXIT_CODE"
echo "$CLAUDE_OUTPUT" >> "$LOG_FILE"

# ── Parse outcome ────────────────────────────────────────────────────────
if echo "$CLAUDE_OUTPUT" | grep -q "SUCCESS"; then
  log "RESULT: SUCCESS — $(echo "$CLAUDE_OUTPUT" | grep -oE 'SUCCESS [^$]+')"
elif echo "$CLAUDE_OUTPUT" | grep -q "TOO_COMPLEX"; then
  log "RESULT: SKIPPED — feature too large for auto-fix"
elif echo "$CLAUDE_OUTPUT" | grep -q "QUESTION_ANSWERED"; then
  log "RESULT: QUESTION — answered and closed"
elif echo "$CLAUDE_OUTPUT" | grep -q "REVIEW_BLOCKED"; then
  log "RESULT: BLOCKED — review found issue, branch left open for manual review"
elif echo "$CLAUDE_OUTPUT" | grep -q "GATE_FAIL"; then
  log "RESULT: GATE FAIL — tests could not be fixed, branch left open"
else
  log "RESULT: UNKNOWN — check log for details"
fi

log "──── auto-fix run end ────"
```

---

## Cron Setup

### Option A: `crontab` (simplest)

```bash
crontab -e
```

Add one line:

```cron
7 * * * * /bin/bash /Users/jackcheng/.claude/scripts/mdpro-auto-fix.sh
```

Fires at minute 7 every hour (avoids the `:00` thundering-herd problem).

Verify it's registered:
```bash
crontab -l
```

### Option B: `launchd` plist (macOS-native, more reliable)

Create `~/Library/LaunchAgents/com.mdpro.autofix.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mdpro.autofix</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/jackcheng/.claude/scripts/mdpro-auto-fix.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/Users/jackcheng/.mdpro/launchd-autofix.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/jackcheng/.mdpro/launchd-autofix-err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>/Users/jackcheng</string>
  </dict>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.mdpro.autofix.plist

# Verify
launchctl list | grep mdpro

# Run manually to test
launchctl start com.mdpro.autofix

# Unload to stop
launchctl unload ~/Library/LaunchAgents/com.mdpro.autofix.plist
```

`launchd` is preferred over `crontab` on macOS because:
- Respects system sleep/wake (won't fire while machine is asleep)
- Restarts on failure
- Better PATH and environment control

---

## Monitoring

### Watch live

```bash
tail -f ~/.mdpro/auto-fix.log
```

### Check last result

```bash
grep "RESULT:" ~/.mdpro/auto-fix.log | tail -5
```

### See all merged PRs from auto-fixer

```bash
gh pr list --state merged --limit 20 --json number,title,mergedAt \
  | jq '.[] | "\(.mergedAt[:10]) #\(.number) \(.title)"' -r \
  | grep "fix/issue"
```

### Cost tracking

Each `claude -p` run is capped at `$MAX_BUDGET_USD`. At 24 runs/day:
- $0.50/run → ~$12/day
- $2.00/run → ~$48/day (cap per run, actual cost usually lower for small fixes)

---

## Failure Modes and Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| `SKIP: previous run still active` | Previous Claude run hasn't finished | Wait; or `rm /tmp/mdpro-auto-fix.lock` if PID is dead |
| `ABORT: working tree is dirty` | Unmerged changes from a manual edit | `git checkout master && git stash` |
| `WARN: stale branch found` | Previous auto-fix left an unmerged branch | Review branch, merge or `git branch -D fix/issue-N-auto` |
| `GATE_FAIL` | Tests fail and Claude couldn't fix in 3 tries | Check branch manually; issue may need human judgment |
| `REVIEW_BLOCKED` | Claude found a blocking issue in its own diff | Review the open branch and PR manually |
| `TOO_COMPLEX` | Feature touched >8 files | Run `/fix-issue` manually with human guidance |

### Full reset if something goes wrong

```bash
# Return to clean master
cd /path/to/mdpro
git checkout master
git pull origin master

# List auto-fix branches
git branch | grep "fix/issue"

# Delete a stale one
git branch -D fix/issue-42-auto

# Remove lock if stale
rm -f /tmp/mdpro-auto-fix.lock
```

---

## Tuning

### Skip specific issues

Add label `blocked` or `wontfix` to any issue in GitHub and the script will skip it.

### Limit to bug fixes only

Change the issue fetch in the script to filter by label:

```bash
gh issue list \
  --state open \
  --label bug \
  --limit 100 \
  --json number,title,createdAt,labels
```

### Dry run (no merge)

Remove the `## Step 4: Merge` section from the Claude prompt to have it stop after
PR creation and review, leaving merge to you.

### Raise the budget for harder issues

```bash
MAX_BUDGET_USD="5.00"
```

---

## Key Design Decisions

**Why not gstack `/schedule` or `CronCreate`?**
- `/schedule` (RemoteTrigger) runs on claude.ai servers — no access to your local
  filesystem, git repo, or `gh` CLI.
- `CronCreate` fires inside your Claude session but only while the REPL is idle,
  and jobs expire after 7 days. Not reliable for production use.
- System cron is the only option that runs unconditionally, with full local access,
  and survives indefinitely.

**Why `--dangerously-skip-permissions`?**
Without it, every Bash/Edit/Write call prompts for approval — there is no user to
click "allow" when running headlessly. This flag is safe inside a dedicated repo
where the prompt scope is controlled.

**Why use `/fix-issue` and `/review` directly in the prompt?**
Skills are loaded via the Skill tool, which is available in headless `claude -p` mode.
Writing `/fix-issue #N` in the prompt causes Claude to invoke the Skill tool, which
loads the full skill SKILL.md and executes it exactly as if you had typed it
interactively. This means the prompt stays short and the skills stay the single
source of truth — you don't maintain a parallel hand-rolled copy of the workflow.

**Why instruct the model to avoid `AskUserQuestion`?**
`--dangerously-skip-permissions` bypasses tool permission gates (Bash, Edit, Write)
but does not suppress the model's own `AskUserQuestion` calls. `/fix-issue` and
`/review` both call `AskUserQuestion` at ambiguous decision points (issue
classification, Codex unavailability, review ASK items). Telling the model in the
prompt that it is in autonomous mode and must decide without prompting is the correct
suppression mechanism — the model reliably respects this instruction.

**Why `launchd` over crontab on macOS?**
`crontab` jobs don't run while the machine is asleep. `launchd` with `StartInterval`
queues the job and fires it when the machine wakes. Better for a laptop.
