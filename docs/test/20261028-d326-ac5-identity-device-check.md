# D326 AC-5 device check: launch identity (2026-10-27/28)

The ADR-0144 pre-landing card run for PR #544 ([D326](../plans/20260912-frontend-backend-sequencing-order.md#d326)). Card:
[`cards/D326-identity-check.md`](cards/D326-identity-check.md) (blob `1990cf86`, unchanged across all three runs). Tester:
gpt-auditor in a hand-started full-access device pane on the Mac mini, holding the desktop GUI lock. Landed SHA: `1d0b66a7`.

## Delegator's check against the card

- **Run 1, `84627974`: FAIL at step 2, steps 3–5 NOT EXERCISED.** Step 2 failed only because `pnpm device:identity`
  prints pnpm's own banner ahead of the tool's output (515 bytes against the report's 60). Steps 3–5 could not run:
  `/Applications/mdpro.app` was not installed, and a second copy of the bundle hands its launch to the first through the
  single-instance socket `/tmp/com_mdpro_app_si.sock`, which is keyed by the compiled identifier `com.mdpro.app`.
- **Run 2, `84627974`: PASS, all six steps**, with two deviations under the user's ruling 「Re-run, adjusted
  (Recommended)」:
  - **D1:** `pnpm -s`;
  - **D2:** a stand-in copy of the verify bundle as "the installed app", with the first instance's socket moved aside for
    its launch and restored afterwards.

  The brief first proposed changing the copy's bundle id. That could not work, because the plugin keys on the compiled
  identifier; the run used the socket move instead.
- **Run 3, `1d0b66a7` (the landing SHA, after test-only fixes 4 and 5): first step-1 launch a false FAIL, then the clean
  retry and steps 2–6 PASS.**
  - The first attempt never started: its brief's PATH named `~/.cargo/bin`, which has no cargo. That was the delegator's
    brief error.
  - On run 3b, the first launch of the freshly built bundle returned `process` FAIL and `releaseId` FAIL. The app's own
    `window.open` and `app.ready` (PID 24864, `startupTimeMs` 396) were logged at 00:35:24.025, the same second the tool
    wrote its result. Delegator's reading, not the tester's: the app process started late, consistent with macOS's
    first-launch assessment of a new bundle, and the tool's 20 s log window closed just before those lines appeared. The
    tool fails closed: a false FAIL, never a false PASS.
  - User ruling for AC-5: 「Accept, document only」. AC-5 is accepted on the retry under gate exception **G-D326-2**, and
    the card and the `macos-device-test` skill now say to launch and quit a freshly built bundle once before the
    identity check. No D item.

## Run 1 report (verbatim)

# D326 AC-5 device identity report — 2026-10-27

**Overall:** FAIL at card step 2 (stdout/report byte equality); coexistence path NOT EXERCISED.

- Build SHA: `84627974b7f16fb021eacae8b194069593a9950a`
- `EXPECTED_RELEASE_ID`: `0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a`
- Card blob: `1990cf86d48436750440f6a43cf4a2ec14fd2448`
- `VERIFY_BUNDLE`: `/Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app`
- Evidence: `/Users/jack/.mdpro-redesign/device/D326-evidence/`

The pinned build produced `mdpro.app`. `pnpm tauri build --bundles app` ended with the expected missing updater private-key error (exit 1), after reporting the finished app bundle. Its full output is `D326-evidence/build.log`.

| Step | Verdict | Proof |
|---|---|---|
| 1. Launch identity check | PASS | Exact command below; exit 0; four checks PASS. `app.ready` and preceding `window.open` both carry PID 33178; release ID matches. |
| 2. Capture and compare | FAIL | `cmp -s step1.stdout d326-identity.txt` exited 1. `step1.stdout` is 515 bytes because `pnpm device:identity` prints its package/command banner before the checks; report is 60 bytes. Four checks and command exit otherwise satisfy the card. |
| 3. Launch second main stand-in | NOT EXERCISED (coexistence prevented) | `open -n /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app` exited 0 with empty stdout. Bounded `app.ready` tail exited 124 after 20 seconds and produced no line. `ps` found only PID 33178, the verified main. No second PID/executable can be reported. |
| 4. Check-only with two mains | NOT EXERCISED | Stopped at step 3: no second live main process. Command not run; stdout, exit status and new report bytes do not exist. |
| 5. Prelaunch refusal with installed main | NOT EXERCISED | Stopped at step 3: no second live main to keep running. Command not run; stdout, exit status and new report bytes do not exist. |
| 6. Restore and release | PASS | Verified app quit via its normal UI (`⌘Q`); `pgrep -fl '/mdpro.app/Contents/MacOS/tauri-app'` then printed nothing. Config restored; `cmp config.before.json ~/.mdpro/config.json` exited 0. `gui-lock.sh release D326-AC5` printed `RELEASED D326-AC5`; final status `FREE`. |

## Exact commands and outputs

Step 1 (run from the pinned worktree with the brief's PATH):

```sh
pnpm device:identity --bundle /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app --file /Users/jack/.mdpro-redesign/device/D326-evidence/d37-small-doc.md --expected-release-id 0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a --out /Users/jack/.mdpro-redesign/device/D326-evidence/d326-identity.txt
```

Exit status: `0`. Exact stdout bytes (515 bytes; blank lines retained):

```text

> tauri-app@0.3.5 device:identity /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797
> node scripts/device/identity.mjs --bundle /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app --file /Users/jack/.mdpro-redesign/device/D326-evidence/d37-small-doc.md --expected-release-id 0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a --out /Users/jack/.mdpro-redesign/device/D326-evidence/d326-identity.txt

[PASS] bundle
[PASS] process
[PASS] releaseId
[PASS] window
```

Exact current `d326-identity.txt` bytes (60 bytes, `5b 50 41 53 53 5d` begins each line, `0a` ends each line):

```text
[PASS] bundle
[PASS] process
[PASS] releaseId
[PASS] window
```

Step 2 command: `cmp -s D326-evidence/step1.stdout D326-evidence/d326-identity.txt`; stdout empty, exit status `1`.

Step 3 command: `open -n /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app`; stdout empty, exit status `0`. The watcher command `timeout 20 sh -c 'tail -n0 -F "$HOME/.mdpro/mdpro.log" | grep -m1 '"event":"app.ready"''` produced empty stdout and exited `124`. Process proof:

```text
$ ps -p 33178 -o pid,comm
  PID COMM
33178 /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app
$ lsof -a -nP -p33178 -d txt -Fn | head -n 3
p33178
ftxt
n/Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app
```

There was no second PID to pass to `ps` or `lsof`. Steps 4–5 had no command invocation or report replacement, so the report file still contains step 1's PASS run.

## Decisive log lines

```json
{"ts":"2026-10-27T23:38:16.030+08:00","level":"info","event":"window.open","status":"success","actionId":null,"context":{"pid":33178,"windowId":"main","windowLabel":"main"},"durationMs":null,"error":null}
{"ts":"2026-10-27T23:38:16.030+08:00","level":"info","event":"app.ready","status":"success","actionId":null,"context":{"appVersion":"0.3.5","buildId":"unknown","pid":33178,"platform":"macos","releaseId":"0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a","startupTimeMs":420},"durationMs":420,"error":null}
```

## Deviations and workflow

- `/Applications/mdpro.app` was absent, so step 3 used the brief's second-main copy at `D326-evidence/second/mdpro.app`. The delegator must rule on this substitution.
- The brief names `gui-lock.sh take`, but the live script accepts `acquire`; used `acquire D326-AC5 45 'D326 AC-5 identity card' gpt-auditor` and held it through cleanup.
- TDD Guardian config validated with no errors or warnings. This is a pinned-build device verification with no implementation work item or code edit. The card supplied the behavioral check; the implementation/coverage/mutation/review stages of the requested workflow were not run. The card's first full acceptance gate failed at step 2, and its two-process path was blocked at step 3.
- No screenshot was taken because the card did not call for a visual assertion, and no failed visual step needed one. Computer Use access was requested once to quit through the UI.
- The `verify-8462797` worktree remains in place as instructed. Its Git status is clean.

## Run 2 report (verbatim)

# D326 AC-5 device identity rerun — 2026-10-27

**Overall: PASS.** Card steps 1–6 passed with the two approved deviations below. No application code changed.

- Build SHA: `84627974b7f16fb021eacae8b194069593a9950a`
- `EXPECTED_RELEASE_ID`: `0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a`
- Card blob: `1990cf86d48436750440f6a43cf4a2ec14fd2448`
- `VERIFY_BUNDLE`: `/Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app`
- Fixture copy: `/Users/jack/.mdpro-redesign/device/D326-evidence/d37-small-doc.md`
- Evidence directory: `/Users/jack/.mdpro-redesign/device/D326-evidence/r2/`

## Deviations

- **D1:** Used `pnpm -s device:identity` for steps 1, 4, and 5. This suppresses pnpm's banner so stdout can equal the archived report byte for byte.
- **D2:** `/Applications/mdpro.app` was absent. Used `/Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app` as the installed-app stand-in. The exact single-instance socket was `/tmp/com_mdpro_app_si.sock`; moved it to `/tmp/com_mdpro_app_si.sock.d326-held` immediately before launching the second copy, then restored it after the second copy quit. No other `/tmp` file was touched.
- The brief says `gui-lock.sh take`; the live script accepts `acquire`. Used `gui-lock.sh acquire D326-AC5-r2 30 'D326 AC-5 identity rerun' gpt-auditor` (exit 0, `ACQUIRED D326-AC5-r2`) and released the same batch at the end.

## Card result

| Step | Verdict | Proof |
|---|---|---|
| 1. Launch identity check | PASS | Exit 0; four PASS lines; verified main PID 5490. |
| 2. Capture and compare | PASS | `cmp -s step1.stdout d326-identity.txt` exit 0; both files 60 bytes. |
| 3. Launch second main | PASS | `open -n` exit 0; bounded `app.ready` watcher exit 0 and logged PID 5675. `ps` and `lsof -d txt` show two live mains at distinct executable paths. |
| 4. Check only with two mains | PASS | Expected failure: `process` FAIL, `window` SKIPPED, exit 1; `cmp` of stdout and current report exit 0. |
| 5. Prelaunch refusal | PASS | Verified main quit via ⌘Q; only stand-in PID 5675 remained. Repeated step 1 command: `process` FAIL, exit 1, report equality exit 0; before/after process-list `cmp` exit 0, so no new main appeared. |
| 6. Restore | PASS | Stand-in quit via ⌘Q. `pgrep` exit 1 (no main); socket restored; config backup/current `cmp` exit 0; lock release printed `RELEASED D326-AC5-r2`, final status `FREE`. |

## Exact commands, stdout bytes, and exit statuses

Commands below ran from `/Users/jack/Documents/mac-app/mdpro-wt/verify-8462797` where applicable, using `/opt/homebrew/bin/pnpm` version `10.26.1` and the same PATH as run 1. The fenced outputs are the complete stdout bytes; each ends with one LF. A command with empty stdout is stated explicitly.

### Step 1

```sh
pnpm -s device:identity --bundle /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app --file /Users/jack/.mdpro-redesign/device/D326-evidence/d37-small-doc.md --expected-release-id 0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a --out /Users/jack/.mdpro-redesign/device/D326-evidence/d326-identity.txt
```

Exit `0`; stdout (60 bytes, archived at `r2/step1.stdout`):

```text
[PASS] bundle
[PASS] process
[PASS] releaseId
[PASS] window
```

### Step 2

```sh
cmp -s /Users/jack/.mdpro-redesign/device/D326-evidence/r2/step1.stdout /Users/jack/.mdpro-redesign/device/D326-evidence/d326-identity.txt
```

Exit `0`; stdout empty. `wc -c` reported 60 bytes for each file.

### Step 3

```sh
ls -l /tmp/com_mdpro_app*_si.sock
mv /tmp/com_mdpro_app_si.sock /tmp/com_mdpro_app_si.sock.d326-held
open -n /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app
```

`ls` exit `0` and identified `/tmp/com_mdpro_app_si.sock`; `mv` exit `0`, stdout empty; `open -n` exit `0`, stdout empty. The bounded watcher, started before the move and launch, was:

```sh
timeout 20 sh -c 'tail -n0 -F /Users/jack/.mdpro/mdpro.log | grep -m1 '\''"event":"app.ready"'\'''
```

Watcher exit `0`; exact stdout (also `r2/second-app-ready.log`):

```text
{"ts":"2026-10-27T23:44:01.065+08:00","level":"info","event":"app.ready","status":"success","actionId":null,"context":{"appVersion":"0.3.5","buildId":"unknown","pid":5675,"platform":"macos","releaseId":"0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a","startupTimeMs":264},"durationMs":264,"error":null}
```

```sh
ps -p 5490,5675 -o pid,comm
lsof -a -nP -p 5490,5675 -d txt -Fn
```

Both exited `0`. Complete `ps` stdout:

```text
  PID COMM
 5490 /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app
 5675 /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app/Contents/MacOS/tauri-app
```

The decisive first `txt` path for each PID in `r2/step3.lsof` is:

```text
p5490
ftxt
n/Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app
p5675
ftxt
n/Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app/Contents/MacOS/tauri-app
```

### Step 4

```sh
pnpm -s device:identity --bundle /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app --expected-release-id 0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a --check-only --out /Users/jack/.mdpro-redesign/device/D326-evidence/d326-identity.txt
```

Exit `1`; stdout (63 bytes, `r2/step4.stdout`):

```text
[PASS] bundle
[FAIL] process
[FAIL] releaseId
[SKIPPED] window
```

`cmp -s r2/step4.stdout d326-identity.txt` exited `0`, stdout empty. The `releaseId` FAIL is the expected consequence of the process-count failure, before a single process can be attributed.

### Step 5

The verified app was selected by its full bundle path in Computer Use and quit with ⌘Q. It exited; `ps -p 5490,5675 -o pid,comm` then showed only PID 5675.

```sh
pnpm -s device:identity --bundle /Users/jack/Documents/mac-app/mdpro-wt/verify-8462797/src-tauri/target/release/bundle/macos/mdpro.app --file /Users/jack/.mdpro-redesign/device/D326-evidence/d37-small-doc.md --expected-release-id 0.3.5-dev@84627974b7f16fb021eacae8b194069593a9950a --out /Users/jack/.mdpro-redesign/device/D326-evidence/d326-identity.txt
```

Exit `1`; stdout (63 bytes, `r2/step5.stdout`):

```text
[PASS] bundle
[FAIL] process
[FAIL] releaseId
[SKIPPED] window
```

`cmp -s r2/step5.stdout d326-identity.txt` exited `0`, stdout empty. `cmp -s r2/step5.before-processes r2/step5.after-processes` exited `0`, stdout empty. Both process lists contained exactly:

```text
5675 /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app/Contents/MacOS/tauri-app
```

### Step 6

The stand-in app was selected by its full bundle path in Computer Use and quit with ⌘Q. Then:

```sh
pgrep -fl '/mdpro.app/Contents/MacOS/tauri-app'
```

Exit `1`, stdout empty. `/tmp/com_mdpro_app_si.sock` no longer existed after its app quit, so no second socket needed deletion. The restoration commands were:

```sh
mv /tmp/com_mdpro_app_si.sock.d326-held /tmp/com_mdpro_app_si.sock
cp -p /Users/jack/.mdpro-redesign/device/D326-evidence/r2/config.before.json /Users/jack/.mdpro/config.json
cmp -s /Users/jack/.mdpro-redesign/device/D326-evidence/r2/config.before.json /Users/jack/.mdpro/config.json
/Users/jack/Documents/mac-app/mdpro/.agents/skills/mdpro-delegator/scripts/gui-lock.sh release D326-AC5-r2
/Users/jack/Documents/mac-app/mdpro/.agents/skills/mdpro-delegator/scripts/gui-lock.sh status
```

`mv`, `cp`, and `cmp` each exited `0` with empty stdout. Lock release exited `0` with `RELEASED D326-AC5-r2\n`; status exited `0` with `FREE\n`. Final `pgrep` exit `1` confirmed no mdpro main remains. The config backup SHA-256 was `26a701686573640e81d2d642e6904e03b742c402d183dfbb5d1bb741592dc7d7`.

## TDD Guardian and worktree

The requested TDD Guardian config loader returned `errors: []`, `warnings: []`, `enabled: true`, and `requireMutation: false`. This was a pinned-build device verification without an implementation work item or code diff, so plan, RED/GREEN, coverage, mutation, review, and commit-gate stages did not apply. The device card's behavioral assertions above were run instead. The verify worktree remained clean (`git status -sb`: `## HEAD (no branch)`). No commit, push, or PR was made.

## Run 3b report (verbatim)

# D326 AC-5 device identity run 3 — final SHA

**Overall: FAIL.** The first card step 1 returned an incorrect `process` verdict. After quitting that app, a clean repeat passed; steps 2–6 then passed. The first failure remains a card failure. No application code changed.

- SHA: `1d0b66a78bfbf6a8ee1d55360360e59a23f665c4`; clean detached worktree: `/Users/jack/Documents/mac-app/mdpro-wt/verify-1d0b66a`.
- `EXPECTED_RELEASE_ID`: `0.3.5-dev@1d0b66a78bfbf6a8ee1d55360360e59a23f665c4`.
- Card blob: `1990cf86d48436750440f6a43cf4a2ec14fd2448`, unchanged at the SHA.
- `VERIFY_BUNDLE`: `/Users/jack/Documents/mac-app/mdpro-wt/verify-1d0b66a/src-tauri/target/release/bundle/macos/mdpro.app`.
- Fixture copy: `/Users/jack/.mdpro-redesign/device/D326-evidence/d37-small-doc.md`.
- Evidence: `/Users/jack/.mdpro-redesign/device/D326-evidence/r3/`.

## Deviations and build

- **D1:** Used `pnpm -s device:identity` so stdout can equal the report byte for byte.
- **D2:** Kept `/Applications/mdpro.app` closed. Used a fresh copy at `D326-evidence/second/mdpro.app` as the installed-app stand-in. The exact socket was `/tmp/com_mdpro_app_si.sock`; moved it to `/tmp/com_mdpro_app_si.sock.d326-held` immediately before launching the second copy, then restored it after that copy quit. No other `/tmp` file was touched.
- **D3 (copy preparation):** Kept the prior `second/mdpro.app` as `second/mdpro.app.previous-r2` and moved a fresh `ditto` copy into `second/mdpro.app`. The backup remains.
- The live `gui-lock.sh` accepts `acquire`, not the brief's `take`. `acquire D326-AC5-r3 30 'D326 AC-5 final-SHA identity rerun' gpt-auditor` exited 0, stdout `ACQUIRED D326-AC5-r3\n`; release exited 0, stdout `RELEASED D326-AC5-r3\n`; final status exited 0, stdout `FREE\n`.
- PATH was exactly `$HOME/.local/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`. `command -v cargo rustfmt node pnpm` resolved all four; Node was `v22.22.3`, pnpm `10.26.1`.
- `pnpm install --frozen-lockfile --offline` exited 0. The build produced the app bundle, then exited 1 at the expected updater-signing error (`A public key has been found, but no private key`). Rust also warned that `rust-objcopy` could not load `libLLVM.dylib` while stripping debug info; the produced app launched. Full merged build output is `r3/build.log` (24,458 bytes; SHA-256 `7b7cd7449d1a8d55326eb4692556a52ed16c039142b99a16dc210a14e4d417b8`).

## Card result

| Step | Verdict | Proof |
|---|---|---|
| 1. Launch identity check | **FAIL initially; PASS on clean retry** | First command exited 1: `process` FAIL, `releaseId` FAIL, `window` SKIPPED. Its app did start: PID 24864 logged `app.ready` with the expected release ID. A diagnostic check-only passed all four. After UI quit and a clean restart, step 1 exited 0 with four PASS lines; verified PID 45739. The initial cause was not established. |
| 2. Capture and compare | PASS on retry | `cmp -s r3/step1-retry.stdout d326-identity.txt` exited 0; each file was 60 bytes. |
| 3. Second main | PASS on retry | Socket move and `open -n` exited 0. Bounded `app.ready` watcher exited 0 for PID 51902. `ps` and `lsof -d txt` showed both PIDs and distinct executable paths. |
| 4. Two-main check-only | PASS on retry | Exit 1; `process` FAIL, `window` SKIPPED; stdout/report `cmp` exit 0. |
| 5. Prelaunch refusal | PASS on retry | Verified app quit via UI; only PID 51902 remained. Repeated launch exited 1 with `process` FAIL; stdout/report `cmp` exit 0; before/after process-list `cmp` exit 0. |
| 6. Restore | PASS | Second app quit via UI. No main remained (`pgrep` exit 1); second socket vanished, held socket restored. Config backup/current `cmp` exit 0; GUI lock released and `FREE`. |

## Exact commands, stdout bytes, and exit statuses

All `pnpm` commands ran from the verify worktree with the PATH above. In command notation below, `$VERIFY_BUNDLE`, `$FIXTURE`, `$EXPECTED_RELEASE_ID`, and `$SCRATCHPAD` expand to the absolute paths and value listed at the start of this report (`$SCRATCHPAD` is `/Users/jack/.mdpro-redesign/device/D326-evidence`). `r3/` expands to `/Users/jack/.mdpro-redesign/device/D326-evidence/r3/`; `second/` expands to `/Users/jack/.mdpro-redesign/device/D326-evidence/second/`. Each named `r3/*.stdout` file contains the exact stdout bytes; each displayed four-line result ends in one LF. Commands redirecting output had empty terminal stdout, with the complete stream in the named file.

1. `git -C /Users/jack/Documents/mac-app/mdpro fetch origin` — exit 0, stdout empty. Reused the existing verify worktree; `git rev-parse HEAD` printed `1d0b66a78bfbf6a8ee1d55360360e59a23f665c4\n`, and `git rev-parse HEAD:docs/test/cards/D326-identity-check.md` printed `1990cf86d48436750440f6a43cf4a2ec14fd2448\n` (both exit 0).
2. `cp -p /Users/jack/.mdpro/config.json r3/config.before.json`, the sidecar binary copy, and `cmp -s` — each exit 0, stdout empty. `pnpm install --frozen-lockfile --offline` — exit 0; stdout ended `Done in 319ms using pnpm v10.26.1\n`.
3. `scripts/heavy-lock.sh sh -c '( set -e; release_id="$(node scripts/release/devReleaseId.mjs)"; printf "EXPECTED_RELEASE_ID=%s\n" "$release_id"; MDPRO_RELEASE_ID="$release_id" pnpm tauri build --bundles app )' > r3/build.log 2>&1` — exit 1; terminal stdout empty. `r3/build.log` contains the exact merged stream, including the expected release ID, produced app path, and final signing error.
4. `ditto VERIFY_BUNDLE second/mdpro.app.new`, `mv second/mdpro.app second/mdpro.app.previous-r2`, `mv second/mdpro.app.new second/mdpro.app` — each exit 0, stdout empty. These abbreviations stand for the absolute bundle and evidence paths above.
5. Initial `pnpm -s device:identity --bundle "$VERIFY_BUNDLE" --file "$FIXTURE" --expected-release-id "$EXPECTED_RELEASE_ID" --out "$SCRATCHPAD/d326-identity.txt"` — exit **1**; exact stdout, `r3/step1.stdout` (63 bytes):

   ```text
   [PASS] bundle
   [FAIL] process
   [FAIL] releaseId
   [SKIPPED] window
   ```

6. Diagnostic `pnpm -s device:identity --bundle "$VERIFY_BUNDLE" --expected-release-id "$EXPECTED_RELEASE_ID" --check-only --out r3/diagnostic-identity.txt` — exit 0; stdout `[PASS] bundle\n[PASS] process\n[PASS] releaseId\n[PASS] window\n`. The initial app was selected by the verify bundle path in Computer Use and quit with `super+q`; `pgrep -fl '/mdpro.app/Contents/MacOS/tauri-app'` exited 1 with empty stdout.
7. Clean repeat of command 5 — exit **0**; exact stdout, `r3/step1-retry.stdout` (60 bytes):

   ```text
   [PASS] bundle
   [PASS] process
   [PASS] releaseId
   [PASS] window
   ```

8. `cmp -s r3/step1-retry.stdout "$SCRATCHPAD/d326-identity.txt"` — exit 0, stdout empty. `wc -c` printed 60 bytes for each file.
9. `ls -l /tmp/com_mdpro_app*_si.sock` — exit 0 and named `/tmp/com_mdpro_app_si.sock`. `mv /tmp/com_mdpro_app_si.sock /tmp/com_mdpro_app_si.sock.d326-held` and `open -n second/mdpro.app` — both exit 0, stdout empty. The watcher `timeout 20 sh -c 'tail -n0 -F /Users/jack/.mdpro/mdpro.log | grep -m1 '"event":"app.ready"''` — exit 0; exact stdout in `r3/second-app-ready.log` (308 bytes):

   ```text
   {"ts":"2026-10-28T00:36:24.323+08:00","level":"info","event":"app.ready","status":"success","actionId":null,"context":{"appVersion":"0.3.5","buildId":"unknown","pid":51902,"platform":"macos","releaseId":"0.3.5-dev@1d0b66a78bfbf6a8ee1d55360360e59a23f665c4","startupTimeMs":214},"durationMs":214,"error":null}
   ```

10. `ps -p 45739,51902 -o pid,comm` — exit 0; exact stdout in `r3/step3.ps`:

    ```text
      PID COMM
    45739 /Users/jack/Documents/mac-app/mdpro-wt/verify-1d0b66a/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app
    51902 /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app/Contents/MacOS/tauri-app
    ```

    `lsof -a -nP -p 45739,51902 -d txt -Fn` — exit 0; exact stdout in `r3/step3.lsof`. The first `txt` path for each PID matches its `ps` executable path above.
11. `pnpm -s device:identity --bundle "$VERIFY_BUNDLE" --expected-release-id "$EXPECTED_RELEASE_ID" --check-only --out "$SCRATCHPAD/d326-identity.txt"` — exit **1**; `r3/step4.stdout` (63 bytes):

    ```text
    [PASS] bundle
    [FAIL] process
    [FAIL] releaseId
    [SKIPPED] window
    ```

    `cmp -s r3/step4.stdout "$SCRATCHPAD/d326-identity.txt"` — exit 0, stdout empty.
12. After selecting and quitting the verified app by its bundle path in Computer Use with `super+q`, `ps -p 45739,51902 -o pid,comm` — exit 0 and showed only PID 51902. Repeated command 5 — exit **1**; `r3/step5.stdout` (63 bytes) contains the same four lines as step 4. `cmp -s r3/step5.stdout "$SCRATCHPAD/d326-identity.txt"` and `cmp -s r3/step5.before-processes r3/step5.after-processes` — each exit 0, stdout empty. Both process-list files contain only `51902 /Users/jack/.mdpro-redesign/device/D326-evidence/second/mdpro.app/Contents/MacOS/tauri-app\n`.
13. After selecting and quitting the second app by its bundle path in Computer Use with `super+q`, `pgrep -fl '/mdpro.app/Contents/MacOS/tauri-app'` — exit 1, stdout empty. `/tmp/com_mdpro_app_si.sock` no longer existed, so no second socket needed deletion. `mv /tmp/com_mdpro_app_si.sock.d326-held /tmp/com_mdpro_app_si.sock`, `cp -p r3/config.before.json /Users/jack/.mdpro/config.json`, and `cmp -s r3/config.before.json /Users/jack/.mdpro/config.json` — each exit 0, stdout empty. Config backup SHA-256 was `26a701686573640e81d2d642e6904e03b742c402d183dfbb5d1bb741592dc7d7`. Lock release/status outputs are above.

## TDD Guardian and handoff

The requested TDD Guardian config loader returned `errors: []`, `warnings: []`, `enabled: true`, `requireMutation: false`. This was a pinned-SHA device verification with no implementation work item or code diff. Plan, RED/GREEN receipts, coverage, mutation, code review, and commit-gate refresh did not apply; the device card supplied the behavioral gate. The card's first step failed, so the overall verdict is FAIL despite the passing clean repeat. No commit, push, or PR was made. The verify worktree remains clean.

