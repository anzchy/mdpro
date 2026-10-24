#!/bin/zsh
# push-head.sh <sha> <branch> [old-head]
# Pushes a handoff SHA as the PR branch head (rule 70 Commits item 2). With old-head, uses the standing
# --force-with-lease exception (ADR-0095; PR branches only, never master, release/x.y or a tag).
# zsh trap avoided: "$S:r..." applies the :r modifier, so the refspec is always written "${sha}:refs/heads/...".
set -u
sha=$1 br=$2 old=${3:-}
case $br in master|release/*|refs/tags/*) echo "REFUSED: $br is protected"; exit 1;; esac
if [[ -n $old ]]; then git push -q --force-with-lease="${br}:${old}" origin "${sha}:refs/heads/${br}"
else git push -q origin "${sha}:refs/heads/${br}"; fi
gh pr list --head $br --json number,headRefOid -q '.[] | "PR #\(.number) head \(.headRefOid)"'
