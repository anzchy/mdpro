# D20 — Reopening a dirty open file focuses it: GUI acceptance (2026-09-24)

This is the GUI acceptance for D20 ([ADR-0028](../adr/0028-reopening-a-dirty-open-file-focuses-it-instead-of-reloading.md)) at commit `de264bf`. It discharges review finding **M-L1** (`.claude/tdd-guardian/review-20260924-115503.md`): the repo has no integration lane, so the real `open_file` / `open_file_dialog` IPC and the real `FileError::EncodingError` payload were test doubles in every automated test.

It was driven through `/gui-acceptance` (computer use) on the release bundle. The evidence is:

- byte-offset log slices from `~/.mdpro/mdpro.log`;
- the byte length of each fixture on disk after every step;
- zoomed captures of the editor and tab bar.

No screenshots were kept. The MCP token was not read.

## Binary under test

| Field | Value |
|---|---|
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, built 2026-09-24 04:17:04Z from the D20 working tree, which was committed unchanged as `de264bf` |
| `Contents/MacOS/tauri-app` sha256 | `1becb9080755163781b505d737e1eca8d1ba82f3e946e92ccb8e08cae3dcb20f` |
| Freshness (trap 2) | The bundle is newer than every D20 source: `src/utils/openWriteGuard.ts`, `src/hooks/useDocument.ts`, `src/App.tsx`, `src/utils/dataLossGuards.ts`, `src/utils/wholesaleReplace.ts` and `src/stores/tocStore.ts` |
| Cold launch (trap 3) | PID 52773, started 12:17:33 (+08) from the `target/release/bundle` path. The launch log shows `appReady:false` and window `main`. The first line of the new events, `file.open.focus_dirty`, cannot come from any earlier build, so the running image is the D20 build |
| Note | The build exited 1 only at the updater-signing step. `/Applications/mdpro.app` was not used |

- **Fixtures:** all in the session scratchpad (`…/scratchpad/d20qa/`), none in the repo:
  - `d20-fixture.md`: 55 B, `# D20 fixture` / `DISK VERSION ONE` / `This line is on disk.`
  - `g4-clean.md`
  - `g5-decode.md`
- **Setup:** in window `main`, the fixture tab was edited to `This line is on disk. UNSAVED-EDIT-X` and showed the dirty dot. The file on disk stayed at 55 B throughout the run. It was checked after each step.
- **Harness note:** launch showed a *Recover drafts* dialog listing two stale drafts from another session's scratchpad. **Recover** was clicked on both, never Discard. They stayed open as the dirty tabs `a.md` and `b.md`. The `file.write` lines in the slices below are draft autosaves from `src-tauri/src/commands/draft.rs`, not writes to the real files. The byte counts on disk confirm this.

## Verdicts

| # | Criterion | Result |
|---|---|---|
| G1 | ⌘O on the dirty fixture in the same window focuses the tab; the buffer and dirty dot are kept; no reload | **pass** |
| G2 | Finder / `open -a` on the same file while the app is running → same | **not applicable to D20, and a gap found**: the file opens in a **new window**, where the per-window guard has nothing to match. `main` kept its buffer. Registered as **D29** |
| G3 | Drag-and-drop the fixture from Finder onto `main` → same | **pass** |
| G4 | A clean tab reopened with ⌘O reloads from disk | **pass** |
| G5 | A dirty open file whose bytes no longer decode, reopened with ⌘O: tab focused, no `EncodingDialog` | **pass** |
| — | Encoding-reopen refusal toast (decision 2: the MCP-write race) | **NOT VERIFIED**: it needs an MCP write while `EncodingDialog` is open, which needs the server token, and reading the token was not approved. It is covered only by jsdom (`tests/d20-reopen-dirty-hook.test.tsx`, `tests/d20-encoding-refusal-message.test.ts`) |
| — | Open Recent, launch paths | **NOT VERIFIED** by hand. Both reach `openDocumentFromPath`, the same function G3 exercised |
| — | Source mode | **NOT VERIFIED**: every probe ran in WYSIWYG. The guard sits above the editor, and the source-mode path shares `commitOpenedDocument` |

## Evidence

### G1: ⌘O, dirty target (log from byte 12 577 750)

```
ui.shortcut.trigger  {action:"file.open", shortcut:"Cmd+O"}
file.open success    {filePath:…/d20-fixture.md, fileSizeBytes:55, source:"dialog"}
editor.milkdown.flush {documentId:"5b03aafbd09dc5e3", outcome:"clean", reason:"reopen"}
file.open.focus_dirty {documentId:"5b03aafbd09dc5e3", entry:"file-open", flushFailed:false, matchedBy:"id"}
file.write …         {bytes:70}   ← draft autosave; the file on disk stays 55 B
```

- There is no `editor.milkdown.reload` and no `ui.toc.coordination.reset`.
- The editor still showed `UNSAVED-EDIT-X` with the dirty dot, and no second tab appeared.
- The read still happens before the guard decides. This is ADR-0028's "the dialog still reads the file it will not use".

