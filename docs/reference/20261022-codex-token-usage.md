# Codex token usage, 36 hours to 2026-10-22 (evidence for ADR-0133)

**Source:** every `~/.codex/sessions/**/*.jsonl` rollout touched in the window. For each rollout,
usage is the `total_token_usage` at the last `token_count` event inside the window, minus the total
at the last event before it. Tokens spent before the window are therefore not counted. The largest
request is the largest `last_token_usage.input_tokens` inside the window.

**Script:** below, verbatim. A copy is at `~/.mdpro-redesign/herdr-spike/delegator/codex_usage.py`.
Run it as `python3 codex_usage.py <hours>`.

## By project and role (36 hours)

| Who | Input | Not cached | Output | Largest request |
|---|---|---|---|---|
| mdpro implementors (`mdpro-wt/*`, `gpt-6-sol` medium) | 1,733M | 10.5M | 1.96M | 665k |
| picsee (two checkouts) | 299M | 6.2M | 0.99M | 596k |
| mdpro auditor and spec adversary (`gpt-6-astra` high) | 65M | 5.0M | 0.24M | 216k |
| pdf-inspector | 18M | 0.7M | 0.03M | 363k |
| others | 8M | 0.4M | 0.06M | 171k |

The first draft of this file counted whole rollouts, including tokens spent before the window
(1,812M for mdpro implementors). The figures above correct that.

## Reading

- The cost is driven by context size multiplied by the number of tool calls. A 600–700k context
  resent on every call explains why a five-turn item reaches 200–300M input.
- The global config (`model_auto_compact_token_limit=9000000`, against a 1M window) means a session
  does not compact below the window.
- How the plan weighs cached against uncached input is not published. These figures are not a
  quota percentage.

## After ADR-0133 (one row per landing, ten landings)

| Landing | Implementor | Since | Input | Not cached | Largest request |
|---|---|---|---|---|---|
| D258 `b5be763e` (PR #526) | gpt-imple-3, `gpt-5.6-sol` medium, cap 250k | whole item, its own sessions | 16.2M (+2.1M Astra adversary and reviewer) | 0.21M | 198k |

## Script

```python
"""Codex token usage per project/role inside a time window.
Usage: python3 codex_usage.py [hours=36]
For each rollout: usage = total_token_usage at the last token_count event inside the window,
minus total_token_usage at the last event before the window (0 if none). Peak = largest
last_token_usage.input_tokens of an event inside the window."""
import json,os,glob,sys,time
from datetime import datetime
hours=float(sys.argv[1]) if len(sys.argv)>1 else 36
end=time.time(); start=end-hours*3600
def ts(d):
  t=d.get('timestamp')
  try: return datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()
  except Exception: return None
K=('input_tokens','cached_input_tokens','output_tokens')
agg={}
for f in glob.glob(os.path.expanduser('~/.codex/sessions')+'/**/*.jsonl',recursive=True):
  if os.path.getmtime(f)<start: continue
  cwd='';model='';before=None;last=None;peak=0
  for l in open(f):
    try:d=json.loads(l)
    except Exception: continue
    p=d.get('payload') or {}
    if d.get('type')=='session_meta': cwd=p.get('cwd','')
    if d.get('type')=='turn_context': model=p.get('model','')
    if p.get('type')=='token_count' and p.get('info'):
      t=ts(d); tot=p['info'].get('total_token_usage') or {}
      if t is not None and t<start: before=tot; continue
      last=tot; peak=max(peak,(p['info'].get('last_token_usage') or {}).get('input_tokens',0))
  if not last: continue
  u=[last.get(k,0)-(before or {}).get(k,0) for k in K]
  proj='mdpro' if '/mdpro' in cwd else (cwd.split('/')[-2] if '-wt/' in cwd else cwd.split('/')[-1])
  role='astra' if 'astra' in model else ('implementor' if 'mdpro-wt' in cwd else 'other')
  k=proj if proj!='mdpro' else 'mdpro:'+role
  a=agg.setdefault(k,[0,0,0,0]); a[0]+=u[0];a[1]+=u[1];a[2]+=u[2];a[3]=max(a[3],peak)
print(f"window {hours}h ending {time.strftime('%Y-%m-%d %H:%M')}")
for k,v in sorted(agg.items(),key=lambda x:-x[1][0]):
  print(f"{k:34} in={v[0]/1e6:.0f}M uncached={(v[0]-v[1])/1e6:.1f}M out={v[2]/1e6:.2f}M peak={v[3]//1000}k")
```
