<!-- Device-check record. Condensed by mdpro-delegator from the report written by real-device-tester (dtrack, Mac mini) at ~/.mdpro-redesign/dtrack/reports/report-20261016-canary-034-to-035.md; brief: ~/.mdpro-redesign/stage-3/brief-canary-034-to-035.md (outside the repo). 6 PASS / 0 FAIL / 0 NOT EXERCISED (C1–C6), plus one D246 sample. -->

# Post-publication canary: a released 0.3.4 client updates itself to v0.3.5 (2026-10-16)

Recorded by mdpro-delegator. **Verdict: PASS, C1–C6.** This is the last exit condition of the
[0.3.5 gate](../plans/20260912-frontend-backend-sequencing-order.md#release-035-gate). v0.3.5 was
published as Latest on 2026-10-16 05:11 UTC (run 38853542009, locked SHA `67715ea`). Run
14:36–14:40 +08:00.

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, input source ABC (so the D219 IME caveat does not apply) |
| Endpoint | the stable `latest.json`, serving `0.3.5` and `…/releases/download/v0.3.5/mdpro_aarch64.app.tar.gz` |
| Before | the published 0.3.4 DMG (13710951 bytes), copied to `builds/canary-0.3.4/mdpro.app`, version 0.3.4, binary sha256 `8862e82a167f2424508b1370b580a3e0635cc2541f67468a544c7ded66f5e459` (the same as the 0.3.4 canary's "after") |
| After | the same path reports 0.3.5, releaseId `0.3.5@67715ea28eb12534f59e7ae99d9c87998fc0f0bd`, binary sha256 `4dced058ec9478f35adf84912e69722d820bd9a03a804976a29a481f740585de`, the same as the RC build's binary |

## Results

| Case | Verdict | Proof |
|---|---|---|
| C1: 0.3.4 finds 0.3.5 | **PASS** | `Update available – v0.3.5` with Install Update enabled; log `hasUpdate:true`, version 0.3.5 |
| C2: Check Again | **PASS** | one new `forceRefresh:true` start / success pair; the UI settled back unchanged |
| C3: Install Update | **PASS** | `update_install` start → success in 12.8 s, no error line; the bundle on disk was already 0.3.5 (`4dced058…`) before relaunch |
| C4: Restart to Apply | **PASS** | Save and Restart; pid 70586 → 71886 at the same path; `app.launch` appVersion 0.3.5, `app.ready` releaseId `0.3.5@67715ea…` |
| C5: up to date | **PASS** | `Version v0.3.5`, `✓ You're up to date`; log `hasUpdate:false` |
| C6: smoke on 0.3.5 | **PASS** | typed text rendered on the first attempt (click on line 1 first); the close prompt answered with Discard changes; process alive |
| D246, one sample | **PASS** | `rm` on an open clean file: exactly one `file.watch.event` `remove` → `emitted_deleted`, decision `deleted-prompt`, the "deleted externally" prompt shown; zero `emitted_modified` lines |

Teardown: a clean quit (`app.quit.commit` drafted 0, failed 0). `~/.mdpro/config.json` changed only
in `recentFiles` (the smoke file added, the oldest entry dropped); the only other change under
`~/.mdpro` is the log growing.

## Notes

- **"Stop Waiting and Quit…" in the macOS app menu** (dtrack's NOTE 4) is expected: it is the
  stuck-quit escape of ADR-0036, which sits after Quit on every platform (`menu.rs:12`, `:156`).
- **actionId:** as in the 0.3.4 canary, 0.3.4 reuses one `actionId` for every check, the install
  and the relaunch in one About session; 0.3.5 starts a fresh one. No verdict depends on it.
- UI wording differs from the brief's table in places (en dash, `Downloading update...` without a
  percentage, `Don't restart yet`, `Discard changes`); each case was judged by its log lines. Each
  check took 11.0–11.7 s against the endpoint.
- `builds/canary-0.3.4/mdpro.app` is now a 0.3.5 client and must not be reused as a 0.3.4 one.
  Three stray helper files dtrack left in `builds/canary-0.3.4/` (`L0`, `PID0`,
  `dl/.claude/mind.mv2.lock`) are on the rule-25 cleanup list.
- Shots are on the mini under `reports/shots/k35-*`.
