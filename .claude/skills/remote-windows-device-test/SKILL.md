---
name: remote-windows-device-test
description: Drive and test the installed mdpro on the Windows desktop (`win-desktop`) entirely over SSH from the MacBook — page control through the WebView2 DevTools port, native menus / real keys / file dialogs / screenshots through a desktop-session PowerShell driver, mdpro.log evidence. Use to device-test, audit or reproduce anything in mdpro on Windows, check a feature-ledger row on Windows, or verify a Windows-only fix.
---

# Remote Windows device test

## Read first

1. **No computer use, no TeamViewer.** Everything goes over SSH; the user keeps working on
   the Mac (user decision, 2026-10-12). Connection basics:
   `.claude/skills/remote-ssh/reference/windows-desktop.md`.
2. **`mdpro.sh debug --yes` restarts the user's running mdpro.** Ask the user first and pass
   `--yes` only after they confirm nothing in mdpro is unsaved. On 0.3.1 the window-close
   prompt is unverified with dirty documents, and Exit skips the quit guard. The script
   refuses to relaunch if mdpro didn't close. Never Exit or kill mdpro with the user's
   documents open.
3. **Open a native menu and click its item in ONE `ui.sh` run** (`menuclick` / `menuat`). A
   split across runs dismisses the menu and produced a false verdict on 2026-10-12.
4. **Run `max` after every start and check `innerWidth` ≈ 1120.** At 270 % scaling an
   unmaximized window is about 667 CSS px wide and the sidebar collapses. Never send `ui.sh`
   output to `/dev/null`.
5. **A failure verdict needs a passing control on the same route in the same run.** Without
   one, write 未验证 (§ 3).

## 1. Setup

```bash
S="$(git rev-parse --show-toplevel)/.claude/skills/remote-windows-device-test/scripts/mac"
$S/deploy.sh            # copies scripts/windows/* to C:\Users\jack\mdpro-audit (hash-checked); run in background
$S/mdpro.sh debug --yes # (after the user confirms nothing is unsaved) restart with DevTools port 9222, maximize, print innerWidth
$S/mdpro.sh status      # 1 tauri-app, 9222 on 127.0.0.1, one page http://tauri.localhost/
```

- **Settings:**
  - `WIN_HOST` (default `win-desktop`), `WIN_DIR` (default `C:\Users\jack\mdpro-audit`),
    `MDPRO_WIN_OUT` (where screenshots land on the Mac).
  - On Windows, `MDPRO_EXE` / `MDPRO_MCP_EXE` (default `D:\programs\mdpro\…`) must be **user
    environment variables** (`setx`). The scheduled task doesn't inherit the SSH session.
- **Fixtures:** put copies in `%WIN_DIR%\fx\` with `push.sh` (or a tar plus `tar -xf`). Never
  open the user's own documents.

## 2. Driving it

```bash
$S/cdp.sh eval 'await __a.click(".ProseMirror"); await __a.text("hello"); await __a.key("b",["ctrl"]); return 1'
$S/cdp.sh evalf probe.js                                       # scripts > ~5 KB
$S/cdp.sh eval '__a.toastsOn(); return 1'; …action…; $S/cdp.sh eval 'return __a.toasts()'
$S/ui.sh '[{"op":"menuclick","path":["File","Save"]}]'
$S/ui.sh '[{"op":"menuclick","path":["File","Export HTML..."]},{"op":"wait","ms":1500},{"op":"filedialog","path":"C:\\Users\\jack\\mdpro-audit\\out\\a.html"}]'
$S/ui.sh '[{"op":"clickat","x":1600,"y":900},{"op":"chord","keys":["ctrl+z"],"nofocus":true}]'   # real keys
$S/ui.sh '[{"op":"open","path":"C:\\Users\\jack\\mdpro-audit\\fx\\a.md"}]'   # single-instance route
$S/log.sh mark; …action…; $S/log.sh since 'file.save|menu'
```

- **Every op and helper:** [`reference/ops.md`](reference/ops.md).
- **Everything that went wrong once, and what to do instead:**
  [`reference/pitfalls.md`](reference/pitfalls.md).
- **What 0.3.1 already does wrong on Windows** (don't re-diagnose it; re-check it on newer
  builds): [`reference/known-0.3.1-windows.md`](reference/known-0.3.1-windows.md).

**Two routes:**

| Route | Use it for | Example |
|---|---|---|
| Page input (CDP) | Whatever the page handles itself | Editor keys, clicks, typed text |
| Real input (`ui.sh`) | Anything the OS or the native menu owns | Menus, accelerators, dialogs, focus |

A result obtained on one route says nothing about the other.

## 3. Reporting

- **Verdicts:** one per row: 通过 / Windows 不通过 / 与 ledger 不符 / 一致（无入口） / 部分 /
  未验证 / 平台不适用.
- **Evidence:** name the action actually performed and the evidence (a log line, a DOM value
  or a screenshot).
- **Failures:** a failure needs a passing control on the same route, in the same run.
  Harness-sensitive conditions:
  - menus split across runs;
  - synthetic punctuation keys;
  - an unmaximized window;
  - anything after a second window closed.
- **Don't pass a row:**
  - from source code alone, or
  - through a different route than the one the row names.
- **Platform triage:** macOS-only rows (Finder, `.dmg`, ADR-0047 verify builds) are
  平台不适用. A Mac-only item that shows up on Windows is checked like any other, in one run.
- **Where it goes:** the report goes in `docs/`, the evidence in
  `docs/test/windows-audit-<date>-<who>/`.
- **Never commit a full-screen shot:** it shows the user's private desktop.
- **Reference:** the 2026-10-12 run is `docs/feature-ledger-windows-audit-claude.md`.

## 4. Cleanup (always)

```bash
$S/mdpro.sh normal --yes  # restart WITHOUT the DevTools port, maximized
$S/mdpro.sh cleanup        # backstop: unregister any mdpro-audit-* task (runi.ps1 already removes its own)
```

- **Discard** the drafts the run created (Recover drafts → Discard).
- **Restore** what you changed: font size, theme, and a hidden window (`showall`).
- **Left behind:** `%WIN_DIR%` keeps the scripts, `fx\`, `out\` and PNGs. No scheduled task
  stays registered: `runi.ps1` unregisters each one when it finishes, `ui-run.ps1` deletes
  `steps.json` / `ui-out.json`, and `mdpro.sh` runs `cleanup` on exit. Delete full-screen shots
  right away.
- **Deleting the folder itself** is a rule-25 action: ask first.
