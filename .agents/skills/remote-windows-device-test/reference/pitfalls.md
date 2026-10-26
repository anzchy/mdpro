# Pitfalls (learned 2026-10-12/13, mdpro 0.3.1 on win-desktop)

Each entry gives what went wrong, how it showed up, and what to do instead. The first group
produced **wrong verdicts**; the rest cost time.

## Produced wrong verdicts

1. **A menu opened in one run and clicked in the next.**
   - What happened: starting the second `ui.sh` run's scheduled task dismisses the menu the
     first run left open, so the item click lands on nothing.
   - Cost: "mdpro → Hide does nothing" was recorded, and turned out false. Hide works, and the
     taskbar button stays. The split failed 2/2 times; open and click in one run worked 4/4.
   - Do: use `menuclick` or `menuat`, which open and click within one run. If you need
     coordinates, find them in a separate run (open, then `shot screen:true`, then
     `chord esc`), then click in one fresh run.
2. **A synthetic punctuation key.**
   - What happened: before 2026-10-13, `__a.key("`")` sent the right character with an empty
     `code` and vk 96 (NumPad0), so which of two colliding bindings "won" was decided by a
     malformed event (row 029).
   - Fixed: `__a.key` now sends US-layout `code` / keyCode and refuses unknown keys, and
     `chord` takes named keys (`backtick`, `slash`, …).
   - Do: confirm with a real `chord` or a unit test before reporting which binding wins.
