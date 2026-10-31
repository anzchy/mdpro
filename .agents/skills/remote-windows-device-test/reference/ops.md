# Ops reference

Kept in sync with `scripts/windows/ui.ps1`, its `native-*.ps1` helpers, `ui-run.ps1`,
`native-reconcile.ps1` and `scripts/windows/cdp.mjs`. When one changes,
this file changes in the same commit.

## Desktop-session driver: `scripts/mac/ui.sh '<json steps>'`

Each step logs one line. **An error stops the run**: it logs `ERROR <op>: …` and then
`ABORTED at step N`, no later step runs, and `ui.sh` exits 1 after printing the log. So
`ui.sh '[…click…, …type…]' && cdp.sh eval …` never types or evaluates after a failed click. A
read-only step can opt out with `"onError":"continue"`, e.g. `{"op":"windows","onError":"continue"}`:
its error is logged and the run goes on. An **identity failure always aborts**, even with
`"onError":"continue"`. A window-targeted native step may specify `"window":"<Tauri label>"`.
`ui.sh` first reads fresh labels, CDP page IDs and physical outer rectangles. Inside the single
native run, `ui.ps1` asks that exact page to place a fresh nonce marker in its Tauri window title;
the marker is a cross-process challenge, **not** an inferred label. It binds only the HWND with
that exact title and rectangle, then rechecks HWND, process, title, rectangle and foreground after
the resolver and before input. The driver restores the original title at the end of the run only
if the nonce marker is still present. A lost `ui-run` SSH result is never replayed: the title
change and input may already have happened, so inspect the title and effects first. Equal rectangles (including two identical maximized
windows), a moved/closed window, or an uncertain read aborts without later input. With multiple
mdpro windows, an unlabeled window-targeted step fails even when one is foreground. A sole-window
unlabeled call still works. **Exact rectangles are required** until a cleared Windows run measures
Tauri versus Win32 physical bounds at 270% and on a secondary monitor. Coordinates are **physical screen pixels**, the same space
as a `shot` with `"screen":true`.
For `clickat`, `menuat` and `menuclick`, a mouse down requires the cursor still at the requested
coordinate after the wait and resolver, with `WindowFromPoint` rooted in the bound HWND. A menu
item must instead hit a `#32768` popup whose thread and active menu owner identify that HWND.
An occluding window, another control under a moved cursor, an unavailable hit observation or a
wrong popup aborts before down. If identity changes after down, cleanup moves to a verified
point on the bound HWND before releasing. If it cannot prove a safe point, it reports
`IDENTITY_MOUSE_RELEASE_FAILED`; the button state then needs manual inspection before another call.
Cleanup revalidates the native process, bounds, visibility and title challenge before relocation
and again immediately before release, so a reused numeric HWND is not enough.

