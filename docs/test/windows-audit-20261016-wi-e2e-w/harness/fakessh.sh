#!/bin/bash
# WI-E2E-W demo W1 fault injection: run the real ssh (the remote command really executes), count the
# call, then report 255 as if the connection dropped after send. FAKE_SSH_MODE=always|first.
n=$(( $(cat "$FAKE_SSH_COUNT" 2>/dev/null || echo 0) + 1 )); echo $n > "$FAKE_SSH_COUNT"
/usr/bin/ssh "$@"; r=$?
if [ "$FAKE_SSH_MODE" = always ] || { [ "$FAKE_SSH_MODE" = first ] && [ $n -eq 1 ]; }; then echo "[fakessh] call $n: real ssh exited $r, reporting 255" >&2; exit 255; fi
exit $r
