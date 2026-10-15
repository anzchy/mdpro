#!/bin/bash
# c4.sh a|b : D240. a = Enter in Link, then Approve; b = Escape in Link, then Reject.
P=/private/tmp/claude-501/-Users-jackcheng-Documents-01-Coding-mac-app-mdpro/2111e493-8b51-4074-88cc-fc9924107420/scratchpad/v035
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro; S=.claude/skills/remote-windows-device-test/scripts/mac
v=$1; word=$2; body=${3:-$1}; late=${LATE:-0}; die(){ echo "ABORT: $*"; exit 3; }
xy(){ echo "$1" | tr -d '"\\ ' | sed -E 's/.*x:([0-9]+).*y:([0-9]+).*/\1 \2/'; }
W='C:\\Users\\jack\\mdpro-audit'
st(){ timeout 60 $S/cdp.sh eval 'return JSON.stringify(__sc.d240())'; }
timeout 60 $S/cdp.sh evalf $P/sc.js >/dev/null
id=$(timeout 60 ssh -o BatchMode=yes win-desktop "powershell -NoProfile -ExecutionPolicy Bypass -File $W\\mcpapi.ps1 -Path /api/documents" | python3 -c 'import sys,json,re; s=sys.stdin.read(); j=json.loads(re.search(r"STATUS 200 (\[.*\])",s).group(1)); print([d["id"] for d in j if (d.get("title") or "").startswith("lk")][0])')
[ -n "$id" ] || die "no lk doc id"; echo "doc id $id"
timeout 60 ssh -o BatchMode=yes win-desktop "Remove-Item $W\\out\\w-$v.txt -ErrorAction SilentlyContinue; 'ok'"
read x y < <(xy "$(timeout 60 $S/cdp.sh eval "return JSON.stringify(__sc.pt('$word','end'))")")
case "$x$y" in (*[!0-9]*|"") die "no $word";; esac
timeout 120 $S/ui.sh "[{\"op\":\"clickat\",\"x\":$x,\"y\":$y}]" >/dev/null
timeout 60 $S/cdp.sh eval "return __sc.select('$word')"
timeout 120 $S/ui.sh '[{"op":"chord","keys":["ctrl+k"],"nofocus":true},{"op":"wait","ms":800},{"op":"chord","keys":["x","period","t"],"nofocus":true},{"op":"wait","ms":400}]' | tail -1
echo "--- after Ctrl+K + typing:"; st
$S/log.sh mark >/dev/null
timeout 120 $S/ui.sh "[{\"op\":\"run\",\"exe\":\"powershell.exe\",\"args\":\"-NoProfile -ExecutionPolicy Bypass -File $W\\\\mcpapi.ps1 -Method POST -Path /api/documents/$id -BodyFile $W\\\\out\\\\body-$body.json -Out $W\\\\out\\\\w-$v.txt\"},{\"op\":\"wait\",\"ms\":3000}]" | tail -1
echo "--- 3 s after the write (Link still open, prompt must be held):"; st
timeout 60 ssh -o BatchMode=yes win-desktop "Test-Path $W\\out\\w-$v.txt"
read x y < <(xy "$(timeout 60 $S/cdp.sh eval 'return JSON.stringify(__sc.ptSel(".link-insert-input"))')")
case "$x$y" in (*[!0-9]*|"") die "no link input";; esac
key=$([ $v = a ] && echo enter || echo esc)
F='{"op":"focus"},{"op":"wait","ms":500},'
if [ "$late" -gt 0 ]; then timeout 120 $S/ui.sh '[{"op":"focus"},{"op":"wait","ms":800},{"op":"tree","depth":0}]' | head -2; echo "--- after early focus:"; st; echo "--- holding Link open $late s more"; sleep $late; F=""; read x y < <(xy "$(timeout 60 $S/cdp.sh eval 'return JSON.stringify(__sc.ptSel(".link-insert-input"))')"); echo "--- before key:"; st; fi
timeout 120 $S/ui.sh "[$F{\"op\":\"clickat\",\"x\":$x,\"y\":$y},{\"op\":\"chord\",\"keys\":[\"end\"],\"nofocus\":true},{\"op\":\"chord\",\"keys\":[\"$key\"],\"nofocus\":true},{\"op\":\"wait\",\"ms\":1500}]" | tail -1
echo "--- after real $key in Link (polled):"; timeout 60 $S/cdp.sh eval 'const o=[]; for (let i=0;i<10;i++){ const s=__sc.d240(); o.push(new Date().toISOString().slice(11,23)+" link="+s.linkOpen+" mcp="+s.mcpOpen+" active="+s.active); await __a.sleep(300);} return o.join(" || ")'; st
timeout 60 $S/cdp.sh shot v035-c4$v-prompt | tail -1
timeout 60 ssh -o BatchMode=yes win-desktop "if (Test-Path $W\\out\\w-$v.txt) { Get-Content $W\\out\\w-$v.txt } else { 'write still pending (no reply yet)' }"
btn=$([ $v = a ] && echo Approve || echo Reject)
read x y < <(xy "$(timeout 60 $S/cdp.sh eval "return JSON.stringify(__sc.ptSel('.mcp-confirm-dialog button','$btn'))")")
case "$x$y" in (*[!0-9]*|"") die "no $btn button";; esac
timeout 120 $S/ui.sh "[{\"op\":\"clickat\",\"x\":$x,\"y\":$y},{\"op\":\"wait\",\"ms\":2000}]" | tail -1
echo "--- after clicking $btn:"; st
timeout 60 ssh -o BatchMode=yes win-desktop "Get-Content $W\\out\\w-$v.txt"
echo "--- log"; $S/log.sh since 'mcp|link|ui\.dialog' | cut -c1-300