| Op | Arguments | What it does |
|---|---|---|
| `windows` | — | Lists mdpro's visible top-level windows: title, hwnd, rect. |
| `focus` | `window?` | Requests foreground for the selected mdpro window without sending a key. If it is already foreground, no activation is needed. A refused or lost activation aborts with `IDENTITY_FOCUS_REFUSED`. |
| `max` / `restore` | — | Maximizes or restores the mdpro window. **Run `max` after every start** (see pitfalls). |
| `menuclick` | `path: ["File","Save"]` | **Real mouse clicks** on the native menu: opens each level and clicks the item, all in this run. Item names come from `menus`. |
| `menuat` | `bar: [x,y], item: [x,y]` | Same idea by coordinates. Use it when `menuclick` can't read the menu: after a second window has closed, `GetMenu` returns an invalid handle (see `menuinfo`). |
| `menus` | — | Dumps the native menu tree: names, accelerator text, `[disabled]`, `[checked]`. |
| `menuinfo` | — | hwnd, HMENU and item count. A count of `-1` means the handle is invalid, so use `menuat`. |
| `clickat` | `x, y, right?` | One real mouse click at screen coordinates. |
| `chord` | `keys: ["ctrl+s","esc"], nofocus?, window?` | Logical real key events (`keybd_event`, scan code zero). Key names: `ctrl shift alt win enter esc tab back del up down left right home end space pageup pagedown f1–f12 backtick slash minus equals period comma semicolon quote lbracket rbracket backslash`, letters and digits. Anything else is refused. Use `nofocus:true` after a `clickat` into the editor, so `focus` doesn't disturb keyboard focus. Pressed keys are released if an identity check fails mid-chord. This op cannot prove physical `event.code` or AltGraph. |
| `layout` | `window?` | Reads the HKL, as 16 hex digits, of the **focused input child's thread** inside the selected window (the WebView2 input child, not the top-level HWND's own thread), and logs `layout hwnd= input= thread= hkl=`. Capture it immediately before a physical chord; a layout change invalidates the recorded value. |
| `physicalChord` | `window?, keys: ["AltRight","KeyQ"], hkl: "0000000004070407", nofocus?` | Sends one ordered physical chord through `SendInput` scan codes. `keys` uses physical DOM-style names from the allowlist, including `KeyQ`, `KeyE`, `KeyK`, `BracketLeft`, `BracketRight`, `Digit7`, `ControlLeft`, `ShiftLeft`, `AltLeft`, `AltRight`. `hkl` must equal the `layout` output for the same window and input context. Right Alt is extended for AltGr. Events are released in reverse order; a short injection aborts, attempts reverse cleanup of every pressed key even if one release fails, and stops following steps. This is the route for real `event.code`/AltGraph proof. |
| `setLayout` | `window?, klid: "00000407"` | Activates an **installed** keyboard layout on the verified input context: posts `WM_INPUTLANGCHANGEREQUEST` to the focused input child and reads the result back on that child's thread. `klid` is exactly 8 hex digits. The context's first prior HKL is restored at the end of the run (see § Keyboard layout). |
| `filedialog` | `window?` or `receipt`, and `path` or `cancel:true` | Drives the common Open / 另存为 dialog **owned by the verified mdpro window**. The dialog is found by its owner chain, the owner's process lifetime and executable, class `#32770` and exactly one filename `Edit`, never by title or foreground. It must already be foreground; the driver never steals focus for it. It sets the `Edit` by `WM_SETTEXT` and presses Enter (or Esc), then waits for it to close. Use `receipt` when the dialog was opened in an earlier invocation (§ File dialogs and receipts). |
| `dialogReceipt` | `window?` | Issues a one-use modal-owner receipt for the bound window and logs `receipt <64 hex>`. Pass that token as `receipt` to a later `filedialog`. |
| `shot` | `out, screen?` | PNG of the mdpro window, or of the whole screen with `screen:true`. A whole-screen shot shows the user's private desktop: never commit it. |
| `open` | `path` | Starts `tauri-app.exe <path>`, which routes into the running app through **single-instance**. Paths opened this way carry `\\?\` on 0.3.1; File → Open does not. |
| `run` | `exe, args` | Starts a process in the desktop session inside an owned, nested kernel job, waits for it within the phase budget, and kills its descendants when the phase ends. Explorer and COM brokers escape any job: what they start is not owned and is not cleaned up. |
| `visible` | — | `IsWindowVisible` for each listed window. |
| `showall` | — | Shows every hidden `mdpro` top-level window, found by `EnumWindows` (`MainWindowHandle` is 0 while hidden). |
| `tree` | `depth` | The UIA tree of the foreground window. The WebView2 subtree is skipped, because it times out. |
| `wait` | `ms` | Sleeps. |
| ~~`keys`~~ ~~`menu`~~ ~~`click`~~ ~~`settext`~~ | — | **Refused.** SendKeys never reaches mdpro from a task; posted `WM_COMMAND` / `WM_MENUCOMMAND` are ignored; UIA Invoke and ValuePattern don't work on WebView content. |

**The one rule:** open a menu and click its item **in one run**. Starting the next run's
scheduled task dismisses a menu the previous run left open, so the item click hits nothing.
On 2026-10-12 this split produced a false "Hide does nothing" verdict.

Example with two distinct, restored windows: `ui.sh '[{"op":"menuclick","window":"main","path":["File","Save"]}]'`.
For German physical input, first read `ui.sh '[{"op":"layout","window":"A"}]'`, then
use that exact HKL in a separately checked `physicalChord` call, such as
`ui.sh '[{"op":"physicalChord","window":"A","keys":["AltRight","KeyQ"],"hkl":"0000000004070407","nofocus":true}]'`.
The HKL shown is an example; use the observed value. A `clickat` in the target editor should
establish focus first. Keep the old logical `chord` for checks that do not require physical code.
Do not infer the Tauri label from a native title. A CDP identity read failure stops before
`ui-run.ps1` is sent. The read is retriable; the native mutation is never retried after an
uncertain SSH outcome. The binding is fresh per `ui.sh` invocation; moving or maximizing a
window within one invocation makes a subsequent step fail closed. Re-run from a newly read
identity only after checking the first step's effect.

## Page client: `scripts/mac/cdp.sh`

```bash
cdp.sh eval '<js>'        # up to ~5 KB; uses `return`; runs inside an async function
cdp.sh evalf file.js      # any size: pushes the file, then node cdp.mjs evalfile
cdp.sh shot name          # page viewport PNG -> $MDPRO_WIN_OUT/name.png
cdp.sh --window <label> eval '<js>'   # in the mdpro window with that Tauri label (any of the above)
```

**With several mdpro windows open, name the window.** `cdp.mjs` asks every page for its Tauri
label (`__TAURI_INTERNALS__.metadata.currentWindow.label`; confirmed on WebView2 only once demo
W6 runs), evaluates in the one that matches, and asks that page again on the eval's own
connection just before the eval. No label with several pages exits **6** `WINDOW_AMBIGUOUS`; a
label no page has, or one that changed before the eval, exits **5** (`WINDOW_NOT_FOUND`,
`WINDOW_MISMATCH`); two pages with the label exit 6. Each prints the candidates and evaluates
nothing. One page and no label behaves as before.

An expression that throws prints `{"exception": "…"}` **and exits 1**, so `cdp.sh eval … && next`
stops there.
`"CDP_PORT_CLOSED: …"` means mdpro is running without the debugging port. After confirming
that nothing in mdpro is unsaved and clearing the restart, run `mdpro.sh debug --yes`.
`"CDP_TIMEOUT"` means no answer within 25 s; see the triage in `pitfalls.md`.
`cdp.mjs` closes every socket it opened before it exits, so a multi-window probe no longer aborts
Node on Windows after printing the answer (D248).

### `__a` helpers, inside an expression (trusted CDP input, page only)

| Helper | Notes |
|---|---|
| `__a.q(sel)` | `document.querySelector`. |
| `__a.sleep(ms)` | |
| `__a.click(selOrEl, {button, count, dx, dy, mods})` | Clicks the element's centre (or `dx/dy` inside it); `mods` takes `["ctrl","shift","alt","meta"]`. |
| `__a.clickXY(x, y, {button, count})` | Viewport CSS px. |
| `__a.text(s)` | `Input.insertText`. **The only safe way to type**: the PC's IME (微软拼音) composes real letter keys. |
| `__a.key(key, mods)` | Named keys (`Enter Escape Tab Backspace Delete Arrow* Home End PageUp PageDown F1–F12`), letters, digits, and US punctuation `` ` - = [ ] \ ; ' , . / `` with the right `code` / keyCode (Shift gives the shifted key). Other keys are refused. |
| `__a.toastsOn()` / `__a.toasts()` | Starts collecting the text of nodes added to the DOM / returns it and clears the buffer. Call `toastsOn` **before** the action: a toast lasts about 3 s. |
| `__a.cspProbe(url)` | Loads `url` as an `<img>` and resolves `{loaded, width, violations:[{directive, blocked}]}`. This found the 0.3.1 image root cause. |

