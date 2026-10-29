#!/usr/bin/env bash
# Purpose: PreToolUse(Bash) guard — refuse a tdd-guardian `receipt.js record` that
# would fingerprint a Rust test file that is not rustfmt-clean (rule 10
# 「Format before you record」, D187). The receipt hashes the files' bytes, so a
# `cargo fmt` after the record breaks the receipt for good. Rust REDs are recorded
# through scripts/tdd/red-receipt.mjs --lane rust, which runs the same byte check
# itself before the lane (ADR-0145 d8, scripts/tdd/receipt-rust.mjs); this hook stays
# the backstop for a direct receipt.js record.
# Input: Claude Code's hook JSON on stdin. Exit 2 + one stderr line = denied.
# Fast path: well-formed input that never mentions `receipt.js` exits 0 here,
# without starting Python. Everything else goes to receipt_rustfmt_guard.py (run
# with `python3 -I -B`, so no __pycache__), which fails closed: a missing module,
# a crash or any exit other than 0/2 denies the call.
# @coordinates-with receipt_rustfmt_guard.py (logic), role_guard_shell.py (parser)
# Regression tests: tests/tooling/d187-receipt-rustfmt-guard.test.ts.
set -uo pipefail

input="$(cat)"
trimmed="${input%"${input##*[![:space:]]}"}"
if [[ "$input" != *receipt.js* && "$trimmed" == \{* && "$trimmed" == *\} && "$input" == *'"tool_name"'* ]]; then
  exit 0
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s' "$input" | python3 -I -B "$here/receipt_rustfmt_guard.py"
rc=$?
case "$rc" in
  0 | 2) exit "$rc" ;;
  *)
    echo "receipt-rustfmt-guard: guard exited $rc; refusing the call (fail closed, rule 10, D187)" >&2
    exit 2
    ;;
esac
