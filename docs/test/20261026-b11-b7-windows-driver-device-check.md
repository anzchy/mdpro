# Device check B11: B7 Windows driver live proof (win-desktop, 2026-10-26)

Committed by herdr-delegator from the tester's report (gpt-auditor, Codex device pane with `-s danger-full-access`). Build: GitHub
Actions `build-windows` run 40280246278 on master `d7142e09` (app code equal to `636116c3`, where B7 landed, PR #540); installer
SHA-256 equal on Mac and PC. Clearances, quoted: install/restart 「yes」; picsee 「Yes, picsee is paused (Recommended)」; de-DE removed from
the plan 「de-DE keyboard的测试移出test plan」 — no layout or language-list change was made. `app.ready` logged `releaseId:"unknown"`
(the dev build carries no release id: [D322](../plans/20260912-frontend-backend-sequencing-order.md#d322)), so the build was proved by
the installer and executable hashes. Evidence files stay in `~/.mdpro-redesign/device/B11-evidence/` (config snapshot stays on the PC).

## Delegator's check

| Item | Verdict | Note |
|---|---|---|
| Geometry | PARTIAL | At 270 %, Tauri outer bounds and Win32 rects matched exactly (tolerance 0) on one screen; no second monitor; identical-maximised NOT VERIFIED |
| Label → HWND, A/B Save | PARTIAL | Labelled Save changed only its own file each way, one `menu.action.dispatch` per label; wrong and closed labels aborted with no Save. Stale move within one run and identical-maximised NOT EXERCISED |
| Focus without Alt | PASS (success path) | B in front → labelled-A focus and chord edited only A; no Alt sent; B's menu not left open. Refusal path not reached (activation succeeded) |
| Mouse isolation | PARTIAL | A click aimed over B aborted `IDENTITY_POINT_OUTSIDE` before the down; a valid A click worked. Occlusion, popup hit and post-down relocation NOT EXERCISED |
| Physical key smoke | PASS | Existing layout only: `physicalChord` gave trusted `code:"KeyK"` / `"Digit1"` and the expected edits in A |
| Cleanup paths | NOT EXERCISED | No safe trigger without risking a stuck key or a drag |

What this enables: the driver can now bind a step to a labelled window and keep stationary Save, focus and key input in that
window, so the Windows menu batch (D261 per-window dispatch, MENU-M3a A/B state) can run on it. It does not by itself verify those
rows. Restoration: config and data restored from the snapshot and hash-checked, drafts zero before and after, the new build left
installed, GUI lock released.

## Tester's report (verbatim)

### B11 Windows driver handoff — 2026-10-26

Tester: gpt-auditor. Host: `win-desktop` (`DESKTOP-7576AM2`). Device run used SSH and the interactive-session driver; no repository files, PC language list, or de-DE layout were changed. GUI lock: B11, acquired before device input and released after cleanup. The TDD Guardian config loaded with zero errors/warnings; its code RED, coverage, mutation, and review stages do not apply to this device-only brief. The brief's six manual cases supplied the test matrix. No code was edited or committed.

| Item | Verdict | Proof |
|---|---|---|
| 1. Geometry baseline | **PARTIAL** | Current page scale 2.7. Tauri physical outer bounds A `111,111,1936,1373`, B `1950,100,3672,1286`; Win32 `GetWindowRect` yielded A origin `111,111`, size `1825×1262`, B origin `1950,100`, size `1722×1186`—exactly the same edges, tolerance 0 for these samples. Interactive `Screen.AllScreens` reported one screen, `DISPLAY1`, bounds `0,0,2560,1440`; secondary monitor NOT EXERCISED. B was partly beyond the current screen, so full side-by-side visibility was not proved. Identical maximised bounds NOT VERIFIED. |
| 2. Label → HWND A/B | **PARTIAL** | Both distinct-rect title challenges bound and saved the intended fixture, with one `menu.action.dispatch` for its label and only its hash changing. Unknown label and closed B label returned `IDENTITY_INVALID: CDP answer cannot authorize native input`, with no further Save log or hash change. The intended stale-move-in-one-run and equal-maximised cases were NOT EXERCISED. |
| 3. Focus without Alt | **PASS for exercised path** | With B foreground, labelled-A `focus` returned `focused` with no Alt injection. After B was foreground again, labelled-A logical `chord ctrl+shift+k` changed only A's Markdown (`0D2D…` → `CD2D…` after Save); B remained `53BA…`. B window screenshot (`B11-evidence/B11-B-after-focus.png`) shows no native menu left open. Refusal path NOT EXERCISED because activation succeeded. |
| 4. Mouse isolation | **PARTIAL** | With A foreground, labelled-A `clickat (2200,500)` (over B) aborted `IDENTITY_POINT_OUTSIDE` before down. A valid labelled-A `clickat (1100,600)` succeeded. B hash stayed `53BA…`. An A point covered by B, menu-popup hit, and post-down relocation were NOT EXERCISED. |
| 5. Physical key smoke | **PASS** | Existing HKL `0000000008040804` only. Labelled-A `physicalChord ControlLeft+ShiftLeft+KeyK` generated trusted `keydown` `KeyK` with `code:"KeyK"`, then transformed A's paragraph into a fence. `physicalChord Digit1` generated trusted `key:"1", code:"Digit1"` and saved `B11 A saved1` inside the fence. Final A hash `8A3A…`; B stayed `53BA…`. Logical `chord ctrl+shift+k` was the control on the same A document. No German-layout case was run (user ruling). |
| 6. Cleanup paths | **NOT EXERCISED** | Forcing mid-key or post-down identity loss risks a held key/button or a drag into A; no safe trigger was established. The unlabelled `filedialog` path was encountered during setup and correctly aborted `IDENTITY_DIALOG_AMBIGUOUS` before Enter/Esc while two mdpro windows existed; this does not prove release-recipient routing. |

## Build and isolation

- GitHub Actions `build-windows` run `40280246278`: success, head `d7142e09e1e4b1eb2444b7983f5b73939e60fb6d`; artifact id `12632505135`, name `mdpro-windows-0.3.5`, artifact size 7,230,460 bytes.
- Downloaded installer mdpro_0.3.5_x64-setup.exe (`B11-evidence/installer/mdpro_0.3.5_x64-setup.exe`), 7,247,472 bytes. SHA-256 on Mac and PC: `D672DB205DB58051D93A12B13043766E4A7700CE62ED51F2BB9B5C07956DEC95` (equal). SSH transfer used `scp -o BatchMode=yes` as permitted by the B11 brief, with normal host-key checking. An initial SSH stdin stream stalled at 167,936 bytes; it was stopped and its partial destination was not used.
- Before: mdpro not running; installed `D:\programs\mdpro\tauri-app.exe` version `0.3.5`, SHA-256 `3D53788A66F4C6C15D3C363DE831CF066E2074B6DF81E6EAAF7BED143DB20442`, UTC timestamp `2026-10-20T02:53:54Z`. Both legacy and roaming draft folders had zero files. The 0.3.5 release rollback installer remains at `C:\Users\jack\Downloads\mdpro_0.3.5_x64-setup.exe`, SHA-256 `480EB2EED02F2296102616FAE729DF5313FCFA00B700FC54DD3DEEBC925DAF07`.
- Snapshot while mdpro was closed: `C:\Users\jack\mdpro-audit\snap\B11-20261026\` (`dot-mdpro`, excluding log, and `appdata-mdpro`). Snapshot config hash `6278C048B6B8457F722F59DBC8B36E2BC77310F242DF8D67D338D5056B97D4DA`. The snapshot stays on the PC; it was not pulled because it may hold credentials.
- Silent installer `/S /D=D:\programs\mdpro` exited 0. After: executable version `0.3.5`, SHA-256 `4FE0F1562C2F3824F7D8229C580DC86923C0F7BFE928540CFFB76944430BAEC2`, UTC timestamp `2026-10-26T06:40:52Z`. `app.ready` at `2026-10-26T15:23:00.218+08:00` gave `appVersion:"0.3.5"`, `platform:"windows"`, `pid:18188`, `releaseId:"unknown"`; the installer and executable hashes are the build identity proof.

## A/B identity and file-hash sequence

A = label `main`, CDP page `9873430232F789B633D05EEF08E185A7`, HWND `5636524`, pid `18188`. B = label `mdpro-5a1e924c-0ef2-447a-ba58-b1b85a58db95`, CDP page `476E2281FE05BB9CAEA71321B8F4AD24`, HWND `3804494`, pid `18188`. The native `bound label=… hwnd=… pid=… rect=… foreground=…` lines on each labelled action are the fresh title-challenge results. B was foreground before the first A Save and before A focus/chord; A was foreground before the B Save. The challenge restored its temporary title each time.

Copied source fixture: `tests/manual-fixtures/d173-two-windows.md`. PC copies under `C:\Users\jack\mdpro-audit\fx\B11\`; no original fixture was edited.

| Checkpoint | A SHA-256 | B SHA-256 |
|---|---|---|
| Before either Save; both dirty in their own editor | `340AF209451DC2286FFC0D0CD4DB3008CFEF22EAEA82F8B564D8F98A4FDA15EF` | same |
| After labelled A Save | `0D2D212C87AA2E15B57AD24E94CB54EC374B7C415558FA7253B9933B903368C1` | `340AF209451DC2286FFC0D0CD4DB3008CFEF22EAEA82F8B564D8F98A4FDA15EF` |
| After labelled B Save | `0D2D212C87AA2E15B57AD24E94CB54EC374B7C415558FA7253B9933B903368C1` | `53BABA9021B745A82A350BD70D066B81BF931756F866A7C051EED7A8D1BD24DC` |
| After labelled-A logical chord and Save | `CD2DD5C9920064C79673928F110FF81EF440CB63392074C8778EFD2BA4121308` | unchanged `53BABA…` |
| After physical chord, printable key, Save; after wrong-label/mouse/stale aborts | `8A3A4DA40C0A5DAD18DD4ACF683216BEAE60906302C6B1E2FE692AE1744406E0` | unchanged `53BABA…` |

Decisive log lines: `15:30:44.778 menu.action.dispatch success {action:"file.save",target:"main"}`, followed by `15:30:44.789 file.save success …B11-A.md`; `15:31:03.702 menu.action.dispatch success {action:"file.save",target:"mdpro-5a1e…"}`, followed by `15:31:03.715 file.save success …B11-B.md`. Full post-mark log: B11.jsonl (`B11-evidence/B11.jsonl`). No Save dispatch followed the wrong or closed label attempts.

## Setup aborts and cleanup

- In an early two-window setup, native File → Open produced a dialog but `filedialog` refused it with `IDENTITY_DIALOG_AMBIGUOUS`. Window titles, CDP identities, and both unchanged file hashes were inspected. A temporary exact-HWND dialog closer removed that test dialog; B's fixture was then opened by the app's `open` route, which created its own third window. The unused blank window was closed before A/B checks. No user document was opened.
- One parallel read-only `menus` probe timed out (`no ui-out.json after 90 s`). The next actions inspected the window list, each editor, and both file hashes; no mutation was repeated. Subsequent native calls were sequential.
- After the stale-label abort, an interactive-state check found mouse buttons and Shift/Ctrl/Alt all up (`vk1`, `vk2`, `vk16`, `vk17`, `vk18` false). The task's own PowerShell window was foreground during that check, so its foreground title is not evidence of the app foreground.
- Captured A page before shortcut (`B11-evidence/B11-A-before.png`) and B native window after focus/chord (`B11-evidence/B11-B-after-focus.png`). No full-screen image was retained. The local temporary scripts used for dialog and state inspection are in this evidence folder; they are not product changes.
- mdpro was closed (process count 0). `robocopy /MIR` restored the snapshot: config hash equal to snapshot, six `dot-mdpro` non-log files hash-matched; roaming appdata held zero files before and after; both draft counts zero; `mdpro.log` survived. The new executable remains installed with the after hash above. `mdpro.sh cleanup` left no `mdpro-audit-*` scheduled task. The GUI lock was released. The partial installer stream file on PC was left in `mdpro-audit` because the interrupted PowerShell process held it; it was never run. The separately verified `B11-installer-copy.exe` remains there.

## Limits and rejected approaches

The B11 run does not clear the older card's MENU-M3a or D261 complete-device matrix. It establishes this brief's stationary A/B Save, focus, and key routes only. The all-paths release-recipient proof, stale move during one invocation, full dual-monitor geometry, and identical-maximised discriminator remain open. I did not force post-down relocation or a mid-chord identity loss because a stuck input or unintended drag could affect the scratch editor. I did not alter the PC's language list.
