# R7 · D29 · D24 · 3.8 — batched device acceptance (2026-09-25)

One release build, four owed device obligations:

- **D16 R7**: the ADR-0030 stuck-quit escape hatch as shaped by
  [ADR-0036](../adr/0036-the-stuck-quit-escape-hatch-is-an-always-enabled-app-menu-item-without-a-shortcut.md);
- **D29**: G-D29-1..7, the external-open routing of
  [ADR-0033](../adr/0033-an-external-open-of-an-already-open-file-goes-to-its-window.md);
- **D24**: the ADR-0031 step-2 geometry round trip, the two-window theme
  criterion, and the [ADR-0032](../adr/0032-the-preference-round-trip-is-a-gui-acceptance-criterion.md)
  settings round trip;
- **stage 3.8**: the per-surface large-document exit re-test.

It was driven through `/gui-acceptance` (computer use) on the release bundle. The evidence is:

- byte-offset log slices from `~/.mdpro/mdpro.log`;
- AppleScript System Events (AX) reads of window count, position, size and `AXMinimized`;
- zoomed captures.

No screenshots were kept. The MCP token was not read. `~/.mdpro/config.json`
was read for the geometry criterion. Its `windowStates` keys are private file
paths, so only the fixture's entry is quoted below.

## Binary under test

| Field | Value |
|---|---|
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, built 2026-09-25 12:24:59Z, after HEAD `3b6c157` (11:48:05Z). The only uncommitted source changes at build time were rustfmt-only edits to two `#[cfg(test)]` files (`quit_guard/coordinator_recheck{,_gone}_tests.rs`), which are not in a release image, so the image is `3b6c157` |
| `Contents/MacOS/tauri-app` sha256 | `326b0404de3350449b337c89ea05b260f872607a87454778559b412a941d4b81` |
| Freshness (trap 2) | The bundle is newer than every source under test: `menu.rs`, `quit_guard/{escape,driver_escape,logging_escape}.rs`, `open_route/{plan,lookup,execute,tauri_glue}.rs`, `main.rs`, `commands/window.rs`, `useOpenInWindow.ts`, `useMcpSync.ts`, `useWindowCloseGuard.ts`, `useTheme.ts`, `preferencesService.ts` |
| Cold launch (trap 3) | Each launch was preceded by `/bin/ps -axo pid,lstart,command` showing no mdpro process. The R7 launches and the final launch (PID 38415, 20:33:34 +08:00) all logged window `main`. `app.quit.escape` cannot come from any build before `3b6c157`, and it appears in the R7 slice |
| Note | `/Applications/mdpro.app` was not used |

- **Fixtures:** all in the session scratchpad, none in the repo: `a.md`, `b.md`, `c.md`, `q.md`, and a symlink `alias/a-link.md → a.md`.
- **Harness notes:**
  - **Menu clicks go through AX, not the pointer.** The menu-bar utility iBar Pro owns menu-bar coordinates (see gui-acceptance §9), so menu items were clicked with `click menu item … of menu bar 1 of (first process whose unix id is <pid>)`, wrapped in `with timeout of 8 seconds`. An `ignoring application responses` variant did **not** deliver the click, so it was not used for any verdict.
  - **Second instances** were started by running `Contents/MacOS/tauri-app <path>` directly. That enters the `tauri_plugin_single_instance` callback (`file.open.external` `source:"single_instance"`).
  - **Draft dialogs:** every *Recover drafts* dialog was either answered with **Recover** or left untouched. Discard was never clicked.

## Verdicts

### D16 R7 — the escape hatch (ADR-0030 / ADR-0036)

