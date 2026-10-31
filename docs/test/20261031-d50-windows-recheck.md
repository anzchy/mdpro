# D50 recheck on win-desktop, 2026-10-31 (herdr-delegator)

Context: the user turned off AMD Radeon Software's Ctrl+Shift+L binding ("Toggle Performance") and asked for a recheck,
keeping Ctrl+Shift+L as the Windows sidebar chord (user: 「我已经关闭了AMD上的ctrl+shift+l（原本用于AMD Radeon 软件的
"Toggle Performance"），Windows上 Toggle Sidebar 仍然用这个快捷键，D50 问题已经解决，你复核一下」).

| Check | Route | Result |
|---|---|---|
| P1 hotkey owner, mdpro closed | `D50-p1.ps1` via `runi.ps1` (task `mdpro-audit-d50-p1-recheck`, interactive desktop, unregistered after) | `RegisterHotKey=True lastError=203; UnregisterHotKey=True` (result file 2026-10-31 08:11:18). Before: `False lastError=1409`. No system-wide owner remains |
| Build identity | read-only SSH | `D:\programs\mdpro\tauri-app.exe` 0.3.5, SHA-256 `1C46E3F2…FC81`; `app.ready` 08:16:22 `releaseId 0.3.5-dev@8aeb1c19`; `8aeb1c19..origin/master` has no `src/` or `src-tauri/` commit |
| Config | read-only | `keyboardShortcutsVersion=2`, `viewToggleSidebar=Cmd+Shift+L` |
| Real presses by the user | user's own keyboard: WYSIWYG editor focus, outside the editor, Source mode | User: 「都切换了，四步都正常」. `mdpro.log` 08:17:02–08:17:56: 22 `ui.shortcut.trigger` `view.toggle_sidebar` `Cmd+Shift+L`, in pairs, plus one `view.cycle` `Cmd+/` (the mode switch). No other action; 0 error/warn lines and 0 `file.save` in 08:1x |

Verdict: 通过. D50's cause was the environment (AMD Radeon Software's hotkey); with it off, the shipped Ctrl+Shift+L works on
Windows in both editors and outside them. Nothing needs to change in mdpro for this machine.
Not covered: other machines where AMD Software (or another program) keeps the binding.
