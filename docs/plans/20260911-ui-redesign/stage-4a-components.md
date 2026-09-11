# UI redesign plan — Stage 4a: components

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 4 — Component changes (Deliverable C; items 2, 4, 5, 6, 9, 13, 14; DR2, DR3, DR5, DR6, DR7, DR8, DR9, DR11, DR16, DR18, DR19, DR20, DR21, DR22)

**Entry:** Deliverable B visually signed off.

Each work item captures before/after screenshots per item × theme, and the stage ends with `/qa-only`. New UI behavior logs per CLAUDE.md "Logging Rules" (rule 20).

### WI-4.1 — Source syntax HighlightStyle (item 2, D3) — M
- Replace `defaultHighlightStyle` (`syntax.ts:3`) with an mdpro `HighlightStyle`:
  - markers use `--color-syntax-markup`
  - URLs, link targets and HTML use `--color-syntax-meta`
  - everything else, including inline and fenced code, uses `--color-text`
- Add both syntax tokens to `:root` (proposal :25-26).
- Keep the `editorPrefApply.ts:183-186` One Dark path unchanged (DR20). Only the "Default" branch switches to the new HighlightStyle.
- **Tests:** extract the tag→style mapping into a pure module. Assert:
  - marker tags map to the markup token
  - meta tags map to the meta token
  - no code-hue token is referenced anywhere (D3 guard)
  - the One Dark switch still returns the One Dark extension

### WI-4.2 — One Icon wrapper (item 4) — M
- **Dependency gate (A7):** if an icon library seems necessary, stop and ask. Name the candidate and describe the inline-SVG alternative.
- Add one `Icon` component (assumption: `src/components/common/Icon.tsx`):
  - inline SVG with `stroke: currentColor`
  - default color `--color-muted`
  - sized with the icon-size tokens
- **Replace every glyph or emoji used as an icon.** Use one close glyph and one chevron (review item 4). Inventory at the baseline; preflight re-greps `src/**/*.tsx`:
  - Settings rail icons: `SettingsDialog.tsx:30-38`
  - close buttons: Settings `SettingsDialog.tsx:138` (`&times;`), tab close `BottomTabs.tsx:73` (`×`), and the WI-4.13 toast "Dismiss" button when it lands
  - TOC carets: `TOCSidebar.tsx:68` (`▸` / `▾`)
  - Integrations: copy buttons `IntegrationsSettings.tsx:220`, `:267` (📋); "Test Connection" `:236` (↻); installed status `:256` (`✓` / `○`), which keeps a text label (DESIGN.md § Status indicator)
  - About update status: `AboutSettings.tsx:224`, `:282` (`✓`)
  - Shortcuts conflict warning: `KeyboardShortcutsSettings.tsx:252` (⚠️)
- **Not icons:** `⌘` and `⌥` in shortcut labels and titles, and the `×` in the table size readout (`TableInsertModal/index.tsx:206`). The dead `TabBar/`, `FileItem.tsx` and `Preview/` are out of scope (A8).
- **Bottom tab markup:**
  - Today the close control is a `span role="button"` inside the tab's `button`, with no name and no key handling (`BottomTabs.tsx:59-75`).
  - Each tab becomes a wrapper holding two sibling buttons: the tab, named by its title with `aria-current="true"` when active, and "Close *name*" with the close icon.
  - The close button also shows while focus is inside the tab.
  - The `+` button (`BottomTabs.tsx:54`) gets the plus icon and the name "New Document". The `nav` (`:48`) is named "Open documents".
  - **Rule edit:** rule 32 § Tab bar describes these bottom tabs instead of the unmounted `TabBar` classes.
- **Tests (by role and name):**
  - decorative icons are `aria-hidden`
  - icon-only buttons keep an accessible name
  - source inspection: no inventory glyph or emoji remains in the listed files
  - bottom tabs (userEvent, by role): each tab is a button named by its title beside a "Close *name*" button, and no button contains another interactive element. Enter on "Close" closes the tab, with the Discard confirmation when it has unsaved edits. Only the active tab has `aria-current`

### WI-4.3 — Settings row contract and ToggleSwitch (item 5, E4) — M
- **Row markup** (DESIGN.md § Settings rows; review :131-134 offered selectors or migration, and this plan migrates):
  - All eight panels with rows move to one markup, whether or not the proposal draws them (it draws Integrations, Export and Editor): Advanced, Appearance, Editor, Export, General, Image, Markdown and Integrations.
  - Markup: `.settings-row` › `.settings-row-content` › `.settings-row-label` (an `h4` title with an id, then an optional `p` description) and `.settings-row-control`.
  - Integrations moves from `strong` / `span.settings-row-description` (`IntegrationsSettings.tsx:137-141`, `:165-169`, `:187-191`) to `h4` / `p`.
  - The `<label htmlFor>` wrappers around `h4` / `p` go (Advanced, Appearance, Export, Image and Markdown today; preflight re-counts), because a `label` can't hold a heading. Each control takes its name from its row's `h4` through `aria-labelledby`.
  - CSS: `.settings-row-label h4` and `.settings-row-label p` replace `.settings-row-label strong` and `.settings-row-description` (`globals.css:1296`, `:1301`). Panel-scoped rules must not reach row titles: `.settings-integrations h4` (`:1215`) and `.settings-general p` (`:1117`) today; preflight lists the rest.
  - Keyboard Shortcuts and About have no rows. They keep their layouts and take the same type steps, section labels and dividers.
