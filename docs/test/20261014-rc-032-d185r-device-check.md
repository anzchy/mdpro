> **Delegator ruling (2026-10-14).** R1 NOT EXERCISED: the open panel, `open -a` and the cold-start CLI all resolve the symlink; the only route left is a Finder drop, which needs a Finder Computer Use grant the delegator may not give (rule 70). D185 device status goes to the user. § 5 is registered as **D202** (outside v0.3.2). N2 and N3 are observations, not findings.

# 0.3.2 RC device check: D185 retry (alias spelling first), build `6768740`, 2026-10-14

Brief: `briefs/20261014-brief-rc-032-d185r.md`. Helpers and D185 steps come from `briefs/20261014-brief-rc-032.md` (part A). Runner: dtrack session on the mini, one sitting, 16:25 to 16:30 GMT+8. Changes from the brief, both from mdpro-delegator during the run:
- (a) The Computer Use grant is for **mdpro only**, and R1's Finder drag-drop fallback is dropped. If `open -a` resolves the alias, R1 is NOT EXERCISED and the run goes straight to R4.
- (b) The Recover drafts dialog at cold launch was recorded as a NOTE, then discarded (§ 5).

**Summary.** **R1 is NOT EXERCISED (every route resolved the alias).** `open -a "$APP" "$XA"` delivered the **real** path to the app. The first line the app logged, `file.open.external`, already has `filePaths` = `$XR`, and no line after the mark contains the `-link` folder. Following ruling (a), R2, D185-a and D185-b were not run; the run went to R4. **FAIL: 0. PASS: 0.** R4 restore and close: clean.

## 1. Build evidence

| Check | Result |
|---|---|
| `request_access` | the first request (`mdpro`, `Finder`) came back with an empty grant (the delegator denied it because it included Finder). Re-requested `com.mdpro.app` only: granted `mdpro` (`com.mdpro.app`) |
| other mdpro before launch | none (`pgrep -fl 'mdpro\|tauri-app'` listed only the `tmux` session and `claude --resume mdpro-remote`, which are not app processes) |
| binary mtime | `stat -f %m` = 1791958358 = `2026-10-14T14:12:38`, matches `BIN_MTIME` |
| binary sha256 | `388e6468075c966f1a258e33f853c2f580e3b64acab4174d564e1daf48bafc16`, matches `BIN_SHA` |
| worktree HEAD | `67687400d347da08e14edf02b5e9aab64578dfa5` |
| D185 commits | `cfa9503 0`, `8a19778 0` (both ancestors of HEAD) |
| fixture | `$FX/d185-alias-spelling.md` 59 B; copied to `$S/a185.md` (59 B) |
| input source | `ABC` |
| `$S` / `$L` | `S=~/.mdpro-redesign/dtrack/scratch/6768740-rc032-d185r`; `ln -s $S $L`; `readlink $L` printed `$S` |
| cold launch | `open -a "$APP"` (no file). PID **11064**, `ps` path `…/builds/6768740/mdpro.app/Contents/MacOS/tauri-app`. L18505 `app.ready` `releaseId:"0.3.2@67687400d347…"` |
| About | shot `r0-about`: **Version v0.3.2** ("Checking for updates…"; no update button clicked). Closed with the Settings close button |
| `W0` | main `{100, 100}` size `{1200, 800}` |
| tabs at start | none (empty main window) |
| view mode | L18545 `view.mode.change` `wysiwyg → source` (⌃2; part A rows run in source mode) |

## 2. Settings
- As-found (`$S/asfound.json`): `{"themeMode":"system","defaultViewMode":"wysiwyg","lastViewMode":"wysiwyg","autoSaveInterval":30,"logging":{"enabled":true,"level":"info"},"mcp":{"serverEnabled":true}}`
- After quit (`$S/restored.json`): byte-identical (`cmp` printed SAME).

## 3. Verdict table

| Row | Verdict | Proof line(s) |
|---|---|---|
| R1 alias first, by the CLI | **NOT EXERCISED (every route resolved the alias)**. Only the CLI route was tried; the drop fallback was dropped by ruling (a) | L18551 `file.open.external` `filePaths:[$XR]`; L18577 hold `path` `$XR`; L18578 register `path` `$XR`; 0 lines contain `$L/` after mark 18550 |
| R2 real spelling second, by the panel | not run (ruling a: R1 NOT EXERCISED → R4) | – |
| D185-a | not run (needs the alias tab) | – |
| D185-b | not run (needs the alias tab) | – |
| R4 restore and close | done | L18610 back to `wysiwyg`; W0 unchanged; L18630 quit commit (all zero); L18631 `app.quit`; `pgrep` exit 1; settings SAME; `rm $L` done |

