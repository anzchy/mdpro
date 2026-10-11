<!-- Device-check record. Condensed by mdpro-delegator from the report written by real-device-tester (dtrack, Mac mini); brief: docs/pending/20261011-brief-rc-c8bd2b6-b-d85.md (untracked). 26 PASS / 0 FAIL / 0 NOT EXERCISED (Case 0, D1–D20, R1–R5); 0 updates-disabled lines; install leg not exercised by design (post-publication canary). One timing note (N1). No findings registered. -->

# 0.3.1 RC regression, part B, update checker (D85) on `c8bd2b6`: report (2026-10-11)

| Field | Value |
|---|---|
| Build | `c8bd2b6` (`c8bd2b63481a3a03552a259c7845c04cc47ea1ea`), the locked 0.3.1 candidate |
| Stock bundle (Case 0) | `~/.mdpro-redesign/dtrack/builds/c8bd2b6/mdpro.app`; `tauri-app` sha256 `16dfdd304e18639b3dfac4fc9bb03d00e34c90bcc20d080be6da02bb079f4e39` = `BIN_SHA` ✔; `stat -f %m` `1791717725` = `BIN_MTIME` ✔ (the same binary as part A); endpoint `https://github.com/anzchy/mdpro/releases/latest/download/latest.json` |
| -d85 bundle (D1–D20, R1–R5) | `~/.mdpro-redesign/dtrack/builds/c8bd2b6-d85/mdpro-d85.app`, built from the same SHA with `d85-override.json` (`tauri build -c`: endpoint `http://127.0.0.1:18785/latest.json`, `dangerousInsecureTransportProtocol`, updater compares against `0.3.0`, public key unchanged); `tauri-app` sha256 `fd79f41271daf6e840ff47a8c07e1f44fae942824932a594db10e6f6c1353cdc` = `BIN_SHA_D85` ✔; `stat -f %m` `1791717841` = `BIN_MTIME_D85` ✔ |
| Version shown | -d85 About header **Version v0.3.1** (`CARGO_PKG_VERSION` of the SHA, by design; brief warning 2). `CFBundleShortVersionString` was not read by this brief or recorded in the report, for either bundle |
| Bundle id | Both bundles are `com.mdpro.app`; `request_access` granted only `com.mdpro.app` (`mdpro-d85` not listed separately) |
| Worktree / HEAD | `/Users/jack/Documents/mac-app/mdpro-wt/verify-c8bd2b6`; `git -C $WT rev-parse HEAD` = `c8bd2b63481a3a03552a259c7845c04cc47ea1ea` ✔; `merge-base --is-ancestor 8f353ac HEAD` → `0` ✔ (D85's fix commit) |
| Sidecar | Not checked in part B (no MCP use); part A recorded `mdpro_mcp` `-rwxr-xr-x` 8012832 B on the stock bundle |
| Processes | Case 0 PID **17477** `…/builds/c8bd2b6/mdpro.app/Contents/MacOS/tauri-app`; before the -d85 launch `pgrep -fl 'mdpro.*\.app/Contents/MacOS'` empty (rc 1); -d85 PID **18169** `…/builds/c8bd2b6-d85/mdpro-d85.app/Contents/MacOS/tauri-app`, the only mdpro path for D1–R5 |
| Brief | `docs/pending/20261011-brief-rc-c8bd2b6-b-d85.md` (on the mini: `~/.mdpro-redesign/dtrack/briefs/20261011-brief-rc-c8bd2b6-b-d85.md`) |
| Tester | real-device-tester (tmux `dtrack`, Mac mini), one run in zsh after part A had finished; no repo edits, commits or pushes; no document opened |
| Date | 2026-10-11, 19:49–19:59 (+08:00) |
| Report origin | mini `~/.mdpro-redesign/dtrack/reports/20261011-rc-c8bd2b6-b-d85.md` and `~/.mdpro-redesign/dtrack/reports/20261011-rc-c8bd2b6-b-d85-server.log`; MacBook copies `~/.mdpro-redesign/reports-in/20261011-rc-c8bd2b6-b-d85.md` (119 lines) and `~/.mdpro-redesign/reports-in/20261011-rc-c8bd2b6-b-d85-server.log` (46 lines) |
| Log | `L` numbers are lines of the mini's `~/.mdpro/mdpro.log`; the run's slice is L16518–L16691. Shots are in the tester's `reports/shots/`, all 1200 × 800 |
| Scenario server | adr047-verify's stub `~/.mdpro-redesign/adr047-probe/d85-server/` (`server.mjs`, `scenario`, `d85-override.json`, `cases.md`), node `v22.22.3`, listening on `127.0.0.1:18785` (`/latest.json`), scenario chosen by the `scenario` file. 19 scenarios: `valid` `older` `same` `204` `404` `401` `403` `500` `502` `503` `bad-json` `empty-body` `not-object` `no-platforms` `no-signature` `no-version` `bad-semver` `bad-pub-date` `no-target` |
| User's ruling | 「D92 按单元接受；D85 随演练一起验 (Recommended)」（2026-10-11） |

## 1. Build and settings

| Check | Result |
|---|---|
| Logging | `{"enabled":true,"level":"info"}` ✔ |
| `request_access` | `{"granted":[{"bundleId":"com.mdpro.app","displayName":"mdpro",…,"tier":"full"}],"denied":[],"screenshotFiltering":"native"}` |
| Pre-launch `pgrep -fl 'mdpro\|tauri-app'` | two non-app hits only (`tmux new -s dtrack …`, `claude --resume mdpro-remote`); no mdpro process |
| Case 0 curl pre-check | `404` ✔ (releases/latest is still the empty v0.3.0; endpoint state unchanged) |
| Server start | `d85-server listening on http://127.0.0.1:18785/latest.json  scenario=valid` |
| Smoke loop | every scenario answered as expected, no `UNKNOWN`: `valid` `older` `same` 200; `204` 204; `404` `401` `403` `500` `502` `503` their own code; `bad-json` `empty-body` `not-object` `no-platforms` `no-signature` `no-version` `bad-semver` `bad-pub-date` `no-target` 200 (server.log lines 4–22) |

server.log: lines 1–3 predate the run (08:34Z), lines 4–22 are the smoke loop, lines 23–46 are the checks below.

## 2. Verdict table (report § 2, all rows)

UI: **E** = `Couldn't get update information. Try again later.` with an enabled **Check Again**. **A** = `Update available — v0.3.1` + `Install Update` + notes `D85 device check: local stub manifest. Not a real release.` + Check Again. **U** = `✓ You're up to date` + Check Again. RNF = `Could not fetch a valid release JSON from the remote`.

| Row | Verdict | UI | Terminal log `context` (L) | New server.log lines |
|---|---|---|---|---|
| Case 0 | **PASS** | E (both) | L16556 `{"error":"Could not fetch a valid release JSON from the remote"}`; after Check Again L16558, the same | 0 (as expected) |
| D1 `valid` | **PASS** | A | L16609 `{"hasUpdate":true,"version":"0.3.1"}` | 1: `2026-10-11T11:51:16.684Z  scenario=valid  status=200  GET /latest.json` |
| D2 `older` | **PASS** | U | L16611 `{"hasUpdate":false}` | 1: `11:51:47.696Z scenario=older status=200` |
| D3 `404` | **PASS** | E | L16613 `{"error":"Could not fetch a valid release JSON from the remote"}` | 1: `11:52:06.004Z scenario=404 status=404` |
| D4 `503` | **PASS** | E | L16615 RNF | 1: `11:52:22.062Z scenario=503 status=503` |
| D5 `401` | **PASS** | E | L16617 RNF | 1: `11:52:38.031Z scenario=401 status=401` |
| D6 `403` | **PASS** | E | L16619 RNF | 1: `11:52:53.649Z scenario=403 status=403` |
| D7 `500` | **PASS** | E | L16621 RNF | 1: `11:53:09.241Z scenario=500 status=500` |
| D8 `502` | **PASS** | E | L16623 RNF | 1: `11:53:24.964Z scenario=502 status=502` |
| D9 `bad-json` | **PASS** | E | L16625 `{"error":"error decoding response body"}` | 1: `11:53:41.004Z scenario=bad-json status=200` |
| D10 `empty-body` | **PASS** | E | L16627 `{"error":"error decoding response body"}` | 1: `11:53:56.848Z scenario=empty-body status=200` |
| D11 `no-platforms` | **PASS** | E | L16629 ``{"error":"the `url` field was not set on the updater response"}`` | 1: `11:54:12.665Z scenario=no-platforms status=200` |
| D12 `no-signature` | **PASS** | E | L16631 ``{"error":"the `signature` field was not set on the updater response"}`` | 1: `11:54:28.447Z scenario=no-signature status=200` |
| D13 `no-version` | **PASS** | E | L16633 ``{"error":"missing field `version`"}`` | 1: `11:54:44.249Z scenario=no-version status=200` |
| D14 `bad-semver` | **PASS** | E | L16635 `{"error":"unexpected character 'n' while parsing major version number"}` | 1: `11:54:59.969Z scenario=bad-semver status=200` |
| D15 `bad-pub-date` | **PASS** | E | L16637 ``{"error":"invalid value for `pub_date`: the 'year' component could not be parsed"}`` | 1: `11:55:16.657Z scenario=bad-pub-date status=200` |
| D16 `no-target` | **PASS** | E | L16639 ``{"error":"the platform `darwin-aarch64` was not found on the response `platforms` object"}`` | 1: `11:55:32.606Z scenario=no-target status=200` |
| D17 `not-object` | **PASS** | E | L16641 `{"error":"invalid length 0, expected struct InnerRemoteRelease with 6 elements"}` | 1: `11:55:48.455Z scenario=not-object status=200` |
| D18 `same` | **PASS** | U | L16643 `{"hasUpdate":false}` | 1: `11:56:04.735Z scenario=same status=200` |
| D19 `204` | **PASS** | U | L16645 `{"hasUpdate":false}` | 1: `11:56:20.706Z scenario=204 status=204` |
| D20 server stopped | **PASS** | E | L16647 `{"error":"error sending request for url (http://127.0.0.1:18785/latest.json)"}` | 0 (as expected; `lsof` printed `stopped` before the click) |
| R1 `503` | **PASS** | E | L16649 RNF | 1: `11:56:55.840Z scenario=503 status=503` |
| R2 `valid`, re-enter About | **PASS** (cache hit, as expected) | E (still the error text) | no new line (`ui.about.update_check` count 65 → 65) | 0 |
| R3 `valid`, Check Again | **PASS** (D85 recovery) | A | L16655 start `{"forceRefresh":true}` → L16656 `{"hasUpdate":true,"version":"0.3.1"}` | 1: `11:57:33.362Z scenario=valid status=200` |
| R4 close, ⌘, → About | **PASS** (see N1) | A immediately; the error text never appeared | L16668 start `{"forceRefresh":false}` → L16669 `{"hasUpdate":true,"version":"0.3.1"}` (plus L16661 / L16663 on Settings open) | 2: `11:57:57.035Z scenario=valid status=200`, `11:58:01.040Z scenario=valid status=200` |
| R5 `older`, close, ⌘, → About | **PASS** (see N1) | U | L16674 start `{"forceRefresh":false}` → L16676 `{"hasUpdate":false}` | 1: `11:58:37.382Z scenario=older status=200` |

**No FAIL and no NOT EXERCISED.** Every -d85 row that should reach the stub added exactly one server.log line (R4 added two, see N1); the two rows that should not (D20 server stopped, R2 cache hit) added none. D3–D8 all carry the same ReleaseNotFound text, which is the accepted D85 option-A limit (the plugin never reads the HTTP status), so no row differed from D3.

**Install leg: not exercised, by design.** Brief warning 3: never click `Install Update`; the stub has no bundle. The tester confirms **Install Update was never clicked**. The real install is covered by the post-publication canary on the real endpoint, the same leg that covers part A's item 10.

Run-wide figures (L16518–L16691): **54** `ui.about.update_check` lines, i.e. 27 start/terminal pairs. Every error-row terminal line is `level:"error"`, `status:"fail"`, with no `outcome` key; every success line is `level:"info"`, `status:"success"`. **0** lines contain `updates-disabled`, and **"Automatic updates coming soon." never appeared**.

## 3. Evidence per row (condensed)

### Case 0. Stock bundle, real endpoint (PID 17477)
⌘, → About: L16555 `start` `{"forceRefresh":false}` (19:50:19.260) → L16556 `fail` RNF (19:50:25.739, about 6.5 s for the real GitHub round-trip); `c0-open.png` E. **Check Again**: L16557 `start` `{"forceRefresh":true}` → L16558 `fail` RNF; `c0-again.png` E. `sl` unchanged (last line still the 08:34:43Z `bad-json`), 0 new lines. Both pairs share `actionId` `b5a84b2b-…` (per component mount). Settings closed with ×, mdpro › Quit mdpro, `pgrep` empty.

### D1–D20. -d85 bundle (PID 18169)
Per row: `cat scenario` printed the row's scenario, Check Again, 8 s wait, shot `d85-<row>.png` (`d85-D1` … `d85-D20`); `uc` / `sl` results are in § 2. D1 was the first About open: L16608 `start` `{"forceRefresh":false}` → L16609 success. D20: the server was killed and `lsof` printed `stopped`; `scenario` still read `204` and the stub logged nothing new (`sl` stayed at `11:56:20.706Z scenario=204`); the fail is L16647. The server was then restarted (`d85-server listening … scenario=valid`).

### R1–R5. Recovery, one sitting, no relaunch
- **R1**: `503`, Check Again: L16648 / L16649, E (`d85-R1.png`).
- **R2**: `cat scenario` = `valid`. General, then About: still E (`d85-R2.png`). No new `ui.about.update_check` line and no new server.log line (`L0` = 42 stayed 42), matching the code (`runCheck(false)` returns the cached error).
- **R3**: Check Again: L16655 `start` `{"forceRefresh":true}` (new `actionId` `24786631-…`, from the R2 remount) → L16656 `success` `{"hasUpdate":true,"version":"0.3.1"}`, A (`d85-R3.png`); stub `11:57:33.362Z`. `Checking for updates...` not captured (about 7 ms).
- **R4**: close button (L16657 `settings.close`), ⌘, (L16658) → **immediately** L16661 `start` `{"forceRefresh":false}` → L16663 `success` `{"hasUpdate":true,…}`, stub `11:57:57.035Z`, while General was showing. About click (L16665) → L16668 / L16669, stub `11:58:01.040Z`. The zoom right after the About click and `r4.png` (about 1 s later) both show A; the old error text never rendered.
- **R5**: `cat scenario` = `older`. Close (L16670), ⌘, (L16671) → L16674 `start` `{"forceRefresh":false}` → L16676 `success` `{"hasUpdate":false}`, stub `11:58:37.382Z scenario=older`, again on Settings open. The About click (L16678) added no further check (served from cache). U (`d85-R5.png`).

### Teardown
Settings closed with its button; mdpro › Quit mdpro, no dialog (L16691 `app.quit.commit` `success`); `pgrep -fl tauri-app` empty. `echo valid > scenario`, `kill`, `rm server.pid`; `lsof -nP -iTCP:18785 -sTCP:LISTEN || echo stopped` printed **`stopped`**. `server.log` copied next to the report. Shots: `c0-open`, `c0-again`, `d85-D1` … `d85-D20`, `d85-R1` … `d85-R5`, `r4`.

## 4. D14 / D17 actual texts (report § 4, verbatim)

The brief left both unpinned (warning 4: read from source, record the actual text).

- D14 (L16635): `unexpected character 'n' while parsing major version number`, an **exact match** with the expected text.
- D17 (L16641): `invalid length 0, expected struct InnerRemoteRelease with 6 elements`, an **exact match** with the expected text.

## 5. Operator slips (report § 5, verbatim)

None. I misread D1's stub output at first (`sl` plus the new-line `awk` printed the same line twice) and corrected the count to 1 before writing this report; the server.log itself has one D1 line (line 23).

## 6. Deviations and notes (report § 6)

- **D5–D8 vs D3:** all five carry the identical text `Could not fetch a valid release JSON from the remote`. There was no difference, so there is no finding.
- **`outcome:"updates-disabled"`:** none anywhere in part B (L16518–L16691).
- **N1, check timing after an update is found.** In Case 0 and D1, opening Settings with ⌘, (landing on General) did **not** start a check; the check started on the About click (L16552 → L16555, L16605 → L16608). After R3 had found an update (`clearCache()`), each later ⌘, started a check **at Settings open**, while General was shown:
  - R4: L16658 → L16661.
  - R5: L16671 → L16674. In R5 the About click (L16678) then used that cached result.

  R4 also checked again on the About click (L16668), so R4 logged two fetches. The brief's proofs ("new start `{"forceRefresh":false}` → success, new server.log line" after ⌘, → About) hold in both rows, and no stale error rendered. The timing differs from the brief's wording, so I'm recording it for the delegator. My guess is that the About component, or an app-level check, mounts with the Settings dialog once the cache is clear; I have not verified this in source.
- **`actionId` per mount:** start and terminal lines share an `actionId`, and successive Check Agains within one mount reuse it (D2–R1 all `8d4427bd-…`). A new mount gets a new one (R3 `24786631-…`, R4 `e045aa29-…` / `399b07fb-…`, R5 `ad549b34-…`).
- **"Checking for updates..."** was not captured in any -d85 row, because local checks finish in 4–13 ms. Part A's About shot did show it on the real endpoint.
- **Teardown:** `lsof` printed **`stopped`** (see § 3).
- No secret or token was printed. The token value appears nowhere in the report or this record.

N1 is registered as [D166](../plans/20260912-frontend-backend-sequencing-order.md#d166) (SHOULD, 0.3.2, mdpro-a3): every R4 / R5 proof held and no stale state rendered, so it is not a gate failure, but the check must run only where the About row says it does. Its source-level cause is unverified; the cache-ownership race registered as [D110](../plans/20260912-frontend-backend-sequencing-order.md#d110) sits on the same code path.