- Extract `src/components/common/ToggleSwitch.tsx`:
  - it renders the label, the input and `.toggle-slider`
  - it exposes `role="switch"` with `aria-checked`, and gets its accessible name through `aria-labelledby` pointing at the visible row heading
  - its visually hidden input gets a keyboard focus ring: add `.toggle-switch input:focus-visible + .toggle-slider` using the rule 33 pattern (there is none today, `globals.css:1314-1356`)
  - it replaces every checkbox input in Settings: nine inputs in six files (re-count in preflight)
    - three hand-copied toggles in `src/components/common/IntegrationsSettings.tsx` (`:152`, `:174`, `:196`)
    - six native checkboxes in the other five files: `EditorSettings`, `MarkdownSettings` ×2, `ImageSettings`, `ExportSettings`, `AdvancedSettings`
- **States** (DESIGN.md § States › Settings). Files below are in `src/components/common/settings/` unless a path is given.
  - **Loading:** every page shows one muted "Loading…" line with `aria-busy="true"` and no inline style.
    - Today six pages dim it with `style={{ opacity: 0.5 }}`: Appearance `:67`, Editor `:63`, Export `:87`, General `:87`, Image `:100`, Markdown `:62`.
    - Shortcuts shows "Loading shortcuts…" in an inline color (`KeyboardShortcutsSettings.tsx:229`).
    - Integrations shows "Loading MCP server status..." (`src/components/common/IntegrationsSettings.tsx:119`).
  - **Load failed:** every page shows "Failed to load preferences. Please close and reopen settings.", the line General (`:73`) and Editor (`:49`) already use.
    - Today Appearance, Export, Image and Markdown render the raw error message (`:54`, `:74`, `:87`, `:49`), and Shortcuts does too (`:221`). Raw messages go to the log only (rule 30 rule 3).
    - Integrations keeps its own failure line for the MCP status read, without the raw message (`IntegrationsSettings.tsx:45`, `:128-130`).
  - **Save failed:** the `preferencesService` error toast (WI-4.13) is the only signal (rule 30 rule 5).
    - Remove the second, inline signals: Image `:75-76`, Export `:49-50`, and the Shortcuts `saveError` (`:212-213`, `:248`).
    - Switches and selects roll back to the saved value, as `MarkdownSettings.tsx:30-39` already does. The page stays usable. A failed Shortcuts save keeps the unsaved banner and the dialog open.
    - The unsaved banner (`.settings-dirty-banner`, `globals.css:1059-1068`) drops its amber literals for `--color-accent-soft` fill and a `--color-accent` border, matching the tab's unsaved dot (DR21). Its text stays `--color-text`.
  - **Logging settings:** `AdvancedSettings` drops its inline `saveError` (`:22`, `:37`, `:53`, `:64`), rolls the control back and relies on the error toast. WI-4.13 makes the service reject, so this catch runs at all.
  - **MCP config read:** `SettingsDialog.tsx:91-97` calls `getPreferences().then(...)` with no catch, so a failure is an unhandled rejection. Add a catch that logs `fail`; the Integrations page shows its own state.
  - **Busy labels:** the Integrations action buttons read "..." while busy (`IntegrationsSettings.tsx:280`, `:287`, `:296`). They become "Updating…", "Removing…" and "Installing…" (rule 30 rule 4).
- **Tests:**
  - ToggleSwitch behavior, written once with `userEvent` (E7):
    - role, with its name coming from the row heading
    - `aria-checked` follows the value
    - click and Space toggle it
    - Tab reaches it and it receives focus
    - when disabled, it ignores both click and Space
  - A source-inspection assertion that the `:focus-visible` rule for `.toggle-slider` exists.
  - **CRITICAL regression:** one table-driven test over every replaced site asserts that toggling still writes the same preference key and value as before.
  - Update `tests/settings-row-layout.test.ts`.
  - Table-driven over every settings row: the control's accessible name equals the row's `h4` text.
  - Source inspection: no `strong` row title and no `settings-row-description` remain in the settings panels.
  - States, table-driven over every settings page with `preferencesService` mocked at the boundary:
    - a pending load shows one busy "Loading…" line
    - a rejected load shows the shared failure line and not the raw message
    - a rejected save leaves no inline error, and a switch or select returns to its saved value
  - A rejected logging-settings save rolls the `AdvancedSettings` control back and renders no inline error
  - A rejected MCP config read in `SettingsDialog` logs `fail` and raises no unhandled rejection