## 4. Rows

### R1 (mark 18550)
`open -a "$APP" "$XA"` with `XA=/Users/jack/.mdpro-redesign/dtrack/scratch/6768740-rc032-d185r-link/a185.md`. Waited 5 s. Shots `r1`, `r1-all-w15673`, `r1-all-w15659`.

Lines after mark 18550, quoted as logged (the path prefix is `/Users/jack/.mdpro-redesign/dtrack/scratch/`):
- L18551 `file.open.external` start `{"appReady":true,"filePaths":[".../6768740-rc032-d185r/a185.md"],"source":"finder"}`
- L18552 `window.open` `filePath` `.../6768740-rc032-d185r/a185.md`, `geometry:"default"`
- L18553 `file.open.route` `{"matchCount":0,"outcome":"new-window","source":"finder","windowLabel":null}`
- L18554 `file.open.external` success `filePath` `.../6768740-rc032-d185r/a185.md`
- L18556 `window.focus` `mdpro-1292ec10-6d73-4342-86d0-47d83bb8a8d6`
- L18576 `file.open` start `filePath` `.../6768740-rc032-d185r/a185.md`
- L18577 `file.watch.hold` `{"gen":1,"groupConsumers":1,"path":".../6768740-rc032-d185r/a185.md","rawConsumers":1,"transition":"first","windowLabel":"mdpro-1292ec10-…"}`
- L18578 `file.watch.register` `{"alreadyWatched":false,"baseline":"seeded",…,"path":".../6768740-rc032-d185r/a185.md","seedCheck":"unchanged","size":59,"watchedCount":1}`
- L18579 `file.open` success, UTF-8, 59 B
- L18582 `tab.open` `documentId` `4086422029aa0b67`, real path
- `grep -c -F "$L/"` over every line after 18550: **0**.

**Where the alias is lost.** It is lost before the app logs anything. In `src-tauri/src/main.rs` (around L440–470), the `Opened` handler turns each `file://` URL into a path with `url.to_file_path()` and logs it verbatim as `file.open.external` without canonicalizing it. So the URL macOS (LaunchServices) delivered already pointed at the real folder. A cold-start CLI argument would not keep the alias either: `launch_args.rs:141` canonicalizes every argument. That makes both CLI routes resolving, and part A showed the open panel resolves too (N5). The one route left untried is a drop onto the window, which ruling (a) removed.

Because main had no tab, the external open went to a **new window**, not to main (L18553 `outcome:"new-window"`, `matchCount:0`). That window opened in WYSIWYG (shot `r1-all-*`), while main was in source mode. Recorded only; it does not affect the verdict.

### R4 (mark 18595)
- I closed the second window with its red button (its tab was clean, so no dialog): L18598 `close_requested` `decision:"save-and-close"`; L18600 `no_unsaved_closing`; L18604 `allowed_close`; then **L18605 `file.watch.unregister`** (`watchedCount:0`) and **L18606 `file.watch.release`** `{"gen":1,"groupConsumers":0,"outcome":"backendReleased","rawConsumers":0,"transition":"window_destroyed"}`; L18607 focus `main`.
- Gate `main` passed. ⌃4 → L18610 `view.mode.change` `source → wysiwyg`. Main bounds `{100,100,1200,800}` = W0, so no restore was needed.
- mdpro › Quit mdpro: L18621 request `windowCount:1`; L18622 check `clean` `dirtyCount:0`; L18630 `app.quit.commit` `deleted:0 drafted:0 failed:0 undiscarded:0`; L18631 `app.quit`. No dialog; **Discard changes count 0**.
- `pgrep -fl tauri-app`: nothing (exit 1). Settings SAME. `rm $L` (symlink only); `$S` is kept, holding `a185.md` (unchanged, 59 B), `asfound.json`, `restored.json` and `partc-draft-lines.txt`.

Shots this run: `r0-drafts`, `r0-about`, `r1`, `r1-all-w15673`, `r1-all-w15659`.

## 5. NOTE for the delegator: a part C draft came back at cold launch
The cold launch showed **Recover drafts** with one entry (shot `r0-drafts`): **"C1-focused-B"**, *Unsaved document*, saved `2026-10-14T08:20:04.222393+00:00` (16:20:04 GMT+8). L18517 `file.draft.list` `listed:1`. Following the delegator's answer, I captured the evidence first and then clicked **Discard**: L18530 `ui.dialog.cancel` `controlId:"dialog.recovery.discard"`, `draftId:"03f4f964-1a99-42a0-94e6-8c1830eba573"`; L18531/L18532 `file.draft.discard` `deleted:true`, `outcome:"ok"`; L18533 success.

