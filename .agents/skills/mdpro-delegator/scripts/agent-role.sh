#!/bin/zsh
# Sourced by reset-codex.sh and prompt.sh: one name-to-role policy for Codex panes.
mdpro_role_for_agent() {
  case $1 in
    gpt-auditor) print -r -- auditor ;;
    gpt-imple-?*|opus-imple-?*) print -r -- implementor ;;
    *) return 2 ;;
  esac
}

# Resolve an existing directory before comparing it with a Herdr cwd or reset argument.
mdpro_canonical_worktree() {
  /usr/bin/python3 -c 'import os,sys
p=sys.argv[1]
if not os.path.isabs(p) or not os.path.isdir(p): sys.exit(2)
print(os.path.realpath(p))' "$1"
}

mdpro_expected_worktree() {
  local name=$1 path
  if [[ -n ${MDPRO_WORKTREE_OVERRIDE:-} ]]; then
    [[ $name == opus-imple-1 ]] || return 2
    path=$MDPRO_WORKTREE_OVERRIDE
  else
    path=$HOME/Documents/mac-app/mdpro-wt/$name
  fi
  mdpro_canonical_worktree "$path"
}
