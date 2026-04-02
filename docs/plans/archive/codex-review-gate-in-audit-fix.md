# Plan: Codex Review Gate in audit-fix Workflow

## Goal

After Claude fixes an audit issue and before it opens a PR, run a Codex code review
on the diff. If Codex finds critical, high, or medium severity issues, Claude must
address them before the PR is created.

---

## Investigation Findings

### codex-plugin-cc cannot run in CI

`openai/codex-plugin-cc` is a **Claude Code plugin** — it works locally by talking
to a running Codex app server via a local Unix socket through `scripts/codex-companion.mjs`.
It requires an interactive local environment and `codex login`. There is no plugin
marketplace inside the `anthropics/claude-code-action` GitHub Actions sandbox.
**Cannot be used in CI.**

### `@openai/codex` npm package ships the Rust binary

`npm install -g @openai/codex` installs a thin JS wrapper (`bin/codex.js`) that
detects the platform and spawns the correct prebuilt Rust binary from a
platform-specific package (`@openai/codex-linux-x64`, `@openai/codex-darwin-arm64`, etc.).
The Rust binary is the current implementation; the TypeScript CLI is legacy.

### `codex review` is a first-class Rust subcommand

From `codex-rs/cli/src/main.rs`:

```rust
enum Subcommand {
    /// Run a code review non-interactively.
    Review(ReviewArgs),
    ...
}
```

`ReviewArgs` supports these flags:

| Flag | Description |
|------|-------------|
| `--base <branch>` | Review diff from `<branch>` to HEAD |
| `--uncommitted` | Review uncommitted working-tree changes |
| `--commit <sha>` | Review a specific commit |
| `--prompt <text>` | Custom review instructions |

The review runs **non-interactively by default** — no `--full-auto` or `--no-ask` flags
needed. It is read-only and never modifies files.

Review output follows the criteria in `codex-rs/core/review_prompt.md`: discrete,
actionable bugs introduced in the commit (security, correctness, data loss).
Not style, not pre-existing issues.

### Authentication

`OPENAI_API_KEY` environment variable. No `codex login` required when the key is set.

### Correct CI command

```bash
# Reviews diff between master and HEAD (i.e. the fix branch)
codex review --base master
```

Output: numbered list of findings, or empty/clean if nothing found.
Exit code: 0 on success regardless of findings (it's a review, not a gate).
Claude reads stdout and decides whether to fix issues.

---

## Changes Required

### 1. GitHub Secret

Add `OPENAI_API_KEY` to the repo's Actions secrets:
- **Settings → Secrets and variables → Actions → New repository secret**
- Name: `OPENAI_API_KEY`
- Value: your OpenAI API key (`sk-...`)

### 2. New CI step: Install Codex

Add **before** the "Fix audit issues" Claude step:

```yaml
- name: Install Codex CLI
  run: npm install -g @openai/codex
```

### 3. Pass `OPENAI_API_KEY` into the Claude action

```yaml
- name: Fix audit issues
  uses: anthropics/claude-code-action@v1
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  with:
    ...
```

### 4. Updated prompt — step 8 is the new Codex review gate

```
Fix audit issue #<NUMBER>.

1. Read the issue: `gh issue view <NUMBER>`
2. Create a fix branch: `git checkout -b fix/audit-<NUMBER>`
3. Apply the minimum correct fix described in the issue
4. Run frontend gate: `pnpm build`
5. If the fix touches .rs files: `cd src-tauri && cargo check --manifest-path src-tauri/Cargo.toml`
6. If tests are relevant: `pnpm test:run`
7. Commit: `git commit -m "fix: <issue title> (Closes #<NUMBER>)"`

8. Run Codex review on the fix:
   ```bash
   codex review --base master
   ```
   - If output is empty or contains no actionable bugs → proceed to step 9
   - If bugs are found → fix each one, re-run gates (steps 4-6), amend the commit,
     re-run Codex review until clean (max 2 Codex iterations)
   - If still not clean after 2 iterations → proceed anyway, note in PR body

9. Push branch: `git push origin fix/audit-<NUMBER>`
10. Open PR: `gh pr create --title "fix: <issue title>" --body "Closes #<NUMBER>" --label audit`

Rules:
- Apply minimum correct fix — don't refactor beyond the finding
- If a fix requires touching more than 3 files, comment on the issue and skip
- If build/test gates fail after 2 attempts, comment on the issue and move on
- Never commit to master directly
```

### 5. Bump `--max-turns` to 30

The Codex iteration loop needs headroom beyond the current 25.

---

## Full `audit-fix` Job Diff

```yaml
      - name: Install Codex CLI
        run: npm install -g @openai/codex

      - name: Fix audit issues
        if: steps.find-issues.outputs.ISSUE_NUMBERS != ''
        uses: anthropics/claude-code-action@v1
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        with:
          allowed_bots: "claude[bot]"
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github_token: ${{ github.token }}
          show_full_output: true
          claude_args: "--model claude-opus-4-6 --max-turns 30 --allowedTools Bash,Read,Write,Edit,Glob,Grep,MultiEdit"
          prompt: |
            <updated prompt above>
```

---

## Flow Diagram

```
schedule / workflow_dispatch
        ↓
Find oldest open audit issue
        ↓
Claude reads issue
        ↓
git checkout -b fix/audit-<N>
        ↓
Apply fix
        ↓
pnpm build + cargo check + pnpm test:run
        ↓
git commit
        ↓
codex review --base master
        ↓
    Bugs found?
   /            \
  YES            NO
   ↓              ↓
Claude fixes    git push
re-gates        gh pr create
re-commits
codex review
(max 2 iters)
```

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `codex review` not in PATH after global install on Ubuntu | Low | `$(npm bin -g)` is usually in PATH; add explicit PATH export if needed |
| Codex review burns OpenAI tokens on noisy output | Low | Review is targeted at diff only; small diffs are cheap |
| Codex iteration loop exceeds `--max-turns 30` | Low | 2-iteration cap in prompt; Claude falls through to PR if still unclean |
| `OPENAI_API_KEY` not set → codex exits non-zero | Medium | Claude should detect empty output and treat as "no findings" |
| `codex review` output format changes between versions | Low | Pin `@openai/codex` to a specific version once verified |

---

## Implementation Order

1. [ ] Add `OPENAI_API_KEY` secret to GitHub repo settings  ← **prerequisite, do first**
2. [ ] Add `Install Codex CLI` step to `audit-fix` job in `claude.yml`
3. [ ] Add `env: OPENAI_API_KEY` to the "Fix audit issues" Claude step
4. [ ] Replace prompt with updated version (step 8 = Codex review gate)
5. [ ] Bump `--max-turns` from 25 → 30
6. [ ] Trigger `workflow_dispatch` on a single known issue to verify
7. [ ] Check PR body — confirm Codex review ran and findings (if any) were addressed