Part C log lines for documentId `03f4f964-1a99-42a0-94e6-8c1830eba573`, together with the draft, window-close and quit lines around them (the full grep of L18200–18498 is in `$S/partc-draft-lines.txt`):
- L18290 / L18327: part C's two launches each listed **0** drafts (`file.draft.list` `listed:0`), so the draft was created during part C.
- L18345 `mcp.create` scheduled `actionId` `179151ae…` `documentId` `03f4f964…` `contentLength:15`; L18347 `tab.open` `filePath:null`; L18349 `mcp.create` applied `activated:true`. This is C1, created in window B `mdpro-c104116d-58b3-44fc-ac26-98183491ee4a`.
- **L18376 / L18377 `draft.write`** `documentId` `03f4f964…`, `filePath:null`, `title:"C1-focused-B"`, `bytes:15` at 16:20:04.221. This is the auto-save draft that came back.
- L18402 / L18408 `editor.milkdown.flush` for `03f4f964…`, `outcome:"clean"`, reasons `tab-switch` and `unmount` (16:20:32.943 / .949).
- L18419 / L18420 `draft.write` for C2b's doc `9a575cdd…` `title:"C2b-mru-B"` (16:20:45.586).
- **C4 step 1, window B closed with Discard changes:** L18421 `window.close` B; L18423 `close_requested` `decision:"prompt"`; L18424 `prevented_showing_dialog`; L18427 `ui.dialog.confirm` `controlId:"dialog.confirm.confirm"`, `title:"Unsaved changes"` (16:20:56.543); L18428 `window.save_state` `skipped not_main`; L18429 `window.close`; L18431 `allowWindowClose:true`; L18432 `allowed_close`. **There is no draft-delete or discard line for `03f4f964…` (or for any document) between L18421 and L18433.**
- C4, main closed: L18434–L18437 (`prompt`, `prevented_showing_dialog`); L18441 / L18442 `draft.write` for `9a575cdd…` "C2b-mru-B" again (16:21:15); L18444 `window.close_cancelled` `notified:true`.
- **C5 quit:** L18476 `app.quit.request` `windowCount:1`; L18478 `app.quit.check` `answer:"dirty"`, `dirtyCount:4`; L18480 `app.quit.prompt`; L18488 `app.quit.answer` `answer:"discard"`, `idCount:4`; L18491 recheck `clean`, `discardedUnchangedCount:4`; L18495 backstop `draftedCount:0`; **L18497 `app.quit.commit` `deleted:1`**, `drafted:0`, `undiscarded:0`; L18498 `app.quit`.

Reading of the lines (not a verdict): C1's draft was written while the document lived in window B. Closing window B with **Discard changes** (L18427) logged no draft delete. The quit then discarded only the 4 documents still open in `main`, and its `deleted:1` most likely took C2b's draft (whose doc had moved to main), not C1's. So a confirmed Discard on a secondary window's close appears to leave that window's untitled drafts on disk, and they come back as Recover drafts on the next launch. This is outside the watcher area; it is recorded for the delegator to triage.

## 6. Operator slips
1. The first `request_access` included `Finder`, for the R1 drop fallback. The delegator denied it; I re-requested mdpro only (ruling a). No Finder action was taken.
2. The Recover drafts dialog was handled with the delegator's answer (shot, NOTE, Discard) instead of part A0 step 6's "stop and report"; see § 5.

Nothing else differed. No Enter, Esc or ⌘Z. No ⌘S. No MCP calls (no token involved).

## 7. Deviations and notes
- **N1 (D185, device route).** The open panel (part A N5), `open -a` while running (LaunchServices hands over the resolved URL; `main.rs` logs it verbatim) and the cold-start CLI (`launch_args.rs:141` canonicalizes) all resolve the symlink. The only device route left is a drop onto the window, which needs a Finder grant (declined here); memory from earlier runs says drags into the editor have not dropped on this mini either. D185-a and D185-b, and the `recipients` count (2 or 3), are still **not observed on a device**. Coverage remains the unit tests (h, h2, c).
- **N2.** An external open while main is empty opened a **new window** (L18553 `new-window`, `matchCount:0`) instead of using main's empty window. Is that expected under ADR-0033? For the delegator to judge.
- **N3.** When the window that held a file was destroyed, `file.watch.unregister` (L18605) was logged **before** `file.watch.release` `backendReleased` (L18606). Part A's change note 3 describes the order for a *tab* close as release → unregister. This was a window close, so it may be a different path; recorded only.
- **N4.** The new window opened in WYSIWYG while main was in source mode (view mode is per window). Recorded only.
- **N5.** The C1 draft survived window B's Discard close (§ 5).
