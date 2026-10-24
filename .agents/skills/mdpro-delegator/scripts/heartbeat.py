#!/usr/bin/env python3
"""heartbeat.py — edit ~/.mdpro-redesign/herdr-spike/delegator/heartbeat.json, the delegator's live state
(assignments per agent, queues, notes, pilots). Read it at every wake and after a restart.

  heartbeat.py show
  heartbeat.py set <agent> key=value [key=value ...]     e.g. set gpt-imple-1 pane=w1:p3C item=D319 "state=fix 1"
  heartbeat.py note "<text>"
"""
import json, os, sys
P = os.path.expanduser('~/.mdpro-redesign/herdr-spike/delegator/heartbeat.json')
h = json.load(open(P))
cmd = sys.argv[1] if len(sys.argv) > 1 else 'show'
if cmd == 'show':
    print(json.dumps(h, indent=2, ensure_ascii=False)); sys.exit(0)
if cmd == 'set':
    a = h.setdefault('assignments', {}).setdefault(sys.argv[2], {})
    for kv in sys.argv[3:]:
        k, v = kv.split('=', 1); a[k] = None if v == 'null' else v
elif cmd == 'note':
    h.setdefault('notes', []).append(sys.argv[2])
else:
    print(__doc__); sys.exit(2)
json.dump(h, open(P, 'w'), indent=2, ensure_ascii=False)
print('ok')
