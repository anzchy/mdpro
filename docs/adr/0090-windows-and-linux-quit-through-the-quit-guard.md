# 0090. Windows and Linux quit through the quit guard from a custom Exit item, with a headless fallback

**Status**: Proposed (2026-10-13). Drafted by mdpro-a3 for [D190](../plans/20260912-frontend-backend-sequencing-order.md#d190)-WI-4, on the delegator's rulings for the stuck-quit escape (parity with macOS, no new dialog) and the ADR number.

## Context

The Windows audit (W4, [`docs/feature-ledger-windows-audit-claude.md`](../feature-ledger-windows-audit-claude.md))
found that mdpro → Exit with four dirty documents ended the process at once:
no prompt, no `app.quit` line, and `%APPDATA%\mdpro\server.port` /
`server.token` left behind. Reading the code and the pinned crates showed the
defect was wider than the menu item:

- muda 0.17.1 answers the predefined Quit on Windows with `PostQuitMessage(0)`
  (`platform_impl/windows/mod.rs:1219-1220`). tao 0.34.5 leaves its message
  loop on `WM_QUIT` (`event_loop.rs:257`) and tauri-runtime-wry 2.9.3 turns that
  into `RunEvent::Exit` only (`lib.rs:4008`). `ExitRequested` is never raised.
- The guard ([ADR-0025](0025-app-quit-is-deferred-through-a-native-terminate-hook.md))
  is a macOS `applicationShouldTerminate:` hook. Off macOS `install` was a
  no-op, `reply` was a no-op and the ADR-0027 alert was a no-op that reported
  "posted". Nothing on Windows ever opened a quit request.
- The server-file cleanup runs on `RunEvent::Exit`, but only in the macOS
  `app.run` closure. The other targets ran `app.run(|_, _| {})`, so every
  Windows exit left the files behind, including the one where the last window
  is closed.

## Options considered

- **Leave Windows on the predefined Quit and only add the Exit cleanup.**
  Cheapest. Lost: unsaved work is still discarded without a prompt and the
  ADR-0035 draft backstop never runs. That is W4 itself.
- **Intercept `ExitRequested` and run the guard there.** The predefined Quit
  never raises it on Windows, so this would not see the defect at all.
- **A custom Exit item whose click opens the same request as macOS.**
  *Chosen.* It reuses the coordinator, prompts, re-check and backstop unchanged.
- **For the ADR-0027 alert off macOS, which is never drawn**, three ways to
  avoid a request owned by an alert that does not exist:
  (a) `native_fallback` reports `false` on a timeout, so the driver releases
  the request back to the windows;
  (b) draw the alert with `rfd::MessageDialog` (rfd 0.14 is already a
  dependency);
  (c) put the ADR-0036 escape item after Exit and let it answer for the person
  who chose it.
  **(a) + (c) chosen**, for parity with macOS. **(b) is deferred**: it gets a
  separate WI only if a device check shows (a) + (c) is not enough.

## Decision

Off macOS the app menu carries a custom **Exit** (`menu.app.quit`) in place of
the predefined Quit. "Stop Waiting and Quit…" follows it directly. The click
sorts the open window labels and calls `QuitGuard::request_quit`, which is
`begin` plus `reply(true)` when there is nothing to guard. Off macOS
`reply(true)` is `AppHandle::exit(0)`, which raises `ExitRequested` and then
`Exit`. `reply(false)` does nothing.

`native_fallback` off macOS reports `false` on a timeout, so the request goes
back to the windows. On the escape it posts `QuitAnyway` to the guard on the
main thread: the alert's Quit Without Saving, which deletes no draft
(ADR-0027 §5).

`main.rs` runs one `app.run` on every target. `RunEvent::Exit` runs
`run_exit_cleanup` everywhere, and `RunEvent::Opened` stays macOS-only.

macOS is unchanged: it keeps the predefined Quit and the native hook.

## Consequences

- Exit on Windows and Linux prompts for unsaved work and runs the
  [ADR-0035](0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md)
  re-check and draft backstop. Every exit removes the MCP server files.
- A wedged webview on Windows is escaped by the menu item, as on macOS
  ([ADR-0036](0036-the-stuck-quit-escape-hatch-is-an-always-enabled-app-menu-item-without-a-shortcut.md)).
  **Cost:** without a dialog the escape quits at once. On macOS the
  [ADR-0027](0027-a-quit-ack-timeout-draws-a-native-alert.md) alert still
  offers Keep Open. A timed-out request off macOS waits on its windows with no
  deadline until the person escapes or a window answers.
- Closing the last window runs the server-file cleanup but not the ADR-0035
  backstop, as on macOS: the per-window close prompt guards that route.
- The predefined Quit's shortcut and OS integration are given up off macOS.
  Exit has no accelerator, and the session-end (`WM_QUERYENDSESSION`) path is
  still unguarded.
- The off-macOS branches are not compiled on the Mac that runs the suite, and
  the Windows cross-check cannot build `ring` there. They are pinned by
  source-contract tests and need a Windows device check.
