# Known Windows behaviour of mdpro 0.3.1 (as of 2026-10-13)

These were seen on the installed 0.3.1 (`c8bd2b6`) on win-desktop: Windows 11, 270 % scaling,
微软拼音 IME. **Re-check each one on a newer build before relying on it.** Fixes are tracked as
D190 (W1–W7) and D189 (#416).

Report: [`docs/feature-ledger-windows-audit-claude.md`](../../../../docs/feature-ledger-windows-audit-claude.md).

| Id | Behaviour | Root cause / evidence | Consequence for testing |
|---|---|---|---|
| W1 | No app shortcut fires: Ctrl+S / N / O / W, Ctrl+2/4, Ctrl+Shift+L, table Ctrl+Alt+arrows. | `src/hooks/useKeyboardShortcuts.ts` `matchesShortcut` rejected Ctrl for "Cmd" bindings (D190 WI-1). Native menu accelerators never fired either. | Drive those actions through the menu. Don't record a shortcut as working from a menu run. |
| W2 | Every save is followed by "External change detected". | The atomic save's rename event has `ownEvent=false` / `unchangedCheck=unstable`. | Expect and dismiss the prompt after each save. It isn't caused by your test. |
| W3 | Local images never render. | CSP `img-src` allows `https://asset.localhost`, but Windows uses `http://asset.localhost` (proven with `__a.cspProbe`). | Image rows can't pass on 0.3.1. |
| W4 | mdpro → Exit quits instantly, with no unsaved prompt, and leaves `%APPDATA%\mdpro\server.port` / `server.token`. | No quit-guard log lines. | Never Exit with the user's documents open. Expect a Recover drafts dialog on the next start. |
| W5 | Paths opened through single-instance carry `\\?\`; the tab label shows the full path. | `file.open` logs `\\?\C:\…`. | Use File → Open when the row is about paths or images. |
| W6 | Inline code (`Mod-Shift-\``) and strikethrough (`Ctrl-Shift-\``) are the same chord on Windows. | Keymap collision in code. Which one wins was observed only with a malformed synthetic key, so re-check with a real `chord backtick`. | |
| W7 | Mac-only chrome: "Cmd+…" labels in Settings → Keyboard Shortcuts, `~/.mdpro/mdpro.log` text, "(⌘N)" tooltip, export suggests `name.md.html`. | Observed. | |
| #416 | At ≤960 CSS px the sidebar collapses to about 33 px. | `responsive.css` media query (D189). | Maximize first. |

**Corrected on 2026-10-13:** "mdpro → Hide does nothing" was a harness artefact (the menu was
opened and clicked in separate runs). Hide hides the window, and the taskbar button stays.
Restore it with the `showall` op.