### G2: file sent to the running app (log from byte 12 564 483)

`open -a <bundle> d20-fixture.md` produced:

```
file.open.external {appReady:true, source:"finder"}
window.open        {windowId:"mdpro-3bca7437-…"}         ← a NEW window
file.open.url_param → file.open → tab.open {documentId:"5b03aafbd09dc5e3"}
```

- The new window loaded the file fresh from disk, without the edit, and showed its own *Recover drafts* dialog for the fixture's draft. That dialog was left alone.
- Window `main` was checked afterwards. It still showed `UNSAVED-EDIT-X` with the dirty dot, so **nothing was lost**.
- **Cause (read from code, not inferred from pixels).** In `src-tauri/src/main.rs`, both routes call `open_file_in_new_window` unconditionally once a window exists:
  - `RunEvent::Opened` calls it when `is_app_ready()`.
  - The single-instance plugin callback calls it when `has_windows_with_documents`.
  - `file:open` is emitted only when no window exists. Neither route checks whether some window already has the path open.
- So ADR-0028's entry-point table was misleading when it listed "Finder 'Open With', single-instance `file:open`" under `openDocumentFromPath`. They reach it only in a new, empty window, where the guard can never find a dirty target.
- This is pre-existing routing, not a D20 regression. It is recorded as **D29**.

### G3: drag-and-drop (log from byte 12 589 486)

The fixture was dragged from a Finder window onto `main` while `g4-clean.md` was the active tab:

```
file.open.drop start  {dropTarget:"window", fileCount:1, filePath:…/d20-fixture.md}
file.open success     {fileSizeBytes:55}
editor.milkdown.flush {documentId:"9746fd75533d49f3", outcome:"clean", reason:"reopen"}
file.open.focus_dirty {documentId:"5b03aafbd09dc5e3", entry:"file-open", flushFailed:false, matchedBy:"id"}
editor.milkdown.mount {contentLength:70, documentId:"5b03aafbd09dc5e3"}
file.open.drop success {openedInNewWindow:false}
```

- `main` switched to the fixture tab. It showed `UNSAVED-EDIT-X` and kept its dot.
- The disk file stayed at 55 B.
- A single `ui.toc.resolve.mismatch` fired during the remount, before the editor instance existed. That is the known D21 artifact, not D20.

### G4: clean tab refresh (log from byte 12 584 653)

The steps were:

1. `g4-clean.md` was opened clean, showing `CLEAN VERSION ONE`.
2. It was rewritten on disk to `CLEAN VERSION TWO FROM DISK`.
3. The file watcher prompted *External change detected*, and **Ignore** was clicked, leaving the tab clean but stale.
4. The file was reopened with ⌘O.

```
ui.dialog.cancel      {controlId:"dialog.reload.ignore"}
file.open success     {fileSizeBytes:40, source:"dialog"}
editor.milkdown.flush {documentId:"9746fd75533d49f3", outcome:"clean", reason:"reopen"}
ui.toc.coordination.reset
editor.milkdown.reload {generation:2, reason:"file-open", droppedPendingEdit:false}
file.open.reload_clean {documentId:"9746fd75533d49f3", entry:"file-open"}
```

The editor then showed `CLEAN VERSION TWO FROM DISK`. "Reopen to refresh" still works (decision 3).

### G5: decode-failure exit (log from byte 12 600 050)

The steps were:

1. `g5-decode.md` (valid UTF-8) was opened.
2. ` G5-DIRTY` was typed, so the tab was dirty.
3. The file was overwritten on disk with 13 B of invalid UTF-8 and no BOM.
4. The watcher prompt was answered with **Ignore**.
5. The file was reopened with ⌘O.

```
file.open fail        {filePath:…/g5-decode.md}  error: "encoding error: …"
editor.milkdown.flush {documentId:"25ebcb91708ce4b9", outcome:"clean", reason:"reopen"}
file.open.focus_dirty {documentId:"25ebcb91708ce4b9", entry:"decode-failure", flushFailed:false, matchedBy:"path"}
file.write …          {bytes:37}   ← draft autosave; the file on disk stays 13 B
```

- No `EncodingDialog` appeared, and the editor kept `G5 VALID UTF8 G5-DIRTY`.
- This is the first test against the **real** `FileError::EncodingError` payload. The structured error carried the path, so `focusDirtyOpenAt` matched by path.
- This is evidence that gap (b), the string-fallback shape with an empty path, is not what the real IPC delivers on this path.

## Left running

These are left for the user to decide on:

- **App.** PID 52773 is still running with window `main` and the G2 window `mdpro-3bca7437-…`.
- **Drafts.** The dirty tabs are `d20-fixture.md`, `a.md`, `b.md` and `g5-decode.md`, and each has a draft. Quitting will prompt for them.
- **Other session's drafts.** The two drafts recovered from another session's scratchpad (`…/89b5e352…/scratchpad/fx/`) now live in this app instance.
- **Destructive choices.** Discarding drafts is permanent, so it was not done here.
