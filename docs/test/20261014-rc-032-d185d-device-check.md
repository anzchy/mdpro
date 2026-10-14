> **Delegator note (2026-10-14).** Stopped before R1: the mini screen locked (display sleep 10 min). Rerun after the user unlocked it: see `20261014-rc-032-d185d2-device-check.md`.

# 0.3.2 RC device check: D185 retry 2 (Finder drop), build `6768740`, 2026-10-14

Brief: `briefs/20261014-brief-rc-032-d185d.md`, which builds on `briefs/20261014-brief-rc-032-d185r.md` and part A of `briefs/20261014-brief-rc-032.md`. Runner: dtrack session on the mini, 16:58 to 17:00 GMT+8.

**Summary. STOPPED before R1: the mini's screen is locked.** Pre-flight passed, the Computer Use grant (mdpro + Finder) was given, and the cold launch was clean (no drafts). The first screenshot then came back all black. The only visible window belonged to `com.apple.loginwindow`, and `ioreg` reports `CGSSessionScreenIsLocked = Yes`. No GUI step can run on a locked session, and the runner may not type the login password. So the Finder window was never opened, no drag was attempted, and **R1, R2, D185-a and D185-b were not run**. **FAIL: 0. PASS: 0.** I quit mdpro by an Apple Event, because the menu needs the GUI. The quit was clean, settings are unchanged, and the symlink is removed. **To retry:** unlock the mini's screen, keep it awake, and send the same brief again. Nothing in the setup needs to change.

## 1. Build evidence

| Check | Result |
|---|---|
| `request_access` (`com.mdpro.app`, `Finder`) | granted: `mdpro` (`com.mdpro.app`), `Finder` (`com.apple.finder`); denied: none |
| other mdpro before launch | none (`pgrep -fl 'mdpro\|tauri-app'` listed only `tmux new -s dtrack` and `claude --resume mdpro-remote`, which are not app processes) |
| binary mtime | `stat -f %m` = 1791958358 = `2026-10-14T14:12:38`, matches `BIN_MTIME` |
| binary sha256 | `388e6468075c966f1a258e33f853c2f580e3b64acab4174d564e1daf48bafc16`, matches `BIN_SHA` |
| worktree HEAD | `67687400d347da08e14edf02b5e9aab64578dfa5` |
| D185 commits | `cfa9503 0`, `8a19778 0` |
| fixture | `$FX/d185-alias-spelling.md` 59 B; copied to `$S/a185.md` (59 B) |
| input source | `ABC` |
| `$S` / `$L` | `S=~/.mdpro-redesign/dtrack/scratch/6768740-rc032-d185d`; `ln -s $S $L`; `readlink $L` printed `$S` (see N1 for why the folder name changed) |
| cold launch | `open -a "$APP"` (no file), mark 18632. PID **14975**, started 16:59:14, `ps` path `…/builds/6768740/mdpro.app/Contents/MacOS/tauri-app`. L18638 `app.ready` `releaseId:"0.3.2@67687400d347da08e14edf02b5e9aab64578dfa5"` |
| Recover drafts | none: L18648 `file.draft.list` `listed:0` |
| About / `W0` / tabs | **not checked**: the screen was locked (§ 4) |

## 2. Settings
- As-found (`$S/asfound.json`): `{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}`
- After quit (`$S/restored.json`): byte-identical (`cmp` printed SAME).

## 3. Verdict table

| Row | Verdict | Proof line(s) |
|---|---|---|
| R1 alias first, by the Finder drop | **not run (screen locked)** | none; no `open $L`, no drag |
| R2 real spelling second, by the panel | not run | – |
| D185-a | not run | – |
| D185-b | not run | – |
| R4 restore and close | done (quit via Apple Event, see § 4) | L18662 `app.quit.request` `windowCount:1`; L18663 check `clean` `dirtyCount:0`; L18671 `app.quit.commit` `deleted:0 drafted:0 failed:0`; L18672 `app.quit`; `pgrep` exit 1; settings SAME; `rm $L` done |

## 4. What happened

- After the cold launch, the first `screenshot` returned a fully black frame. The tool said the visible window was owned by `com.apple.loginwindow`.
- `ioreg -n Root -d1` → `IOConsoleUsers`: `"CGSSessionScreenIsLocked"=Yes`, `kCGSSessionOnConsoleKey=Yes`, `CGSSessionScreenLockedTime=3939450853`. The user session is logged in, but its screen is locked. `pmset -g assertions` showed `PreventUserIdleDisplaySleep 0`: only system sleep was being held off (UURemote and a `caffeinate`), not display sleep, so the display had most likely idled into the lock.
- Unlocking means typing the account password, which the runner may not do. I did not open Finder and did not drag anything. In the log after mark 18632, the only window line is L18636 `window.open` `main`. There is no `tab.open` and no `view.mode.change`, so the app was never touched.
- **R4.** The mdpro › Quit menu needs the GUI, so I quit with `osascript -e 'tell application id "com.mdpro.app" to quit'` (mark 18661). It went through the app's normal quit path (L18662–L18672, all clean, no dialog). **Discard changes count: 0.** `$L` was removed (the symlink only). `$S` is kept, holding `a185.md` (unchanged, 59 B), `asfound.json`, `restored.json`, `mark0`, `markq`.

Shots this run: none were saved (`shot.sh` was not reached; the one computer-use screenshot was the black lock frame).

## 5. Operator slips
1. I quit with an Apple Event instead of mdpro › Quit (§ 4), because the GUI was unavailable. The quit sequence it logged is the same as a menu quit's.

No key presses, clicks or typing reached mdpro or Finder. No Enter, Esc, ⌘Z or ⌘S. No MCP calls.

## 6. Deviations and notes
- **N1.** I used `S=…/6768740-rc032-d185d` (and `$L` = `…-d185d-link`), not the `-d185r` folder named in the d185r brief's R0. The d185r run's evidence (`partc-draft-lines.txt`, its `asfound.json` / `restored.json`) is still in the `-d185r` folder, and reusing that folder would have overwritten it. Logged paths in a retry will therefore contain `-d185d`.
- **N2 (for the retry).** Before the next attempt, keep the display from sleeping or locking for the run, for example with `caffeinate -d` for its duration, or by a setting the user chooses. Unlocking itself has to be done by the user at the mini.
- **N3 (carried, unchanged).** Memory from builds 8994bc8 and 8c996b1 says that synthetic drags inside the editor never dropped (an in-page HTML5 drop). This brief's drop is different: it is a native file drop from Finder, which Tauri delivers through `onDragDropEvent` (`src/App.tsx:630–649` → `handleFileDrop` → `openDroppedMarkdown`), with `dragDropEnabled: true` in `tauri.conf.json`. That earlier failure does not have to repeat here, but it has not been tried yet.
