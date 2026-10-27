#!/bin/zsh
# tree-identity.sh <shaA> <shaB> — compares the src, tests and src-tauri trees (rule 70 Commits item 1).
# SAME on all three means lanes that ran on A hold for B; only decisive files, typecheck/build and ledger:check rerun.
a=$1 b=$2; same=1
for t in src tests src-tauri; do
  x=$(git rev-parse $a:$t) y=$(git rev-parse $b:$t)
  [[ $x == $y ]] && echo "same  $t $x" || { echo "DIFF  $t $x -> $y"; same=0; }
done
(( same )) && echo SAME || echo DIFFERENT
