# Ops reference

Kept in sync with `scripts/windows/ui.ps1` and `scripts/windows/cdp.mjs`. When one changes,
this file changes in the same commit.

## Desktop-session driver: `scripts/mac/ui.sh '<json steps>'`

Each step logs one line, and an error logs `ERROR <op>: …` and the run continues. Coordinates
are **physical screen pixels**, the same space as a `shot` with `"screen":true`.

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

## Other scripts

| Script | Use |
|---|---|
| `mac/mdpro.sh debug \| normal \| status \| cleanup` | Restarts mdpro with or without the port (it refuses to relaunch if mdpro didn't close), maximizes, and checks `innerWidth`; `cleanup` removes the scheduled tasks. |
| `mac/log.sh mark` / `log.sh since [regex]` | mdpro.log events since the mark. A failed mark is an error, never an empty number. |
| `mac/push.sh local winpath` | Chunked upload, verified by SHA-256 (`hash ok` / `HASH MISMATCH`). |
| `mac/pull.sh winpath name` | Binary download into `$MDPRO_WIN_OUT`. |
| `mac/deploy.sh` | Uploads `scripts/windows/*`, skipping unchanged files. Can exceed 120 s: run it in the background. |
| `windows/mcp-probe.ps1` | `mdpro_mcp.exe` over stdio: initialize, tools/list, get_open_documents. |