### WI-4.4 — Running badge and toggle track (item 6) — S
- `.mcp-status-badge.running` (`globals.css:1371-1372`, pre-split reference): a dot plus muted text, no fill (review :146).
- Toggle off-track (the `#ccc` at pre-split `globals.css:1335`): a text-based `color-mix` (review :147). This removes the last `stage: 4` deferred entry.
- No semantic green token unless the user asks (review :146).
- **Tests:** the tokenization test covers the literals; the badge keeps its text label, so status is not conveyed by color only (rule 33 hard rule).

### WI-4.5 — Source | WYSIWYG segmented control (item 9) — M
- Replace `.sidebar-mode-label` at `App.tsx:1128` and `Sidebar/index.tsx:39` with one control, mounted once in the WI-4.8 main bar so it shows in both sidebar states (review :185). Runs after WI-4.8.
- Styling follows proposal :114-120 and review :183-184.
- The native menu shortcuts (⌃2 / ⌃4) keep working, and the control reflects the current mode.
- **Semantics:** a radio group named "Editor mode", with one radio per mode.
  - Only the checked radio is in the Tab order (roving `tabindex`). Arrow keys select the previous or next mode, and Home/End select the first or last.
  - The Source font preference (WI-5.2) uses the same component, named by its row title (WI-4.3).
  - The control does not clip a segment's pattern 2 outline.
- **Tests (userEvent, by role):**
  - clicking a segment switches the view mode through the existing store action
  - a radio group named "Editor mode" shows the current mode as checked, and only that radio has `tabindex` 0
  - ArrowRight, ArrowLeft, Home and End switch the mode through the store action, and focus follows
  - the store-driven mode change updates the selection
- **Logging:** `ui.mode_switch.click` per rule 20 (name to be confirmed against existing events).

### WI-4.6 — Destructive confirmation (item 13, DR8) — S
- **Why:**
  - `ConfirmDialog` gives `autoFocus` to its confirm button (`ConfirmDialog.tsx:51-53`). The mounted Discard callers are `App.tsx:1180` and `BottomTabs.tsx:83`; at each, pressing Enter right after the dialog opens discards unsaved text. `Sidebar/Sidebar.tsx:53` is a third, but that component is not mounted (A8).
  - It also misses rule 32 in three ways:
    - no Tab trap
    - `aria-label` instead of `aria-labelledby` and `aria-describedby` (`:37`)
    - no backdrop click
  - `BottomTabs.confirmClose` awaits the close before it clears `pendingCloseId`, so the dialog stays open while the work runs and a second press runs it twice. `App.tsx` already clears first.
  - Neither caller catches a failed close, so it fails silently (rule 60).
- **Change:**
  - Add `destructive?: boolean` (assumption: the prop name).
    - With it, the confirm button uses the existing `.toolbar-button.danger` (`globals.css:1195`), and focus starts on the cancel button ("Keep editing"). The danger button never takes focus.
    - Without it, the confirm button keeps `autoFocus`, as in the About page's "Save and Restart" dialog (`AboutSettings.tsx:306`).
  - Pass `destructive` at both mounted Discard callers.
  - **A choice closes the dialog** (DESIGN.md § States › Dialogs): both callers clear their pending state before awaiting the close, so nothing can be pressed twice.
  - **Close failed:** both callers catch the rejection, log `fail`, and show one error toast (WI-4.13) that starts "Close failed". The tab stays open.
  - The rule 32 shell applies to every caller:
    - Title and message ids are wired to `aria-labelledby` and `aria-describedby`.
    - Tab and Shift+Tab wrap inside the dialog, following `handleDialogKeyDown` in `SettingsDialog.tsx`.
    - A backdrop click cancels; a click on the card stops propagation.
    - Esc still cancels.
  - On close, focus returns to the element that had it before the dialog opened, if that element is still in the document. A closed tab's button is gone, for example.
  - **Rule 32:** in the same commit, add an exception to "First-focused element is the most-likely-edited control, not title/cancel": when the primary action is destructive, focus starts on the safe action. This covers WI-4.10 (DR5) too.
