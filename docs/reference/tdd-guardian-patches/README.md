> Moved here from `.claude/tdd-guardian/patches/` on 2026-10-30 (chore/tddg-cleanup, base 81bc8384), when tdd-guardian was disabled at project scope; ADR-0125 cites the old path.

# Local patches to the tdd-guardian plugin

These patch a plugin that lives in a **cache directory**
(`~/.claude/plugins/cache/xiaolai/tdd-guardian/<version>/`). A plugin update
replaces that directory wholesale, so anything fixed there is erased without
warning. The patches are kept here so the fix is recoverable, reviewable, and
attached to the evidence that motivated it.

They are **not applied automatically.** Nothing in this repo reaches into the
plugin cache. After a plugin update, reapply by hand and re-check.

## `tdd-guardian-0.9.1-exec-counts-and-exit101.patch`

Against upstream `71346d8` ("chore: release manifest fix", 2026-08-24) of
<https://github.com/xiaolai/tdd-guardian-for-claude>, file
`scripts/tdd-guardian/lib/exec.js`.

```bash
cd ~/.claude/plugins/cache/xiaolai/tdd-guardian/0.9.1
git apply /path/to/mdpro/docs/reference/tdd-guardian-patches/tdd-guardian-0.9.1-exec-counts-and-exit101.patch
```

### What it fixes

**1. The vitest count parser could not read a `todo` segment.** Vitest emits
pipe-separated segments only for non-zero categories — `failed`, `passed`,
`skipped`, and `todo`. The original expression was fixed-order and allowed an
optional `skipped` segment only, so a real line like

```
Tests  3 failed | 1457 passed | 4 todo (1464)
```

matched nothing at all and the counts came back `null`. That is not cosmetic:
`verification.js` grades a red with no counts as `opaque-failure` rather than
`assertion-failure`, which is explicitly weaker evidence at final verdict time.
**One `it.todo` anywhere in the repository silently weakened every red receipt
the tool recorded.** Replaced with a segment-by-segment parser. `todo` is folded
into `skipped` so the `{passed, failed, skipped, total}` shape every caller reads
stays consistent, and kept separately for fidelity.

**2. `EXIT_CLASS` had no entry for 101.** Cargo exits 101 when tests fail.
Unlisted, it fell through to `runner-error`, so a genuine Rust test failure was
reported as a broken environment and no fix-it agent was dispatched.

**3. Guard for the case (2) opens up.** Cargo also exits 101 when the crate does
not compile, which *is* an environment failure. The parse-error heuristic in
`classify()` now recognises `could not compile` and `error[E1234]`, and applies
only when no test output was produced — the presence of test output is the only
thing that separates a failed build from a failed test.

### Evidence this was live damage, not a hypothetical

Measured in this repository on 2026-09-17, before the fix. Every vitest receipt
ever recorded here was downgraded:

| receipt | lane | recorded kind |
|---|---|---|
| `WI-2`, `WI-3`, `WI-5`, `WI-6`, `WI-7`, `WI-10` (2026-09-13/14) | unit | `opaque-failure` |
| `D2-WI-1`, `D2-WI-2`, `D2-WI-3` (2026-09-15) | unit | `opaque-failure` |
| `D2-WI-4` (2026-09-15) | rust | `green` — a red that never went red |
| `WI-2-logging-lock` (2026-09-16) | rust | `environment` — bug 2; a real Rust test failure filed as a broken runner, leaving that work item with no red on record |
| `WI-3-logging-fail-closed` (2026-09-16) | unit | `opaque-failure` |
| `WI-1` (2026-09-17) | unit | `opaque-failure` |

The first receipt recorded after the patch, `TS-WI-1`, came back
`assertion-failure`.

**The historical receipts were deliberately not re-recorded.** They are the
record of what the tool actually saw. Rewriting them would be the same mistake
the receipt mechanism exists to prevent.

## Known, unpatched: receipt ids collide across efforts

`receipts.json` (and `state.json` before it was fixed by hand) key work items by
**bare id**. Recording `WI-3` for a new effort silently destroys the `WI-3`
receipt from an earlier one. This repo already holds ids from four separate
efforts; the collision fired for real once, on `state.json`, and was caught
before damage only because the file was read first.

Worked around locally by namespacing — `TS-WI-1`, `TS-WI-3`, … — but the CLI
still keys by bare id and the next effort that forgets the prefix will overwrite
history. Belongs in the same upstream issue as the two fixes above.
