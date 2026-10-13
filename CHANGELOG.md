# Changelog

All notable changes to mdpro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- On Windows, local images in documents are shown again (the content security policy blocked `http://asset.localhost`, the address Windows serves them from) (D190)
  - **Not yet checked on a device**
- Opening a file with a `<br>` tag inside a line (for example `first<br />second`, or `x<br>y` in a table cell) no longer deletes it (D192). The tag used to disappear as the file loaded, and the first edit anywhere in the document then saved the text without it. A `<br />` on a line of its own still opens as an empty line
  - **Not yet checked on a device**
- On Windows the app shortcuts work again: Ctrl+S, Ctrl+N, Ctrl+O, Ctrl+W, Ctrl+, and the rest were all ignored, because a binding written as Cmd was also required to have Ctrl released (D190, closes D50; a regression of the #38 fix)
  - **Not yet checked on a device**
- On Windows Ctrl+Shift+N opens a new window. The native menu shortcut never reaches the app there, so the in-app shortcut handler now covers New Window off macOS, using the existing New Window shortcut setting (D190)
  - **Not yet checked on a device**
- On Windows, mdpro → Exit now asks about unsaved changes and writes recovery drafts before quitting, as Quit does on macOS, and every way of quitting now removes the MCP server files (`server.port`, `server.token`). Exit used to end the app at once, and the files were left behind (D190, [ADR-0090](docs/adr/0090-windows-and-linux-quit-through-the-quit-guard.md))
  - **Not yet checked on a device**
- When the same file is open in two windows, closing it in one window, or closing that window, no longer stops the other window from seeing changes made outside mdpro (D173, part 1; [ADR-0086](docs/adr/0086-a-save-tells-every-other-holder-and-the-watch-is-owned-per-canonical-group.md)). Closing it used to stop watching the file for every window, so the other window got no prompt and its next ⌘S silently overwrote the outside change. Each window now keeps its own hold on the file, and the watch stops only when no window holds it; a window that is closed outright now gives up its holds too, which it never did before. A save in one window is still not shown to the other; that is the next part of D173
  - **Not yet checked on a device**
- Saving a file in one window now raises "External change detected" in every other window that has the same file open, and in another tab of the same window open on that file, so their ⌘S can no longer overwrite the save unseen; ⌘S there stays refused until you choose Reload or Ignore (D173, part 2; [ADR-0086](docs/adr/0086-a-save-tells-every-other-holder-and-the-watch-is-owned-per-canonical-group.md)). The save's own tab is never prompted. A failed Save As onto a file the window already had open no longer stops that window watching it, and when two tabs have one file open and it is edited and then renamed outside mdpro, both tabs now keep the unanswered change instead of one of them losing it. A ⌘S already under way in the other window when the save lands still writes
  - **Not yet checked on a device**
- Opening a file in a second window no longer hides an outside change the first window had not been told about yet (D173, part 3; [ADR-0086](docs/adr/0086-a-save-tells-every-other-holder-and-the-watch-is-owned-per-canonical-group.md)). The second window's open used to overwrite the shared record of the file's last-seen bytes, so the outside change's late event looked like nothing had changed and the first window never prompted. Now the open compares the record before and after, and if they differ every window holding the file gets "External change detected"; the new document in the second window may prompt once for bytes it already read. A Save As does not do this check, so the saving document is not wrongly blocked. A save now also tells each distinct spelling of the path, such as `/d/./doc.md` and `/d/doc.md`
  - **Not yet checked on a device**
- A released build's log now says which release it is (D175). The `app.ready` line carries a new `releaseId`, `<version>@<full commit SHA>`, set only by the release workflow; `buildId` is unchanged and still reads `unknown` in released builds. Before publishing, the release workflow now refuses a draft whose macOS app was not built with that exact id
  - **Not yet checked on a device**
- A file changed outside mdpro while it is open in a background tab now raises "External change detected" when you switch to that tab, and ⌘S no longer writes over that change until you choose Reload or Ignore (D171, [ADR-0081](docs/adr/0081-external-changes-are-kept-per-document-and-an-open-reports-a-change-since-its-read.md)). The change used to be dropped, so the next save silently overwrote it. A save blocked this way shows "Save failed: the file changed on disk; reload or ignore that change before saving" and leaves the tab unsaved. A failed Reload now keeps the prompt up, and a change that arrives during a Reload prompts again afterwards
  - **Not yet checked on a device**
- Reopening Settings no longer runs an update check before you open the About page (D166). Once a check had found an update, every ⌘, briefly mounted the About page left over from the last visit and checked again, and visiting About then checked a second time. Settings now always opens on General, and a Check Again still running when Settings was closed can no longer replace the result a reopened About page is showing
- A file written by another program in the moment between mdpro reading it and starting to watch it now raises "External change detected" (D111, [ADR-0081](docs/adr/0081-external-changes-are-kept-per-document-and-an-open-reports-a-change-since-its-read.md)). That write used to go unreported, so the tab showed the old text and the next ⌘S overwrote the change. A change that lands while the file is still opening is kept for its tab instead of being dropped. Save As onto the document's own file is refused, like ⌘S, while an external change is unanswered
  - **Not yet checked on a device**
- A file in a background tab that another program edits and then renames or moves still raises "External change detected" when you switch to it (D178). The rename used to replace the record of the edit, so the tab quietly followed the new name and the next ⌘S wrote the old text over the edit. The tab now follows the rename, the prompt shows for the new path, and ⌘S stays refused until you reload or ignore. A change at the new path that arrives before you switch to the tab is no longer dropped
  - **Not yet checked on a device**
- The app no longer spins while an "External change detected" prompt is open (D172). Since the D165 change, a file changed or deleted outside mdpro re-rendered the window continuously for as long as the prompt stayed up. Closing one document's prompt also no longer drops another document's change that arrives at the same moment, which had left that document's Reload doing nothing
- While any dialog is open, ⌘W, ⌘N, ⌘O and Open Recent no longer change tabs behind it (D165). ⌘W used to close the tab behind an "External change detected" prompt, leaving the prompt on screen for a document that was gone; with "Unsaved changes" open, ⌘N or ⌘O switched documents so that "Discard changes" closed the wrong one. The refused action is logged, and an external-change prompt now goes away if its document is closed some other way
- When a save fails, the notice now gives the reason, for example "Save failed: permission denied: …/notes.md" in a read-only folder (D163). It used to read "Save failed: [object Object]". Save As reports its failures the same way
- In dark mode the Source editor's search panel (⌘F), its fields and buttons, the line-number gutter and the lint tooltips are dark too (D158). They used to stay light grey with black text whatever the app theme, because the editor always ran CodeMirror's light theme. They now follow the app theme, live, and use mdpro's own colours, with a visible focus ring on the search field and buttons
  - **Known limit**: the search panel's checkboxes stay light in dark mode for now
  - The Go to Line dialog's close button and the selected row of the lint panel follow the app theme too; with the light app theme and the oneDark code theme, a selected lint diagnostic is no longer dark text on a dark row
- Pasting a web table whose last row is covered by a merged cell from the row above no longer loses the whole table (D162). Since the D149 change the table turned into an empty paragraph, and inside a table that empty paragraph replaced the selected cells; the merged cell is now shortened to end above that row, which is filled with empty cells
  - A pasted cell whose merged span runs past the end of the pasted table is no longer cut short when there is no covered last row (D162 follow-up). Pasting such a table over selected cells used to fail with an error and paste nothing
  - Pasting cells with a merged cell taller than the target, over selected cells or at the caret, no longer fails with an error and pastes nothing; the merged cell is cut to fit, the pasted cells end up selected exactly, and the rest of the table is left as it was (D162 follow-up, [ADR-0082](docs/adr/0082-mdpro-patches-prosemirror-tables-for-the-overlong-rowspan-cell-paste.md): two fixes to prosemirror-tables 1.8.5, applied as a pnpm patch)
- Pasting a web table that has only a header row, outside any table, no longer loses its text (D149); it now pastes as a table with that header and one empty row. A web table with only body rows no longer gets a left-aligned header (D150); its added header row is empty and unaligned, and every body row is kept
- In WYSIWYG, Insert row above on a table's header row no longer splits the table in two (D155). The saved file used to gain an extra, empty table above the original. The header row is now emptied and its old text moves down into a new first body row, as in Source mode; column alignment is kept and one undo restores the table
- In Source mode a selection is visible again (D154). A selection within one line, and the last line of a longer one, showed no highlight at all, because the current-line background was opaque and covered it; while the editor had focus, mdpro's own selection colour was also overridden by CodeMirror's. The current line now has a faint translucent tint, and a selection shows in the accent colour while the editor has focus and in neutral grey when it doesn't
- In WYSIWYG, a column added with the table context menu's Insert column left / right, or its shortcut, no longer comes out left-aligned (D141). Each insert used to write a `:-` delimiter nobody had set; the new column is now unaligned, and the existing columns keep their alignment
- **Moved files prompt.** Moving an open file away from outside mdpro (`mv`, Finder, a sync client) now raises "File was deleted externally", so the next ⌘S no longer silently recreates the file at its old path (D107, [ADR-0078](docs/adr/0078-a-watched-file-moved-away-is-reported-as-deleted.md)). An editor that saves by renaming the old file aside first may briefly show that prompt before "modified externally" replaces it.
  - **Not yet checked on a device**
- Changing only the permissions or the owner of an open file whose contents are unchanged (`chmod 444`, `chmod 644`, `chown`) no longer raises "modified externally"; making the file unreadable (`chmod 000`) still does (D164, [ADR-0080](docs/adr/0080-permission-and-ownership-changes-on-an-unchanged-file-do-not-prompt.md))
  - **Not yet checked on a device**

## [0.3.1] - 2026-10-11

### Highlights

- **Quitting no longer loses unsaved work.** ⌘Q, the Dock's Quit and AppleScript `quit` now ask before discarding anything. A window that stops responding can't trap you either: a new **mdpro → Stop Waiting and Quit…** menu item gets you out.
- **Draft recovery is safer.** Recovering a draft no longer overwrites another unsaved draft of the same file, and it no longer opens a duplicate tab. Recovered documents are watched for outside changes like any other file.
- **Saving is more reliable.** Edits made while a save is running are kept, and pressing ⌘S twice in a row can no longer leave older text on disk. Switching tabs or modes no longer drops edits the editor couldn't capture. The "Unsaved changes" dialog now opens on Keep editing, so pressing Enter by accident keeps your work.
- **Changes made by other apps are caught more reliably.** You get the "External change detected" prompt when another editor saves by replacing the file, and for files you saved for the first time. Reopening a file you already have open switches to its existing tab instead of opening a second copy, and shows no prompt when nothing changed.
- **Table editing is much sturdier.** The table menu's Delete Row, Delete Column and Delete Table now work, and menu actions apply to the cell you right-clicked. Tab moves between cells in Source mode. Tables pasted from web pages, including into a single cell, keep every cell in its column and keep their alignment. A paste that would split a table is refused with a short notice.
- **Switching between Source and WYSIWYG keeps your place** instead of jumping to the top. Clicks in the outline land on the right heading, even in image-heavy documents. Typing in WYSIWYG always reaches the saved file.
- **Large documents open much faster.** A table-heavy document that used to freeze the window for close to a minute now opens quickly. Very large or very long-line documents open in Source mode instead of hanging the app.
- **The encoding and reload dialogs behave better.** Files saved as UTF-16 are saved back in the same format. A wrong encoding retry no longer opens the file as garbled text. Esc and Tab work in these dialogs wherever your keyboard focus is.
- **Better rendering and HTML export.** Math (`$…$`, `$$…$$`), footnotes, plain web links and `:emoji:` shortcodes render in exported HTML. Heading links in an exported file always jump to the right heading.
- **Claude and other AI agents can edit documents more safely.** You approve each agent edit from a prompt inside the window that has the document open. The agent connection (MCP server) can be switched on or off in Settings → Integrations without a restart. Agent edits no longer overwrite what you just typed or move your cursor.
- **The update checker in Settings → About is clearer.** It shows real update errors instead of "coming soon", and its install and restart buttons are styled properly. Restarting to apply an update saves your latest edits first.
- **Known limits:** Escape does nothing on the native "mdpro isn't responding" quit alert. Legacy encodings such as GBK, Big5 or Shift-JIS cannot be opened yet. Dragging text or tables within the editor is not available in this release; file drops still work.

### Installing

mdpro 0.3.1 is not notarized ([ADR-0070](docs/adr/0070-0-3-1-ships-without-notarization.md)), so a copy downloaded with a browser carries the quarantine flag and macOS blocks the first launch with "mdpro can't be opened". That is Gatekeeper, not a broken download. Open it once this way, and every later launch is normal:

- **macOS 15 and later**: double-click `mdpro.app` once and dismiss the alert, then open System Settings → Privacy & Security, scroll to the Security section and click **Open Anyway** next to mdpro, then confirm.
- **macOS 13 and 14**: Control-click `mdpro.app` in Finder, choose **Open**, then click **Open** in the alert.
- **From Terminal** (either version): `xattr -d com.apple.quarantine /Applications/mdpro.app`.

Updating from inside mdpro (Settings → About → Install Update) does not go through Gatekeeper, so an installed 0.2.6 or 0.3.0 needs none of this.

The full development log for this release, with every defect record, decision record and verification note, is in [docs/release-notes/0.3.1-full.md](https://github.com/anzchy/mdpro/blob/v0.3.1/docs/release-notes/0.3.1-full.md).

### Added
- **Quit asks first.** ⌘Q, the menu's Quit, the Dock's Quit and AppleScript `quit` now prompt each window with unsaved changes, one at a time, instead of exiting silently.
- **Hung windows can't trap a quit.** If a window does not answer within about 2 seconds, a native alert offers Keep Open or Quit Without Saving, and drafts are kept for recovery.
- **Stop Waiting and Quit.** A new mdpro → Stop Waiting and Quit… menu item gets you out of a quit that is stuck waiting on a window.
- **Mode switches keep your place.** Switching between Source and WYSIWYG returns you to the block you were reading instead of the top of the document.
- **Math in export.** `$inline$` and `$$display$$` math render, and HTML export writes it as MathML.
- **Footnotes in export.** `[^1]` references and definitions render with working back-links.
- **Autolinks and emoji.** Bare `http(s)://` URLs become links and `:shortcode:` emoji render as glyphs.
- **In-app update checker.** Settings → About shows the version, checks for updates, shows download progress and installs with one click.
- **Save before restart.** Restarting to apply an update saves every modified document first, and stops if an untitled document exists or a save fails.
- **Large-document degrades are logged.** Each switch to Source mode for a document too complex for WYSIWYG writes one log line saying which trigger fired.
- **Logging off stays off.** A corrupt settings file no longer silently turns logging back on.
- **File watcher diagnostics.** The file watcher and the "External change detected" prompt now leave a trail in `~/.mdpro/mdpro.log`.
- **Preference and window-state logging.** Preference reads and the startup window size and position restore each write a log line.

### Security
- **MCP token file is private.** `server.token` is owner-only from the moment it is created, and every server start mints a fresh token.
- **Stricter sanitizer.** Rendering and export share one allow-list that keeps math, footnotes and Mermaid output while removing scripts, event handlers and style-based exfiltration.
- **No `name` attribute in export.** Raw-HTML `<a name="x">` anchors no longer survive export; use `id="x"`.
- **DOMPurify upgraded.** DOMPurify 3.3.3 patches two moderate XSS advisories in the WYSIWYG paste path.
- **Link scheme allow-list.** Clicking a link in WYSIWYG opens it only for `http`, `https`, `mailto` and `tel`; other schemes, including `file:` and `ftp:`, are blocked and logged.
- **Protocol-relative links blocked.** Links such as `//host/x` no longer open, and in-document links such as `#fragment` are no longer sent to the system opener.

### Changed
- **Agent edits are approved in-window.** An MCP write to a document is confirmed by a prompt in the window that has it open, with clear HTTP results for reject, timeout and cancel, instead of a native alert that froze the app.
- **MCP switch takes effect live.** Settings → Integrations turns the MCP server on and off immediately, shows its real state, and keeps the setting across restarts.
- **Safer MCP settings.** Settings no longer overwrites your MCP settings with defaults when it opens before your preferences have loaded.
- **Quit timing is clock-proof.** Quit deadlines use a monotonic clock, so a system time change cannot fire or delay the quit alert.
- **Large-document guard judges structure.** WYSIWYG falls back to Source mode based on lines and table cells rather than file size, with a new toast message.
- **Very long lines open in Source.** A document whose longest line exceeds one million characters opens in Source mode instead of hanging WYSIWYG.
- **Table tools off for huge tables.** Source mode turns off its table editing tools, with a one-time notice, for documents with more than 50,000 table rows.
- **UTF-16 files stay UTF-16.** Files opened as UTF-16 are saved back in UTF-16 with their byte-order mark, and CRLF line endings survive.
- **⌘/ cycles view modes everywhere.** ⌘/ now cycles view modes even inside the Source editor; the line-comment shortcut moved to ⌘⌥/.
- **Outline clicks land precisely.** Clicking an outline entry in WYSIWYG jumps instantly and lands the heading 40 px below the top, matching Source mode.
- **Build, test and release tooling.** New `pnpm control:*` commands build and drive an isolated verification app for development checks, the CI release workflow generates `latest.json`, the update-check log line now closes for disabled updates, and the `micromark-extension-gfm-table` override is pinned to `2.1.2`.

### Fixed
- The Windows build compiles again. The file watcher's unchanged-file check uses Unix-only file metadata on macOS and Linux, and a weaker portable stamp on Windows, where it never drops a change event (D159).
- **Late edits survive quit.** A window edited after it answered the quit prompt is asked again, and every unsaved document is drafted just before exit.
- **No more endless quit.** A quit can no longer hang forever with no alert, and a quit prompt now appears only in the window it was meant for.
- **Accurate stuck-quit alert.** The Stop Waiting and Quit… alert now says what actually happened.
- **No new windows during quit.** New windows are not opened while a quit is waiting on an unsaved-changes prompt.
- **One close prompt.** Closing a window with unsaved changes asks once, not once per edit.
- **Enter keeps your work.** The "Unsaved changes" dialog now opens on Keep editing instead of Discard.
- **Clean MCP files on quit.** Quitting removes the MCP server's port and token files.
- **Quit failures are logged.** The quit path's remaining silent failures now write a log line.
- **Recovery won't clobber drafts.** Recovering a draft no longer overwrites another waiting draft of the same file.
- **No duplicate recovered tab.** Recovering a draft whose file is already open in a clean tab puts it into that tab.
- **Drafts stay with their window.** *Recover drafts* no longer offers a draft another open window is using.
- **Recovered files are watched.** A document reopened through *Recover drafts* is watched for external changes.
- **Draft log name.** Draft autosaves now log as `draft.write` instead of `file.write`.
- **Edits during save are kept.** Edits made while a save is running are no longer overwritten, and the tab stays dirty.
- **Double ⌘S is safe.** Two quick saves of one document run in order, so older text can no longer end up on disk.
- **Failed captures block switches.** Switching tabs or leaving WYSIWYG is refused with a notice when the editor cannot capture your edits.
- **Refusals stay local.** A failed WYSIWYG flush refuses only the switches that would unmount that editor.
- **Restart keeps last edits.** Restart to Apply now saves an edit made in the last fraction of a second.
- **Settings persist.** Preference changes made in the app are written to disk and restored at launch.
- **Config is never reset.** A preference write no longer rebuilds an unreadable `config.json` from defaults, and window size is restored correctly on Retina displays.
- **Settings writes don't race.** Settings panels no longer replay stale values, lose their controls on a failed save, or rewrite the theme at launch.
- **Save errors surface.** A failed preferences write now shows a "Failed to save preferences" toast.
- **Logging settings don't clobber preferences.** Changing logging settings no longer discards a concurrent preferences change.
- **Atomic saves detected.** An external editor that saves by replacing the file now raises "External change detected" instead of "deleted" or nothing.
- **No false reload prompts.** Re-opening a watched file, or opening one soon after saving, no longer raises a false prompt.
- **Real changes still prompt.** The unchanged-file check no longer hides real external edits, including ones right after ⌘S.
- **First-saved files are watched.** A file saved for the first time through the save dialog is watched like an opened file.
- **Reload in place after Save As.** Reload on a document first saved through Save As no longer opens a duplicate tab.
- **Reopen reuses the tab.** Re-opening a file whose tab is already open focuses or reloads that tab, even after Save As.
- **Reopen keeps unsaved edits.** Opening a file that is already open with unsaved changes switches to it instead of discarding them.
- **External opens find the window.** Opening a file from Finder that is already open focuses its window and tab instead of opening a copy.
- **Failed opens tell you.** A failed external open, such as a file over 10 MB, shows a "Failed to open file" toast.
- **Relative paths open.** Launching mdpro with a relative path while it is running opens the right file.
- **Failed drops keep the mode.** Dropping a file that fails to open no longer switches Source to WYSIWYG.
- **Safer UTF-16 retry.** The encoding dialog offers only UTF-16LE and UTF-16BE and refuses a retry that would open the file as gibberish.
- **Esc and Tab in dialogs.** Esc closes the encoding and reload dialogs wherever focus is, and Tab stays inside the encoding dialog.
- **Table deletes work.** Delete Row, Delete Column and Delete Table in the WYSIWYG table menu now delete, and Align applies to the whole column.
- **Menu acts on clicked cell.** WYSIWYG table menu actions apply to the cell you right-clicked, including clicks on a cell's border.
- **Menu stays on screen.** The table context menu no longer runs off the bottom of the window.
- **Tab moves between cells.** In Source mode, Tab and Shift-Tab move between table cells, and never indent table text when they cannot move.
- **Blank first cells keep their column.** A row whose first cell is blank no longer has its content moved one column left.
- **Extra cells are kept.** Format on save, table edits and the HTTP table endpoints widen a table instead of deleting cells beyond the header width.
- **Ragged tables stay aligned.** WYSIWYG widens tables with extra cells when loading, and pasted ragged HTML tables keep every cell in its column.
- **Empty cells stay empty.** Empty table cells edited in WYSIWYG save as empty instead of `<br />`.
- **Pastes can't split tables.** Pasting or dropping content containing a table into a cell is refused with a notice instead of breaking the table.
- **Web tables paste into cells.** Pasting a web-page table into a table cell fills the cells instead of failing or splitting the table.
- **Alignment is preserved.** Pasted tables without alignment stay unaligned, and columns added by a paste are not left-aligned.
- **Deleting across a table is safe.** Deleting or dragging a selection from outside a table into a cell no longer leaves an unsaveable document.
- **Fewer phantom tables.** Source mode no longer treats setext headings and over-indented lines as tables, so MCP table edits hit the right table.
- **WYSIWYG typing is saved.** Edits typed in WYSIWYG now reach the document, the dirty dot and the saved file.
- **⌘K works in Source.** In Source mode ⌘K opens the same Insert Link box as WYSIWYG.
- **Link prompt follows its document.** An open Insert Link prompt closes when its document stops being the one in front.
- **Dialogs stack in order.** The newest dialog is on top and gets Escape.
- **Esc dismisses dialogs.** Escape dismisses the Unsaved-changes dialog and the MCP prompt wherever focus is.
- **Visible focus rings.** The Unsaved-changes, reload and MCP confirmation dialogs show which button has focus when they open.
- **Stale cell highlight clears.** In Source mode the current-cell highlight no longer lingers inside a code fence.
- **Saved view mode respected.** Automatic view switches no longer overwrite the view mode you chose.
- **Image-heavy navigation lands right.** Outline clicks and mode switches in image-heavy documents land where they should.
- **Outline highlight follows scrolling.** The outline highlight follows scrolling in both WYSIWYG and Source mode, including after a cold open or mode switch.
- **Duplicate headings work.** Clicking the second of two identically titled headings goes to that heading.
- **Collapse state survives typing.** Collapsed outline sections and the highlight no longer reset while you type or rename a heading.
- **Correct heading list.** The outline lists Setext headings, ignores `#` lines in code blocks, and jumps correctly in CRLF documents.
- **TOC navigation in all modes.** Clicking a TOC entry navigates in every view mode, with heading anchors matching between renderer and outline.
- **Unique heading anchors.** Exported HTML and the outline no longer give two headings the same anchor.
- **Anchors on every heading.** Headings named "Title", "Name", "Body", "Location" or "Forms" keep their anchor in export.
- **Clean packaged console.** Packaged builds no longer log Content-Security-Policy errors at launch.
- **Agent edits don't eat typing.** HTTP table actions and MCP inserts no longer overwrite what you just typed, move your caret, or lose keystrokes typed right after.
- **WYSIWYG inserts show up.** An MCP `insert_content` into the active WYSIWYG document now appears in the editor and is kept.
- **Equal-length edits sync.** Edits that keep the document the same length reach MCP clients without a save.
- **Caret moves sync.** In Source mode, moving the caret updates the MCP cursor.
- **Consistent offsets.** MCP document offsets are UTF-16 code units on both sides, so inserts after an emoji land in the same place.
- **Horizontal rules are safe.** Closing the MCP prompt no longer selects a trailing horizontal rule.
- **Clear locked switch.** With an unreadable `config.json`, Settings → Integrations no longer contradicts itself.
- **Real update errors.** Settings → About shows update-server errors with Check Again instead of "Automatic updates coming soon", and shows that line only when no update address exists.
- **Styled update buttons.** The Install Update and Restart to Apply buttons are styled as primary buttons again.
- **Table documents open fast.** A table-heavy document that froze WYSIWYG for close to a minute now opens in seconds.
- **Heading-dense documents open fast.** Opening a large document with many headings no longer freezes the app for minutes.
- **No stall on broken tables.** Typing in Source mode no longer stalls in a long document with a broken table.
- **Cheaper table cursor moves.** Moving the cursor or linting in a large table no longer copies the whole table.
- **Frontend logging keeps running.** Frontend log records no longer stop a second after launch, and a failed settings read keeps logging off.
- **Uncorrupted log records.** Concurrent writes no longer fuse two log records into one line.
- **Dialog time not counted.** Logged durations no longer include time spent in a file dialog.
- **One action per click.** A single native menu click runs its action once.
- **One Open Recent list.** File → Open Recent is one list for the whole session, whichever window is focused.
- **Window size restored per file.** A window opened for a file comes back at that file's last size and position.
- **Settings rows aligned.** Settings labels and controls are vertically centred.

## [0.3.0] - 2026-04-10

### Added
- **Two-mode editor** — ViewMode simplified to WYSIWYG (⌃4) and Source (⌃2); the old four-mode setup (split / editor-only / preview-only / wysiwyg) is retired. Stored preferences migrate automatically.
- **Inline source reveal** — in WYSIWYG mode, moving the cursor over a link, image, or code span reveals the raw Markdown inline. Press ⌃\` to force-reveal the element under the cursor on demand.
- **Draft migration** — legacy `~/.mdpro/drafts/` auto-save files migrate to the correct platform data directory on first launch.

### Fixed
- Cmd+S no longer causes a visible blink in the mode label (closes #377)
- Highlight toggle now works on existing selections in WYSIWYG mode (closes #376)
- Image src resolves immediately after paste; no more flash of broken image (closes #375)
- MCP `insert_content` checks window focus before injecting (closes #356)
- MCP shadow store rolls back on emit failure; rollback outcome now logged
- MCP insert panics on multi-byte (emoji/CJK) documents (closes #345)
- MCP `mcp_sync_documents` payload size enforced; `log_event` payload capped (closes #316)
- MCP TOML config path escaped correctly (closes #145)
- IPC commands `check_file_modified`, `reload_file`, `copy_external_image` validate paths (closes #351, #346, #266)
- HTML export sanitized with ammonia to prevent stored XSS (closes #246); heading IDs and task-list checkboxes preserved
- Split-view drag listeners cleaned up on unmount (closes #123)

### Changed
- Title bar row removed; mode label moved to the sidebar traffic-lights zone
- ⌃1 (Split) and ⌃3 (Preview Only) removed; ⌃2 now maps to Source

---

## [0.2.6] - 2026-04-02

### Added
- In-app update checker — Settings → About shows version, checks for updates, tracks download progress, and installs with one click

### Fixed
- File watcher no longer triggers on self-writes (closes #291)
- Stale closures eliminated in `useMcpEvents` (closes #284, #254)
- `save_file` validates file extension to prevent arbitrary writes (closes #279, #264, #245, #209)
- TOC heading parser handles CRLF line endings (closes #259)
- Auto-save reads active document ID from store instead of captured closure (closes #220)
- MCP server clears focused window on blur (closes #201)
- `export_html` theme param sanitized with allowlist (closes #193)

### Removed
- Dead `useMilkdown` hook (closes #239)
- Dead `getServerInfo()` from mcpService (closes #195)

---

## [0.2.5] - 2026-04-02

### Fixed
- Highlight and Export HTML shortcuts wired through preferences system (closes #207, #192)
- `dirs::home_dir()` replaces `env::var("HOME")` for portability (closes #176)
- Draft auto-save and deletion errors now logged instead of silently swallowed (closes #163)
- MCP binary path platform guard added for non-macOS builds (closes #185)
- Link modal callback guarded against destroyed editor view (closes #161)
- CRLF normalized before highlight preprocessing in CodeMirror (closes #182)

---

## [0.2.4] - 2026-03-31

### Added
- Settings panel redesigned with 9 sections (Editor, Markdown, Appearance, Export, Keyboard Shortcuts, Integrations, etc.)
- User-configurable keyboard shortcuts — bind any action in Preferences → Keyboard Shortcuts
- CodeMirror compartments for live preference reconfiguration (font size, line wrap, tab size)
- `==highlight==` syntax rendered in WYSIWYG mode (closes #40)
- React modal for ⌘K link insert, replacing `window.prompt` (closes #25)
- Atomic preferences writes with concurrent-save lock

### Fixed
- Settings panel label/control vertical misalignment (closes #78)
- ⌘/ view-cycle only intercepts when the editor is not focused (closes #32)
- Sidebar toggle shortcut documented and corrected to ⌘⇧L (closes #33)

---

## [0.2.3] - 2026-03-22

### Fixed
- ⌘1–6 heading shortcuts in Milkdown WYSIWYG mode (closes #37)
- Inline code and strikethrough keybindings restored (closes #36)
- ⌘0 paragraph shortcut uses `turnIntoTextCommand` correctly (closes #34)
- ⌘⇧H highlight routed to Milkdown command in WYSIWYG mode (closes #35)
- XSS, URL injection, path traversal, and token leak vulnerabilities patched
- TOC click-to-navigate restored in all view modes
- Stale-closure writes and cross-document dispatches guarded in editor store

---

## [0.2.2] - 2026-03-21

### Added
- Image paste into WYSIWYG editor (⌘V) — image saved to `assets/` folder beside the `.md` file, reference inserted automatically
- Find & Replace via ⌘F using CodeMirror search extension (closes #9)
- Drag-and-drop image files onto the editor inserts `![image](path)` (closes #12)

### Fixed
- YAML frontmatter stripped before rendering (closes #15)
- Pasted HTML sanitized; `javascript:` links blocked in WYSIWYG (closes #7, #10)
- Unicode-aware heading slugs for CJK characters and emoji (closes #8)
- CRLF line endings normalized on file read (closes #11)
- Milkdown listener wired to documentStore — fixes Cmd+S data loss after WYSIWYG edits
- Accessibility: DevToolbar `tabIndex=-1`, Escape closes dialogs (closes #13)

---

## [0.2.1] - 2026-02-04

### Added
- MCP Integrations settings panel — configure MCP server from inside the app

### Fixed
- MCP HTTP server stays alive between requests (shutdown sender now retained)
- TOC click-to-jump working in WYSIWYG mode
- MCP HTTP port hardcoded to 55045 for stability

---

## [0.2.0] - 2026-02-04

### Added
- **MCP (Model Context Protocol) server** — expose open documents to Claude Code, Codex CLI, and Gemini CLI. Tools: `get_open_documents`, `read_document`, `write_document`, `insert_content`. Server config at `server.port` and `server.token` in the platform data dir, `dirs::data_dir()/mdpro/` (macOS: `~/Library/Application Support/mdpro/`). *Corrected 2026-09-22 (D8): originally stated `~/.mdpro/`.*
- **Table of contents sidebar** — heading extraction via pulldown-cmark, click-to-navigate, scroll-spy highlighting.
- **Tab bar** — open multiple documents at once with configurable position, close behavior, and MRU tracking.
- **Bottom status bar** — mode tabs at the bottom of the editor window.
- Image service with base64 conversion for bundled assets.

---

## [0.1.8] - 2026-01-29

### Added
- Default view mode from preferences applied when opening files

### Fixed
- Windows close error

---

## [0.1.7] - 2026-01-29

### Added
- Structured JSONL logging to `~/.mdpro/mdpro.log` for debugging production builds

### Fixed
- WYSIWYG mode rendering issue

---

## [0.1.6] - 2026-01-25

### Added
- Multi-window support
- Table formatting in WYSIWYG editor
- Window state persistence across launches

---

## [0.1.5] - 2026-02-03

### Added
- Use default view mode from preferences for file opens (a3a8a5f)

### Fixed
- Windows close error (ee9eb79)

### Changed
- Automate version update in release workflow (601909e)

## [0.1.4] - 2026-02-02

### Fixed
- WYSIWYG mode rendering issue (aaf3c48)

### Added
- Structured JSONL logging for debugging (d5051bc)
