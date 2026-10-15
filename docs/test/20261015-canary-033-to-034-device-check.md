<!-- Device-check record. Condensed by mdpro-delegator from the report written by real-device-tester (dtrack, Mac mini) at ~/.mdpro-redesign/dtrack/reports/report-20261015-canary-033-to-034.md; brief: docs/pending/20261015-brief-canary-033-to-034.md (untracked). 6 PASS / 0 FAIL / 0 NOT EXERCISED (C1–C6). -->

# Post-publication canary: a released 0.3.3 client updates itself to v0.3.4 (2026-10-15)

Recorded by mdpro-delegator. **Verdict: PASS, C1–C6.** This is the last exit condition of the
[0.3.4 gate](../plans/20260912-frontend-backend-sequencing-order.md#release-034-gate) and WI-004
acceptance 3: a client still on the old updater (`tauri-plugin-updater` 2.9.0) has to accept a
release signed and served for the new one (2.13.1). v0.3.4 was published as Latest on 2026-10-15
05:19 UTC (run 38684838367, locked SHA `3b16610`).

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, input source ABC |
| Endpoint | the stable `latest.json`, serving `0.3.4` and `…/releases/download/v0.3.4/mdpro_aarch64.app.tar.gz` |
| Before | the published 0.3.3 DMG (14486453 bytes), copied to `builds/canary-0.3.3/mdpro.app`, version 0.3.3, binary sha256 `787eeaca…98bb` |
| After | the same path reports 0.3.4, binary sha256 `8862e82a167f2424508b1370b580a3e0635cc2541f67468a544c7ded66f5e459`, the same as the locked candidate's binary in the [macOS check](20261015-v034-macos-device-check.md) |

## Results

| Case | Verdict | Proof |
|---|---|---|
| C1: 0.3.3 finds 0.3.4 | **PASS** | `Update available – v0.3.4` with Install Update enabled; log `hasUpdate:true`, version 0.3.4 |
| C2: Check Again | **PASS** | a `forceRefresh:true` start and the same success line; the UI settled back unchanged |
| C3: Install Update | **PASS** | `update_install` start → success in 12.5 s with no error line, so the old updater accepted the new signature; the bundle on disk was already 0.3.4 before relaunch |
| C4: Restart to Apply | **PASS** | pid 70359 → 71403 at the same path; `ui.about.relaunch` start, then `app.launch` with appVersion 0.3.4 |
| C5: up to date | **PASS** | `Version v0.3.4`, `✓ You're up to date`; log `hasUpdate:false` |
| C6: smoke on 0.3.4 | **PASS** | typed text rendered; the close prompt was answered with Discard changes; the process stayed alive |

Teardown: `~/.mdpro/config.json` unchanged; the only change under `~/.mdpro` is the log growing.

## Run history

The run took three attempts. The first (13:2x) and second (15:06) stopped before C1 because the
mini's screen was locked; the second came after the user unlocked it, but the delegator's message
reached dtrack only after the display had slept and locked again. The third (15:13–15:17) ran with
`caffeinate -d` holding the display, and kept pre-flight and step 1 from the first attempt.

## Notes

- **C6 focus:** after Settings closed and ⌘N opened a new tab, the first typed text went nowhere;
  a click on line 1 gave the editor focus. Recorded as an observation on that path, not a canary
  failure and not yet a D item.
- **actionId:** 0.3.3 reuses one `actionId` for every check, the install and the relaunch in one
  About session; 0.3.4 started a fresh one after relaunch. No verdict depends on it.
- The UI wording differs from the brief's table in places (an en dash in the available line,
  `Don't restart yet`, `Discard changes`); each case was judged by its log lines. Each check took
  10.7–11.6 s against the endpoint.
- Shots are on the mini under `reports/shots/k34-*`, so the 2026-10-12 canary's images survive.
