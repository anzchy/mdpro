#!/usr/bin/env bash
#
# Purpose: Deterministic pre-PR quality gates for the autonomous audit-fix loop
# (.github/workflows/cc-audit-fix.yml). Runs AFTER the fix is committed and any
# Codex-review iterations have converged, BEFORE the branch is pushed / a PR is
# opened. Catches the two classes of defect that the diff-only Codex review gate
# repeatedly let through:
#
#   Gate 1 (hard) — Regression test presence (TDD rule 10):
#       a fix that changes .ts/.tsx/.rs source MUST add or modify a test, unless
#       the latest commit message records an explicit, audited exemption marker.
#
#   Gate 2 (hard) — Sibling call-site scan:
#       when source changes, require a recorded sibling-scan note so a bug class
#       fixed in one function is not silently left unfixed in structurally
#       identical siblings (the #401 regression). The script surfaces candidate
#       sibling definitions to inform that note; the judgement stays with the
#       fixer, but the *record* of having scanned is enforced here.
#
# Exit code: 0 = all gates pass. Non-zero = a gate failed; the caller MUST NOT
# push a branch or open a PR. It must instead add the missing test / handle the
# siblings, or route the issue to `needs-human` (see the workflow brake).
#
# Usage: bash .github/scripts/pre-pr-gates.sh [base-ref]   (base-ref defaults to "master")
#
set -euo pipefail

# This script uses `mapfile` (bash 4+). CI runs on ubuntu (bash 5), but stock
# macOS ships bash 3.2 — fail with a clear message instead of a cryptic
# "mapfile: command not found" if it's ever run there.
if [ "${BASH_VERSINFO:-0}" -lt 4 ]; then
  echo "pre-pr-gates: requires bash 4+ (found ${BASH_VERSION:-unknown}); on macOS run via 'brew install bash'." >&2
  exit 2
fi

BASE="${1:-master}"
NOTE_FILE=".pre-pr/sibling-scan.md"

# Resolve the diff range robustly: under a shallow checkout the `master` ref may
# be absent, in which case fall back to the previous commit on this branch.
if git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  RANGE="${BASE}...HEAD"
else
  RANGE="HEAD~1..HEAD"
fi

mapfile -t CHANGED < <(git diff --name-only "$RANGE" || true)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "pre-pr-gates: no changed files in range '$RANGE' — nothing to gate."
  exit 0
fi

is_test()   { [[ "$1" =~ (\.test\.|\.spec\.|(^|/)tests?/|__tests__/) ]]; }
is_source() { [[ "$1" =~ \.(ts|tsx|rs)$ ]]; }

echo "pre-pr-gates: diffing '$RANGE'"
printf '  changed: %s\n' "${CHANGED[@]}"

# ---------------------------------------------------------------------------
# Gate 1 — regression test presence
# ---------------------------------------------------------------------------
src_changed=false
test_changed=false
for f in "${CHANGED[@]}"; do
  if is_test "$f"; then
    test_changed=true
  elif is_source "$f"; then
    src_changed=true
  fi
done

# Rust tests live inline under #[cfg(test)] in the same .rs file, so a source
# file appearing in the diff can itself carry the regression test. Count it only
# when the diff actually ADDS a #[test] / #[cfg(test)] line.
rust_inline_test=false
if git diff "$RANGE" -- '*.rs' | grep -qE '^\+[[:space:]]*#\[(test|cfg\(test\))'; then
  rust_inline_test=true
fi

# Audited escape hatch for legitimately test-exempt changes (type-only, pure
# refactor of covered code, etc.). Must be justified in the commit message so a
# human reviewer can see the reason: [no-regression-test: <reason>]
test_exempt=false
if git log -1 --format='%B' | grep -qiE '\[no-regression-test:'; then
  test_exempt=true
fi

if $src_changed && ! $test_changed && ! $rust_inline_test && ! $test_exempt; then
  echo "::error::GATE 1 FAILED — source changed but no regression test added/modified (TDD rule 10)."
  echo "  A bug fix must include a test that fails without the fix and passes with it."
  echo "  Either add that test, or — only if the change is genuinely test-exempt —"
  echo "  record '[no-regression-test: <reason>]' in the commit message; otherwise"
  echo "  route the issue to needs-human. Do NOT push or open a PR."
  exit 1
fi
echo "pre-pr-gates: GATE 1 PASS (test present, inline rust test, exemption, or no source change)."

# ---------------------------------------------------------------------------
# Gate 2 — sibling call-site scan
# ---------------------------------------------------------------------------
if ! $src_changed; then
  echo "pre-pr-gates: GATE 2 SKIPPED (no source change)."
  exit 0
fi

# Surface candidate sibling definitions in each changed source file so the fixer
# can judge whether the same bug class repeats. Advisory output only.
echo "pre-pr-gates: GATE 2 — candidate siblings in changed source files:"
for f in "${CHANGED[@]}"; do
  is_source "$f" && ! is_test "$f" || continue
  [ -f "$f" ] || continue
  echo "  --- $f ---"
  # Rust `fn name`, TS `function name`, and `const name = (...) =>` handlers.
  grep -nE '^[[:space:]]*(pub[[:space:]]+)?(async[[:space:]]+)?fn[[:space:]]+[A-Za-z0-9_]+|^[[:space:]]*(export[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+[A-Za-z0-9_]+|^[[:space:]]*(export[[:space:]]+)?const[[:space:]]+[A-Za-z0-9_]+[[:space:]]*=[[:space:]]*(async[[:space:]]+)?\(' "$f" \
    | sed 's/^/    /' || echo "    (no top-level fn/handler definitions matched)"
done

# Enforce that the scan was actually performed and recorded.
if [ ! -s "$NOTE_FILE" ]; then
  echo "::error::GATE 2 FAILED — missing sibling-scan note ($NOTE_FILE)."
  echo "  Review the candidate siblings above. Write '$NOTE_FILE' recording, for"
  echo "  the bug class you fixed, which sibling call-sites share it and were"
  echo "  fixed, and which are not affected (with a one-line reason each). Fold"
  echo "  the same summary into the PR body. Then re-run this gate."
  exit 1
fi
echo "pre-pr-gates: GATE 2 PASS (sibling-scan note present)."
echo "----- $NOTE_FILE -----"
cat "$NOTE_FILE"
echo "----------------------"

echo "pre-pr-gates: ALL GATES PASS."
