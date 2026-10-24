#!/bin/zsh
# post-reports.sh <pr> <file>... — posts each report as its own PR comment, in order (round one: only after BOTH
# auditors are in, so neither sees the other's verdict; then the merged verdict last).
pr=$1; shift
for f in "$@"; do gh pr comment $pr --body-file "$f" >/dev/null && echo "posted $f" || echo "FAIL $f"; done
