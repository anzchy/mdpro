#!/bin/bash
# log.sh mark             remember the current line count of %USERPROFILE%\.mdpro\mdpro.log
# log.sh since [regex]    print events written since the mark: time event status context error
source "$(dirname "$0")/common.sh"
mark="$OUT/.logmark"
if [ "$1" = mark ]; then
  n=$(win '(Get-Content $env:USERPROFILE\.mdpro\mdpro.log -Encoding UTF8 | Measure-Object -Line).Lines' | tr -d '\r\n ')
  [[ $n =~ ^[0-9]+$ ]] || { echo "mark failed (ssh?): '$n'" >&2; exit 1; }
  echo "$n" > "$mark"; echo "mark $n"
else
  n=$(cat "$mark" 2>/dev/null); [[ $n =~ ^[0-9]+$ ]] || { echo "no valid mark; run: log.sh mark" >&2; exit 1; }
  win "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(((Get-Content \$env:USERPROFILE\.mdpro\mdpro.log -Encoding UTF8 | Select-Object -Skip $n) -join \"\`n\")))" | tr -d '\r\n' | base64 -D | python3 -c "
import json,sys,re
pat=re.compile(sys.argv[1]) if len(sys.argv)>1 and sys.argv[1] else None
for l in sys.stdin.read().splitlines():
    try: j=json.loads(l)
    except Exception: continue
    s='%s %s %s %s %s'%(j.get('ts','')[11:23], j.get('event'), j.get('status'), json.dumps(j.get('context'),ensure_ascii=False)[:240], (j.get('error') or '')[:120])
    if not pat or pat.search(s): print(s)" "$2"
fi
