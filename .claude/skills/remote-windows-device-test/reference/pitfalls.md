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
   - Ctrl / Alt chords are safe.
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
    - `common.sh` retries once on ssh exit 255, and the wrappers refuse empty output.
    - If it happens again, run `ssh win-desktop hostname` and repeat the call.
18. **CDP hang triage:**
    - It hung for about a minute twice, then recovered, and the renderer CPU was idle.
    - Check in this order: `ssh win-desktop hostname`, then `Invoke-WebRequest
      127.0.0.1:9222/json/list` on the PC, then `node cdp.mjs eval 1+1` on the PC, then retry.
19. **The Claude Code Bash tool:**
    - Calls over 120 s move to the background, so keep each call to one action plus its check.
    - Run `deploy.sh` with `run_in_background`.
    - Wait with a bounded loop:
      `end=$((SECONDS+600)); until <check> || [ $SECONDS -ge $end ]; do sleep 3; done`.
      Never `sleep N; cat`, which is blocked. When the wait reads a background task's output,
      the check also stops on `^\[exited with code`, so a producer that died (ssh 255) ends
      the wait. On 2026-10-15 an unbounded loop waited hours for a hash from a transfer that
      had already failed.
    - Before reporting, stop every background shell the run no longer needs.
    - `rm -rf` of a scratch folder is denied, so use a new folder name.
    - A backgrounded command can leave the shell in another directory, so set
      `S="$(git rev-parse --show-toplevel)/.claude/skills/remote-windows-device-test/scripts/mac"`.
20. **Screenshots on the Mac:** `sips -c` crops around the centre, not the top. Downscale with
    `sips -Z 1300` before reading. A full-screen shot shows the user's private desktop: delete
    it after use and never commit it.