- **Tests** (through tdd-guardian, RED first; query by role and name, use `userEvent`):
  - **Data-loss regression:** with `destructive`, pressing Enter right after open does not call `onConfirm`. This test fails today.
  - With `destructive`, the confirm button has the danger variant and isn't focused. Without it, the confirm button is focused.
  - Tab from the last button wraps to the first, and Shift+Tab wraps back.
  - A backdrop click cancels; a click inside the card doesn't.
  - Focus returns to the opener on close.
  - At each mounted caller, pressing the confirm button twice calls the close once, and the dialog is gone before the close resolves.
  - At each mounted caller, a rejected close shows one error toast, leaves the tab open and leaves no dialog.
  - `tests/focus-trap.test.ts:44-58`: keep the Escape checks, and assert that `autoFocus` depends on `destructive`.
- **Logging:** keep `dialog.confirm.cancel` and `dialog.confirm.confirm`, adding `context.destructive`. Add `context.trigger: "backdrop"` when a backdrop click cancels.

### WI-4.7 — Settings rail (item 14) — S
- `--settings-sidebar-bg` → `var(--color-surface)` in both theme files.
- `.settings-category-btn.is-active` uses the rule 31 active pattern; hover uses `--color-hover`.
- Retire `--settings-btn-hover-bg` / `--settings-btn-active-bg` from `light.css`, `dark.css` and `globals.css :root` once no consumer remains.
- **Semantics:** the rail (`SettingsDialog.tsx:142-157`) becomes a vertical tab list named "Settings", and `.settings-main` is its tab panel, labelled by the active tab.
  - Only the active tab is in the Tab order (roving `tabindex`). Up/Down open the previous or next page, and Home/End open the first or last, so Tab goes from the rail straight into the page.
  - Initial focus moves from `firstNavRef` to the active tab, which is the first page when the dialog opens.
  - Focus always sits on the selected tab, so the accent-soft fill cannot show it. The focused tab adds the inset `--color-focus-ring` ring that TOC rows use (DR15).
  - Page changes by arrow key log `settings.category.<id>`, as clicks do.
- **Narrow dialog (DR16):** at the 400px minimum window the dialog is 360px wide (`globals.css:860`), and the 220px rail (`:905`) would leave a 140px page.
  - The dialog is a size container. Below the width where the rail and a usable page stop fitting (assumption: 560px, confirmed against the widest page at preflight), the rail shows icons only.
  - Each tab keeps its name: the label is visually hidden, never removed or `aria-hidden`, so the tab test below still finds it by name. The name also shows as a tooltip.
  - Settings rows (WI-4.3 markup) wrap in a narrow page: the control moves under the title and description.
- **Rule edit:** rule 33 pattern 3 says settings categories add the inset ring, because focus sits on the selected tab.
- **Tests:**
  - a source-inspection assertion that both retired tokens are neither declared nor consumed anywhere in app CSS
  - (userEvent, by role) the rail is a tab list named "Settings" with one tab at `tabindex` 0; ArrowDown, ArrowUp, Home and End change the page and the panel's label; Tab from the rail lands inside the panel; `tests/focus-trap.test.ts` stays green

### WI-4.8 — Main bar and status strip (D1 structure, DR2) — M
- **Order:** runs before WI-4.5, which mounts its control in this bar.
- **Layout bug below 960px:**
  - The 960px query sets `.app-shell` to one column but keeps the two-column areas (`globals.css:79-89`, `:1548-1551`). By the grid spec, with the sidebar shown the sidebar gets the flexible track and the main column sizes to its content.
  - WI-0.4 confirms this with a 900px capture. WI-4.8 removes the `.app-shell` override.
  - The `.split-*` rules in that query style the dead Preview split and stay with it (A8).
- **Narrow windows (DR16):** the minimum window stays 400×640 (`src-tauri/tauri.conf.json`). With the sidebar shown, the main column is then 180px.
  - The segmented control never shrinks. The breadcrumb takes the rest of the bar and ellipsizes in the DR4 order: folder first, then file name.
  - The status strip stays one line and is a size container. As it narrows it hides line ending first, then encoding, then word count. The cursor position always stays in Source. WYSIWYG has no cursor field (DR19), so word count stays there.
  - Each threshold is measured at preflight from the widest realistic values of the fields still shown (for example `Ln 12,345, Col 234`, `123,456 words`, `Windows-1252`, `CRLF`), so a field hides before anything clips.
  - Separators are spacing or borders on the fields, not text between them, so a hidden field leaves no dangling separator.
  - These rules are CSS only. Screenshots at 400×640 in both sidebar states and at 959px check them (Appendix B), not unit tests (rule 10).
