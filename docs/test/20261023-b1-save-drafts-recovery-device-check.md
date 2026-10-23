# Device check B1: save, drafts and recovery, Mac mini, 2026-10-23

Committed by herdr-delegator from the tester's report. Tester: gpt-imple-3, through Codex Computer Use (user, 2026-10-23:
「已经完成还未device test的，交给 gpt-imple-3 进行device test，之后写测试报告」). Build: verify worktree of master
`ed958b26`, launched by exact path; every launch was checked by process path and `app.ready` `releaseId:"unknown"`.
A first run that tested a v0.3.5 release by mistake was voided and is not used here. Evidence stays on the mini under
`~/.mdpro-redesign/device/B1-evidence/`.

## Delegator's check against the cards

| Item | Tester | Delegator | Why |
|---|---|---|---|
| D290 | PASS | **PASS** | `file.save.recreate_choice` cancel and original for both `mv` and `rm`; no `file.save` success before the choice |
| D255-WI-3d Save As | PASS | **PASS** | new path, open-target and symlink refusals (`reason:"already_open"`), deleted original reaches the panel, cancel writes nothing, target hashes unchanged |
| D214 | PASS | **PASS** | undo-to-saved clears dirty in both modes; Ignore then undo stays dirty |
| D163 | PASS | **PASS** | `file.save` fail `permission denied`, dirty kept, bytes unchanged |
| D299 | FAIL | **PARTIAL: merge PASS, refusal NOT EXERCISED** | clean merge (`merged-into-clean`) and dirty collision (`collision-dirty`, protected move) passed; the other-window refusal / Keep for later and `file.draft.rekey` were not reached. A missing proof is NOT EXERCISED, not FAIL (rule 70 § Device-check batches). New finding D315 (stale Recovery row after a protected move) |
| D291 + D273 step 5 | FAIL | **FAIL** | WYSIWYG 3/3 first keys landed; Source 1/3 (two lost, one on the matching-background-tab path). Registered as D314 |
| D241 | NOT EXERCISED | **NOT EXERCISED** | zero `ui.recovery.held` / `ui.mcp_confirm.held` |

---

## Tester's report (verbatim)

# Device report B1 rerun — save, drafts and recovery

Date: 2026-10-23 (Asia/Shanghai)  
Run window: 15:19–15:42  
Tester: `gpt-imple-3`  
Counts: **PASS 4 / FAIL 2 / NOT EXERCISED 1**

## Build and identity

- SHA: `ed958b26f69b7b8a0d8c1ea608056d5f6dbdbf6d`
- App: `/Users/jack/Documents/mac-app/mdpro-wt/verify-ed958b2/src-tauri/target/release/bundle/macos/mdpro.app`
- Binary: `Contents/MacOS/tauri-app`
- The existing bundle was used; it was not rebuilt.
- Every launch used the exact app path with `open -n` / `open -g -n -a <exact-path>`.
- Twelve launch receipts are under `B1-evidence/logs/launch-01-*` through `launch-12-*`. Each process receipt contains exactly one mdpro process and it is under `verify-ed958b2`; each matching newest `app.ready` has the same pid, `appVersion:"0.3.5"`, `buildId:"unknown"`, and `releaseId:"unknown"`.
- Example first receipt: pid `50356`, `2026-10-23T15:19:05.948+08:00`. Final receipt: pid `93849`, `2026-10-23T15:41:18.733+08:00`.
- The void installed-app run remains under `B1-evidence/void-run-0.3.5/` and was not used for any verdict below.

## 1. D290 — PASS

I exercised separate `mv` and `rm` cases on open dirty fixture files. In both cases I chose Ignore after the watcher warning, pressed Cmd+S, saw the three-way recreate / Save As / cancel choice, chose Cancel, and verified that the unsaved edits and dirty mark remained. I then repeated the save and chose the original path.

Decisive log lines include:

