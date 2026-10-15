# Ops reference

Kept in sync with `scripts/windows/ui.ps1` and `scripts/windows/cdp.mjs`. When one changes,
this file changes in the same commit.

## Desktop-session driver: `scripts/mac/ui.sh '<json steps>'`

Each step logs one line. **An error stops the run**: it logs `ERROR <op>: …` and then
`ABORTED at step N`, no later step runs, and `ui.sh` exits 1 after printing the log. So
`ui.sh '[…click…, …type…]' && cdp.sh eval …` never types or evaluates after a failed click. A
read-only step can opt out with `"onError":"continue"`, e.g. `{"op":"windows","onError":"continue"}`:
its error is logged and the run goes on. Coordinates are **physical screen pixels**, the same space
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
```

An expression that throws prints `{"exception": "…"}` **and exits 1**, so `cdp.sh eval … && next`
stops there.
`"CDP_PORT_CLOSED: …"` means mdpro is running without the debugging port: run `mdpro.sh debug`.
`"CDP_TIMEOUT"` means no answer within 25 s; see the triage in `pitfalls.md`.

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
| 1 | It ran and failed: an eval threw, a `ui.sh` step failed (`ABORTED at step N`), a restart step failed, or the output was empty (`NO OUTPUT`). | Read the printed log or exception. |
| 2 | Refused before running: usage, a validator, a missing `--yes`, no page. | Fix the call. |
| 3 | **Unknown outcome**: the connection dropped after the command was sent (`UNKNOWN OUTCOME`), or `cdp.mjs` timed out (`CDP_TIMEOUT`). The command may or may not have run. | Check the state on the PC before anything else (pitfalls 21). |
| 4 | The DevTools port is closed. | `mdpro.sh debug --yes`. |
| 124 | `ui.sh`: no log came back before the timeout. | The steps may have partly run; check, then re-run. |
| 255 | ssh never got through, even after the one retry a read gets. | `ssh win-desktop hostname`. |

A read never returns 0 with an empty answer: a failed read keeps ssh's status.

## Safety rules in the scripts

- Every one-off scheduled task (`runi.ps1`) is waited for and then **unregistered** (try/finally). `ui-run.ps1` deletes its step and output files, so nothing can replay them.
- Every value interpolated into a remote PowerShell command goes through `psq` (it doubles `'`) inside `'…'`, after a validator: Windows paths must match `^[A-Za-z]:\\` with no quote, backtick or `$`; file names must match `^[A-Za-z0-9._-]+$`, not starting with a dot. `WIN_DIR` is validated once, in `common.sh`. Keep this for any new wrapper.
- **A lost response is never replayed** (D228). `common.sh` has two ssh calls: `win` for anything that changes state, never retried, and `win_read` for idempotent reads, retried once on ssh exit 255. When `win` loses the connection the wrapper exits **3**, `UNKNOWN OUTCOME`: the command may or may not have run, so check the state before anything else (pitfalls 21). `cdp.mjs`'s own exit 3, `CDP_TIMEOUT`, means the same thing.
- The only listener is WebView2's DevTools port, on `127.0.0.1:9222`, and only while mdpro runs from `launch.cmd`.

## Other scripts

| Script | Use |
|---|---|
| `mac/mdpro.sh debug --yes \| normal --yes \| status \| cleanup` | Restarts mdpro with or without the port. `--yes` is required, given only after the user confirms nothing is unsaved. It refuses to relaunch if mdpro didn't close, maximizes, and checks `innerWidth`; it exits 0 only when every one of those steps did, and with the failing step's status otherwise (3 for an unknown outcome). `cleanup` (also run on exit) removes any leftover task. |
| `mac/log.sh mark` / `log.sh since [regex]` | mdpro.log events since the mark. A failed mark is an error, never an empty number. |
| `mac/push.sh local winpath` | Chunked upload, verified by SHA-256 (`hash ok` / `HASH MISMATCH`). A lost chunk stops it with "partial upload; re-run push" (exit 3); re-running is safe, because it truncates first. |
| `mac/pull.sh winpath name` | Binary download into `$MDPRO_WIN_OUT`. |
| `mac/deploy.sh` | Uploads `scripts/windows/*`, skipping unchanged files. Can exceed 120 s: run it in the background. |
| `windows/mcp-probe.ps1` | `mdpro_mcp.exe` over stdio: initialize, tools/list, get_open_documents. |
