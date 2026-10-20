# Step 8: the self-acceptance handoff (rule 71)

Write `~/.mdpro-redesign/herdr-spike/<you>/<item>-handoff.md` (the brief may name a different file;
the brief wins). The delegator confirms by re-reading your evidence, so give commands and decisive
output lines, not claims.

```markdown
# <item> handoff — <SHA7>

## Summary
<two to four lines: what changed and why; any brief/skill difference noted>

## Workflow record
| Step | File | Result |
|---|---|---|
| Plan | <item>-plan.md | <n> WIs |
| Matrix | <item>-test-matrix.md | <n> cases, or "skipped per brief" |
| Attack | <item>-attack.md | rounds <1|2>; gaps found <n>, added <n>, rejected <n> with counter-proof; or ATTACK-NOT-RUN |
| Implement | <item>-implement.md | <n> WIs DONE |
| Coverage | <item>-coverage.md | PASS / WARN / FAIL |
| Review | <item>-review.md | verdict, COUNT line; subagent or SELF-REVIEW |

## Self-acceptance
| AC | Evidence (test file › case, or command) | Decisive output | Receipt · verdict | Verdict |
|---|---|---|---|---|
| AC-1 | tests/x.test.tsx › "…" | `✓ … (n tests)` | D###-WI-1 · SEPARATION-HELD | PASS |

## REDs
| Receipt | Command | Failing line | Kind | Findings |

## Lanes (Step 7)
| Lane | Command | Decisive line |

## Commit
- SHA <full>, parent <full>
- Trees: :src <sha> · :tests <sha> · :src-tauri <sha>
- `git diff-tree --no-ext-diff --stat -r <parent> <sha>`:
  <output>

## Open items
<every AC not PASS: which, why, and what it needs; reviewer Mediums left open; receipt findings; device-check steps for the delegator's brief>
```

**Don't hand off an AC as PASS** without evidence that shows the behaviour. Name it as open instead.
