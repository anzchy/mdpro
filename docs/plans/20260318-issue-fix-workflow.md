# Issue Fix Dev Workflow

## Per-Issue Workflow

### 1. Prioritize by P0 → P1 → P2

Start with the P0s — they're data loss and security issues. Fix sequentially, not in bulk.

### 2. For each issue, use `/fix-issue`

This project has a built-in skill for end-to-end issue resolution:

```
/fix-issue 6   # e.g., fix the Cmd+S data loss bug
```

It fetches the issue, classifies it, implements a fix, audits, and opens a PR automatically.

### 3. Manual workflow (if doing it yourself)

```bash
# 1. Create a branch per issue
git checkout -b fix/issue-6-wysiwyg-sync

# 2. Write a failing test FIRST (TDD — red phase)
pnpm test:run   # confirm it fails

# 3. Implement the fix (green phase)
pnpm build      # confirm it compiles

# 4. Run tests + check
pnpm test:run
cd src-tauri && cargo check

# 5. Atomic commit
git add <specific files>
git commit -m "fix(wysiwyg): sync editor content to store on save

Resolves #6 — edits were not flushed to documentStore before
Cmd+S triggered save, causing the pre-edit content to be written.

Co-Authored-By: Claude <noreply@anthropic.com>"

# 6. Open PR
gh pr create --title "fix(wysiwyg): sync editor content on Cmd+S" \
  --body "Closes #6" --assignee @me
```

## Open Issues — Suggested Fix Order

| Issue | Priority | Type | Title | Why |
|-------|----------|------|-------|-----|
| #6 | P0 | bug | WYSIWYG content not synced to store — Cmd+S discards edits | Data loss, most impactful |
| #7 | P0 | security | Pasted HTML in WYSIWYG bypasses DOMPurify — XSS risk | Security, DOMPurify config fix |
| #10 | P1 | security | `javascript:` links clickable in WYSIWYG | Security, one-liner sanitization |
| #8 | P0 | bug | CJK and emoji heading anchors produce broken/colliding slugs | Correctness, self-contained |
| #11 | P1 | bug | CRLF line endings may be mangled on save | File I/O, isolated |
| #13 | P1 | a11y | Tab focus order broken — DevToolbar may trap focus | Accessibility, UI-only |
| #15 | P2 | bug | YAML frontmatter rendered as document content instead of stripped | Compat, affects rendering |
| #9 | P0 | feature | Implement Find & Replace (Cmd+F) | Larger feature, save for last |
| #12 | P1 | feature | Drag image file onto editor should insert markdown image syntax | Feature, needs image paste work |
| #14 | P1 | feature | Add Mermaid diagram support in preview and WYSIWYG | Largest feature, most complex |

## Rules

- One branch per issue — never bundle unrelated fixes
- TDD: write the failing test before writing the fix
- Atomic commits: `type(scope): summary` format
- All tests must pass before opening a PR
- Add structured logging to any new code paths (see CLAUDE.md Logging Rules)