| # | Criterion | Result |
|---|---|---|
| m1 | *Stop Waiting and Quit…* sits in the mdpro menu directly below Quit, is enabled, and has no shortcut | **pass**. Read from the app menu on device: the item directly follows Quit, is enabled, and shows no key equivalent |
| m2 | An idle click does nothing and logs `noop` | **pass**. 20:27:22.928 `app.quit.escape {outcome:"noop", phase:"idle", unresolvedCount:0}`. There was no alert, the app stayed up, and no other `app.quit.*` line was written |
| m3 | A click while a save dialog is up (`deciding`) shows the ADR-0027 alert, and Keep Open restores the app | **pass**. With one dirty window, ⌘Q, dialog up (`delivered` acked), then the escape: 20:29:30.402 `app.quit.escape {outcome:"fallback", phase:"deciding", requestId:1, round:0, unresolvedCount:1}`, followed by the native alert. There was **no** `app.quit.timeout`. Keep Open logged 20:30:03.615 `app.quit.fallback {answer:"keepOpen"}` → `app.quit.cancel {reason:"userKeptOpen"}`. The window then took typing |
| R7 | **ADR-0030 residual**: the escape rescues a quit whose renderer is really frozen | **pass**. ⌘Q with a dirty document. After the prompted window acked `delivered`, its WebContent process was frozen with `SIGSTOP`. The escape then logged 20:32:32.774 `app.quit.escape {outcome:"fallback", phase:"deciding", requestId:2}`, and the native alert drew even though the webview could not paint. Quit Without Saving logged 20:33:02.464 `app.quit.fallback {answer:"quitWithoutSaving"}` → `app.quit.commit {backstop:false, deleted:0, …}` → `app.quit` 7 ms later. The cold relaunch (PID 38415) offered *Recover drafts* for the document, and **Recover** restored the edit, as ADR-0027 §5 requires (Quit Without Saving deletes no draft) |
| — | Logs carry counts and enums only | **pass** for every `app.quit.escape` / `app.quit.fallback` line above |

**Observations (not failures of an R7 criterion):**

- **The alert text misdescribes an escape.** When the user reached it from the menu, it still says the app "didn't answer in time", but nothing timed out. The wording lives in one place (ADR-0036, *What it buys*), so the fix is a one-string change. It is recorded as a follow-up, not fixed here.
- After Keep Open, one stray `editor.milkdown.mount` was logged with no user action. The editor behaved normally.

### D29 — external open of an already-open file (ADR-0033)

| # | Criterion | Result |
|---|---|---|
| G1 | Finder-route open (`open -a`) of a file dirty in window W focuses W and that tab, and no new window appears | **pass**. `file.open.route {outcome:"existing-window", windowLabel:"main"}` → `{outcome:"focused-tab"}`. The AX window count was unchanged, and the zoom showed the dirty tab active |
| G2 | A file loaded in a newly opened second window is routable | **pass**. From `main`, `b.md` → `existing-window` to W2 (`mdpro-dad3…`) → `focused-tab`. W2 came to the front |
| G3 | Close W, choose Keep editing, then open W's file: it routes to W | **pass**. Closing dirty `main` showed *Unsaved changes*, and Keep editing logged `window.close_cancelled`. Opening `a.md` then gave `existing-window main` → `focused-tab` |
| G4 | `/tmp` vs `/private/tmp` and a symlink alias reach the existing tab, with no duplicate tab | **pass**, in three runs:<br>1. Through `open -a`, both spellings arrive already canonicalised by LaunchServices, so that route alone proves nothing.<br>2. A second instance given the raw `/tmp/…/a.md` logged the `/private/tmp` form, `source:"single_instance"` → `existing-window main` → `focused-tab`.<br>3. A second instance given the absolute symlink logged the same.<br>The tab count was unchanged in every case |
| G5 | An unopened path still opens a new window. With only `main` present, a second instance still broadcasts | **pass**, in two parts:<br>**G5a:** an unopened path gave `new-window`, followed by `window.open`.<br>**G5b:** with only `main` present, a second instance given `c.md` logged `file.open.route {matchCount:0, outcome:"broadcast", source:"single_instance", windowLabel:null}`. `c.md` opened as a tab in `main`, and the AX window count stayed 1 |
| G6 | A minimised W is un-minimised | **pass**. ⌘M set `AXMinimized` to true. `open -a` of `a.md` set it back to false and logged `focused-tab`. This route took **545 ms** from `file.open.external` to `focused-tab`, against about 5 ms when the window is not minimised. The extra time is probably the deminiaturise animation, but that was not measured |
| G7 | `file.open.route` lines carry no content | **pass**. Contexts hold only `source`, `outcome`, `matchCount`, `windowLabel` and `documentId`. (`file.open.external` still logs paths, but that predates D29 and is outside ADR-0033) |

### D24 — preference persistence (ADR-0031 step 2 and ADR-0032)

