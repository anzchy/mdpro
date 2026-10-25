#!/bin/bash
# log.sh mark             remember the byte size and identity of %USERPROFILE%\.mdpro\mdpro.log
# log.sh raw [file]       write the bytes logged since the mark, unchanged, to $OUT/<file>
#                         (default raw-<time>.jsonl) and print its path: the capture a run judges by
# log.sh since [regex]    human view of events since the mark; since is not an oracle (it
#                         reformats and skips bad lines): judge by raw. time event status context error
# Exit 7: the mark no longer fits the file (truncated, replaced, or a v1 line-count mark).
source "$(dirname "$0")/common.sh"
mark="$OUT/.logmark"

# One read of the log, by bytes: size, identity (creation time + sha256 of the first line), and,
# when $off >= 0, the bytes from $off to the end as base64. Shared for writing: mdpro keeps it open.
read -r -d '' PS_READ <<'PS'
$p = Join-Path $env:USERPROFILE '.mdpro\mdpro.log';
$f = [IO.File]::Open($p, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete);
try {
  $n = $f.Length; $h = New-Object byte[] ([Math]::Min($n, 65536)); $k = 0;
  while ($k -lt $h.Length) { $m = $f.Read($h, $k, $h.Length - $k); if ($m -le 0) { break }; $k += $m };
  $e = [Array]::IndexOf($h, [byte]10); if ($e -lt 0) { $e = $k };
  $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($h, 0, $e)).Replace('-', '').ToLower();
  'size ' + $n; 'id ' + (Get-Item -LiteralPath $p).CreationTimeUtc.Ticks + '-' + $sha;
  if ($off -ge 0 -and $off -le $n) {
    [void]$f.Seek($off, [IO.SeekOrigin]::Begin); $b = New-Object byte[] ($n - $off); $k = 0;
    while ($k -lt $b.Length) { $m = $f.Read($b, $k, $b.Length - $k); if ($m -le 0) { break }; $k += $m };
    'b64 ' + [Convert]::ToBase64String($b, 0, $k)
  }
} finally { $f.Close() }
PS
PS_READ=${PS_READ//$'\n'/ }

# Reads the reply on stdin. argv: mode (mark|raw|since), mark file, then the out file or the regex.
read -r -d '' PY <<'PY'
import base64, json, os, re, sys
mode, markfile, arg = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""
f = {}
for line in sys.stdin.read().splitlines():
    k, _, v = line.strip().partition(" ")
    f[k] = v.strip()
size, ident = f.get("size", ""), f.get("id", "")
if not re.fullmatch(r"\d+", size) or not re.fullmatch(r"\d+-[0-9a-f]+", ident):
    sys.exit("bad reply from the log read (ssh? log missing?): size=%r id=%r" % (size, ident))
size = int(size)
if mode == "mark":
    open(markfile, "w").write("v2 %d %s\n" % (size, ident))
    print("mark v2 %d %s" % (size, ident))
    sys.exit(0)
_, start, mid = open(markfile).read().split()
start = int(start)
if size < start:
    print("truncated: the log is %d bytes, below the mark's %d; re-mark" % (size, start), file=sys.stderr); sys.exit(7)
if ident != mid:
    print("replaced: the log's identity is %s, not the mark's %s; re-mark" % (ident, mid), file=sys.stderr); sys.exit(7)
if "b64" not in f:
    sys.exit("bad reply from the log read: no bytes")
data = base64.b64decode(f["b64"])
if len(data) != size - start:
    print("got %d bytes for %d..%d; re-run" % (len(data), start, size), file=sys.stderr); sys.exit(7)
lines = [l for l in data.split(b"\n") if l.strip()]
events, bad = [], 0
for l in lines:
    try: events.append(json.loads(l.decode("utf-8")))
    except Exception: bad += 1
if mode == "raw":
    tmp = arg + ".part"
    open(tmp, "wb").write(data)
    os.replace(tmp, arg)
    print("raw: bytes %d..%d lines: %d malformed: %d (identity %s)" % (start, size, len(lines), bad, ident), file=sys.stderr)
    print(arg)
    sys.exit(0)
pat = re.compile(arg) if arg else None
for j in events:
    if not isinstance(j, dict): continue
    s = "%s %s %s %s %s" % (str(j.get("ts", ""))[11:23], j.get("event"), j.get("status"),
        json.dumps(j.get("context"), ensure_ascii=False)[:240], (j.get("error") or "")[:120])
    if not pat or pat.search(s): print(s)
if bad: print("malformed: %d (skipped)" % bad, file=sys.stderr)
PY

RE_MARK='^v2 [0-9]+ [0-9]+-[0-9a-f]+$'
case "$1" in
  mark)
    r=$(win_read "\$off = -1; $PS_READ") || exit $?
    printf '%s' "$r" | python3 -c "$PY" mark "$mark"
    ;;
  raw|since)
    if [ "$1" = raw ]; then
      name="${2:-raw-$(date +%Y%m%d-%H%M%S).jsonl}"; check_name "$name"; arg="$OUT/$name"
    else
      arg="$2"
    fi
    m=$(cat "$mark" 2>/dev/null)
    [[ $m =~ $RE_MARK ]] || { echo "no v2 mark (a v1 line-count mark no longer fits): re-mark with log.sh mark" >&2; exit 7; }
    read -r _ off _ <<<"$m"
    # Read first: inside a pipeline a failed read printed nothing and exited 0.
    r=$(win_read "\$off = $off; $PS_READ") || exit $?
    printf '%s' "$r" | python3 -c "$PY" "$1" "$mark" "$arg"
    ;;
  *) sed -n '2,7p' "$0" >&2; exit 2 ;;
esac