- **Main bar** (proposal :143-146, :384-385; DESIGN.md § Main bar):
  - One bar at the top of `.main`, rendered in both sidebar states. It replaces `.main-traffic-area` (`App.tsx:1126-1130`), which today renders only when the sidebar is hidden.
  - Height `--title-bar-height` (`globals.css:18`), the height of the proposal's bar and of `.sidebar-traffic-area`, so the two top edges line up. Hairline bottom.
  - The bar background is the window drag region (`data-tauri-drag-region`). The breadcrumb and the segmented control opt out with `data-tauri-drag-region="false"`, as `.sidebar-mode-label` does today.
  - Sidebar hidden: the left padding uses `--traffic-lights-clearance-main` (rule 31 § Layout tokens). Sidebar shown: `.sidebar-traffic-area` keeps its drag region and loses the mode label. The sidebar heading text changes from "Table of Contents" (`Sidebar/index.tsx:41`) to "Contents" (proposal :367; DESIGN.md § Layout); update any test that queries the old text.
  - Left: the breadcrumb (DR4). Right: the WI-4.5 segmented control.
  - **Breadcrumb rules (DR4):**
    - A saved document shows its parent folder name, muted, then " / " and the file name in text color. The name logic matches `getDocumentTitle` (`BottomTabs.tsx:14-20`). Extract a shared pure helper rather than a second copy.
    - An unsaved document (`path` null) shows "Untitled" with no folder.
    - When space runs out, the folder shrinks and ellipsizes first. The file name ellipsizes only once the folder is gone.
    - The full path appears only in a tooltip (rule 30 rule 3).
    - It is not clickable and carries no unsaved mark, because the tab already shows that (rule 30 rule 5).
  - `.busy-indicator` (`App.tsx:1131-1135`) stays between the bar and `.workspace`.
- **Status strip** (proposal :158-160, :421-427; DESIGN.md § Status strip):
  - The last child of `.main`, below `.workspace`. The bottom tabs stay full width below it.
  - Fields: cursor position, word count, encoding and line ending.
    - Encoding and line ending come from the active document (`src/types/document.ts:12,15`).
    - Cursor: `editorStore.setCursor` (`editorStore.ts:92`) has no caller at the baseline (grep), and `tabStore` keeps a per-tab `cursorPosition` (`tabStore.ts:12`). Preflight picks one of these as the source and adds no third. In WYSIWYG the field is omitted and no position mapping is built (DR19).
    - Word count is new: a pure util following DR18, recomputed off the keystroke path with a debounce (assumption — confirm the interval against a file near the 10MB limit).
      - Input is the document's Markdown, not editor DOM, so both modes show the same count.
      - First remove what isn't prose: front matter at the start of the file, fence lines (the code between them stays), ordered-list numbers, link and image destinations, autolinks and HTML tags.
      - Then count each `\p{Script=Han}`, `\p{Script=Hiragana}` and `\p{Script=Katakana}` character as one word, and each remaining run of `\p{L}`, `\p{M}` and `\p{N}` as one word. An apostrophe inside a run keeps it whole (`don't` = 1; assumption — confirm).
      - Regex with Unicode property escapes only: no `Intl.Segmenter`, no Markdown parser. Both exist in Safari 16.2 and Node.
  - Render-if-nonzero (rule 30 rule 2): unknown or zero fields are omitted. With no active document the strip is not rendered.
  - No "Commands ⌘K" hint (Q11).
  - **Semantics:** a group named "Document status", not a live region, so cursor moves and typing are never announced. Every value is visible text.
- **Tests:**
  - word-count util (DR18): `don't stop` = 2; `你好世界` = 4; `Hello 世界` = 3; `안녕 하세요` = 2; `## **Bold** [link](https://example.com)` = 2; code inside a fence counts and the fence lines don't; front matter, `1.` list numbers and HTML tags don't count; empty input and marker-only lines = 0
  - field formatter: drops unknown and zero fields, and never emits a dangling separator
  - breadcrumb helper: nested path gives folder and name; root-level file; `path` null gives "Untitled" with no folder; a name with no extension
  - component (userEvent, by role): exactly one mode control exists in both sidebar states; the drag-region attribute is on the bar background and not on its controls; the strip is absent with no document; the strip is a group named "Document status" with no `aria-live`; in WYSIWYG the strip has no cursor field, and switching to Source shows it
  - Source cursor wiring: a selection change updates the chosen store
- **Logging:** none. The bar and strip add no user action beyond WI-4.5's.

### WI-4.9 — Empty state (DR3) — S
- **Order:** runs after WI-4.8, which already hides the strip with no document.
- **When:** no active document, i.e. a launch with no file paths (`App.tsx:1053-1062`) or closing the last document (`documentStore.ts:116-117`). Today `.workspace` then renders a blank editor (`App.tsx:1136-1146`; SplitView with `readOnly`).
- **Launch:** the empty state waits for the launch open check. It renders only once `launchPathsComplete` is true (`App.tsx:110`; set at `:1061`, `:1068`, `:1071`), and before that the editor column is blank on `--color-editor-bg`. A Finder launch waits for preferences, then `get_launch_paths` (retried once after 300 ms, `:1053-1062`), then `openPaths`, so without the wait "No documents open" would flash before the file appears. The launch view-mode effect already waits on the same flag (`:295`).
- **Where:** inside `.workspace`, in place of the editor, while there is no active document.
  - Preflight: confirm that not mounting either editor with no document does not break the launch view-mode effect (`App.tsx:293-305`) or the first Milkdown mount when a document opens.