| # | Criterion | Result |
|---|---|---|
| S2-save @2× | A per-file window's geometry is saved in **logical** units | **pass**. The display is the built-in Retina at scale 2. AX set the `b.md` window to 333,177 with size 1011×655, and it was then closed. `windowStates` for `b.md` became `{x:333, y:177, width:1011, height:655}`, which is the logical value. Entries written before step 2 still read `2400×1600` |
| S2-restore @2× | Reopening that file restores the saved geometry | **FAIL**, and not because of units. Reopening `b.md` (Finder route) gave 100,100 at 1200×800. **Root cause, read from the code:** the only reader of stored geometry is `create_window` (`src-tauri/src/commands/window.rs`), via `get_stored_geometry(path)`. Its only frontend caller is `App.tsx`'s `onNewWindow: () => void openNewWindow()`, which passes **no path**. The external-open route builds its window in `open_route/tauri_glue.rs` `open_file_in_new_window` at a fixed 1200×800 and never reads storage. The per-file restore is therefore **unreachable**. This predates step 2, and the ledger row 按文件记忆窗口几何 already recorded it from a code read; this run is its first device confirmation. Step 2 fixed the units of the save half, but its round-trip criterion cannot pass until some entry point passes a path to `create_window` |
| S2 @1× | The same round trip on a scale-1 display | **NOT VERIFIED**. There is no scale-1 display attached, and changing display scaling is a system setting this lane may not touch |
| main | The `main` window's `windowState` is saved and restored | **NOT VERIFIED, blocked by step 5**. `preferencesService.saveWindowState` returns early while `isTauriEnv()` is false, and `App.tsx` applies `prefs.windowState` from the browser-branch defaults. On disk, `windowState` holds the defaults `{1200,800,100,100}` |
| Theme ×2 | Changing the theme in window A does not get rolled back when window B starts | **pass on its literal wording, with a caveat that matters**. `main` was switched to Light (AX Theme menu). Starting window B (`q.md`) left `main` Light. **But** B opened in the system (Dark) theme, and `themeMode` on disk stayed `"system"`. The Theme-menu write never reaches disk (step 5). The criterion passes only because nothing is persisted that B could roll back to |
| ADR-0032 | The Settings-panel round trip survives a relaunch | **NOT RUN.** The two rows above already show that no frontend preference write reaches disk until step 5, so the round trip cannot pass on this build. Running it would only restate that |

### Stage 3.8 — per-surface large-document exit re-test

**NOT RUN.** The three blockers named in its sequencing row all still hold:

1. D6 is not closed, and the ADR-0004 waiver does not cover 3.8.
2. The WYSIWYG pathological numbers need a Web Inspector sweep, and the release bundle ships without DevTools.
3. ADR-0006 forbids fixing new thresholds before that sweep.

This batch did not change any of them.

## Defects and observations found on the way

| Item | Evidence strength | Where recorded |
|---|---|---|
| **Per-file geometry restore is unreachable** (the D24 S2-restore FAIL above) | Device FAIL plus the code path read end to end. It was already known from a code read (ledger row 按文件记忆窗口几何) | D24 row; ledger row gains the device evidence |
| **Spurious "External change detected" prompt.** In W2, clean `b.md` twice showed the reload prompt after an external open of *another* file routed to its window. `b.md`'s mtime was unchanged | Device observation, twice. **Mechanism is a hypothesis, not proved:** the opened files carry `com.apple.lastuseddate#PS` (written by LaunchServices), FSEvents reports an xattr write as `Modify(Metadata)`, and `file_watcher.rs`'s `EventKind::Modify(_)` arm emits `modified` for every modify kind. `decideFileChange` then prompts for any non-rename, non-delete event on the active path. It was never seen in `main`; that is unexplained. Neither the `file:changed` emit nor the prompt decision is logged, so the log could not confirm it | New row D32 |
| **Every new window re-offers the same drafts.** Each new window's *Recover drafts* dialog offered `a.md`'s draft, although `a.md` was open and already recovered in `main`, because every window runs `list_drafts` on mount | Device observation plus the mount effect in `App.tsx`. Neither Recover nor Discard was clicked on those dialogs | Added to D27, the same cross-window draft-dialog family |
| **A relative path given to a second instance is dropped silently.** The single-instance callback ignores the second process's `cwd`, and `filter_launch_paths` canonicalises against the first process's cwd | Code read. The drop is silent (no log line) | New row D33 |
| **D31 reproduced.** One AX click on Theme → Light logged 5 `ui.menu.select` `menu.theme.light` lines with two windows open. Theme → System logged 4 with three windows | Device repro. This matches the `useMenuEvents` listener leak read from the code | D31 row |
| `window.close` is logged before the unsaved-changes prompt, even when the close is then cancelled | Log order only | Noted here only |
