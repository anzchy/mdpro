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
  local name=$1 path roster_root
  roster_root=$HOME/Documents/mac-app/mdpro-wt
  if [[ -n ${MDPRO_WORKTREE_OVERRIDE:-} ]]; then
    [[ $name == opus-imple-1 ]] || return 2
    [[ ! -L $roster_root/$name ]] || return 2
    path=$MDPRO_WORKTREE_OVERRIDE
  else
    path=$roster_root/$name
    [[ ! -L $path ]] || return 2
  fi
  local canonical
  canonical=$(mdpro_canonical_worktree "$path") || return 2
  if [[ -n ${MDPRO_WORKTREE_OVERRIDE:-} ]]; then
    /usr/bin/python3 -c 'import os,re,sys
target,root=sys.argv[1:]
roster=re.compile(r"(?:(?:gpt|opus)-auditor|(?:gpt|opus)-imple-[0-9]+)\Z")
foreign=[os.path.join(os.path.dirname(root),"mdpro")]
if os.path.isdir(root):
    foreign.extend(os.path.join(root,name) for name in os.listdir(root) if roster.fullmatch(name) and name!="opus-imple-1")
ancestors=[]
cursor=target
while True:
    ancestors.append(cursor)
    parent=os.path.dirname(cursor)
    if parent==cursor: break
    cursor=parent
for path in foreign:
    if os.path.isdir(path) and any(os.path.samefile(path,ancestor) for ancestor in ancestors): sys.exit(2)' "$canonical" "$roster_root" || return 2
  fi
  print -r -- "$canonical"
}