- **Content** (DESIGN.md § Empty state; proposal :284-286, :607-609; DR1):
  - A muted file icon and the title "No documents open".
  - Two buttons: **New Document** (primary) calls the same `createDocument()` as ⌘N (`App.tsx:997`), and **Open…** (secondary) calls `handleOpenDialog` (`App.tsx:516`). Each button shows its shortcut in `kbd`.
  - A muted line "or drop a Markdown file here". The existing drop handler already opens `.md` / `.markdown` files with no document open (`App.tsx:802-840`). The copy does not mention images. During a drag, the frame becomes the drop target (WI-4.12).
- **Main bar with no document:** the bar still renders, keeping the drag region and traffic-light clearance, but the breadcrumb and the segmented control are not rendered.
- **Contents sidebar with no document:** no message. Today `TOCSidebar` shows "No headings found in this document." whenever `entries` is empty (`TOCSidebar.tsx:107-115`), even with no document to have headings. The message stays for an open document with no headings.
- **Focus:** nothing is auto-focused. Both buttons are in the normal tab order and use the rule 33 button focus ring.
- **Tests** (component, userEvent, by role):
  - With no active document, the heading and both buttons are present, and neither editor is mounted
  - Clicking **New Document** creates a document through the same path as ⌘N; clicking **Open…** reaches the open dialog (Tauri mocked at the boundary)
  - After a document opens, the empty state is gone and the editor mounts
  - Before the launch check completes, neither the empty state nor an editor renders, and a launch with a file path never renders the empty state (assumption: a pure helper picks blank, empty or editor from the flag and the active document)
  - The bar's breadcrumb and mode control are absent with no document
  - With no active document the Contents sidebar renders no message; an open document with no headings still shows "No headings found in this document."
- **Logging:** `ui.empty_state.new` and `ui.empty_state.open` (rule 20), each with the action id passed into the reused handler, so the existing `file.*` events share it.

### WI-4.12 — Drop target (DR7) — S
- **Order:** Lane B, after WI-4.10. It shares `App.tsx` with that lane and restyles WI-4.9's frame.
- **Why:**
  - The listener at `App.tsx:877-881` acts only on `drop` and ignores `enter`, `over` and `leave`, so nothing changes while a file is dragged over the window.
  - A drop with no Markdown or image file only writes a `file.open.drop` cancel log (`:823-836`). The user sees nothing.
  - WI-4.9's empty state tells people to drop a file.
- **Classify once:** extract the split at `App.tsx:806-816`, and `IMAGE_EXTENSIONS` at `:711`, into a pure helper such as `classifyDrop(paths, hasActiveDocument)`.
  - It returns a discriminated union with the Markdown and image counts, and callers handle it with an exhaustive switch.
  - The hover label and `handleFileDrop` both use it, so the label can't promise something the drop won't do.
- **Drag state:** a hook (for example `useDropTarget`) owns the `onDragDropEvent` listener. `App.tsx` is already far past the 300-line limit (rule 50).
  - `enter` classifies `payload.paths` and shows the target.
  - `over` is ignored; the pointer is not tracked.
  - `leave` and `drop` clear the target. `drop` then routes the paths.
  - Window blur also clears it, in case `leave` never arrives (assumption — confirm with a drag cancelled by Esc in `pnpm tauri dev`).
- **Look and copy:** DESIGN.md § Drop target has the full state table.
  - With a document open, an overlay covers `.workspace` (`App.tsx:1136-1146`).
  - In the empty state, WI-4.9's frame changes instead; there is no second frame.
  - No label mentions tabs.
- **Behavior change:** a drop with no supported files shows one toast, "Only Markdown and image files can be dropped". Every other drop keeps today's behavior, including the toast for images with no document (`App.tsx:723-724`).
- **Stacking:** if the overlay needs a z-index to paint over the editor, add a "Drop target" row to rule 31's z-index table in the same commit, below "Dialog backdrop".
- **Tests** (through tdd-guardian, RED first):
  - `classifyDrop`: Markdown only, images only, both, neither, uppercase extensions and an empty list, each with and without a document
  - The hook, with `@tauri-apps/api/window` mocked at the boundary: `enter` shows the target; `leave`, `drop` and blur clear it; `drop` passes the paths on
  - Regression: dropping only unsupported files shows the toast. This test fails today.
  - The label text for each state, queried by text rather than class
- **Logging:** keep `file.open.drop`. Log nothing on hover, because it would fire on every drag.