**Limits:** CDP input does not move Windows keyboard focus into the WebView and never triggers
native menu accelerators. For real-key tests, do `clickat` into the editor, then
`chord … nofocus:true`.

## Coordinates

- A `shot` with `"screen":true` and every `clickat` / `menuat` use **physical** pixels.
  Downscale a shot to read it, then multiply back (for example `sips -Z 1300`: factor = 3040/1300).
- Page elements are in **CSS** px. Inside the WebView, physical = client origin + css × `devicePixelRatio`
  (2.7 at 270 %). On a maximized window the menu bar sits at y ≈ 47 and the window rect starts at
  -11,-11. Prefer `cdp.sh` clicks for page elements, and convert only when you need real input.

## Exit codes (every Mac-side wrapper)

| Code | Meaning | What to do |
|---|---|---|
| 0 | Done. | — |
| 1 | It ran and failed: an eval threw, the DevTools protocol answered with an error instead of a result (`CDP_ERROR`, e.g. "Execution context was destroyed"; the eval may or may not have run), a `ui.sh` step failed (`ABORTED at step N`), a scheduled task left no readable result (`runi: … has no result`), a restart step failed, a pulled file did not decode or write (`pull failed`), or the output was empty (`NO OUTPUT`). | Read the printed log or exception; after `CDP_ERROR`, check the page's state before re-running. |
| 2 | Refused before running: usage, a validator, a missing `--yes`, no page. | Fix the call. |
| 3 | **Unknown outcome**: the connection dropped after the command was sent (`UNKNOWN OUTCOME`), or `cdp.mjs` timed out (`CDP_TIMEOUT`). The command may or may not have run. | Check the state on the PC before anything else (pitfalls 21). |
| 4 | The DevTools port is closed. | After confirming nothing in mdpro is unsaved and clearing the restart, run `mdpro.sh debug --yes`. |
| 5 | `cdp.sh --window`: no page has the label, or the page's label changed before the eval. Nothing was evaluated. | Pick a label from the printed candidates. |
| 6 | `cdp.sh`: several mdpro windows and no `--window`, or several with that label. Nothing was evaluated. | Pass `--window <label>`. |
| 7 | `log.sh raw` / `since`: the mark no longer fits the log. It is `truncated` (the file is smaller than the mark), `replaced` (another creation time or first line), a v1 line-count mark, or the bytes returned don't match the size. Nothing is written. | `log.sh mark` again and repeat the action. |
| 124 | `ui.sh`: no log came back before the timeout. | The steps may have partly run; check, then re-run. |
| 255 | ssh never got through, even after the one retry a read gets. | `ssh win-desktop hostname`. |