```json
{"ts":"2026-10-23T15:20:09.869+08:00","event":"file.save.recreate_choice","status":"cancel","context":{"choice":"cancel","outcome":"cancelled"}}
{"ts":"2026-10-23T15:20:18.524+08:00","event":"file.save.recreate_choice","status":"success","context":{"choice":"original","outcome":"written"}}
{"ts":"2026-10-23T15:20:55.473+08:00","event":"file.save.recreate_choice","status":"cancel","context":{"choice":"cancel","outcome":"cancelled"}}
{"ts":"2026-10-23T15:21:03.444+08:00","event":"file.save.recreate_choice","status":"success","context":{"choice":"original","outcome":"written"}}
```

There is no `file.save` success between either initial Cmd+S and its cancel choice. Full slice: `B1-evidence/logs/D290-save-events.jsonl`. Screenshots: `D290-mv-recreate-choice.png`, `D290-mv-cancel-retains-edits.png`, `D290-rm-recreate-choice.png`, `D290-rm-cancel-retains-edits.png`.

## 2. D299 — FAIL

The clean same-id merge passed: Recovery merged into the clean tab and the immediately typed `Q` appeared in the recovered body.

```json
{"ts":"2026-10-23T15:28:00.044+08:00","event":"file.draft.recover.merge","status":"success","context":{"documentId":"50aeee1996dc5fe","draftId":"50aeee1996dc5fe","outcome":"merged-into-clean"}}
```

The dirty collision also preserved both buffers. A same-id autosave first moved the protected recovery bundle (`sourceId:59204e185dcfa011` to `movedId:ea33cc17-c374-4344-8ca1-657e280f2017`). Two subsequent saves of the dirty tab left that moved draft present (`D299-protected-survives-save.txt`). On the following launch, Recovery opened the original `RECOVERED DIRTY DRAFT` in a separate tab beside the dirty MCP-edited same-path tab; the immediate `W` landed in the recovered text.

```json
{"ts":"2026-10-23T15:32:17.678+08:00","event":"file.draft.protected_move","status":"success","context":{"movedId":"ea33cc17-c374-4344-8ca1-657e280f2017","sourceId":"59204e185dcfa011"}}
{"ts":"2026-10-23T15:34:57.023+08:00","event":"file.draft.recover.merge","status":"success","context":{"documentId":"0133bcdd-a446-474b-ba42-2636a87dd8f2","draftId":"ea33cc17-c374-4344-8ca1-657e280f2017","outcome":"collision-dirty"}}
```

However, the required other-window refusal / Keep-for-later path was not reached, and this run produced neither `dialog.recovery.keep_for_later` nor `file.draft.rekey`. Because required D299 proof is missing, the item is FAIL rather than PASS. Full slice: `B1-evidence/logs/D299-recovery-events.jsonl`. Screenshots: `D299-clean-merge-D291-wysiwyg-try1.png`, `D299-collision-dirty-two-tabs.png`, `D299-dirty-collision-preserves-recovered.png`.

## 3. D291 + D273 step 5 — FAIL

WYSIWYG was run three times. The immediate keys were visible in all three runs (`Q`, `Q`, `W`); the clean case and the final true dirty-collision case are captured in the screenshots above.

Source was run three times with `defaultViewMode:"source"` during the temporary test configuration:

1. Same-id clean merge: PASS — immediate `1` appeared at the start of the recovered source (`D291-source-try1.png`).
2. Same-id clean merge: FAIL — immediate `2` did not appear (`D291-source-try2-key-lost.png`).
3. Matching-background-tab path: FAIL — Recovery selected the background target and left the foreground control unchanged, but immediate `3` did not appear (`D291-source-background-try3-key-lost.png`).

The merge log proves all three Source recovery paths resolved rather than hanging; the last two are at 15:40:18.239 and 15:41:22.573 in `B1-evidence/logs/D291-merge-events.jsonl`. Result: WYSIWYG 3/3 keys landed; Source 1/3 keys landed. This is a device regression beyond the previously documented WYSIWYG-only D300 expectation.

## 4. D241 — NOT EXERCISED

I launched with surviving drafts repeatedly and sent MCP inserts during the recovery interval, including two explicit attempts while Recovery was on screen. The requests returned HTTP 200 immediately because the document owner was still treated as focused; no MCP confirmation prompt was created. I also did not win the Settings-at-startup race after the mandatory identity check.

