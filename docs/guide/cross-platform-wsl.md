# Cross-Platform Development (Mac + WSL)

Developer guide moved from `CLAUDE.md`. The two must-follow rules (always LF,
never `core.autocrlf = true`) are also summarized there.

This project is developed on **macOS** (primary) and **WSL/Linux** (secondary). Line ending mismatches are a common pitfall.

## Line Endings — Always LF

`.gitattributes` enforces LF for all text files. **Never commit CRLF.**

```bash
# Verify a file's line endings
file src/App.tsx          # Should say "ASCII text" not "CRLF line terminators"
```

## If you see mass "modified" files after a pull

This is almost always a CRLF/LF mismatch — not real code changes. Verify:

```bash
git diff --stat HEAD      # Same insertions = deletions → line ending issue
file src/App.tsx          # "CRLF line terminators" confirms it
```

Fix by restoring all files to the committed LF versions:

```bash
git checkout -- .
```

## Re-normalize after editing `.gitattributes`

```bash
git add --renormalize .
git commit -m "chore: normalize line endings to LF"
```

## Never set `core.autocrlf = true`

Windows/WSL default is `autocrlf=true` which converts LF→CRLF on checkout. This causes every line to appear modified when diffing against Mac commits. Disable it:

```bash
git config core.autocrlf false        # repo-level
git config --global core.autocrlf false  # or globally on WSL
```

The `.gitattributes` `eol=lf` rule is authoritative — no per-developer config needed.
