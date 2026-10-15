#!/bin/bash
# deploy.sh — copy scripts/windows/* to $WIN_DIR, skipping files whose SHA-256 already matches.
# A full re-upload can exceed the Bash tool's 120 s limit: run it with run_in_background.
source "$(dirname "$0")/common.sh"
win_read "New-Item -ItemType Directory -Force '$WD' | Out-Null; 'dir ok'"
hashes=$(win_read "Get-ChildItem '$WD' -File | ForEach-Object { \$_.Name + ' ' + (Get-FileHash \$_.FullName -Algorithm SHA256).Hash.ToLower() }" | tr -d '\r')
for f in "$SKILL_DIR"/scripts/windows/*; do
  n=$(basename "$f"); check_name "$n"; h=$(shasum -a 256 "$f" | cut -d' ' -f1)
  if printf '%s\n' "$hashes" | grep -qx "$n $h"; then echo "same $n"; continue; fi
  "$(dirname "$0")/push.sh" "$f" "$WIN_DIR\\$n"
done