The log slice contains eight `ui.recovery.released` lines and **zero** `ui.recovery.held` / `ui.mcp_confirm.held` lines. Per the brief, absence of `ui.recovery.held` makes this probe NOT EXERCISED; neither theme can be claimed. Evidence: `B1-evidence/logs/D241-admission-events.jsonl`, `D241-launch4-mcp-response.txt`, `D241-mcp-pending-response.txt`.

## 5. D255-WI-3d Save As — PASS

- New path: Save As wrote `save-as-new.md`, rebound title/path, and cleared dirty state.
- Open target: Replace was refused with “the selected file is already open in mdpro; your edits were not saved.”
- Symlink alias: the same refusal occurred.
- Deleted original: Save As still opened the native panel.
- Cancel: wrote no output.
- Target hashes before, after both refusals, and final are identical.

Decisive log sequence in `B1-evidence/logs/D255-save-as-events.jsonl`: Start/Success at 15:21:18–15:21:24; `reason:"already_open"` failures at 15:21:54 and 15:22:12; final cancel at 15:22:36. Screenshots: `D255-save-as-new-path.png`, `D255-open-target-refused.png`, `D255-symlink-target-refused.png`, `D255-deleted-original-save-panel.png`.

## 6. D214 re-smoke — PASS

In Source and WYSIWYG, typing made the tab dirty and undo back to the saved text cleared the dirty mark. In WYSIWYG, after an external disk edit I chose Ignore; undo returned the visible editor to the old text but correctly left the tab dirty, and closing prompted for unsaved changes. I chose Keep editing, then saved and closed cleanly.

Evidence: `B1-evidence/logs/D214-events.jsonl`; screenshots `D214-source-dirty.png`, `D214-source-clean-after-undo.png`, `D214-wysiwyg-dirty.png`, `D214-wysiwyg-clean-after-undo.png`, `D214-ignore-undo-stays-dirty.png`, `D214-ignore-close-prompts.png`.

## 7. D163 re-smoke — PASS

With the fixture directory read-only, Cmd+S showed the full permission-denied toast, the dirty mark remained, and the file hash was unchanged. After restoring directory permissions, Cmd+S succeeded and cleared dirty state.

```json
{"ts":"2026-10-23T15:24:53.622+08:00","event":"file.save","status":"fail","context":{"filePath":"/Users/jack/.mdpro-redesign/device/B1-evidence/work/readonly/d163.md"},"error":"permission denied: /Users/jack/.mdpro-redesign/device/B1-evidence/work/readonly/d163.md"}
```

Evidence: `B1-evidence/logs/D163-permission-events.jsonl`, `D163-before.sha256`, `D163-after-failed.sha256`; screenshots `D163-permission-denied-toast.png`, `D163-saved-after-restore.png`.

## Cleanup

- mdpro pid `93849` was quit; `B1-evidence/logs/final-mdpro-processes.txt` records no running mdpro process.
- Only drafts whose `originalPath` was under this run's `B1-evidence/work/` were removed. `final-draft-inventory.txt` is empty after cleanup; the pre-run real draft inventory was empty.
- The read-only fixture directory was restored to mode 755.
- `/Users/jack/.mdpro/config.json` was restored from `B1-evidence/config-backup/config.json`; `cmp` succeeded (`logs/config-restore-cmp.txt`).
- The verify worktree and app bundle were left in place for B2.
- The owned GUI lock (`session=gpt-imple-3`, pid `41552`) was released; `/Users/jack/.cache/desktop-gui.lock` no longer exists.

## Surprises

- A same-id autosave correctly preserved an unrecovered bundle with `file.draft.protected_move`, but the already-rendered Recovery row still referred to the source ID. Recovering that stale row opened the newly written same-id autosave; the original protected bundle appeared on the following launch. No data was lost, but the intermediate row did not continue to identify the pre-existing bundle.
- Source first-key routing failed in two of three runs, including the matching-background-tab path. The foreground control remained byte-for-byte/visually unchanged, so the key was dropped rather than routed to the wrong tab.
