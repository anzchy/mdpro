#!/bin/zsh
# push-head.sh <sha> <branch> [old-head]
# Pushes a handoff SHA as the head of an OPEN PR's branch (rule 70 Commits item 2). With old-head it uses the standing
# --force-with-lease exception, which covers only an existing PR branch (rule 25, ADR-0095): never master, a
# release/x.y branch, a tag, or the frozen frontend-backend-redesign. Without old-head it is a plain push, used before
# the PR exists. It fails unless the PR head afterwards equals <sha>.
# zsh trap avoided: "$S:r..." applies the :r modifier, so the refspec is always written "${sha}:refs/heads/...".
set -u
sha=$1 br=$2 old=${3:-}
case $br in master|release/*|refs/*|frontend-backend-redesign) echo "REFUSED: $br is protected or frozen"; exit 1;; esac
if [[ -n $old ]]; then
  pr=$(gh pr list --head "$br" --state open --json number -q '.[0].number' 2>/dev/null)
  [[ -n $pr ]] || { echo "REFUSED: no open PR on $br, so the force-with-lease exception does not apply"; exit 1; }
  git push -q --force-with-lease="${br}:${old}" origin "${sha}:refs/heads/${br}" || { echo "FAIL push (lease or network)"; exit 1; }
else
  git push -q origin "${sha}:refs/heads/${br}" || { echo "FAIL push"; exit 1; }
fi
head=$(gh pr list --head "$br" --state open --json headRefOid -q '.[0].headRefOid' 2>/dev/null)
if [[ -z $head ]]; then echo "PUSHED ${sha} (no PR yet)"; exit 0; fi
[[ $head == $(git rev-parse "$sha") ]] && echo "OK PR head $head" || { echo "FAIL PR head is $head, not $sha"; exit 1; }