A read never returns 0 with an empty answer: a failed read keeps ssh's status.

`ui.sh` identity refusal uses **2** for an invalid caller step or malformed/ambiguous CDP
record before native dispatch, and **1** with `ERROR <op>: IDENTITY_FAILURE: …` plus `ABORTED`
when the native observation is missing, ambiguous or stale. `cdp.mjs identity-native` uses **1**
(`IDENTITY_READ_FAILED` or `IDENTITY_INVALID`) for a failed page/bounds read and **6**
(`IDENTITY_DUPLICATE_LABEL`) for duplicate labels. The native title challenge also refuses
`IDENTITY_PAGE_REPLACED`, `IDENTITY_STALE_BEFORE_BIND`, `IDENTITY_TITLE_BIND_FAILED`,
`IDENTITY_NATIVE_CHALLENGE_CHANGED`, or `IDENTITY_TITLE_RESTORE_FAILED`. A failed restore is
reported even if an earlier input completed; inspect the title before another labelled run.
Neither failure authorizes later input.
`IDENTITY_FOCUS_REFUSED` means `SetForegroundWindow` failed or the selected HWND did not
remain foreground through the settling wait. The run aborts, including with
`onError:"continue"`; no Alt tap is sent to the previous foreground window. Windows may
refuse activation, so inspect foreground state before choosing a next action.
Native mouse ownership failures exit **1** with `ABORTED`: `IDENTITY_CURSOR_READ_FAILED`
or `IDENTITY_CURSOR_MOVED` means the pointer could not be confirmed at the requested pixel;
`IDENTITY_POINT_OUTSIDE` means the hit HWND or popup owner was not the bound target.
`IDENTITY_MOUSE_RELEASE_FAILED` means a held button could not be safely released over the bound
window. Stop and inspect pointer/button state and both documents before any further input.
`physicalChord`/`layout` abort with **1** and `ABORTED` for missing or changed target HKL
(`PHYSICAL_HKL_REQUIRED`, `PHYSICAL_HKL_MISMATCH`), an unknown physical name
(`PHYSICAL_KEY_UNKNOWN`), wrong foreground (`PHYSICAL_FOCUS_MISMATCH`), or a short
`SendInput` count (`PHYSICAL_SEND_SHORT`). A failed modifier cleanup is
`PHYSICAL_RELEASE_FAILED`; reconcile keyboard state before further input. A transport exit
**3**, **70** or **124** is still an uncertain outcome and is never replayed automatically.

