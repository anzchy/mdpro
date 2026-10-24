#!/bin/zsh
# status.sh — one line per herdr agent: name, pane, status, and the Codex/Claude context line if visible.
herdr agent list 2>/dev/null | grep -oE '"name":"[^"]+"|"pane_id":"[^"]+"|"agent_status":"[^"]+"' | paste - - - |
while read -r l; do
  n=$(print -r -- $l | grep -oE '"name":"[^"]+"' | cut -d'"' -f4)
  ctx=$(herdr agent read $n --source recent-unwrapped --lines 6 2>/dev/null | grep -oE 'Context [^│·]*[0-9]+%[ a-z]*' | tail -1)
  echo "$l  $ctx" | sed 's/"[a-z_]*"://g; s/"//g'
done
echo "gui-lock: $( [[ -d $HOME/.cache/desktop-gui.lock ]] && tr '\n' ' ' < $HOME/.cache/desktop-gui.lock/owner || echo FREE)"
