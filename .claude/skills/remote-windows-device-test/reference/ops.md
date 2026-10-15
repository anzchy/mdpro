# Ops reference

Kept in sync with `scripts/windows/ui.ps1` and `scripts/windows/cdp.mjs`. When one changes,
this file changes in the same commit.

## Desktop-session driver: `scripts/mac/ui.sh '<json steps>'`

Each step logs one line. **An error stops the run**: it logs `ERROR <op>: …` and then
`ABORTED at step N`, no later step runs, and `ui.sh` exits 1 after printing the log. So
`ui.sh '[…click…, …type…]' && cdp.sh eval …` never types or evaluates after a failed click. A
read-only step can opt out with `"onError":"continue"`, e.g. `{"op":"windows","onError":"continue"}`:
its error is logged and the run goes on. **`ui.sh` cannot bind a window by label yet**: a step
with a `"window"` field is refused, and with several mdpro windows open and none in front it
refuses rather than taking the first (pitfalls 22). Coordinates are **physical screen pixels**, the same space
as a `shot` with `"screen":true`.

| Op | Arguments | What it does |
|---|---|---|
| `windows` | — | Lists mdpro's visible top-level windows: title, hwnd, rect. |
| `focus` | — | Brings mdpro to the foreground (taps Alt to unlock `SetForegroundWindow`). |
| `max` / `restore` | — | Maximizes or restores the mdpro window. **Run `max` after every start** (see pitfalls). |
| `menuclick` | `path: ["File","Save"]` | **Real mouse clicks** on the native menu: opens each level and clicks the item, all in this run. Item names come from `menus`. |
| `menuat` | `bar: [x,y], item: [x,y]` | Same idea by coordinates. Use it when `menuclick` can't read the menu: after a second window has closed, `GetMenu` returns an invalid handle (see `menuinfo`). |
| `menus` | — | Dumps the native menu tree: names, accelerator text, `[disabled]`, `[checked]`. |
| `menuinfo` | — | hwnd, HMENU and item count. A count of `-1` means the handle is invalid, so use `menuat`. |
| `clickat` | `x, y, right?` | One real mouse click at screen coordinates. |
| `chord` | `keys: ["ctrl+s","esc"], nofocus?` | Real key events (keybd_event). Key names: `ctrl shift alt win enter esc tab back del up down left right home end space pageup pagedown f1–f12 backtick slash minus equals period comma semicolon quote lbracket rbracket backslash`, letters and digits. Anything else is refused. Use `nofocus:true` after a `clickat` into the editor, so `focus` doesn't disturb keyboard focus. |
| `filedialog` | `path` or `cancel:true` | Drives the foreground common Open / 另存为 dialog. It sets the Win32 `Edit` by `WM_SETTEXT` and presses Enter (or Esc). |
| `shot` | `out, screen?` | PNG of the mdpro window, or of the whole screen with `screen:true`. A whole-screen shot shows the user's private desktop: never commit it. |
| `open` | `path` | Starts `tauri-app.exe <path>`, which routes into the running app through **single-instance**. Paths opened this way carry `\\?\` on 0.3.1; File → Open does not. |
| `run` | `exe, args` | Starts any process in the desktop session. |
| `visible` | — | `IsWindowVisible` for each listed window. |
| `showall` | — | Shows every hidden `mdpro` top-level window, found by `EnumWindows` (`MainWindowHandle` is 0 while hidden). |
| `tree` | `depth` | The UIA tree of the foreground window. The WebView2 subtree is skipped, because it times out. |
| `wait` | `ms` | Sleeps. |
| ~~`keys`~~ ~~`menu`~~ ~~`click`~~ ~~`settext`~~ | — | **Refused.** SendKeys never reaches mdpro from a task; posted `WM_COMMAND` / `WM_MENUCOMMAND` are ignored; UIA Invoke and ValuePattern don't work on WebView content. |

**The one rule:** open a menu and click its item **in one run**. Starting the next run's
scheduled task dismisses a menu the previous run left open, so the item click hits nothing.
On 2026-10-12 this split produced a false "Hide does nothing" verdict.

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
`"CDP_PORT_CLOSED: …"` means mdpro is running without the debugging port: run `mdpro.sh debug`.
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
| 4 | The DevTools port is closed. | `mdpro.sh debug --yes`. |
| 5 | `cdp.sh --window`: no page has the label, or the page's label changed before the eval. Nothing was evaluated. | Pick a label from the printed candidates. |
| 6 | `cdp.sh`: several mdpro windows and no `--window`, or several with that label. Nothing was evaluated. | Pass `--window <label>`. |
| 7 | `log.sh raw` / `since`: the mark no longer fits the log. It is `truncated` (the file is smaller than the mark), `replaced` (another creation time or first line), a v1 line-count mark, or the bytes returned don't match the size. Nothing is written. | `log.sh mark` again and repeat the action. |
| 124 | `ui.sh`: no log came back before the timeout. | The steps may have partly run; check, then re-run. |
| 255 | ssh never got through, even after the one retry a read gets. | `ssh win-desktop hostname`. |

A read never returns 0 with an empty answer: a failed read keeps ssh's status.

## Safety rules in the scripts

- Every one-off scheduled task (`runi.ps1`) is waited for and then **unregistered** (try/finally). `ui-run.ps1` deletes its step and output files, so nothing can replay them.
- Every value interpolated into a remote PowerShell command goes through `psq` (it doubles `'`) inside `'…'`, after a validator: Windows paths must match `^[A-Za-z]:\\` with no quote, backtick or `$`; file names must match `^[A-Za-z0-9._-]+$`, not starting with a dot. `WIN_DIR` is validated once, in `common.sh`. Keep this for any new wrapper.
- **A lost response is never replayed** (D228). `common.sh` has two ssh calls: `win` for anything that changes state, never retried, and `win_read` for idempotent reads, retried once on ssh exit 255. When `win` loses the connection the wrapper exits **3**, `UNKNOWN OUTCOME`: the command may or may not have run, so check the state before anything else (pitfalls 21). `cdp.mjs`'s own exit 3, `CDP_TIMEOUT`, means the same thing.
- **The Windows side's exit codes reach the Mac caller** (D247). OpenSSH there runs every command in PowerShell 5.1, which exits 1 for any failure; `win` and `win_read` wrap each command (`ps_wrap` in `common.sh`) so a failed program's own code comes back: `ui.sh`'s 124, `cdp.mjs`'s 1–6. A failed cmdlet is still 1, success 0.
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