### WI-4.15 — One menu keyboard contract — S
- **Today:**
  - The table menu handles arrow keys, Home/End and Enter/Space, and focuses the first item on open (`TableContextMenu/index.tsx:132-199`). `SourceTableContextMenu/index.tsx:130-172` copies it.
  - The image menu has none of that. It has no name, its "Resize Image" label is a plain child of the menu, its custom-width form sits inside `role="menu"`, and it does not close on scroll (`ImageContextMenu.tsx:97-117`, `:166-220`).
- **One hook** (assumption: `src/components/Editor/useMenuKeyboard.ts`), used by all three menus:
  - focus the first enabled item on open
  - ArrowDown/ArrowUp wrap, Home/End jump, Enter/Space activate
  - Escape closes and returns focus to the element focused before the menu opened
  - pointerdown outside, resize and scroll close the menu (rule 32)
  - keys are ignored while focus is outside the menu items, so the custom-width input keeps its own arrow keys
- **Image menu:**
  - named "Resize image"; the visible label is hidden from assistive tech
  - the width presets are `menuitemradio`, with the current width checked (the Source table menu already uses `menuitemradio`)
  - the custom-width form moves out of the `role="menu"` element into the same popover. "Custom…" focuses its input, Enter applies, and Escape closes the popover
- **Rule edit:** rule 32 § Context menu contract adds the keyboard list above and names the hook.
- **Tests (userEvent, by role):**
  - hook: arrow wrap, Home/End, Enter activates, Escape closes and restores focus, and keys are ignored in an input
  - image menu: named "Resize image", four `menuitemradio` items with the current width checked, no child that is not an item, and "Custom…" focuses a labelled input
  - the existing table menu keyboard tests stay green
- **Logging:** unchanged (`editor.image.resize`).

### Stage 4 acceptance criteria
- [ ] G0 passes; every work item above has its RED→GREEN tests (rule 10: behavior and ARIA, not rendering snapshots)
- [ ] `defaultHighlightStyle` no longer drives the Source light theme; no `--color-syntax-code` appears anywhere in `src/`; the One Dark path is unchanged (DR20)
- [ ] No new runtime dependency (the E7 test devDependencies are excepted); if an icon library was proposed, the user's decision is recorded
- [ ] No emoji or glyph icons remain at the item 4 sites; icon-only controls have accessible names. Each bottom tab's close control is a sibling button named "Close *name*" that Tab reaches
- [ ] Every boolean setting renders `ToggleSwitch` (E4) and the per-site regression test passes; every switch shows a focus-visible ring in both themes; all eight row panels use the WI-4.3 row markup, and every settings control's name is its row title
- [ ] The Running badge has no fill and a text label; the toggle track has no literal
- [ ] The segmented control is a radio group with one Tab stop. It works by mouse, arrow keys and menu shortcut, in both sidebar states
- [ ] The main bar renders in both sidebar states at `--title-bar-height`, with the breadcrumb on the left (DR4: folder / name, "Untitled", folder truncates first, path only in the tooltip) and the one segmented control on the right. In `pnpm tauri dev` it clears the traffic lights and the window drags from the bar background.
- [ ] Below 960px with the sidebar shown, the sidebar keeps its width and the main column fills the rest
- [ ] At 400×640, in both sidebar states, nothing clips (DR16). The mode control is whole, the breadcrumb ellipsizes folder first, and the status strip is one line that keeps the cursor. The Settings dialog shows the icon-only rail, and its rows wrap
- [ ] The status strip shows only known, nonzero fields for the active document, is absent with no document, has no ⌘K hint, and applies DR18 word counting, and shows no cursor field in WYSIWYG (DR19)
- [ ] With no document open (a launch with no file, and after closing the last tab), the empty state shows the title, **New Document**, **Open…** and the drop line; both buttons work by mouse and keyboard, and dropping a `.md` file opens it. The Contents sidebar shows no message. A Finder launch with a file never shows the empty state first.
- [ ] In `pnpm tauri dev`, an external change shows the right state of the dialog. (1) Changed with no edits: Reload works. (2) Changed with unsaved edits: Enter and Esc both keep the edits, and only "Discard and reload" replaces them. (3) Deleted: no Reload is offered, and "Save As…" writes the text to a new path. Tab stays inside the dialog in every state.
- [ ] Every dialog uses the same `.dialog-card` shell, title and message type steps and button variants: the external change dialog (`ReloadDialog.tsx`), `ConfirmDialog`, draft recovery, encoding, and the link and table insert modals. The screenshot index puts the recovery and encoding dialogs next to the external change dialog, in both themes.
- [ ] Re-opening a file that is already open (⌘O, recent files, Finder, drop) switches to its tab and keeps its unsaved edits
- [ ] Dragging files over the window shows the DR7 target, with the right label for Markdown, images, both and unsupported files, with and without a document. The target clears when the drag leaves or is cancelled, and dropping only unsupported files shows one toast.
- [ ] In every Discard confirmation, focus starts on "Keep editing", so Enter never discards. Tab stays inside the dialog, a backdrop click cancels, and focus returns to the opener.
- [ ] Discard confirmations use the danger variant at both mounted callers; Cancel stays secondary. Pressing the confirm button twice closes once, and a failed close shows one error toast with the tab still open.
- [ ] In `pnpm tauri dev`, a failed save shows the error toast in both themes. It stays until dismissed or replaced, "Dismiss" clears it, and VoiceOver announces it. "Saved" still disappears after 3 seconds.
- [ ] In `pnpm tauri dev`, opening a missing file and an oversized file from recent files, from Finder and by drop shows one error toast naming the file, with "larger than 10 MB" for the oversized one. "Exported *name*" shows no path.
- [ ] Every settings page shows the same "Loading…" line and the same load-failure line. A failed settings save shows only the error toast, and the control returns to its saved value.
- [ ] In `pnpm tauri dev`, in WYSIWYG (DR11): Reload a file another app changed, type, and press ⌘S; the file keeps both changes. A dropped image survives typing, and no unsaved dot appears after Reload.
- [ ] The `--settings-btn-*` tokens are fully retired
- [ ] The settings rail is a tab list with one Tab stop. Arrow keys and Home/End change the page, and the focused tab shows the inset focus ring in both themes
- [ ] The tokenization deferred list is **empty**, and the per-stage count check asserts 0 for every stage
- [ ] Before/after screenshots per item × theme, taken in `pnpm tauri dev` (E5); `/qa-only` findings triaged
- [ ] Rule 33 checklist on every changed control, in both themes, at the DR17 sizes
- [ ] The table, Source table and image menus share one keyboard contract (WI-4.15), including scroll dismissal. The image menu is named, and its custom-width form sits outside the menu
- [ ] **Contrast table, Stage 4 additions** (A9, both themes): Source syntax roles on the editor background (4.5:1, WI-4.1); the Running badge; status strip labels and values; the breadcrumb folder and name; the empty state text and drop line; the drop target label and edge; toast text and the error edge; the dirty dot on active and inactive tabs (3:1); the Shortcuts unsaved banner text on its accent-soft fill (4.5:1, DR21)
- [ ] New UI events log per rule 20
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable C
- [ ] **STOP (Deliverable C) — mandatory visual sign-off:** the user compares the after-shots with the matching `proposal-ab.html` boards (main window Source, Settings, components and states) and explicitly approves before Stage 5; the report is posted and the commit split is proposed

