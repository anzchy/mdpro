# D15 / D18 — WYSIWYG edits reach the document, GUI acceptance (2026-09-22)

This pass checks the D15/D18 fix on a release bundle. D15 was that a WYSIWYG edit was
shown on screen but never reached the document store. D18 was the `editorView not found`
errors. The question is whether a synthetic WYSIWYG edit now reaches the document in
four situations:

- a mode switch;
- an immediate ⌘S;
- a fast tab switch;
- an external-change reload.

It also checks that the reload path does not write stale text back.

It was run by the mdpro-agent-2 session at mdpro-3f's request, authorized directly by
the user in that session. The user switched the input source to ABC, and I confirmed
`com.apple.keylayout.ABC` via `TISCopyCurrentKeyboardInputSource` before typing.

## Binary under test

| Field | Value |
|---|---|
| Source | The uncommitted D15 working tree on `frontend-backend-redesign`, built by mdpro-3f. mdpro-3f confirmed the build was newer than every D15 source file |
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, launched by absolute path. `ps` showed `…/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app`. The first log line after the mark carried `appReady:false` |
| `tauri-app` sha256 | `a1fc155fdca8a8f64b9a88e90fbbcee00b28d022f03504877155173f1a76954e`, checked before launch |
| Build note | The updater signing step exits 1 (no `TAURI_SIGNING_PRIVATE_KEY`); the `.app` is produced |
| Test files | `d15-a.md`, `d15-b.md`, `d15-c.md`, each 62 B (`# D15 X` / `Paragraph one of X.` / `## Section` / `Paragraph two of X.`), in mdpro-3f's scratchpad `gui-d15/` |
| Input | Synthetic CGEvents (computer-use tool), ABC input source, no physical keyboard |
| Log | `~/.mdpro/mdpro.log`, read only after the byte mark 3,568,306 (205 lines were added during the run) |

## Results

| # | Criterion | Result | Observed |
|---|---|---|---|
| 1 | A in WYSIWYG, type ` XQ1` at the end of paragraph one, wait ~1 s, ⌃2 | **PASS** | Before ⌃2, the tab showed the unsaved dot. In Source, line 3 reads `Paragraph one of A. XQ1` |
| 2 | ⌃4, type ` XQ2`, ⌘S with no wait | **PASS** | A "Saved" toast appeared and the dot cleared. On disk: `Paragraph one of A. XQ1 XQ2` (70 B). The log shows `file.save` with `fileSizeBytes:70`. An autosave had already written XQ1 (`file.write` 66 B, 20:16:36), so the ⌘S write carried only XQ2 as new text |
| 3 | B as a second tab, type ` XQ3`, switch to A at once, switch back to B | **PASS** | The typing and the A-tab click ran in one batch with no wait; the gap was not measured, so "under 200 ms" is not claimed. On return, B shows `… XQ3` and the dot. ⌃2 Source shows `Paragraph one of B. XQ3` |
| 4 | C open in WYSIWYG, `printf '\nEXTERNAL LINE\n' >> d15-c.md`, reload, type ` XQ4`, save | **PASS** | The app showed an "External change detected" prompt; I chose **Reload**. The toast said "File reloaded" and EXTERNAL LINE was visible in WYSIWYG. After ` XQ4` and ⌘S, the file (81 B) has both `Paragraph one of C. XQ4` and `EXTERNAL LINE`. The old text was not written back |
| 5 | Log | **PASS** | One `editor.milkdown.reload` with `{reason:"file-reload", generation:2, droppedPendingEdit:false}` for C (20:23:18). The other 4 `reload` lines are `reason:"file-open"`, generation 1. `editorView not found`: **0**. `"level":"error"`: **0**. Non-null `"error"` field: **0**. The only warnings are 6 `ui.toc.resolve.mismatch` lines, all `domCount:0`, one per Milkdown mount. That is the recorded D14/N-3 behaviour |
| 6 | With B dirty, click the red close button | **PASS** | An "Unsaved changes" prompt appeared ("Close without saving?", with the buttons **Keep editing** and **Discard changes**). I chose Keep editing, and the window stayed open with all three tabs |

## Observations (not D15 failures)

- **The external-change prompt was not immediate.** A screenshot taken a few seconds
  after the append showed no prompt, and nothing file-change related had been logged.
  The prompt was on screen at the next screenshot, about 3 minutes later. When it
  appeared in between was not measured. The watcher path logs nothing, so the log cannot
  date it.
- **`open -a <bundle> d15-b.md` while the app was running opened a second window**, not a
  tab. I closed that window (clean, no prompt) and opened B with ⌘O in A's window to get
  two tabs for check 3.
- **D16 again:** AppleScript `quit` with B dirty (` XQ3`) exited with no prompt.
  `d15-b.md` is still 62 B on disk. This matches D16 in the D14 record.
- The system theme was dark, so this pass ran in the dark theme only.

## Not covered

- Physical keyboard input and IME composition (WeType). This run used ABC only.
- A timed tab switch under 200 ms. The gap was not measured.
- The light theme.
- Latency of the external-change prompt.
- ⌘Q or menu Quit with a dirty document.
