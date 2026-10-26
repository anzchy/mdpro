# Device check B9: 0.3.6 patch-batch leftovers (Mac mini, 2026-10-26)

Committed by herdr-delegator from the tester's report (gpt-auditor, Codex device pane with `-s danger-full-access`; the
user: 「The batch of fixes still waiting on device tests on macOS, which goes to gpt-auditor」). Build: verify bundle of
master `9d38f8fb`, whose `src` and `src-tauri` equal master `0da402d5`; launched by exact path, one process. picsee paused by
the user's word: 「Yes, picsee is paused (Recommended)」. Drafts live in `~/Library/Application Support/mdpro/drafts/`.

## Delegator's check against the rows

| Item | Verdict | Note |
|---|---|---|
| D305 | **PASS** | Don't Save on the second window: two `draft.discard outcome:"deleted"`, the first window's control draft kept and the only one offered at relaunch |
| D299 | **refusal + Keep for later PASS; next-launch listing NOT EXERCISED** | Recover in the other window: `file.draft.recover fail {outcome:"in_use"}`, toast, Keep for later closed the row and the draft stayed on disk under its id, as ADR-0127 decision 3 says. The brief wrongly required `file.draft.rekey` (a delegator error, not a defect); the tester's FAIL is against that brief. The draft was then consumed by the D241 step, so its listing at the next launch was not shown |
| D241 | **MCP half PASS; startup Settings hold NOT EXERCISED** | an MCP insert from a background window logged `ui.mcp_confirm.held` while Recovery was up, then showed once after Recover; Reject returned 403 and nothing was inserted. Startup listing finished before Settings could open, so `ui.recovery.held` was not reached |
| M3b Source link-stale | **PASS** | `ui.menu.select editor.format.hyperlink` → `ui.link-modal.open {screen:"source"}` → switch to WYSIWYG → `ui.link-insert.cancel {reason:"view-mode-changed"}`; file byte-identical |
| D158 Source lint rows | **NOT EXERCISED, unreachable** | no key (M1b removed ⌘⇧M), no menu item, `Editor.tsx` `basicSetup.lintKeymap: false`; F8 opened nothing |

**Observation, not yet a defect:** during D305, closing the second window ended the whole app although the first window
was open. The log ends with `window.close_requested allowed_close`, `file.watch.*`, `ui.menu.build`; there is no `app.quit`
line and no crash report in `~/Library/Logs/DiagnosticReports/`. Needs a targeted repro.

## Tester's report (verbatim)

# B9 macOS device test — 2026-10-26

Build: `/Users/jack/Documents/mac-app/mdpro-wt/verify-9d38f8f/src-tauri/target/release/bundle/macos/mdpro.app` (brief: app code identical to master `0da402d5`). Test window 08:26–08:34 Asia/Singapore. Every counted launch used `open -n` with this full app path. The first counted launch had exactly one process, PID 6819 from that bundle, and `app.ready` at 08:26:43.273; later launches used the same bundle and had fresh `app.ready` lines. The initial already-running dtrack build was quit before the counted launch. Full selected JSON log: [B9-events.jsonl](B9-events.jsonl); launch receipt: [launch-01.txt](launch-01.txt).

| Item | Verdict | Proof |
|---|---|---|
| D305 | **PASS** | Both second-window drafts existed before Discard. `draft.discard` logged two `outcome:"deleted"` successes at 08:29:14.708–.709, then `window.close_requested` `allowed_close`. Only the first-window control draft remained. Relaunch listed one draft and showed only `B9-control.md`; [prompt](D305-prompt.png), [relaunch](D305-relaunch-control-only.png). |
| D299 other-window refusal / Keep for later | **FAIL against the B9 pass condition** | Recover in the caller window returned `OpenInWindow`, showed “This file is open in another window,” and Keep for later logged at 08:31:36.838; [refusal](D299-refusal.png). The draft remained on disk under the *same* id `298c30be48a3a487`, and no `file.draft.rekey` occurred. A later D241 subtest recovered that draft, so this run did not prove it was offered on a subsequent launch after Keep. The written B9 requirement says Keep rekeys; ADR-0127 decision 3 says it leaves the draft on disk, while `src/components/AppDialogs.tsx` only removes the row from this dialog. This may be a brief/implementation contract mismatch; the required log line is absent. |
| D241 startup Recovery waits | **NOT EXERCISED** overall | The startup Settings-over-Recovery hold and `ui.recovery.held` were not reached; initial `list_drafts`/admission finished before Settings could open. The other half did run: an MCP insert for the control document, sent while another window had focus, logged `ui.mcp_confirm.held` at 08:33:13.860 while Recovery remained visible; [held](D241-mcp-held-recovery.png). Recover merged the test-owned draft at 08:33:31.281, then the queued MCP confirmation appeared once; [released](D241-mcp-released.png). Reject returned HTTP 403 and preserved the recovered text. No full D241 verdict is claimed without the Settings hold, both themes, and `ui.recovery.held` followed by release. |
| M3b Source link-stale sub-step | **PASS** | In Source mode on `B9-source.md`, selected “Text only”, clicked Format → Link, then View → WYSIWYG while the Link modal was open. `ui.menu.select` for `editor.format.hyperlink` at 08:32:21.624 and `ui.link-modal.open {screen:"source"}` at 08:32:21.628 prove dispatch. `ui.link-insert.cancel {reason:"view-mode-changed",screen:"source"}` at 08:32:26.198 proves the stale callback was cancelled. The modal closed, and `B9-source.md` still matches its copied fixture byte for byte. |
| D158 Source lint rows | **NOT EXERCISED** | Source `B9-lint.md` opened in both themes. F8 on the focused Source editor opened no lint panel or rows; the menu has no lint item. The old Cmd+Shift+M route was removed by M1b, as B4 recorded; `Editor.tsx` has `basicSetup.lintKeymap: false`. Search panel and gutter looked consistent in [dark](D158-dark-search.png) and after a live switch to [light](D158-light-search-live-switch.png), but these screenshots do not prove the required lint rows, focused/unfocused selected row, or oneDark case. D158 has no proving log line; screenshots of those actual widgets are still owed. |