**Proposed commit split (C, proposal only, one per item):**
- `feat(editor): mdpro Source HighlightStyle`
- `feat(ui): Icon wrapper`
- `refactor(settings): ToggleSwitch component`
- `style(settings): row contract`
- `style(settings): running badge`
- `feat(ui): main bar and status strip`
- `feat(ui): empty state with new and open actions`
- `fix(file-watch): dirty-aware external change dialog`
- `feat(ui): drop target while dragging files`
- `fix(a11y): one keyboard contract for context menus`
- `fix(open): switch to an already-open document instead of replacing it` (first in Stage 4)
- `fix(editor): WYSIWYG shows text changed outside the editor` (right after the already-open fix)
- `feat(ui): mode segmented control`
- `fix(dialog): destructive confirm focuses the safe action and traps Tab`
- `fix(toast): failure toasts use an error variant that stays until dismissed`
- `style(settings): flat rail`

**Rollback:** each item's commit reverts independently.

**Worktree lanes (optional):**
- **Lane A:** WI-4.1 (`Editor/extensions/`) is independent.
- **Lane B:** WI-4.2 → WI-4.13 → WI-4.6 → WI-4.8 → WI-4.5 → WI-4.9 → WI-4.10 → WI-4.12 run in sequence, because they share `BottomTabs`, `Sidebar` and `App.tsx`.
- **WI-4.11, then WI-4.14,** run before any lane. WI-4.11 shares no files with the lanes. WI-4.14 shares `App.tsx` and `MilkdownEditor.tsx` with Lane B, so it lands before Lane B starts. WI-4.15 touches only the three menus and its hook, so any lane can take it.
- **Lane C:** WI-4.3 → WI-4.4 → WI-4.7 run in sequence, because they share the settings components and the settings CSS partial.
- **Conflict flag:** all lanes still meet in the theme files, `DESIGN.md` and `CHANGELOG.md`. Lanes B and C also both edit `SettingsDialog.tsx`, in different hunks (WI-4.2 icons, WI-4.3 MCP read). Merge one lane at a time and re-run G0 after each merge.