3. **A narrow window.**
   - What happened: at 270 % scaling a normal 1672 px window is only about 667 CSS px wide.
     The sidebar collapses (that's #416), so outline entries can't be clicked, and that was
     nearly recorded as a failure.
   - The `max` that should have fixed it had its output thrown away (`>/dev/null`), so nobody
     saw it fail.
   - Do: run `max` after **every** start (`mdpro.sh` now does it), and check
     `cdp.sh eval 'return innerWidth'` (about 1120). Never discard `ui.sh` output.
4. **A failure verdict without a passing control.**
   - What happened: "Ctrl+S doesn't save" only became trustworthy after real Ctrl+Z reached the
     page on the same route, File → Save by menu worked, and the code root cause was found
     (`useKeyboardShortcuts.ts` matchesShortcut).
   - Do: before you write a failure, show that something on the same route works, in the same
     run. Without that, the verdict is 未验证, not 不通过.

## Cost time

5. **Computer use / TeamViewer:** the user does not want the Mac's screen taken over. Drive
   everything over SSH.
6. **SSH has no desktop.**
   - Screenshots, UIA, input and window messages only work from the interactive session.
   - `runi.ps1` registers a one-off scheduled task, `LogonType Interactive`.
   - `$Args` is a reserved PowerShell name.
   - The principal must be `WindowsIdentity.GetCurrent().Name`; `USERDOMAIN\USERNAME` fails
     with 0x80070534.
7. **Code page 936:** anything non-ASCII printed over SSH is mangled. Move data as base64
   (all wrappers do).
8. **About 8 KB per SSH command line** ("exec request failed on channel 0" at 63 KB).
   - `push.sh` uploads in 7 KB chunks.
   - `cdp.sh eval` refuses more than about 5 KB of script; use `evalf`.
   - The old chunk loop dropped the last chunk (no trailing newline); `push.sh` now checks
     SHA-256 after every upload.
9. **Keyboard.**
   - SendKeys never arrives from the task; `chord` (keybd_event) does.
   - A CDP click doesn't move OS keyboard focus into the WebView, so do a real `clickat` into
     the editor first.
   - The 微软拼音 IME composes letters (`zq7` became `q7前`), so type text only with `__a.text`.
   - Ctrl / Alt logical chords are useful controls, but `chord` uses zero scan codes and cannot
     prove a physical `event.code` or German AltGr. Use `layout` on the target HWND, then
     `physicalChord` with that exact HKL and DOM physical key names for those cases. Right Alt
     is distinct from left Alt. Recheck foreground and layout; a failed or uncertain injection
     is not a reason to send the chord again before inspecting the app and keyboard state.
10. **Native menus:**
    - Real clicks work. Posted `WM_COMMAND` / `WM_MENUCOMMAND` are ignored.
    - After a second window has been closed, `GetMenu` on the main window returns an invalid
      handle (`menuinfo` count -1) although real clicks still work; use `menuat`.
11. **File dialogs:** AutomationId 1001 is the combo box; the name box is the Win32 class
    `Edit`, set by `WM_SETTEXT`; `SetFocus` is refused, but Enter works.
12. **Toasts last about 3 s:** call `__a.toastsOn()` before the action, and `__a.toasts()`
    after it.
13. **Two open routes:**
    - The `open` op (second launch, single-instance) gives `\\?\C:\…` paths on 0.3.1.
    - File → Open gives plain `C:\…`.
    - Path-related rows behave differently by route (e.g. the image asset URL), so test the
      route the row names.
14. **Scheduled tasks persisted** (fixed 2026-10-13, independent review C1): before the fix, every
    `mdpro-audit-*` task stayed registered until a manual `cleanup`, and `mdpro-audit-ui`
    would replay a leftover `steps.json`. `runi.ps1` now unregisters its task in `finally`.
15. **Exit / kill / relaunch:**
    - On 0.3.1, mdpro → Exit quits instantly, even with dirty documents.
    - A relaunch shows a modal "Recover drafts" dialog that blocks later probes.
    - Never Exit or kill with the user's own documents open.
    - After a relaunch, Discard the test drafts, then `max` again.
16. **Hide really hides.**
    - After mdpro → Hide the window is invisible, and `windows` / `MainWin` find nothing.
    - Restore it with the `showall` op (EnumWindows) in the same run.
17. **Empty output is a transport failure, never a result.**
    - Example: "Connection reset … port 22", after which `log.sh mark` wrote an empty mark and
      `since` failed.
    - `common.sh`'s `win_read` retries a read once on ssh exit 255, and the wrappers refuse empty
      output. A mutation is never retried (entry 21).
    - If a read fails again, run `ssh win-desktop hostname` and repeat the call.
18. **CDP hang triage:**
    - It hung for about a minute twice, then recovered, and the renderer CPU was idle.
    - Check in this order: `ssh win-desktop hostname`, then `Invoke-WebRequest
      127.0.0.1:9222/json/list` on the PC, then `node cdp.mjs eval 1+1` on the PC, then retry.
19. **Long-running shell calls:**
    - Claude Code Bash calls over 120 s move to the background; in Codex, keep an exec session and
      wait on that session. Keep each call to one action plus its check.
    - Run `deploy.sh` in the background or in a resumable exec session.
    - Wait with a bounded loop:
      `end=$((SECONDS+600)); until <check> || [ $SECONDS -ge $end ]; do sleep 3; done`.
      Never `sleep N; cat`, which is blocked. When the wait reads a background task's output,
      the check also stops on `^\[exited with code`, so a producer that died (ssh 255) ends
      the wait. On 2026-10-15 an unbounded loop waited hours for a hash from a transfer that
      had already failed.
    - Before reporting, stop every background shell the run no longer needs.
    - `rm -rf` of a scratch folder is denied, so use a new folder name.
    - A backgrounded command can leave the shell in another directory, so set
      `S="$(git rev-parse --show-toplevel)/.agents/skills/remote-windows-device-test/scripts/mac"`.
20. **Screenshots on the Mac:** `sips -c` crops around the centre, not the top. Downscale with
    `sips -Z 1300` before reading. A full-screen shot shows the user's private desktop: delete
    it after use and never commit it.
21. **A retried mutation ran twice** (D228, fixed 2026-10-15).
    - What happened: `win` retried every ssh exit 255. But 255 also comes back when the
      connection drops *after* the remote command ran, so a lost response replayed a whole eval,
      `ui.sh` run or chunk append: a doubled keystroke, a doubled chunk.
    - Now: `win` (evals, `ui.sh` steps, `runi` restarts, chunk appends, the upload's decode)
      never retries. On 255 it prints `UNKNOWN OUTCOME: transport lost after send; reconcile
      state before continuing` and the wrapper exits **3**. `win_read` (status, logs, hashes,
      pulls, screenshots, the upload's truncate) still retries once.
    - Do: on exit 3, look before you act again. Check the editor, the log or the file, undo a
      half-applied step, then go on. `push.sh` stops with "partial upload; re-run push": re-run
      it, since it starts by truncating the upload. `mdpro.sh debug`/`normal` never relaunch
      over a close whose outcome is unknown.
    - A new remote call is classified when it is written: `win` for anything that changes
      state, `win_read` only if running it twice is harmless.
      `tests/tooling/windows-driver-transport.test.ts` T7 fails on an unlisted `win` call.
22. **Several mdpro windows: the drivers used to pick one** (WI-E2E-W item 3, 2026-10-15).
    - What happened: `cdp.mjs` evaluated in the first page `/json/list` returned, and `ui.ps1`'s
      `MainWin` took the first mdpro window when none was in front, so a run could type into a
      window it never meant to.
    - Now: `cdp.sh --window <label>` binds an eval to a Tauri label. For native steps,
      `ui.sh` reads all page labels, CDP page IDs and Tauri physical outer rectangles. In the
      same native run, the exact page places a fresh nonce marker in its Tauri title; `ui.ps1`
      requires that marker and an exact Win32 rectangle before pinning the HWND/process. It
      rechecks title, bounds, process and foreground after the resolver and before mouse/key
      input, then restores the title only if the marker remains. A missing label, identical rectangles,
      move, close or foreground mismatch aborts. With two windows, every window-targeted native
      step needs its label; foreground alone is never a substitute.
    - A title marker may remain after a lost SSH outcome or interrupted cleanup. Inspect the
      title and document effects before another call; never replay a title challenge or native
      mutation merely because the response was lost.
    - Device proof is still owed: measure Tauri and Win32 rectangles at 270% scaling and on a
      secondary monitor before accepting any tolerance. Two identically maximized windows stay
      ambiguous, so record that binding subcase as 未验证. Native A/B effects on a locked installer
      remain 未验证 until the cleared Windows run.