## Native transaction: budgets, outcome, lock and reconcile

One `ui.sh` call is one native transaction with one random `runId`. The budgets come from the
environment of the Mac caller, are checked by `ui-transaction.py` and checked again on Windows.
A value that is out of range, out of order or not a plain integer is refused before any lock,
task or input with `UI_BUDGET_INVALID` (exit **2**).

| Variable | Default | Range | Bounds |
|---|---|---|---|
| `MDPRO_UI_PHASE_MS` | 5000 | 10–5000 | one phase (a resolver, a wait, a helper) |
| `MDPRO_UI_TRANSACTION_MS` | 30000 | 50–85000 | the whole native run, cleanup included: Windows ends the run by this deadline |
| `MDPRO_UI_OUTER_MS` | 90000 | 100–90000 | the Mac's wait for the dispatched run's answer, from the call's start; sent as `-TimeoutSec`, which also caps the run on Windows' own clock. Exit **124** (`native-transport`, outcome unknown) only when it expires with no answer |
| `MDPRO_UI_CLEANUP_MS` | 5000 | 10–5000 | the reserve kept for cleanup |
| `MDPRO_UI_POLL_MS` | 25 | 1–1000 | the poll interval |

Ordering: phase < transaction < outer, cleanup < transaction, and phase + cleanup ≤ transaction.
The gap between transaction and outer is the slack in which a run that used its whole deadline
still returns its `OUTCOME` and latch; keep it to seconds, not milliseconds (the defaults leave 60 s).