## Steps and decisive observations

1. Backed up `~/.mdpro/config.json` to [config.json.bak](config.json.bak). The actual drafts folder is `~/Library/Application Support/mdpro/drafts/` (the brief's `~/.mdpro/drafts/` does not exist). Its **before** listing was empty. Copied seven fixtures from `verify-9d38f8f/tests/manual-fixtures/` into this evidence directory; only those copies were opened.
2. D305: dirtied `B9-control.md` in the first window and `B9-discard-a.md` plus `B9-discard-b.md` in a second. Waited for autosave and inspected all three on-disk bundles: `298c30be48a3a487` (control, owner `main`), `abad2c749611c178` (A) and `cd6fbe8f4bc342ea` (B), both owned by `mdpro-eaa2d1ca-d71e-4e06-a8e5-32b91c0073f3`. Closed the second window and clicked **Discard changes** on these scratch copies. The two second-window bundles disappeared; the control bundle stayed. Relaunch `file.draft.list` showed `listed:1`, and Recovery offered only the control. The app process exited when the second window closed, unexpectedly; relaunch proof was taken after that exit.
3. D299: with Recovery pending in one window, launched the control copy through the app's external-open route, which opened it in another window. Recover in the first window produced `file.draft.recover fail {outcome:"in_use"}, error:"OpenInWindow"` at 08:31:34.174 and the reason toast. Clicked **Keep for later**. The dialog closed and the on-disk bundle was still present under its original id. Neither `file.draft.rekey` nor `file.draft.protected_move` appeared in the run log after Keep. The external-open setup used `open -a <exact bundle> <fixture copy>` and created a new window in the same verified process.
4. D241 MCP half: with the control file open under a Recovery prompt in its owning window, sent one local HTTP `/api/documents/{id}/insert` request from a background process while another window had focus. The request used `server.port` and `server.token` from the platform data dir without printing either value. `mcp.confirm start` and `ui.mcp_confirm.held` proved the request was received. Recovery stayed on screen; Recover merged `B9 CONTROL DIRTY` into its clean tab. The MCP prompt then appeared, was rejected, and the request returned 403. No `B9 MCP probe` text was inserted.
5. M3b and D158: opened Source and lint fixture copies through the app's file picker. Source Link cancellation and the two theme search screenshots are above. `B9-source.md`, `B9-lint.md`, `B9-discard-a.md`, and `B9-discard-b.md` still match their originals in `tests/manual-fixtures/` byte for byte.

## Cleanup and limitations

- **Drafts after quit:** empty. The one B9 control draft was recovered in the D241 subtest and its unsaved test copy was explicitly discarded at quit. No pre-existing draft was deleted; the before listing was empty.
- Quit mdpro after choosing **Discard changes** for the recovered B9 scratch document. No `mdpro.app/Contents/MacOS/tauri-app` process remained. Restored `~/.mdpro/config.json` from the backup; `cmp` exit 0.
- The input source was Doubao Pinyin at start and end. A Computer Use `Ctrl+Space` attempt did not change the selected source, so ABC was not established. The M3b command was driven through native menu clicks, and the mode change also used the menu; no text was typed through the IME for that substep. The D158 F8 attempt occurred with the Chinese IME selected. No input-source change needs restoring.
- All screenshots were saved in this evidence directory. No repository file was edited, no rebuild or commit was made.
