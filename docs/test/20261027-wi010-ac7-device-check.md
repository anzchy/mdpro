# WI010-AC7 device check: control-channel probe v1 and console buffer (2026-10-27)

The first pre-landing card run under [ADR-0144](../adr/0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md),
for PR #543 (ADR-0047 WI-010). Card: [`cards/ADR47-WI010-AC7.md`](cards/ADR47-WI010-AC7.md). Tester: gpt-auditor in a
device pane on the Mac mini, holding the desktop GUI lock.

## Delegator's check against the card

- **Run 1, `fb801b56`: NOT EXERCISED, the brief's fault.** The card and the implementor's command sheet built the verify
  bundle without `--features control-channel` (manifest `"features": []`), so no `control.json` existed and no probe
  could start. The card's setup was corrected in `09117581`; no check changed. Side observation:
  `control:launch --control on` reported `verdict: pass` (L1) on that featureless build instead of refusing.
- **Run 2, `75caea6a` (tree-identical to `fb801b56` in `src`, `tests`, `src-tauri`):** identity matches
  (`releaseId 0.3.5-dev@75caea6a…`, manifest `features: ["control-channel"]`, card blob `42941570`). Steps 1–4 and their
  failure conditions **PASS**: probe v1 fields, the DOM dirty flip after a channel `type`, the typed text in the editor.
  Steps 5–8 (the four console sources and the overflow) **NOT EXERCISED**: a release-type verify build has no web
  inspector, because Tauri enables it there only with the `devtools` Cargo feature, which mdpro does not enable.
