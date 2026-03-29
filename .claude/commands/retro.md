---
description: Engineering retrospective from git history
argument-hint: "[period: 7d|14d|30d|compare] (default: 7d)"
---

# Retro

## Context

```text
$ARGUMENTS
```

Default period: last 7 days.

---

## Data Collection

```bash
# Commits in period
git log --since="7 days ago" --oneline --no-merges

# Commits with full metadata
git log --since="7 days ago" --format="%h|%ae|%ad|%s" --date=short --no-merges

# Files changed most
git log --since="7 days ago" --name-only --no-merges --format="" | sort | uniq -c | sort -rn | head 20

# Test health
pnpm test:run 2>&1 | tail -20

# Cargo test health
cd src-tauri && cargo test 2>&1 | tail -20
```

For `compare` mode, run the above for both `--since="7 days ago"` and `--since="14 days ago" --until="7 days ago"` to show week-over-week trends.

---

## Output Structure

### 1. Week Summary Table

| Metric | This period |
|--------|------------|
| Commits | N |
| Files changed | N |
| Types (feat/fix/chore/…) | breakdown |
| Test health | pass / fail / unknown |
| Rust build | pass / fail / unknown |

### 2. Commit Breakdown

Group commits by conventional type (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`).

List each commit under its type with the scope in brackets.

### 3. Hotspot Analysis

Top 10 most-changed files. Flag files changed more than 3 times in the period — these are churn candidates. Ask: are they changing for the right reasons, or is there an abstraction missing?

### 4. Shipping Velocity

- Features shipped (feat commits)
- Bugs fixed (fix commits)
- Ratio of chore/refactor to feature work — high ratio may indicate cleanup debt being paid down (good) or over-engineering (worth noting)

### 5. Test Health Trend

- Current test pass rate
- Any tests added this period (count new `*.test.ts` or `*.test.tsx` files)
- Any tests deleted or skipped (`.skip`, `.todo`)

### 6. Wins and Improvements

**Top wins** — 2–3 specific things that went well, anchored in actual commits. Praise is specific or it's worthless.

**Growth opportunities** — 1–2 patterns worth changing. Framed as investment, not criticism. For example: "3 bug fixes in `useMenuEvents` this month — the event registration logic might benefit from a dedicated test suite."

### 7. Next Week Focus

Based on the above, propose 1–3 focus areas for the next period. Keep it actionable.

---

## Tone

- Specificity over flattery. Quote actual commit messages.
- No filler. If there's nothing interesting in a section, say so in one sentence and move on.
- Candid about churn and test gaps. These are investments, not failures.
