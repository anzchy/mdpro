# Windows audit notes (mdpro 0.3.1 installed, D:\programs\mdpro\tauri-app.exe)
009 PASS single-instance: 2nd launch with path -> 1 process left, log app.single_instance -> file.open.route broadcast -> file.open success
010 PASS UTF-16LE BOM CRLF file renders 中文+emoji, outline lists heading (log encoding UTF-16LE)
011 PASS GBK -> "Can't open this file as UTF-8" dialog, UTF-16LE/UTF-16BE/Cancel, focus Cancel, Esc closes
014 PARTIAL 10,485,761 B refused (log "file too large"); toast via external open: see below
WIN-1 tab label = full verbatim path "\\?\C:\Users\..." not basename; paths everywhere carry \\?\ prefix
WIN-2 New Document tooltip "(⌘N)" mac glyph
WIN-3 native menu has macOS-only mdpro>Services/Hide(Ctrl+H)/Hide Others/Show All; Redo is Ctrl+Y; Ctrl+H = Hide (replace shortcut conflict?)
055 LEDGER WRONG: WYSIWYG renders footnote ref (sup 1) + definition block (dl footnote_definition)
GFM task list in WYSIWYG: no checkbox UI (data-checked only)
watch baseline "failopen" on open (file.watch.register baseline=failopen)
014 PASS toast "Failed to open file" appears on oversized external open (MutationObserver caught it)
WIN-4 MENU ACCELERATORS DEAD (synthetic keybd_event): Ctrl+S, Ctrl+N, Ctrl+2, Ctrl+4, Ctrl+Shift+L, Ctrl+W never fire (no ui.menu.select log), whether focus is in the editor or the title bar. Same actions via real mouse click on the native menu work (menu.file.save -> file.save success). In-page keys (Ctrl+Z) work. NEEDS HUMAN CONFIRM with physical keyboard.
049 PASS Ctrl+Z undo (in-page CodeMirror/ProseMirror)
Injected WM_COMMAND / WM_MENUCOMMAND are ignored by the menu; real mouse clicks work (tooling note)
Chinese IME (微软拼音) active: typed letters get composed -> use CDP insertText for text
001 PASS via menu click (menu.file.new -> tab.open Untitled)
016 FAIL on Windows: own save -> watcher "remove" (self_write, suppressed) then "modify_name to" with ownEvent=false, unchangedCheck=unstable -> emitted_modified -> reload-prompt "External change detected" after every save (work1.md 22:22:47)
006/018 PASS via menu Close on dirty Untitled: "Unsaved changes / Keep editing / Discard changes", initial focus Keep editing; Discard closes. (Enter-keeps via CDP key not conclusive)
012 PASS UTF-16LE+BOM+CRLF saved via menu: FF FE BOM kept, 3 CRLF 0 LF, appended text present
016 detection PASS for a real external append (modify_any -> reload-prompt in ~300ms); self-save false prompt reproduced again on work16.md (UTF-16)
017 PASS Reload reloads in place (file.reload, editor.milkdown.reload generation 2, new line visible)
019 PASS draft.write every 30s after an unsaved edit (157 bytes)
020 PASS kill -> relaunch -> "Recover drafts" lists work1 + utf16 drafts with Recover/Discard; Discard deletes, Recover restores DRAFTPROBE (reason draft-recovery). Cosmetic: timestamp shown raw ISO UTC with 100ns digits
WIN-5 shortcut collisions on Windows (Mod=Ctrl): inline code Mod-Shift-` == strikethrough Ctrl-Shift-`; heading Mod-2/Mod-4 == View Source/WYSIWYG Ctrl+2/Ctrl+4
027 PASS Ctrl+B / Ctrl+I (in-page) -> strong/em
028 PASS Ctrl+3 -> h3, Ctrl+0 -> p (in-page)
029 FAIL on Windows: Ctrl+Shift+` produces <del> (strikethrough wins the collision); inline code unreachable by keyboard
030 PASS Ctrl+Shift+` -> del
033 WYSIWYG Ctrl+Shift+H no effect (menu accelerator path)
049 PASS Ctrl+Z undo; redo by Ctrl+Y and Ctrl+Shift+Z both work
031 UNCLEAR: Ctrl+K opens "Insert Link" modal (ui.link-modal.open), submit logged (urlLength 11) but no <a> inserted on the Shift+Home selection; may be a harness artifact -> needs human
032 PARTIAL: javascript:alert(1) produced no link (silently, no error shown); example.com path not observable (see 031)
077 PASS Source Ctrl+F opens CM search/replace panel; Esc closes
078 PASS Source Ctrl+3 -> "### "
079 PASS Ctrl+- deeper (#### ), Ctrl+= back (### )
080 PASS Source Ctrl+K -> Insert Link -> [srcword](https://example.com) (also shows 032 https auto-prefix)
WIN-4 ROOT CAUSE (code, c8bd2b6): src/hooks/useKeyboardShortcuts.ts:84-86 matchesShortcut: primaryMod = isMac ? metaKey : ctrlKey; then `if (wantCtrl !== event.ctrlKey) return false` -> on Windows every "Cmd+X" binding (wantCtrl=false, ctrlKey=true) is rejected. All app shortcuts dead on Windows: Save, New, Open, Close, Export HTML, Toggle sidebar, Preferences, Insert table, table row/col shortcuts. Native menu accelerators also never fire (WebView2 focus). Menu clicks work.
060/061 table keyboard shortcuts: unreachable on Windows (same root cause)
058 PASS WYSIWYG right-click on a cell: Insert above/below, column left/right, Move row/col, Reformat, Delete row/col/table; menu clamped inside viewport
060 PASS via context menu: Insert row below 4->5 rows (editor.table.insert_row_after)
062 NOTE Move row up enabled on the first BODY row (row 1); ledger says greyed on first row (header?) — not a contradiction unless header intended
059 PASS Source right-click menu full list; Move column left disabled in first column
066 PASS (Source) Tab moves a1 -> start of b1 cell
071 PASS Source active cell has class cm-table-active-cell
088 PASS File > Export HTML... (real menu click) -> native 另存为 dialog -> basic.html 27,178 B (file.export_rendered). NOTE suggested name "basic.md.html" (double extension)
089 PASS 2 <math>, one display=block, no <script> anywhere
090 PASS footnote ref -> #1 (exists), backref ↩ -> #fnref-1
091 PASS bare URL linked, :smile: -> 😄
092 PASS task checkbox, del, mark, table
093 PASS(Stub as stated) mermaid stays code block (language-mermaid), no svg
094 PASS no <script>, no javascript: href
102/114/115 literal [[wikilink]] / [@citekey] in export (Absent as stated)
WIN-6 at 270% display scaling a 1672x1136 px window is ~667 CSS px wide: sidebar squeezed to ~25 CSS px, TOC text clipped ('TA/OI/CC'), entries unclickable (narrow-window layout)
103 PASS (maximized, 1120 css px) outline click scrolls heading to top (scroll_anchor source=toc)
108 PASS WYSIWYG->Source keeps "Section 5" at top (scroll_anchor capture block/heading -> restore tier block)
081 PASS Source shows "H2" badge for "## Section 5" off the cursor line
104 PASS View>Toggle Sidebar hides/shows (220px), one preferences.set per toggle
121 PASS Theme>Dark -> html.theme-dark bg rgb(15,17,21); Theme>Light -> theme-light. Dark: editor scrollbar stays light (native Windows scrollbar)
130 PASS Integrations shows MCP Running, localhost:55045, Start on launch / Auto-approve toggles
137 PRESENT Install buttons for Claude Desktop / Claude Code / Codex CLI / Gemini CLI (not clicked: would write user client configs)
139 PASS /api/status: no token 401, wrong token 401, right X-MDPRO-Token 200 {"version":"0.3.1"}, foreign Origin 403
141 PASS POST /api/documents/new -> 201 id
133 PASS mdpro_mcp.exe initialize (mdpro MCP Server 0.3.1), tools/list = 4 tools, get_open_documents returns tabs (titles basename; paths \\?\)
169 PASS About auto-check -> "You're up to date" (ui.about.update_check hasUpdate false)
172 PASS About "Version v0.3.1"
154 Windows: Keyboard Shortcuts page lists mac labels "Cmd+N/Cmd+S..." on Windows (and none work, WIN-4)
145 NOTE Advanced shows mac path "~/.mdpro/mdpro.log"
153 PASS 10 pages, all fit at 1120x653 css px (maximized)
160 PASS File>New Window -> second window (window.create, default geometry at 76,76; cascade not tested with a 3rd)
164 PASS Window>Close closes the focused window (close guard: no_unsaved_closing -> allowed_close). Window menu = Minimize(Ctrl+M) / Maximize / Close(Alt+F4)
168 WIN: mdpro menu shows About / Preferences / Services / Hide (Ctrl+H) / Hide Others / Show All / Exit / Stop Waiting and Quit...; Hide clicked -> window stays visible (mac-only predefined items are no-ops on Windows)
167 WIN: native menu bar exists on Windows with 8 menus (mdpro File Edit View Format Theme Window Help)
141 visible: HTTP-created doc "# from HTTP" appears as a new Untitled tab
005 PASS (as stated) Untitled + File>Save -> native 另存为 dialog; cancel logs file.save cancel. No Save As menu item; Ctrl+Shift+S unbound (and all Cmd shortcuts dead on Windows anyway)
106 PASS View>Source / View>WYSIWYG via menu (menu.view.set_mode)
109 PASS mode label "SOURCE"/"WYSIWYG" at top of the sidebar (no traffic lights on Windows)
tooling: after a second window is closed, GetMenu(main) returns an invalid HMENU (count -1) though real clicks still work -> drive menus by coordinates
082 INCONCLUSIVE real Ctrl+Alt+/ on a source line: no change (Ctrl+Alt = AltGr on Windows; or no-op)
124 PASS Preferences>Editor font size + : editor 16px -> 17px live; - restores 16px
044 FAIL (Windows, files opened via single-instance/second launch): <img> src http://asset.localhost/%2F%2F%3F%2FC%3A%2F...red.png (\?\ prefix -> //?/C:/...), naturalWidth 0, broken-image icon
044 ROOT CAUSE: CSP img-src = 'self' asset: https://asset.localhost https: data: ; Windows asset URLs are http://asset.localhost/... -> securitypolicyviolation img-src (caught in page). Local images never render on Windows (also via File>Open plain path; data: URL of same PNG loads fine). Affects 035-040 display too.
002 PASS File>Open... -> native 打开 dialog -> file.open source=dialog, plain path C:\... (no \\?\ prefix via dialog)
173 FAIL on Windows: mdpro > Exit with several dirty tabs -> process gone at once, NO quit prompt, no app.quit / quit-guard log lines (predefined Quit item bypasses the guard)
140 FAIL on Windows: after Exit, %APPDATA%\mdpro\server.port and server.token still exist
173 mitigation: relaunch -> Recover drafts lists the 4 dirty docs (drafts <=30s old survive)
