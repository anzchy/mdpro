# W036: v0.3.6 Windows menu batch, device check (2026-10-28)

**Build:** `build-windows.yml` run 40658985158 on master `8aeb1c19` (artifact `mdpro-windows-0.3.5-dev-8aeb1c1`), installed on
`win-desktop`; every launch `app.ready.releaseId = 0.3.5-dev@8aeb1c1956643146a6e7762f16307dbb054ddad2`. App code on master
did not change after this build (`8aeb1c19..568483a7` touches no `src/` or `src-tauri/`).
**Tester:** gpt-auditor in a device pane (rule 71), brief `~/.mdpro-redesign/device/brief-W036.md`, cards
`docs/test/cards/{D261,MENU-D261-WI-1,MENU-M3a,MENU-M7,D50,D255-windows,D264}.md` at `568483a7`.
**Clearances, quoted (user, 2026-10-28):** 「Yes, install and restart」; de-DE 「Allow, restore after (Recommended)」.

## Result

| Card | Verdict | Why |
|---|---|---|
| D261 | NOT EXERCISED | test driver: native file dialog refused as `IDENTITY_DIALOG_AMBIGUOUS`, so the two-window setup failed ([D336](../plans/20260912-frontend-backend-sequencing-order.md#d336)) |
| MENU-D261-WI-1 | NOT EXERCISED | same run as D261 (D336) |
| MENU-M3a | NOT EXERCISED | not started after the same setup failure (D336) |
| MENU-M7 | PARTIAL | most row states, F6, Reset, cross-window pending text observed; full row comparison and post-restart activation not proved |
| D50 | **FAIL** (known) | real Ctrl+Shift+L again reaches no shortcut handler; same-route Ctrl+Shift+N and Ctrl+S pass. Re-confirms the 2026-10-20 W-1a FAIL; no fix had landed, so this is no escape |
| D255-windows | NOT EXERCISED | test driver: `ui.sh` timed out after 90 s on the first selection step ([D337](../plans/20260912-frontend-backend-sequencing-order.md#d337)) |
| D264 | NOT EXERCISED | test driver: de-DE added to the language list, but the mdpro thread's HKL never became `00000407`, so no AltGr was sent ([D338](../plans/20260912-frontend-backend-sequencing-order.md#d338)). **D264 is not named fixed in the v0.3.6 notes on this run** |

## Delegator check against the cards

- Build identity: workflow `head_sha`, installer SHA-256 equal on Mac and PC, installed executable hash and timestamp, and
  `releaseId` on all three launches match the brief. Display 270 %, `innerWidth` 1423 after maximize.
- D50's FAIL meets the card's failure condition with its required same-route control (Ctrl+Shift+N logged
  `file.new_window` and opened a window; Ctrl+S logged `ui.shortcut.trigger` and `file.save`). Steps 2 and 5 were not
  completed; they are not needed for the FAIL.
- The five NOT EXERCISED cards stopped in the driver before any product step was judged; none is counted as a product
  result. `IDENTITY_DIALOG_AMBIGUOUS` was already seen during B11's setup (`20261026-b11-b7-windows-driver-device-check.md`).
- **Final config hash differs from the snapshot**, and that is accepted: the last normal-mode launch migrated the restored
  pre-v2 `config.json` to `keyboardShortcutsVersion` 2, which is the app's normal first-launch migration (M1b) that any
  launch of this build performs. The diff is confined to `keyboardShortcuts` and `keyboardShortcutsVersion`; the
  test-assigned `Ctrl+Shift+C` is absent. The language list, fixtures and directory listings match the pre-run state.
- The PC snapshot `C:\Users\jack\mdpro-audit\snap\W036` is kept until the rerun (user 「Keep until the rerun」).

## Rulings (user, 2026-10-28)
- Rerun: 「Fix driver, then rerun (Recommended)」: D336–D338 are fixed in one Windows-tooling item, then the five unexercised
  cards and MENU-M7's remainder run again. The 0.3.6 Windows menu batch is not passed until then.
- D50: 「Fix in 0.3.6」.

## Tester report (verbatim)

# W036 Windows menu batch — device handoff

Tester: `gpt-auditor`, `win-desktop` (`DESKTOP-7576AM2`), 2026-10-28. Result is **incomplete**: one confirmed product failure, one partial card, and five cards not exercised. No repository file was edited, committed, or posted to a PR. No Mac desktop GUI was opened.

## Build and authority

| Evidence | Observed |
|---|---|
| Workflow | `build-windows.yml` run `40658985158`, conclusion `success`, `head_sha=8aeb1c1956643146a6e7762f16307dbb054ddad2` |
| Artifact | `mdpro-windows-0.3.5-dev-8aeb1c1`, reported size 7,240,999 bytes; downloaded `mdpro_0.3.5_x64-setup.exe` |
| Installer SHA-256, Mac and PC | `2B5D6A7B740F01501E5A06BBC668AFB59E575949E6A4632ACC1ED9205F8088D5`, equal |
| Installed executable before | `D:\programs\mdpro\tauri-app.exe`, version `0.3.5`, SHA-256 `4FE0F1562C2F3824F7D8229C580DC86923C0F7BFE928540CFFB76944430BAEC2`, timestamp `2026-10-26T06:40:52Z` |
| Install | Silent `/S /D=D:\programs\mdpro`, exit `0` |
| Installed executable after | Version `0.3.5`, SHA-256 `1C46E3F2EC10745F1BF0F5792C9F32764908A3C2C3B9D02E9F96149B7818FC81`, timestamp `2026-10-28T08:57:56Z` |
| Launch identity | First debug `app.ready` at `19:24:20`, second debug at `19:57:40`, final normal at `20:13:28`: all `releaseId=0.3.5-dev@8aeb1c1956643146a6e7762f16307dbb054ddad2` |
| Display | `devicePixelRatio=2.6999998092651367` (270%); after maximize, `innerWidth=1423` |
| Host key | Stored `win-desktop` ED25519 fingerprint `SHA256:XGEIP0iWtBBw9XQgnKaK1nmOMHQuU/xxfqQRw/TnfzA` matched the skill reference |

The brief quotes the user's clearance to install and restart (`Yes, install and restart`) and to add de-DE temporarily (`Allow, restore after (Recommended)`). The GUI lock was not taken because this batch used only the Windows PC. The TDD Guardian config loaded with no errors or warnings. Its plan, RED, coverage, mutation, review and commit-gate stages do not apply to this device-only brief: no implementation work or test source was changed, as the brief expressly states.

## Card verdicts

| Card | Verdict | Decisive proof / limit |
|---|---|---|
| D261 | 未验证 / NOT EXERCISED | A/B fixture setup could not be completed through the Windows file-dialog driver. A File → Open dispatch reached `main`, but `filedialog` rejected `IDENTITY_DIALOG_AMBIGUOUS`; no Save, Highlight, Table, Save As, or close-race verdict. The macOS no-focused-window fallback is 平台不适用 / N/A. |
| MENU-D261-WI-1 | 未验证 / NOT EXERCISED | Shared A/B attempt with D261. No labelled two-window Save, focus race, or switch-away-and-back Table submission was completed. The no-focused-window fallback is N/A on Windows. |
| MENU-M3a | 未验证 / NOT EXERCISED | No per-window mode/menu-state sequence was run after the A/B dialog setup failed. Late-report, install-failure, and modal refusal subcases are also unexercised. The Windows no-focused-window case is N/A. |
| MENU-M7 | 部分 / PARTIAL | Settings DOM, Windows labels, F6 recording, saved pending text in a second window, Reset to `<unassigned>`, and unavailable-row conflict exclusion were observed. Full row-by-row comparison and exact final config-hash restoration did not pass. |
| D50 | Windows 不通过 / FAIL | Real `Ctrl+Shift+L` from editor focus produced no `ui.shortcut.trigger` and did not change the visible sidebar. Same-route real `Ctrl+Shift+N` logged `file.new_window` and created a second window. Real `Ctrl+S` also logged and saved. Remaining shortcut rows were not completed. |
| D255-windows | 未验证 / NOT EXERCISED | Fixture opened and Source mode selected, but the real-input driver timed out on the first selection setup. No command/effect/undo pair or Save As/MRU/fullscreen route was judged. German steps were not attempted without verified de-DE HKL. |
| D264 | 未验证 / NOT EXERCISED | de-DE was added to the language list, but the target mdpro thread reported HKL `0000000008040804`, then `0000000004090409`, never de-DE. No `physicalChord` was sent and no AltGr product verdict is possible. **Do not name D264 fixed in v0.3.6 release notes on this run.** |

## Per-card steps and evidence

**D50.** Opened only scratch `fx\w036\d50.md` in `main`, inserted `W036 `, then used a real `clickat` and real `Ctrl+S`. At `19:25:30.208`, `ui.shortcut.trigger` succeeded for `file.save`; `file.save` succeeded at `19:25:30.232` with 95 bytes. The sidebar existed before real `Ctrl+Shift+L` and remained visible afterward; the marked log slice contains no sidebar shortcut event. At `19:26:17.845`, real `Ctrl+Shift+N` emitted `file.new_window`; `window.create success` followed at `19:26:17.975`. The driver returned `IDENTITY_REJECTED` after the new window took focus, so the effect was reconciled from the log and window list; no chord was replayed. The new clean window closed with `window.close success` at `19:27:23`. Steps 2 and 5 were not completed. Raw log: `~/.mdpro-redesign/device/W036-evidence/D50.jsonl`.

**MENU-M7.** Real native Preferences route was attempted; the driver timed out, but `ui.menu.select success` for `menu.file.preferences` and `preferences.read success` showed Settings opened. In Keyboard Shortcuts, `preferences.read success` with `purpose:"settings_shortcuts"` occurred at `19:31:50.688`. The DOM showed FILE/EDIT/PARAGRAPH/FORMAT/VIEW/TABLE/WINDOW groups, Replace, unavailable rows with spans and no buttons, WYSIWYG-only and Source-only capability text, fixed/system spans, F3/Shift+F3 second keys, Windows Ctrl labels and F11. A real F6 changed Delete Word's recorder from `Press keys...` to `F6` and displayed the expected conflict with Cycle View Mode's fixed F6; no document command was observed. A nonconflicting `Ctrl+Shift+P` then saved with `settings.shortcuts.save` and `preferences.set success` at `19:34:25`. Reopened Settings showed `Active: Not set · after restart: Ctrl+Shift+P`; a second window showed `Source` with `Active: Not set · after restart: Ctrl+Shift+C` after that test binding was saved at `19:38:57`. Reset returned Delete Word to `Not set`, and on-disk config held `<unassigned>`. Assigning `Ctrl+Shift+C` to Source showed no conflict while Copy As Markdown remained `Not available` and non-recordable. Full exhaustive row grouping, actual post-process-restart key activation, and final hash equality remain unproved. Raw log: `~/.mdpro-redesign/device/W036-evidence/MENU-M7.jsonl`.

**D261 / MENU-D261-WI-1.** Created and inventoried separate A/B fixture copies. A was `main`; a second clean window received the Settings cross-window inspection. The external `open` operation, despite focusing that second window, routed `d261-b.md` to a **new third window** (`file.open.route outcome:"new-window"` at `19:46:10`), so the unintended empty window was closed normally. The fixture window and `main` were moved to distinct physical bounds, but A still held `d50.md`. A labelled `menuclick` File → Open reached `menu.action.dispatch success` with `action:"file.open", target:"main"` at `19:49:17`, followed by `ui.menu.select success` and `file.open start`; the combined driver call timed out before completing the dialog. A diagnostic Ctrl+O opened another dialog. The driver rejected subsequent `filedialog` with `IDENTITY_DIALOG_AMBIGUOUS`; both dialogs were cancelled/closed during recovery and `file.open cancel` was logged at `19:54:18`. No A/B mutation was judged. Shared raw logs: `~/.mdpro-redesign/device/W036-evidence/D261.jsonl`, `~/.mdpro-redesign/device/W036-evidence/MENU-D261-WI-1.jsonl`.

**MENU-M3a.** Not started after the native-dialog setup failure. `~/.mdpro-redesign/device/W036-evidence/MENU-M3a.jsonl` is the shared setup interval, with no M3a command/effect pair; it is not pass evidence.

**D255-windows.** Reopened the locked build after a config restore, opened `d255-a.md` (`file.open success` at `19:58:45`), and switched to Source (`view.mode.change success` at `19:58:59`). A real `clickat` plus `Ctrl+A` did select Source text, but `ui.sh` returned `TIMEOUT: no ui-out.json after 90 s`; the orphaned run-owned driver process was stopped only after checking the editor state. No listed D255 chord was attempted or counted. Raw log: `~/.mdpro-redesign/device/W036-evidence/D255-windows.jsonl`.

**D264.** The pre-run language list was exported to `snap\W036\languages.xml` on the PC. Adding `de-DE` yielded `0407:00000407`. Running the prior sitting's `kbl.ps1` through the interactive driver did not produce a new `kbl.log` line. A labelled `layout` read returned `0000000008040804`; after a Windows layout-switch attempt it returned `0000000004090409`. Because `00000407` never became the target-thread HKL, no AltGr key was injected. Raw log: `~/.mdpro-redesign/device/W036-evidence/D264.jsonl` (app events only; language-list and HKL evidence is recorded here).

## Cleanup and remaining discrepancy

- All test windows were closed through app close paths. The final `mdpro.sh normal --yes` exited `0`: mdpro is running in normal mode, maximized, with DevTools port 9222 closed. Final `app.ready` at `20:13:28` has the locked `releaseId`. `mdpro.sh cleanup` exited `0`; `scheduledTasks=0`.
- The exported language list was restored exactly by removing the added de-DE entry. After restoration, ordered language tags and input-method tips compared equal to the export (`languagesEqual=True`): `zh-Hans-CN`, `en-US`; no de-DE entry remains.
- All ten fixture files have their pre-run SHA-256 `F5517BCDDDEE83F4D4ADEA6EBCDA50FDF18F9E7AD959CC3FFD5A19EF2BE09D38`. Directory names, sizes, and timestamps compare equal to the pre-run inventory (`directoryEntriesEqual=True`). No Save As output was created. The snapshot config was restored while mdpro was closed and at that moment matched SHA-256 `6278C048B6B8457F722F59DBC8B36E2BC77310F242DF8D67D338D5056B97D4DA`.
- **Final config hash does not match the snapshot.** The normal-mode relaunch migrated the original config, which had no `keyboardShortcutsVersion`, to version 2. Final `config.json` SHA-256 is `70B9973F245F5604D4CD1D4D6ECA845903B0A325DFF2DB6737F66DA059442F4F`; the diff is confined to `keyboardShortcuts` and `keyboardShortcutsVersion`. The test-assigned `Ctrl+Shift+C` is absent from the final config; Source is `<unassigned>`. Restoring the old bytes again while mdpro is running would violate the config-isolation rule, and another launch would reapply migration. This final brief condition remains unmet and needs delegator ruling.
- The PC snapshot remains at `C:\Users\jack\mdpro-audit\snap\W036` and contains private MCP state. It was not copied to the Mac or attached. The config-isolation skill says to remove it after the run is recorded; recursive deletion requires rule-25 confirmation through the delegator. The run-created installer and driver scratch files remain under `C:\Users\jack\mdpro-audit\`; they do not affect mdpro's normal mode.

Rejected approaches: treating the external-open third window as the intended B would invalidate the clicked-window oracle; treating a timed-out or ambiguous dialog call as a product failure would lack a passing same-route control; injecting AltGr without the verified target-thread de-DE HKL would give a false D264 result; rewriting `config.json` while mdpro runs would violate the snapshot rule.