**Outcome.** Each run ends with one `OUTCOME {…}` line, also committed as `runs/<runId>/result.json`:
`runId`, `status` (`completed` | `failed`), `phase`, `step`, `op`, `elapsedMs`, `completedSteps`,
`inputOutcome` (`none` | `partial` | `unknown`), `heldInput` (`released` | `uncertain`) and `cleanup`
(`complete` | `failed` | `not-started`). A task exit of 0 is not proof: only a committed
`completed` result is. A stalled phase fails with `NATIVE_PHASE_TIMEOUT phase=<name>`, an
overrun with `NATIVE_TRANSACTION_TIMEOUT phase=<name>`; every Windows-side failure, these
included, exits **1**, and **124** is kept for the Mac's outer wait. Cleanup ends every
process the run owns, by kernel job and by birth time plus executable; one still alive at the
cleanup deadline is `NATIVE_OWNED_PROCESSES_REMAIN` (or `NATIVE_CONTROL_PROCESSES_REMAIN` for the
supervisor's own helpers).

**Session lock and latch.** One native run at a time: a second gets `NATIVE_SESSION_BUSY`. A run
whose cleanup failed, whose held input is uncertain, or whose worker left no result writes
`native-session-blocked.json`; every later run refuses with `NATIVE_RECONCILIATION_REQUIRED`
until the run is reconciled. The evidence stays in `runs/<runId>/`.

**Reconcile** runs on the PC (there is no Mac wrapper):
`native-reconcile.ps1 -RunId <runId> [-InputReleasedConfirmed]`. It never replays and never
deletes: after its checks it writes `runs/<runId>/reconcile-checks.json` and moves the latch to
`runs/<runId>/reconciled.json`. It refuses, exit **1** unless noted, with:

| Code | Meaning |
|---|---|
| `NATIVE_RECONCILE_INVALID` (**2**) | Malformed run id or budget. |
| `NATIVE_RECONCILE_NOT_LATCHED` | No latch to clear. |
| `NATIVE_RECONCILE_RUN_MISMATCH` | The latch names another run. |
| `NATIVE_RECONCILE_TASK_PRESENT` | The run's scheduled task still exists, or its absence could not be proved. Only a definite not-found counts as absent. |
| `NATIVE_RECONCILE_MANIFEST_MISSING` / `_INVALID` | The run's owned-process manifest is gone or unreadable. |
| `NATIVE_RECONCILE_OWNED_ALIVE pid=` | A process the run owned is still alive (same birth and executable). |
| `NATIVE_RECONCILE_INPUT_UNCONFIRMED` | Held input was not proved released. Look at the desktop, release any stuck key or button, then pass `-InputReleasedConfirmed`. |

## File dialogs and receipts

`filedialog` acts only on the dialog that the verified owner window owns (`IDENTITY_DIALOG_*`
otherwise): `NOT_FOUND`, `AMBIGUOUS`, `CONTROL_NOT_FOUND`, `CONTROL_AMBIGUOUS` (the filename
control is `Edit` 1001 inside combo 1148, or the legacy 1152), `FOREGROUND` (the dialog is not
foreground), `CHANGED` (dialog or control replaced before the write), `LIFETIME` (a pin was lost),
and `PIN_FAILED`, `UNPIN_FAILED`, `RELEASE_FAILED`. `UI_DIALOG_PATH_INVALID` refuses a bad path,
`UI_DIALOG_NOT_DISMISSED` a dialog that stayed open.

A dialog opened by one invocation (for example a `menuclick` that blocks on the modal) is
driven in the next one by **receipt**:

1. **Issue.** `dialogReceipt` (labelled, through the title challenge, or for the sole window)
   pins a receipt-only property on the owner, restores its title before any modal opens, and
   stores the record on the PC under the SHA-256 of a random token; only the token is printed.
   It expires 30 s after issue. Issuing again for the same owner invalidates the earlier one.
2. **Consume.** `filedialog` with `receipt:<token>` takes the record exactly once, by an atomic
   move, with no CDP. It then trusts only native observations: the stored owner, its process
   lifetime and the pin.

Refusals: `IDENTITY_RECEIPT_INVALID` (unknown, used or malformed), `IDENTITY_RECEIPT_EXPIRED`,
`IDENTITY_RECEIPT_LABEL_MISMATCH` (the step's `window` is not the receipt's), and
`IDENTITY_RECEIPT_PIN_FAILED`.

## Keyboard layout

`layout` and `setLayout` work on the input context: the focused input child of the bound
window, which the first `setLayout` on it pins for the rest of the run. The context's checks are `LAYOUT_INPUT_UNREADABLE`, `_OUTSIDE`
(the focused child is not inside the bound window), `_CHANGED` / `_REPLACED` (focus moved, or the
child was replaced), and `_PIN_FAILED`. Other refusals: `LAYOUT_KLID_INVALID`,
`LAYOUT_UNAVAILABLE` (not an installed layout), `LAYOUT_HKL_UNREADABLE`,
`LAYOUT_REQUEST_REJECTED` (the request could not be posted), and `LAYOUT_NOT_OBSERVED` (the readback is not the requested layout).

**Restore.** Each context keeps one baseline, its HKL before the first `setLayout` in the run. A
revisit never replaces it. At the end of the run, success or abort, every touched context is
restored in reverse order of first activation, and one failure does not stop the others:
`layout-restore input= thread= prior= observed= restored` per context, or
`LAYOUT_RESTORE_FAILED` / `LAYOUT_RESTORE_UNCERTAIN … reason=request-pending` (the request was
never observed, so its later effect is unknown), all failures joined in one error. Whether a
layout change reaches only that window or the whole input thread (R-5) has not been measured
on Windows yet; do not rely on per-window isolation.

## Safety rules in the scripts

- Every one-off scheduled task (`runi.ps1`) is waited for and then **unregistered** (try/finally). `ui-run.ps1` keeps each run's `steps.json`, `ui-out.json` and `result.json` under `runs/<runId>/` as evidence; a run id is never reused (`NATIVE_RUN_ID_REUSED`), so nothing replays them.
- Every value interpolated into a remote PowerShell command goes through `psq` (it doubles `'`) inside `'…'`, after a validator: Windows paths must match `^[A-Za-z]:\\` with no quote, backtick or `$`; file names must match `^[A-Za-z0-9._-]+$`, not starting with a dot. `WIN_DIR` is validated once, in `common.sh`. Keep this for any new wrapper.
- **A lost response is never replayed** (D228). `common.sh` has two ssh calls: `win` for anything that changes state, never retried, and `win_read` for idempotent reads, retried once on ssh exit 255. When `win` loses the connection the wrapper exits **3**, `UNKNOWN OUTCOME`: the command may or may not have run, so check the state before anything else (pitfalls 21). `cdp.mjs`'s own exit 3, `CDP_TIMEOUT`, means the same thing.
- **The Windows side's exit codes reach the Mac caller** (D247). OpenSSH there runs every command in PowerShell 5.1, which exits 1 for any failure; `win` and `win_read` wrap each command (`ps_wrap` in `common.sh`) so a failed program's own code comes back: `ui-run.ps1`'s 1 and 2, `cdp.mjs`'s 1–6. A failed cmdlet is still 1, success 0.
- **Exit 70, `NATIVE_CRASH`: the remote program crashed** (D248). A Windows crash code is an NTSTATUS (0xC0000409, 0xC0000005), outside 0–255; ssh would cut it to a byte that can look like a driver's own code (0xC0000005 → 5, `WINDOW_NOT_FOUND`), so `ps_wrap` reports any code outside 0–255 as 70. The outcome is unknown, as for 3: check the state, never re-run a mutation on it.
- The only listener is WebView2's DevTools port, on `127.0.0.1:9222`, and only while mdpro runs from `launch.cmd`.

## Other scripts

| Script | Use |
|---|---|
| `mac/mdpro.sh debug --yes \| normal --yes \| status \| cleanup` | Restarts mdpro with or without the port. `--yes` is required, given only after the user confirms nothing is unsaved. It refuses to relaunch if mdpro didn't close, maximizes, and checks `innerWidth`; it exits 0 only when every one of those steps did, and with the failing step's status otherwise (3 for an unknown outcome). `cleanup` (also run on exit) removes any leftover task. |
| `mac/log.sh mark` / `log.sh raw [file]` / `log.sh since [regex]` | `mark` records mdpro.log's byte size and identity (creation time plus the sha256 of its first line) as a v2 mark. `raw` writes the bytes logged since then, unchanged, to `$OUT/<file>` (default `raw-<time>.jsonl`), prints the path, and reports `lines: N malformed: M` on stderr; **judge a run by this file**. `since` is the human view of the same bytes: it reformats each event and skips bad lines, so it is not an oracle. Both refuse with exit 7 when the mark no longer fits. A failed mark is an error, never an empty number. |
| `mac/push.sh local winpath` | Chunked upload, verified by SHA-256 (`hash ok` / `HASH MISMATCH`). A lost chunk stops it with "partial upload; re-run push" (exit 3); re-running is safe, because it truncates first. |
| `mac/pull.sh winpath name` | Binary download into `$MDPRO_WIN_OUT`. |
| `mac/deploy.sh` | Uploads `scripts/windows/*`, skipping unchanged files. Can exceed 120 s: run it in the background. |
| `windows/mcp-probe.ps1` | `mdpro_mcp.exe` over stdio: initialize, tools/list, get_open_documents. |
