"""ADR-0098 phase 1 manifest generator. Read-only and deterministic.

Usage: python3 -I scripts/redesign/adr0098-manifest.py <repo root> <baseline sha>  > manifest.json

Every file is read from git objects at <baseline sha> (`git show <sha>:<path>`), never
from the working tree, so the output depends only on the SHA. It emits the full
`mdpro-test-move-map/1` manifest: moves with destinations (control, tooling, perf),
exclusions with reasons, overrides with reasons, sorted by source path.
"""
import json, re, subprocess, sys
root, BASE_ARG = sys.argv[1], sys.argv[2]
def sh(*a): return subprocess.check_output(a, cwd=root, text=True)
base = sh('git', 'rev-parse', '--verify', BASE_ARG + '^{commit}').strip()
TREE = sh('git', 'ls-tree', '-r', '--name-only', base).split('\n')
def ls(*prefixes): return [p for p in TREE if p and any(p.startswith(x.rstrip('/') + '/') for x in prefixes)]
def read(p): return subprocess.check_output(['git', 'show', f'{base}:{p}'], cwd=root).decode('utf8')
SPEC = re.compile(r"""(?:from\s+|import\s*\(\s*|vi\.(?:mock|doMock|importActual)\s*\(\s*|require\s*\(\s*)["'`]([^"'`]+)["'`]""")
TOOLFILE = re.compile(r"""["']\s*(?:\.\./)*(scripts/[\w./-]+\.(?:mjs|js|sh|py|json)|\.claude/hooks/[\w./-]+|\.github/(?:workflows|scripts)/[\w./-]+)""")
SEGMENTED = re.compile(r"""["'](scripts|\.github|\.claude)["']\s*,\s*["']([\w.-]+)["']""")
COMMENTS = re.compile(r"""/\*.*?\*/|(?<![:"'`])//[^\n]*""", re.S)
# Support/helper modules: which tooling do they drive?
def target_of(text, depth):
    text = COMMENTS.sub("", text)
    specs = SPEC.findall(text)
    up = '../' * depth
    if any(x.startswith(up + 'scripts/control/') for x in specs): return 'control'
    if any(re.match(re.escape(up) + r'(scripts|\.github|\.claude)/', x) for x in specs): return 'tooling'
    if any(re.match(re.escape(up) + r'vitest\.', x) for x in specs): return 'tooling'
    lits = TOOLFILE.findall(text)
    for top, nxt in SEGMENTED.findall(text):
        if top == '.claude' and nxt != 'hooks': continue
        lits.append(f'{top}/{nxt}/')
    if any(l.startswith('scripts/control/') for l in lits): return 'control'
    if lits: return 'tooling'
    return None
helpers = {}
htext = {p: read(p) for p in ls('tests/support', 'tests/helpers')}
for p, t in htext.items():
    helpers[p] = (target_of(t, 2), False)
def resolve_helper(spec, frm):
    base = '/'.join(frm.split('/')[:-1])
    parts = (base + '/' + spec).split('/')
    out = []
    for x in parts:
        if x == '..': out.pop()
        elif x not in ('', '.'): out.append(x)
    cand = '/'.join(out)
    for ext in ('', '.ts', '.tsx', '.mjs'):
        if cand + ext in htext: return cand + ext
    return None
changed = True
while changed:  # a helper inherits the tooling target of the helpers it imports
    changed = False
    for p, t in htext.items():
        if helpers[p][0]: continue
        for x in SPEC.findall(COMMENTS.sub('', t)):
            if x.startswith('.'):
                h = resolve_helper(x, p)
                if h and helpers[h][0]:
                    helpers[p] = (helpers[h][0], False); changed = True; break
# Hand placements the rules cannot see (each one reviewed; see ADR-0098 § Membership).
OVERRIDES = {'tests/release-workflow-blocks.test.ts': ('tooling',
    'tests tests/support/workflowBlocks.ts, the reader of .github/workflows/release.yml; no import names the workflow')}
# Files the rules place but phase 1 does not move.
EXCLUDED = {'tests/d182-build-mac-masked-failure.test.ts':
    'open receipt D182-WI-1 (red kind environment); user decision 2026-10-15: not moved in phase 1'}
files = [f for f in ls('tests') if f.count('/') == 1 and re.search(r'\.test\.tsx?$', f)]
rows = []
for f in files:
    t = read(f); specs = SPEC.findall(COMMENTS.sub('', t))
    src = any(x.startswith('../src/') for x in specs)
    direct = target_of(t, 1)
    via = set()
    for x in specs:
        m = re.match(r'\./((?:support|helpers)/[\w.-]+)', x)
        if m:
            for ext in ('', '.ts', '.tsx', '.mjs'):
                h = helpers.get('tests/' + m.group(1) + ext)
                if h:
                    if h[0]: via.add(h[0])
                    if h[1]: src = src or False  # helper reaching src does not make the test app-bound by itself
                    break
    target = direct or (sorted(via)[0] if via else None)
    if f[6:].startswith('control-'): target = 'control'
    if f in OVERRIDES: target = OVERRIDES[f][0]
    cls = 'stay' if target is None else ('BORDERLINE-' + target if src else target)
    rows.append({'file': f, 'class': cls})
# A test that imports app source and also reaches tooling stays at the root (the membership
# rule), and is reported for review instead of stopping the run.
review = sorted(r['file'] for r in rows if r['class'].startswith('BORDERLINE'))
moves, excluded = [], []
for r in rows:
    if r['class'] == 'stay' or r['class'].startswith('BORDERLINE'): continue
    if r['file'] in EXCLUDED:
        excluded.append({'file': r['file'], 'class': r['class'], 'reason': EXCLUDED[r['file']]}); continue
    moves.append({'from': r['file'], 'to': f"tests/{r['class']}/{r['file'][6:]}", 'class': r['class']})
for p in ls('perf'):
    moves.append({'from': p, 'to': 'tests/perf/' + p[5:], 'class': 'perf'})
moves.sort(key=lambda m: m['from'])
dest = [m['to'] for m in moves]
if len(set(dest)) != len(dest) or set(dest) & set(TREE):
    sys.exit('destination collision')
print(json.dumps({'schema': 'mdpro-test-move-map/1', 'adr': '0098', 'phase': 1, 'baseline': base,
    'excluded': excluded,
    'stays_for_review': [{'file': f, 'reason': 'imports ../src/ and reaches tooling: stays at the root'} for f in review],
    'overrides': [{'file': f, 'class': c, 'reason': why} for f, (c, why) in sorted(OVERRIDES.items())],
    'moves': moves}, indent=1, ensure_ascii=False))