- **User ruling (2026-10-27):** 「Waive buffer half + register D (Recommended)」. Gate exception G543-2 for the buffer half,
  this landing only; [D328](../plans/20260912-frontend-backend-sequencing-order.md#d328) gives the device harness a
  real-app way to raise console errors with `eval` off. The buffer stays proved by unit tests.

## Tester report, run 1 (verbatim)

# WI010-AC7 device report — BLOCKED AT SETUP

- Build SHA: `fb801b563e6c041b806d7e76ccd424d86aa46284`
- Card blob: `320a457699e367bfa190454da2756cf9fdd04503`
- `app.ready.releaseId`: `0.3.5-dev@fb801b563e6c041b806d7e76ccd424d86aa46284` (matches)
- Manifest: verify profile; `buildId=d78975d05bd556e8af4fcd56bebc1774e517925f1cf163b8610abca2e9a8fe07`; `commit=fb801b563e6c041b806d7e76ccd424d86aa46284`; `sourceTree=02bbebce357a7e0ca858134c332320903f98df99`; `distSha256=31a992b7f4b02e42ebdba1edb61c487604b8de4d829f464bc7e65ad59920aedc`; `features=[]`.
- Run: `d7dkzbyl6dnyjw0jvm9ulbbuw`; pid `21921`.
- Overall verdict: **NOT EXERCISED**. The prescribed `pnpm control:build --profile verify` omitted the `control-channel` feature. The launched app has no `control.json` and logged no `control.listen`; socket step 2 cannot start. The feature is compiled only with `#[cfg(feature = "control-channel")]` in `src-tauri/src/main.rs`. The brief permits only a SHA change to the device-ready build instructions, so I stopped rather than substitute a different build command. A revised brief would need `pnpm control:build --profile verify --features control-channel` and a new manifest identity.

## Card steps and failure conditions

| Card item | Verdict | Proof |
|---|---|---|
| Setup: build, doctor, fixture, GUI lock | PASS | `WI010-AC7-evidence/build.log`; `doctor-before.log` ends `verdict: pass`; fixture copied to `/tmp/adr47-wi010.6T4mdT/probe.md`; lock acquired before launch. |
| 1. Launch with control on and Source mode | PASS for launch | `launch.log`: `ready: L1 run d7dkzbyl6dnyjw0jvm9ulbbuw pid 21921`, `verdict: pass`; `identity.log` has expected release ID. |
| 2. Probe `{"kind":"cm"}` | NOT EXERCISED | `handoff-check.log`: `control.json absent`. No socket credential exists. |
| 3. Click and type | NOT EXERCISED | Stopped at step 2. |
| 4. Probe after type | NOT EXERCISED | Stopped at step 2; no dirty-flip claim. |
| 5. Enter four errors in Web Inspector | NOT EXERCISED | Stopped at step 2; no Computer Use action or screenshot taken. |
| 6. Probe four sources | NOT EXERCISED | Stopped at step 2. |
| 7. Force overflow | NOT EXERCISED | Stopped at step 2. |
| 8. Probe overflow, app.ready, doctor | NOT EXERCISED for probe/overflow; PASS for identity and doctor observation | `identity.log` has `app.ready`; `doctor-active.log` records one live verify pid and run lock, as expected while running. |
| 9. Quit, clean, final doctor | PASS | `quit.log`, `clean.log`, `doctor-final.log` (`verdict: pass`); GUI lock released. |
| Failure condition: step 2 fields | NOT EXERCISED | No step 2 reply. |
| Failure condition: dirty flip and typed text | NOT EXERCISED | No input or step 4 reply. |
| Failure condition: four sources and sequence | NOT EXERCISED | No step 6 reply. |
| Failure condition: capacity, last fill, consecutive sequence, exact overflow | NOT EXERCISED | No step 8 reply. |
| Failure condition: release ID and one bundle process | PASS for release ID; one live pid observed | `identity.log` has exact release ID and build ID; `doctor-active.log` names pid 21921 as the live verify binary. |

## Decisive excerpts

`build.log`: `control:build: buildId d78975d05bd556e8af4fcd56bebc1774e517925f1cf163b8610abca2e9a8fe07 → src-tauri/target/verify/release/bundle/macos/build-manifest.json`.

Manifest: `"profile": "verify"`, `"features": []`.

`identity.log`: `"event":"app.ready"`, `"buildId":"d78975d05bd556e8af4fcd56bebc1774e517925f1cf163b8610abca2e9a8fe07"`, `"pid":21921`, `"releaseId":"0.3.5-dev@fb801b563e6c041b806d7e76ccd424d86aa46284"`.

`handoff-check.log`: `control.json absent`. No socket reply files were produced; no token was printed or reported. Channel `eval` was never enabled.

`quit.log`: `quit: run d7dkzbyl6dnyjw0jvm9ulbbuw terminated (SIGTERM)`; `verdict: pass`.

`clean.log`: `clean: removed d7dkzbyl6dnyjw0jvm9ulbbuw`; `verdict: pass`.

`doctor-final.log`: `[pass] no run lock`, `[pass] no verify binary running`, `[pass] si.sock not live`, `verdict: pass`.

## Workflow note

The requested TDD Guardian config validated with no errors or warnings, but this is a device acceptance card with no implementation work items or code changes. The workflow's plan stage cannot produce an implementation WI for it; its first applicable gate is the card's setup, where the required control-channel handoff was absent. No RED receipt, coverage, mutation, or code review was claimed. The verify worktree remains at the requested path and is clean.

## Tester report, run 2 (verbatim)

# WI010-AC7 device report — NOT EXERCISED

- Build SHA: `75caea6ab3c7abcb3fba30a5eb7587a876f99bb5` (detached verify worktree retained at `/Users/jack/Documents/mac-app/mdpro-wt/verify-75caea6`).
- `app.ready.releaseId`: `0.3.5-dev@75caea6ab3c7abcb3fba30a5eb7587a876f99bb5`.
- Build manifest: schema 1, profile `verify`, commit `75caea6ab3c7abcb3fba30a5eb7587a876f99bb5`, buildId `f853a299bb36107f740681fc963dbafe305ac2b92588ffdee39b25d61b17e559`, `features: ["control-channel"]`, distSha256 `31a992b7f4b02e42ebdba1edb61c487604b8de4d829f464bc7e65ad59920aedc`, mainBinarySha256 `a51a14792a0e394ee678be95424c6dc582c34d2febdc13499e43ee9827994089`, codesign cdhash `fa830cd63dfc6d43abb3baf8df51b09fa4524f6e`.
- Card blob: `42941570b41556dd66eb8fd86897623eda3270da` (`git rev-parse 75caea6a:docs/test/cards/ADR47-WI010-AC7.md`).
- Run: `1dt6hcxxzjwt5imbzcug0byuh`, PID `7444`. Channel `eval` remained off; its token was never printed or copied into evidence.
- Overall verdict: **NOT EXERCISED**. Step 5 stopped the card: Web Inspector Console could not be opened through Computer Use. No console event was injected, so the buffer and overflow conditions cannot be judged. The delegator needs to provide an alternate deliberate eval-off error fixture or a supported way to open the Inspector, then rerun this card.

## Card steps

| Step | Verdict | Proof |
|---|---|---|
| Setup | PASS | `build.log`: `Finished 1 bundle`, manifest lists `control-channel`; `doctor-before.log`: `verdict: pass`; desktop GUI lock acquired for batch WI010-AC7 before launch. |
| 1. Launch | PASS | `launch.log`: `ready: L1 run 1dt6hcxxzjwt5imbzcug0byuh pid 7444`, `verdict: pass`; `app.ready` line below matches release and build identities. |
| 2. Probe before edit | PASS | `wi010-before.json`: `probeVersion:1`, `windowLabels:["main"]`, `ready:true`, `activeDocument:"probe.md"`, `mode:"source"`, `dirty:false`, console entries `[]`, overflow `0`. |
| 3. Click and type | PASS | `click.json`: `ok:true` with click coordinates; `type.json`: `ok:true`; step 4 proves the editor effect. |
| 4. Probe after edit | PASS | `wi010-after-type.json`: same active document, `dirty:true`, `lastLine:" WI010-device-typed"`, tab dirty `true`. Computer Use AX tree also showed that text in the mdpro editor. |
| 5. Four Web Inspector Console events | NOT EXERCISED | Web Inspector was unavailable through Computer Use: the app had no Inspector menu item, Option-Command-I did not open it, and the editor context menu had no Inspect item. No event was entered. A later alternate shortcut hit an editor command; this changed only the disposable, unsaved fixture. |
| 6. Probe four event sources | NOT EXERCISED | Depends on step 5; no `wi010-after-sources.json` was created. |
| 7. Console overflow input | NOT EXERCISED | Depends on step 5; no overflow input was entered. |
| 8. Probe overflow, log, doctor | NOT EXERCISED | The overflow probe depends on step 7. The `app.ready` identity was read and `doctor-active.log` captured the expected live-run failures (`no run lock`, `no verify binary running`, `si.sock not live`); these do not prove overflow. `pgrep` returned only PID 7444 for this bundle. |
| 9. Cleanup | PASS | `quit.log`: SIGTERM and `verdict: pass`; `clean.log`: owned run and stale socket removed, `verdict: pass`; `doctor-final.log`: `verdict: pass`. Computer Use inventory showed mdpro-verify closed, then GUI lock release returned `RELEASED WI010-AC7`. |

## Failure conditions

| Failure condition | Verdict | Proof |
|---|---|---|
| Initial probe fields missing | PASS | `wi010-before.json` contains each required field and expected value. |
| Dirty flip or typed text missing | PASS | `wi010-after-type.json` contains the dirty flip and exact typed text. |
| Four buffered sources missing or sequence order wrong | NOT EXERCISED | Step 5 blocked deliberate source events. |
| Capacity, last fill, consecutive sequence, or exact overflow wrong | NOT EXERCISED | Steps 7–8 could not run after step 5. |
| Wrong `app.ready.releaseId` or multiple bundle processes | PASS | `app.ready` line below; one matching PID, 7444. |

## Decisive excerpts

`app.ready` (read from the run log before `control:clean`):

```json
{"ts":"2026-10-27T15:38:45.080+08:00","level":"info","event":"app.ready","status":"success","actionId":null,"context":{"appVersion":"0.3.5","buildId":"f853a299bb36107f740681fc963dbafe305ac2b92588ffdee39b25d61b17e559","pid":7444,"platform":"macos","releaseId":"0.3.5-dev@75caea6ab3c7abcb3fba30a5eb7587a876f99bb5","startupTimeMs":355},"durationMs":355,"error":null}
```

Socket replies (complete replies are in the evidence files):

```json
{"id":"p0","ok":true,"value":{"activeDocument":"probe.md","console":{"capacity":100,"entries":[],"overflow":0},"dirty":false,"mode":"source","probeVersion":1,"ready":true,"windowLabels":["main"]}}
{"id":"p1","ok":true,"value":{"activeDocument":"probe.md","console":{"capacity":100,"entries":[],"overflow":0},"dirty":true,"lastLine":" WI010-device-typed","mode":"source","probeVersion":1,"ready":true,"windowLabels":["main"]}}
```

The complete replies identify `dirty` as `DOM`, `activeDocument` as `DOM:textContent`, console fields as `Rust:injected page buffer`, and `windowLabels` as `Rust`.

## Workflow and cleanup

The requested TDD Guardian configuration loaded and validated. This was execution of an existing real-app acceptance card at a fixed SHA; it made no implementation or test changes, so the planner, RED receipts, coverage, mutation, and code-review stages had no work item to run. The device card governed the checks. `pnpm control:quit`, `pnpm control:clean`, and final `pnpm control:doctor` completed in that order; the verify worktree remains as requested.

Evidence directory: `/Users/jack/.mdpro-redesign/device/WI010-AC7-evidence/`. It contains `build.log`, launch/doctor/cleanup logs, the two probe replies, and click/type replies. The run directory and its control token were removed by `control:clean`. No screenshot was captured because none was needed for a passing visual step and Computer Use reported screenshots unavailable.
