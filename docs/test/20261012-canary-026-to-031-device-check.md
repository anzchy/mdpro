<!-- Device-check record. Condensed by mdpro-delegator from the report written by real-device-tester (dtrack, Mac mini) at ~/.mdpro-redesign/dtrack/reports/report-20261012-canary-026-to-031.md; brief: docs/pending/20261012-brief-canary-026-to-031.md (untracked). 6 PASS / 0 FAIL / 0 NOT EXERCISED (C1–C6). The D85 install leg is exercised. Two findings for the delegator: 0.2.6 wrote no ui.about.* log lines (cause undetermined), and the released 0.3.1 reports buildId "unknown" (registered as D175). -->

# Post-publication canary: a released 0.2.6 client updates itself to v0.3.1 (2026-10-12)

**Why this run exists.** v0.3.1 was published as Latest on 2026-10-12 01:50 UTC
([release-031-gate](../plans/20260912-frontend-backend-sequencing-order.md#release-031-gate),
run 38192569913). Every earlier D85 check forbade clicking **Install Update**
because the stub manifest had no bundle
([part B record](20261011-rc-c8bd2b6-b-d85-device-check.md), "Install leg: not
exercised, by design"). This run is that leg on the real endpoint: an old,
really-released client must find 0.3.1 on
`https://github.com/anzchy/mdpro/releases/latest/download/latest.json`, download
`mdpro_aarch64.app.tar.gz`, verify its minisign signature against the pubkey
baked into the old client, replace its own bundle, relaunch as 0.3.1 and then
report up to date. It also closes part A item 10.

**Why 0.2.6.** v0.3.0's GitHub release carries no assets at all, so 0.2.6
(2026-04-02) is the newest released macOS client. Its updater pubkey and
endpoint are identical to v0.3.1's.

**Build.** Neither bundle is ours: the 0.2.6 client is the released
`mdpro_0.2.6_aarch64.dmg` (14170531 bytes, matched), the 0.3.1 payload is
whatever the updater fetched. Identity is the binary before and after and the
`appVersion` in `app.launch`. Tester: real-device-tester (dtrack), 10:20–10:24
GMT+8, Mac mini, logging `{"enabled":true,"level":"info"}`.

## Verdicts

| Case | What | Verdict | Evidence |
|---|---|---|---|
| C1 | 0.2.6 finds 0.3.1 on the stable endpoint | **PASS** (UI); log proof absent, see F1 | Header `Version v0.2.6`; `Update available — v0.3.1`, enabled **Install Update**, a Highlights block with the 0.3.1 notes. `app.launch` line 16694 `appVersion":"0.2.6"`. Shot `c1-available` |
| C2 | Check Again repeats it | **PASS** (UI); log proof absent | `Checking for updates...` with Check Again disabled for 10–30 s, then back to `Update available — v0.3.1`. Shots `c2-again`, `c2-again-settled` |
| C3 | Install Update: download, signature, bundle swap | **PASS** | `Downloading update...` (no percentage) → `✓ Ready to install` + **Restart to Apply** after ~20 s. Before restart, with pid 53240 still the 0.2.6 process: `CFBundleShortVersionString` already `0.3.1`; `tauri-app` size 18462304 → 23003968, sha256 `addb114d…` → `cf2e5043…`. No error phase, so the plugin's signature check passed. Shots `c3-downloading`, `c3-ready` |
| C4 | Restart to Apply relaunches as 0.3.1 | **PASS** | Dialog `Restart to apply update?` (buttons `Don't restart yet` / `Save and Restart`), clicked Save and Restart. One process, same path, new pid 54217. Lines 16707 `app.quit` success, 16708 `app.launch` `appVersion":"0.3.1"`, 16712 `app.ready` `pid 54217`. Shots `c4-dialog`, `c4-relaunched` |
| C5 | The upgraded client reports up to date | **PASS** | Header `Version v0.3.1`; `✓ You're up to date`, Check Again enabled. Fresh pair 16744 `start {"forceRefresh":false}` → 16745 `success {"hasUpdate":false}`, same actionId, 12 s apart. Shot `c5-uptodate` |
| C6 | Smoke on 0.3.1 | **PASS** | ⌘N, `canary 0.3.1` rendered; ⌘W prompt `Unsaved changes` answered by clicking `Discard changes`; tab closed, process alive. Shot `c6-editor` |

`Automatic updates coming soon.` never appeared. Install Update was clicked
exactly once. No Enter, Return or Esc while a dialog was open.

**Teardown.** mdpro › Quit mdpro; `app.quit.commit` success with `backstop:true`
and all counters 0; no `tauri-app` process left. `~/.mdpro/config.json` is
byte-identical before and after (neither client rewrote it); in `~/.mdpro` only
`mdpro.log` grew. `builds/canary-0.2.6/mdpro.app` is left in place and **is now
the 0.3.1 client**; the DMG was deleted, nothing else.

## Findings

**F1. 0.2.6 writes no `ui.about.*` log lines.** The whole 0.2.6 session (lines
16694–16707) has no `ui.about.update_check`, `ui.about.update_install` or
`ui.about.relaunch`; opening About wrote only `app.version.get`. The 0.2.6
source logs these at level `info` through `loggingService.logEventSync`, whose
`shouldLog` reads the logging store (default enabled, `info`), so the source
gives no reason; the invoke is a swallowed `safeInvoke("log_event")`. The cause
is undetermined and cannot be re-probed: the 0.2.6 binary was replaced by the
run. Consequence for this record: C1–C4 rest on UI state, the bundle identity
before and after, the pid change and the 0.3.1 `app.launch` line, not on the
brief's log pairs. 0.3.1 does emit them (C5). No D item: 0.2.6 is not a
supported surface.

**F2. The released 0.3.1 reports `"buildId":"unknown"` in `app.ready`.**
`main.rs` reads `option_env!("MDPRO_BUILD_ID")`, which the verify launcher
sets (ADR-0047) and `release.yml` does not. A production log line therefore
cannot be tied to the build that produced it. Registered as
[D175](../plans/20260912-frontend-backend-sequencing-order.md#d175).

**F3. Literal strings the brief had wrong** (brief error, not app): the ready
block reads `✓ Ready to install`; the restart dialog's dismiss button is
`Don't restart yet`; the 0.3.1 close prompt is `Unsaved changes` with
`Keep editing` / `Discard changes`; the download phase shows no percentage.

**N1.** Check latency on the real endpoint: about 12 s on 0.3.1, 10–30 s on
0.2.6. The brief's 10 s waits are too short for a Check Again screenshot.

**Operator slips** (tester's own account): C6's first `type` after ⌘N went
nowhere because the editor had no focus; clicked into it and retyped, nothing
saved. C2's 10 s screenshot caught the check in flight; an extra settled shot
was taken.

## Pending after this record

- Delete the rehearsal draft `rehearsal-d76-c8bd2b6` (rule 25, user confirms).
- D175.
