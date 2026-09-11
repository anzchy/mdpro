# Plan: UI Redesign — proposal-ab alignment + 100% tokenized CSS

Generated on 2026-09-11 from the execution prompt `.prompts/2026-09-11_050736_FINAL.md`
Baseline commit: `0a3675e` (re-verify every "observed" fact before relying on it)
Branch: master
Status: DRAFT — blocked on the Stage 0 approval gate
Sources of truth (precedence on conflict: rules > old DESIGN.md > review > proposal > DESIGN.md):

- [`.claude/rules/30-34`](../../.claude/rules/): enforceable rules. Rule 31 defines "tokenized"; rule 33 defines focus patterns; rule 34 defines the theme classes.
- [`docs/design/mdpro-ui-old/DESIGN.md`](../design/mdpro-ui-old/DESIGN.md): the shipped UI's aesthetic register. D1–D4 are logged at :122-125. Cited below as `old DESIGN.md:N`. Read-only in this plan (see Out of scope).
- [`docs/design/mdpro-ui-new/mdpro-ui-codex-review.md`](../design/mdpro-ui-new/mdpro-ui-codex-review.md): the change list, items 1–15.
- [`docs/design/mdpro-ui-new/proposal-ab.html`](../design/mdpro-ui-new/proposal-ab.html): the rendered target. Tokens are at :21-61; the rejected D3 block at :63-69 must never ship.
- [`docs/design/mdpro-ui-new/DESIGN.md`](../design/mdpro-ui-new/DESIGN.md): the target design system distilled from the review and the proposal. It holds token names (no values), a component contract per surface with proposal line citations, the rule edits the redesign needs, and the open questions. Use it as the per-work-item checklist and at visual sign-off. It ranks below the review and the proposal, so a disagreement with either is a bug in this file and a stop-and-ask. A bare `DESIGN.md` below means this file: every token, platform-floor and runtime-token doc update in this plan lands here. The root `DESIGN.md` is only an index.

A conflict between any two sources is a stop-and-ask, never a silent pick.

---

## Goal

Bring the shipped UI in line with the proposal and the review, and leave app CSS 100% tokenized and well organized. The work follows the user-approved redesign workflow:

1. **Zero-visual-change refactor first.** Intended visual changes come afterwards, backed by before/after screenshots.
2. **Four deliverables, each independently reviewable and revertable:**
   - A: CSS infrastructure
   - B: visual retune
   - C: components
   - D: `sourceFont`
3. **Mandatory visual sign-off** by the user after the retune (end of Stage 3) and after the component changes (end of Stage 4), against the `proposal-ab.html` boards.

## Decided (do not re-litigate)

| ID | Decision | Source |
|---|---|---|
| D1 | A's register with B's structure | review :10-17, old DESIGN.md:122 |
| D2 | Hybrid Source font: new installs use Monospace; a "Source font" preference offers Monospace / Follow editor font | review :98-100, old DESIGN.md:123 |
| D3 | No second hue in Source syntax (no `--color-syntax-code`) | review :81-85, old DESIGN.md:124 |
| D4 | Keep the current cool neutrals; adopt only derived mechanics | review :252, old DESIGN.md:125 |
| E1 | macOS floor is 13.1, whose bundled WebKit (Safari 16.2) has `color-mix()`. macOS 11–12 get it only with a Safari 16.2+ update, which the bundle cannot require. It is set in `tauri.conf.json`; no `@supports` fallback. | eng review 2026-09-11 |
| E2 | CSS order has one source: `src/styles/index.css` `@import`s globals → sections → themes. `main.tsx` imports only that file, and the test helper and the pure-move proof read the same list. | eng review 2026-09-11 |
| E3 | `sourceFont` is a string `"mono"` \| `"editor"`, following the `fontFamily` pattern. Serde defaults give existing files `"editor"`; `EditorConfig::default()` (first run) gives `"mono"`; unknown values fall back to `"editor"` at apply time. | eng review 2026-09-11 |
| E4 | One `src/components/common/ToggleSwitch.tsx` replaces the hand-copied toggles and the native checkboxes in Settings. | eng review 2026-09-11 |
| E5 | Zero-change stages are proven by a computed-style JSON diff. Sign-off screenshots are taken in `pnpm tauri dev` (WKWebView). | eng review 2026-09-11 |
| E6 | The existing `config.json` overwrite gets its own PR, which must land before Stage 5 starts (TODOS.md P1). Today a parse failure still lets `App.tsx` write `lastViewMode` at launch, which replaces the file with defaults. | eng review 2026-09-11 (Codex consult) |
| E7 | Allowed test-only devDependencies: `@testing-library/react`, `@testing-library/user-event` and `@testing-library/dom`. Vitest also collects `tests/**/*.test.tsx`. Runtime dependencies stay frozen (A7). | eng review 2026-09-11 (Codex consult) |
| E8 | `--source-font-family` defaults to the mono stack in `:root`. Users who chose `"editor"` may see mono for a moment until preferences load, which is how `fontFamily` and `fontSize` already behave. Accepted; checked in Stage 5, with a TODO if it is visible. | eng review 2026-09-11 (Codex consult) |
| DR1 | Reference directions for three review §4 surfaces: empty state = framed drop region (extends the proposal's static swatch at :607-609), external change = dirty-aware dialog, drop target = editor-column tint. The mockups are local review artifacts under `~/.gstack/`, never committed. Whether each surface is built in this plan is decided separately. | design review 2026-09-11 |
| DR2 | The main bar (breadcrumb + mode control) and the status strip are built in this plan as WI-4.8. D1 already chose B's structure; encoding, line ending and a cursor store already exist, so only word count is new logic. | design review 2026-09-11 |
| DR3 | The no-document state is built in this plan as WI-4.9, following the empty-state reference (DR1), with clickable New and Open… buttons next to the ⌘N / ⌘O hints. Today that state is a blank read-only editor, and hints alone give a mouse user nothing to act on. | design review 2026-09-11 |
| DR4 | The breadcrumb shows the parent folder (muted), then the file name, or "Untitled" for an unsaved document. The folder truncates first. The full path appears only in a tooltip. It is not clickable and has no unsaved mark. | design review 2026-09-11 |
| DR5 | The external-change dialog is rebuilt in this plan as WI-4.10, following the dirty-aware reference (DR1). It has three states: changed with no edits; changed with unsaved edits, where "Discard and reload" is danger and focus starts on "Keep my version"; and deleted, which offers "Keep editing" / "Save As…". This closes the path where Enter discards unsaved edits. Accepted: the fix ships with Stage 4, not as a separate branch. | design review 2026-09-11 |
| DR6 | Opening a file that is already open switches to its tab and never re-reads it. This closes the path where re-opening or dropping an open file discards its unsaved edits. Built in this plan as WI-4.11, which runs first in Stage 4. Accepted: the fix ships with Stage 4, not as a separate branch. | design review 2026-09-11 |
| DR7 | Build the drop target in this plan as WI-4.12, following the DR1 direction. While files are dragged over the window, the editor column shows a tint and a label chosen from the dragged file types. The label uses the same classifier as the drop. A drop with no supported files shows one toast instead of failing silently. | design review 2026-09-11 |
| DR8 | WI-4.6 brings `ConfirmDialog` fully in line with rule 32. With `destructive` set, focus starts on the safe action, so Enter can't discard. It also adds the Tab trap, `aria-labelledby` and `aria-describedby`, backdrop cancel, and focus return. In the same commit, rule 32's first-focus line gains an exception for destructive primaries. | design review 2026-09-11 |
| DR9 | Build toast variants in this plan as WI-4.13. Failure toasts use DESIGN.md's error variant: `role="alert"`, a "Dismiss" button and no auto-dismiss, so "Save failed" no longer looks like "Saved" or disappears after 3 seconds. Refusals stay default. Rule 32 § Toast gains the variant contract in the same commit. | design review 2026-09-11 |
| DR10 | The Preview pane is a dead-code candidate under A8. `Preview.tsx` has not been mounted since `4570de3` (`ViewMode` is `"wysiwyg" \| "source"`), and `ImageRenderer.tsx`, `usePreview.ts` and `preview.css` serve only it. Q1 is closed, `preview.css` leaves the tokenization scope, and the Preview screenshot row is dropped. `mathRender.ts` stays live for export. | design review 2026-09-11 |
| DR11 | In WYSIWYG, text that changes outside the editor reaches the live editor before the next edit. That covers Reload, an image drop, and any other store write the preflight finds. Today Milkdown reads the text only when the document id changes, so an edit after Reload writes the old text back, and ⌘S saves it over the file. Built in this plan as WI-4.14, which runs right after WI-4.11. Accepted: the fix ships with Stage 4, not as a separate branch. | design review 2026-09-11 |
| DR12 | Colors change instantly on hover, selection, press and theme switch. Only the switch knob `transform` and hover-reveal `opacity` animate, on the motion tokens; spinners keep rotating. No transition names a color property, `box-shadow` or `all` (rule 32), so a theme switch can't flicker (rule 34). This differs from the proposal's drawn color fades (proposal :117-234), and rules outrank the proposal. WI-3.2 item 11 removes today's color transitions. | design review 2026-09-11 |
| DR13 | Reduced motion: one `@media (prefers-reduced-motion: reduce)` block zeroes the motion duration token, and WI-3.2 edits rule 32 § Animations to describe it instead of per-site `no-preference` wrappers. Progress spinners keep rotating. | design review 2026-09-11 |
| DR14 | Redesign tokens are logged in the new DESIGN.md § Tokens while the redesign is in progress: WI-2.2 adds an interim clause to rule 31, whose token log otherwise points at the old doc. WI-5.5 then makes root `DESIGN.md` mark the new doc current and removes the clause. The old doc stays read-only. | design review 2026-09-11 |
| DR15 | Q4 approved with a change: `--color-focus-ring` equals the solid accent in both themes. The proposal's 70% mix measures 2.91:1 on the light surface and 2.68:1 on accent-soft, below A9's 3:1. Pattern 2 and pattern 3's inset ring use the token; pattern 1 is unchanged. | design review 2026-09-11 |
| DR16 | The minimum window stays 400×640, and the new chrome gets narrow rules. The segmented control never shrinks, and the breadcrumb ellipsizes (folder first, then name). The status strip stays one line and hides line ending, then encoding, then word count; the cursor stays. In a narrow Settings dialog the rail shows icons only, keeping each tab's name, and settings rows wrap. The 960px `.app-shell` override is removed. Checked at 400×640 in both sidebar states and at 959px. | design review 2026-09-11 |
| DR17 | mdpro has no page zoom (no zoom hotkeys, no zoom capability, no menu item), so the 200% zoom check cannot run. It is replaced by two checks QA can run: the 400×640 minimum window (DR16), and `zoom: 2` set on `<html>` from Web Inspector in `pnpm tauri dev`, both themes. WI-3.3 edits rule 33's checklist to match. Page zoom itself is a TODOS candidate, not part of this plan. | design review 2026-09-11 |
| DR18 | Word count (Q12): each Han, Hiragana or Katakana character is one word; any other run of letters and digits is one word, so Latin and Korean count by spaces. Markdown syntax is not counted: front matter, fence lines, list numbers, link and image destinations, autolinks and HTML tags are removed first. Code inside a block and image alt text count. A pure regex util over the document's Markdown gives the same number in Source and WYSIWYG and in Node and WKWebView. | design review 2026-09-11 |
| DR19 | WYSIWYG has no cursor field (Q13). A ProseMirror position has no exact Markdown line and column, and an estimate would be wrong inside tables, lists and hidden markers, so the field is omitted (rule 30 rule 2). Switching to Source shows it again. At narrow widths in WYSIWYG, word count is the field that stays. | design review 2026-09-11 |
| DR20 | One Dark stays selectable and unchanged (Q3). "Default" becomes the WI-4.1 tokenized HighlightStyle and follows the app theme. One Dark stays an explicit opt-in that looks as it does today, including a dark Source editor in the light theme. No preference migration. Its colors come from the `@codemirror/theme-one-dark` package, not from app CSS, so the token guard doesn't see them. | design review 2026-09-11 |
| DR21 | No warning color (Q7). The Shortcuts unsaved banner (`globals.css:1059-1068`) moves from amber to `--color-accent-soft` fill with an accent border, the same color as the tab's unsaved dot, in WI-4.3. The dev toolbar (`.dev-toolbar*`, `globals.css:1509-1547`) renders only in dev builds (`DevToolbar.tsx:28`), so the WI-2.1 guard lists its literals as an exception with file:line. | design review 2026-09-11 |
| DR22 | Chrome font sizes outside the ramp (Q8) take the proposal's roles, with no exceptions. Dialog titles use `--font-size-ui-lg` semibold (proposal :230, :274). Settings section labels use `--font-size-ui-sm` semibold muted (:244), card headings `--font-size-ui` semibold (:265), and `.mcp-client-status` uses `--font-size-ui`. One new token, `--font-size-title: 16px`, names the proposal's settings page title literal (:242) and also serves the About app name. The ×, + and stepper glyph sizes become WI-4.2 icons at `--icon-size-*`. Dead selectors (`.file-item-close`, `.tab-bar__new-tab`) are skipped (A8). | design review 2026-09-11 |
| DR23 | Radii outside the token pair (Q9) snap by role; the old 4/6/8/10/12/16 scale (old DESIGN.md:76) is retired. `--radius-control` (6px): controls and row fills, including today's 8px buttons, 10px search field and 4px inputs. `--radius-popover` (10px): menus (8px today), dialogs (16px), toasts (12px) and grouped sections inside dialogs (12px; proposal `.sheet` :261). A new `--radius-inner` (4px) covers parts nested inside a rounded container: segment buttons and menu items (proposal :116, :206), tab close, stepper buttons, inline edit, and table and grid-picker cells. Circles keep `50%`, and pills (switch track :193, progress bars) use `999px`, which rule 31's allowlist gains. Dead selectors are skipped (A8), and the dev toolbar falls under DR21. Chosen by the reviewer on the user's instruction to decide the remaining questions. | design review 2026-09-11 |

## Assumptions (confirm or change at the Stage 0 gate)

| ID | Assumption |
|---|---|
| A1 | All 15 review items are in scope. If scope narrows (e.g. P0 only), drop whole work items. |
| A2 | Orchestrate through `/feature-workflow`. Each work item is implemented with `/tdd-guardian:workflow`. |
| A3 | Visual QA uses `/qa-only` (report-only). `/design-review` runs only when the user asks. |
| A4 | Screenshots and computed-style JSON are stored at `$TMPDIR/mdpro-redesign/<stage>/<surface>-<theme>.{png,json}` and never committed. |
| A5 | "100% tokenized" follows the definition below. |
| A6 | Stage 1 is a pure move into ordered partials listed in `src/styles/index.css` (E2). `:root` tokens stay in `globals.css` (rule 31:11-16). |
| A7 | No new runtime npm or cargo dependency, including icon, image-diff and contrast tools. The only exception is E7's test-only devDependencies, added in WI-1.0. |
| A8 | `src/App.css`, `src/components/TabBar/`, the unmounted Preview pane (DR10: `src/components/Preview/Preview.tsx`, `ImageRenderer.tsx`, `styles/preview.css`, and `src/hooks/usePreview.ts`) the unmounted document list (`src/components/Sidebar/Sidebar.tsx` and `FileItem.tsx`) and the unreachable large-file warning (WI-4.13) are dead-code candidates; list them, do not delete them. `src/components/Preview/mathRender.ts` stays live, because HTML export uses it. The tokenization test asserts that no file outside the candidates imports them. Deletion is tracked in TODOS.md. |
| A9 | Contrast thresholds are WCAG 2.1 AA: 4.5:1 for text, 3:1 for focus indicators and control boundaries. |
| A10 | Class (c) literals with 3 or more unrelated uses get a semantic token (rule 31's rule of three). |
| A11 | Manual test guide location: `docs/guide/manual-test-ui-redesign.md`. |
| A12 | Deferred class (b) literals are tracked in an explicit allowlist inside the tokenization test rather than by `it.skip` on whole files. This refines the prompt so every file stays guarded during Stage 2; see WI-2.1. |

## Open questions (must be answered at the Stage 0 gate)

| ID | Question | Blocks |
|---|---|---|
| Q1 | ~~Should the Preview's highlight.js theme follow dark mode?~~ **Closed by DR10:** `Preview.tsx` has not been mounted since `4570de3`, so it is a dead-code candidate (A8). | — |
| Q2 | Should `:root` keep its duplicated light values (`globals.css:1-47`)? **Proposed (design review; confirm at the Stage 0 gate):** keep them. `App.tsx:451-452` adds the theme class in an effect, after first paint, so `:root` is what paints first. WI-2.1's guard asserts that every token declared in both `:root` and `.theme-light` has the same value, so the copies can't drift. | WI-3.1 |
| Q3 | ~~Does One Dark stay selectable, unchanged, next to the new HighlightStyle (review :86)?~~ **Answered: DR20.** | WI-4.1 |
| Q4 | ~~Is the rule 33 edit approved (patterns 1–3 → `--color-focus-ring`, review item 7)?~~ **Closed by DR15:** approved, with the token equal to the solid accent. | WI-3.3 |
| Q5 | ~~What is the WebKit floor?~~ **Closed by E1:** macOS 13.1, set in WI-3.4. | — |
| Q6 | Undeclared tokens are read with a hex fallback: `--color-success`, `--color-error` and `--color-text-tertiary` (`globals.css:1842`, `:1846`, `:1850`). Declare them, or replace them with existing tokens? **Proposed (design review; confirm at the Stage 0 gate):** replace them. They color the About update status (`AboutSettings.tsx:219-281`): error uses `--color-danger`, disabled uses `--color-muted`, and "up to date" uses `--color-text`, because DESIGN.md § Status indicator rules out green and the label already states the result. No token is declared. | WI-2.2 |
| Q7 | ~~Amber warning literals (`globals.css:1065-1066`, `:1519-1544`, mostly the dev toolbar) need a decision: add a `--color-warning` token, or exclude the dev-only toolbar?~~ **Answered: DR21.** | WI-2.1, WI-4.3 |
| Q8 | ~~Chrome font sizes outside the 12/13/14 ramp (18px ×9, 16px ×4, 15px ×2, 24px ×1 in `globals.css`) need a decision: add title tokens, or make them exceptions?~~ **Answered: DR22.** | WI-3.2, WI-4.2 |
| Q9 | ~~Radii outside the proposal's control/popover pair (4px ×12, 8px ×11, 12px ×6, 3px ×5, 2px ×2, 16px ×2, 24px ×1) need a decision: add tokens from the old DESIGN.md:76 scale, or make them exceptions?~~ **Answered: DR23.** | WI-2.1, WI-2.2, Stage 3 |
| Q10 | `z-index: 1` at `MilkdownEditor.css:214` is not in the rule 31:83-91 table. Allow it as a local stacking exception? **Proposed (design review; confirm at the Stage 0 gate):** allow it. It stacks the column-resize handle inside a table cell, not a window layer, and rule 31's table lists window layers. WI-2.1 lists it as a local exception with file:line. | WI-2.1 |
| Q11 | ~~If the app has no command palette, confirm it is out of scope (the proposal draws one).~~ **Closed (design review):** no command palette exists, so the proposal's palette (:449) is out of scope. ⌘K already inserts a link (`typoraKeymapPlugin.ts:5`), so a "Commands ⌘K" hint would also be wrong. | — |
| Q12 | ~~How does the status-strip word count treat CJK text and Markdown syntax?~~ **Answered: DR18.** | WI-4.8 |
| Q13 | ~~In WYSIWYG, does the status strip show a cursor position (and in what unit), or omit that field?~~ **Answered: DR19.** | WI-4.8 |
| Q14 | ~~The app has no Save As.~~ **Closed (design review):** the code path exists. `saveActiveDocumentAs` (`useDocument.ts:172-200`) opens the save picker with the file name and saves, and untitled documents already use it (`:207`); only a menu item is missing. The deleted state's "Save As…" calls it. Original question: The app has no Save As. In the deleted-file state, should "Save As…" be built (a path picker plus the existing save path), or should that state offer "Save" to recreate the file at its old path? | WI-4.10 |

---

## Baseline (observed at `0a3675e`)

### Token files

- `src/styles/globals.css` `:root` (:1-47) declares these tokens:
  - colors, `--shadow-soft`, fonts
  - layout: title bar, traffic lights, sidebar, bottom tabs, content width
  - the three runtime editor tokens
  - the `--settings-*` tokens and the semantic aliases
- `src/styles/themes/light.css` and `dark.css` declare the color set, the `--settings-*` tokens and the aliases. `--shadow-soft` exists only in `:root`.
- `src/main.tsx:3-5` imports `globals.css`, then `light.css`, then `dark.css`.

### Literal inventory

| File | Lines | Color literals | px font-sizes |
|---|---|---|---|
| `src/styles/globals.css` | 1918 | 49 | 88 |
| `src/components/Editor/MilkdownEditor.css` | 269 | 1 | 1 |
| `src/components/Preview/styles/preview.css` (dead-code candidate, DR10; out of scope) | 139 | 1 | 2 |
| `src/components/BottomTabs/BottomTabs.css` | 116 | 2 | 3 |
| `src/components/Editor/ImageContextMenu.css` | 65 | 0 | 1 |
| `src/plugins/milkdown/inlineEditPlugin.css` | 39 | 0 | 0 |
| `src/plugins/milkdown/imagePastePlugin.css` | 25 | 0 | 1 |
| `src/plugins/codemirror/wysiwygDecorationsPlugin.css` | 16 | 0 | 1 |

`globals.css` also contains non-`var()` declarations of these kinds: 47 `border-radius`, 7 `transition`, 5 `z-index`, 1 `box-shadow`.

### Hotspots feeding work items

- **Hardcoded accent fills (item 1):** `globals.css:1032` and `:1747`.
- **Sub-12px font sizes (item 12):**
  - `globals.css`: `:122`, `:219`, `:532`, `:578`, `:929`, `:1245`, `:1431`, `:1682`, `:1690`, `:1774`
  - `wysiwygDecorationsPlugin.css:5`
- **Transitions (item 11):**
  - `globals.css`: `:639` (0.05s), `:1335` (0.2s), `:1347` (0.2s), `:1423`, `:1629` (includes 0.3s), `:1667`, `:1739`
  - `BottomTabs.css`: `:24`, `:66`, `:105`
  - Only the 0.15s durations match the proposal's fast-duration token.
- **Focus:** only two `:focus-visible` rules exist (`globals.css:572`, `:648`). Item 7 adds `.toolbar-button:focus-visible`.
- **Running badge and toggle track (item 6):** `.mcp-status-badge.running` at `globals.css:1371-1372`; the toggle off-track at `:1334`.
- **Settings rows (item 5):** `globals.css:1296`, `:1301`, `:1314`; `.toggle-switch` at `:1314`.
- **Settings rail (item 14):** `.settings-sidebar` at `:904`; `.settings-category-btn` at `:937`, with hover at `:948` and active at `:952`. The `--settings-btn-*` tokens are at `light.css:21-22`, `dark.css:21-22` and `globals.css:40-41`.
- **Mode label (item 9):** `.sidebar-mode-label` at `src/App.tsx:1128` and `src/components/Sidebar/index.tsx:39`.
- **Discard (item 13):**
  - `ConfirmDialog.tsx:42,52` renders both buttons as `.toolbar-button`.
  - A `.toolbar-button.danger` variant already exists at `globals.css:1195`.
  - Callers: `BottomTabs.tsx:83` and `App.tsx:1180` ("Discard changes"). `Sidebar/Sidebar.tsx:53` is a third, in a component nothing renders.
  - The confirm button has `autoFocus` (`:53`), and the card uses `aria-label` (`:37`). There is no Tab trap and no backdrop click (DR8).
- **Icons (item 4):** `SettingsDialog.tsx:30-38` and `BottomTabs.tsx:73`.
- **Syntax (item 2):**
  - `src/components/Editor/extensions/syntax.ts:3` uses `defaultHighlightStyle`.
  - `src/components/common/settings/editorPrefApply.ts:183-186` switches to `oneDark`.
- **Fonts (item 3):**
  - Source and WYSIWYG both use `--editor-font-family` (`globals.css:336`, `MilkdownEditor.css:43`).
  - The `fontFamily: "system"` default is at `src/types/preferences.ts:284` and `src-tauri/src/models/preferences.rs:568`.
- **Dead-code candidates:**
  - `src/App.css` (19 color literals, imported nowhere)
  - `src/components/TabBar/` (re-exported only by its own `index.ts`)
  - the Preview pane (DR10): `src/components/Preview/Preview.tsx` is imported nowhere since `4570de3`; `ImageRenderer.tsx`, `styles/preview.css` and `src/hooks/usePreview.ts` are used only by it. `mathRender.ts` in the same folder is live (`exportService.ts:4`).
  - the old document list: `src/components/Sidebar/Sidebar.tsx` is re-exported at `Sidebar/index.tsx:54` but rendered nowhere, and `FileItem.tsx` is imported only by it (`Sidebar.tsx:3`). The WI-2.1 dead-code guard must allow that re-export or name it.
  - the large-file warning (`useDocument.ts:31`, `:66-68`, `:101-103`, `:126-128`; `App.tsx:499-503`): it warns above 10 MB, and the backend already refuses those files (`src-tauri/src/commands/file.rs:16`, `:162-168`)

### Gates and tools

- `pnpm build` (`tsc && vite build`), `pnpm test:run` (`vitest run`), `cd src-tauri && cargo test`. All three also run in `.github/workflows/ci.yml`.
- `pnpm dev` serves localhost:1420 without Tauri APIs; `pnpm tauri dev` runs the full app.
- `.claude/tdd-guardian/config.json` has `enabled: true` and `testCommand: pnpm test:run`, but `lanes` is absent. Readiness must be confirmed in WI-0.1.
- `CHANGELOG.md:8` has a `## [Unreleased]` section.

---

## Working protocol (applies to every stage)

**Per work item** (`/feature-workflow` + `/tdd-guardian:workflow`):
1. Preflight: re-verify the cited file:line facts and record discrepancies.
2. RED: write or adjust a test that fails for the right reason. CSS-only changes have no unit test (rule 10) but must pass the screenshot and tokenization gates.
3. GREEN, then refactor.
4. Run the common gate (below).
5. Update the manual test guide (A11).

**Common gate G0** runs at the end of every work item and every stage:
- [ ] `pnpm build` exits 0
- [ ] `pnpm test:run` exits 0; no newly skipped tests; no assertion deleted to get green
- [ ] `cd src-tauri && cargo test` exits 0 (required whenever Rust changed; otherwise run once per stage)
- [ ] No file outside the work item's declared file set changed, compared with the baseline `git status --porcelain` saved in WI-0.1 (the tree already has unrelated changes)
- [ ] No new dependency: `git diff package.json src-tauri/Cargo.toml` is empty, apart from the three E7 devDependencies added in WI-1.0
- [ ] No screenshot, no `.prompts/` artifact, and no conversation content in the diff
- [ ] Nothing committed or pushed

**Stop protocol:** there are five stops: end of Stage 0, and end of Stages 2, 3, 4 and 5.

At each stop:
1. Post the stop report (template at the bottom).
2. Propose the commit split for that deliverable.
3. Wait for the user's explicit reply.

Do not start the next stage without that reply.

**Visual evidence protocol (E5):**
- **Zero-change stages (1–2):** the proof is a computed-style snapshot, not a visual comparison.
  - A throwaway script kept outside the repo (`$TMPDIR/mdpro-redesign/snapshot.js`) runs through `/browse` against `pnpm dev`.
  - For each Appendix B surface, in both themes and at a fixed viewport, it walks a fixed selector list. It records `getComputedStyle` for the A5 property families plus the box size, including `::before` / `::after`, and writes sorted JSON.
  - It also puts each surface into the states the selectors style (checked, disabled, focus-visible, an open modal, a scrolled container) and asserts that each state actually applied, so a missed state fails instead of producing an empty diff. A state that script cannot force (e.g. hover) is marked manual in the index.
  - Before and after files are compared with plain `diff`; an empty diff passes. Screenshots are still taken, as reference only.
  - Chromium is not the engine that ships. A representative subset is also collected inside `pnpm tauri dev` through WebView DevTools and diffed the same way: main window Source, one Settings page and one modal, in both themes.
- **Sign-off stages (3–4):** the screenshots the user signs off on are taken in `pnpm tauri dev` (WKWebView). `/browse` is Chromium, and rules 30/34 require visual QA in Tauri. `/browse` shots are fine for iteration.
- Capture Tauri-only surfaces manually in `pnpm tauri dev`.
- Each before/after pair uses the same window size and scale (1×, or the DR17 2× check), recorded in the index.
- A cell that cannot be captured is marked in the matrix, and the user is asked to capture it. Never skip a cell silently.

**Contrast protocol:**
- Compute ratios from resolved colors, in both themes, with a throwaway script outside the repo. Record a table.
- Failures are flagged, not silently retuned.

**Rule 33 protocol:**
- Tab through every changed surface in both themes: at the default window, at the 400×640 minimum (DR16), and with `zoom: 2` set on `<html>` from Web Inspector in `pnpm tauri dev` (DR17). mdpro has no page zoom, so 200% browser zoom can't be reached.
- Modals loop Tab, and Esc returns focus to the invoking control.
- Where `/browse` cannot drive focus, or a check needs Web Inspector, ask the user to run it, and record who ran it.

---

## Definition of "100% tokenized" (A5)

Applies to every app-owned `src/**/*.css` file except `globals.css :root`, `light.css`, `dark.css`, third-party CSS (highlight.js, KaTeX) and the dead-code candidates. The dead-code exclusion holds only while they stay unimported: the tokenization test asserts that no `src/**` file outside the candidates, and not `index.html`, imports them, and any such import brings the file into scope.

- **Color properties** (color, background, border, outline, fill, stroke, box-shadow, caret-color, text-decoration-color) may use only `var(--…)`, `color-mix()` over `var()`s, `transparent`, `currentColor` or `inherit`.
- **Must use `var(--…)`:** font-family, chrome font-size, border-radius, transition/animation duration and easing, icon width/height.
- **Allowed literals:**
  - the rule 31:58-76 list
  - `em` / `%` sizes inside editor and preview content
  - z-index values from the rule 31:83-91 table
- **Enforcement:** `tests/css-tokenization.test.ts` (WI-2.1).

---

## Deliverables overview

| Deliverable | Stages | Visual change | Review items | Stop after |
|---|---|---|---|---|
| A — CSS infrastructure | 1, 2 | None (computed-style diff is empty) | none directly | Stage 2 |
| B — Visual retune | 3 | Intended | 1, 7, 8, 10, 11, 12, 15 | Stage 3 **(visual sign-off)** |
| C — Components | 4 | Intended | 2, 4, 5, 6, 9, 13, 14; DR2 main bar and status strip; DR3 empty state; DR5 external-change dialog; DR6 already-open guard; DR7 drop target; DR8 destructive confirmation; DR9 error toasts | Stage 4 **(visual sign-off)** |
| D — `sourceFont` | 5 | Intended (Source mode only) | 3 (D2) | Stage 5 |

The item→stage mapping is an assumption (A1). Correct it at the Stage 0 gate.

---

## Stage 0 — Inventory, baseline, plan approval (no code edits)

**Entry:** this plan exists; the working tree is otherwise as at the baseline.

### WI-0.1 — Readiness and baseline gates — S
- Run `/tdd-guardian:status`. If the config is missing, disabled, or has no runnable lane, **stop and ask the user to run `/tdd-guardian:init`**.
- Run G0 on the untouched tree and record pre-existing failures, so they are not blamed on this work.
- Save `git status --porcelain` to `$TMPDIR/mdpro-redesign/git-status-baseline.txt`. G0's file-set check compares against it.
- Re-verify every Baseline fact above and note discrepancies in Appendix A.
- List every test that reads app CSS from disk, since Stage 1 will move those files: `grep -rln "\.css" tests`.

### WI-0.2 — Literal inventory and classification — M
- For every non-token value in the tokenized categories, record file:line, selector, property and value.
- Put each value in a class:
  - **(a)** an existing or proposal token with the same value exists
  - **(b)** tokenizing it changes the rendered value (e.g. sub-12px chrome sizes, the `:1032`/`:1747` accent fills, 0.05s/0.2s/0.3s transitions)
  - **(c)** it needs a new token or an exception (feeds Q6–Q10)
- Write the result to Appendix A.

### WI-0.3 — QA surface matrix — S
- Fill Appendix B with every surface × {light, dark}.
- Mark each row "has reference" (drawn on a proposal board) or "no reference".

### WI-0.4 — Baseline snapshots and screenshots — M
- Write the computed-style snapshot script, and record baseline JSON for every `pnpm dev` surface × theme (E5).
- Capture every matrix cell per the visual evidence protocol.
- Record the paths, window size and scale in Appendix B.
- Capture the main window at 400×640 with the sidebar shown and hidden, and the Settings dialog at 400×640 (DR16).
- Capture the main window 900px wide with the sidebar shown, to confirm the layout bug WI-4.8 fixes.

### WI-0.5 — CSS file map and rule 33 edit proposal — S
- Read every section banner in `globals.css`. The list observed so far is incomplete: `.toast` at `:819` sits between the link modal and Settings banners.
- **Confirm the recent-files CSS is dead; WI-1.2 removes it** (Stage 0 changes only this plan):
  - The `.toolbar-recent*` rules (from `globals.css:397`) have no consumer in `src/` or `tests/`. Recent files are only the native "Open Recent" submenu (`menu.rs:73-96`).
  - WI-1.2 deletes these rules and the stale "Recent dropdown" row in rule 31's z-index table, in one commit before the move, so no partial receives them.
- Propose the partial file map (WI-1.1). Any section longer than about 300 lines (Settings spans `:858-1435`) splits along its sub-banners.
- Draft the exact rule 33 spec-column edit (DR15), without applying it.

### WI-0.6 — Plan design review — S
- Run `/plan-design-review` on this plan.
- Fold non-controversial findings into this file. List the rest as open questions.

### Stage 0 acceptance criteria
- [ ] tdd-guardian readiness confirmed, or the user was asked to run `/tdd-guardian:init` (the stage does not pass until it is ready)
- [ ] Baseline G0 results recorded, including pre-existing failures
- [ ] Appendix A lists every non-token value in the tokenized categories with file:line and class a/b/c; the counts reconcile with the Baseline table, or the discrepancy is explained
- [ ] Appendix B lists every surface × theme with a reference flag, including the review §4 surfaces (recent files, which is a native submenu; disabled-with-reason button; the external-change dialog, formerly a banner; drag-and-drop target; empty/no-tabs state)
- [ ] Every Appendix B cell has a baseline screenshot path, or a "could not capture" mark with the user asked
- [ ] Every `pnpm dev` surface × theme has baseline computed-style JSON, and the baseline `git status --porcelain` is saved
- [ ] The CSS file map is decided: every partial is ≤ ~300 lines and its import position is listed
- [ ] The rule 33 edit is drafted (text only)
- [ ] `/plan-design-review` findings are recorded
- [ ] **Gate:** the user explicitly approves the plan and answers or waives A1–A12 and Q1–Q14

**Rollback:** nothing to roll back; Stage 0 changes only this plan document.

---

## Stage 1 — Split `globals.css` (Deliverable A; zero visual change)

**Entry:** Stage 0 gate passed.

### WI-1.0 — Test tooling (E7) — S
- Add `@testing-library/react`, `@testing-library/user-event` and `@testing-library/dom` as devDependencies, in versions compatible with React 19; record the versions.
- Widen the vitest `include` to `tests/**/*.test.{ts,tsx}` and confirm that the JSX transform works for files under `tests/`.
- Nothing else in `package.json` changes. Existing tests and the jsdom environment stay as they are.
- **RED → GREEN:** the smoke test `tests/testing-library-smoke.test.tsx`
  - renders a native checkbox and presses Space with `userEvent.keyboard`
  - asserts the checkbox becomes checked
  - stays in the suite, because the Stage 4 and 5 keyboard tests rely on this tooling
- **Zero change:** the app bundle and the computed-style snapshot are unaffected.

### WI-1.1 — Ordered CSS entry and location-independent reader — S
- **Entry file (E2):**
  - Create `src/styles/index.css` containing only `@import "./globals.css";`, `@import "./themes/light.css";` and `@import "./themes/dark.css";`, one per line, in today's order.
  - `src/main.tsx` replaces its three style imports with one `./styles/index.css` import at the same position, so App's component CSS still comes first.
- **Test helper:** `src/test/appCss.ts` (rule 10).
  - It parses the `@import` lines of `index.css` and returns the app CSS in that order, per file or concatenated.
  - `tsc` type-checks it (`tsconfig` includes `src`; `@types/node` is present).
  - Its own test lives under `tests/`, because vitest collects tests only there.
- Every test that reads `src/styles/globals.css` from disk switches to the helper, with assertions unchanged: `design-tokens-accent-danger`, `settings-row-layout`, `source-scroll-layout` and `source-table-cell-highlight` (re-check with the WI-0.1 grep).
- **RED:** helper tests assert that
  1. before the split, the helper's non-theme concatenation equals `globals.css` byte for byte (after the split, the Stage 1 pure-move proof takes over this check);
  2. an `@import` of a missing file throws instead of being skipped;
  3. `index.css` is rejected if it contains anything other than comments and `@import` lines, a duplicate import, or a path that resolves outside `src/styles/`.
- **Zero change:** after the entry switch, the computed-style diff against the Stage 0 baseline is empty.

### WI-1.2 — Move sections into partials — M
- **First commit, before any move:** delete the `.toolbar-recent*` rules (WI-0.5) and the "Recent dropdown" row in rule 31's z-index table. The computed-style diff stays empty, because nothing renders those classes. The pure-move proof diffs against this commit.
- Keep `:root` tokens and base/reset rules in `globals.css` (rule 31:11-16).
- Move each other section verbatim into a partial, per the approved file map (A6). Assumed location: `src/styles/sections/<section>.css`.
- List the partials in `src/styles/index.css` immediately after `./globals.css`, in original source order. `main.tsx` is not touched again.
- Change no selector, value or rule order. Remove only the moved text.
- Plugin CSS stays co-located with its plugin (rule 50 §3). Do not pull plugin CSS into the partials.
- **Rule edit, in the move commit:** rule 32 § Single source of truth names the partial that owns each surface (app shell, sidebar, dialog backdrop, toast, settings, link insert modal) instead of `globals.css`, per the approved file map. The modal contract's "`.dialog-backdrop` + `.dialog-card` from `globals.css`" names the dialog partial. Rule 31 keeps `globals.css` for the `:root` tokens. Until this commit lands, the rule's old file names stand, so no partial exists without it.

### Stage 1 acceptance criteria
- [ ] G0 passes
- [ ] **Pure-move proof:** concatenate the new `globals.css` and the partials in import order, strip banner comments from both sides, and diff against the baseline file. The diff is empty; the exact command and its empty output are in the report. Example:
  ```bash
  diff <(git show <dead-CSS commit>:src/styles/globals.css | sed '/^\/\*.*\*\/$/d') \
       <(sed -n 's|^@import "\./\(.*\)";$|src/styles/\1|p' src/styles/index.css \
           | grep -v '/themes/' | xargs cat | sed '/^\/\*.*\*\/$/d')
  ```
  The file list comes from `index.css`, so the proof, the helper and the app share one order.
- [ ] **Built-CSS order:** in the `pnpm build` output CSS, rules appear in the same relative order as before. Spot-check the first and last selector of each partial.
- [ ] The computed-style diff against the Stage 0 baseline is empty for every `pnpm dev` surface × theme (command and empty output in the report); Tauri-only cells show no visible difference
- [ ] Every app CSS file is ≤ ~300 lines, or is listed as an approved exception
- [ ] No test assertion changed; only the file-reading paths did
- [ ] Rule 32's ownership table and modal contract name the partials; rule 31's z-index table has no "Recent dropdown" row, and no `.toolbar-recent` selector remains
- [ ] The WI-1.0 smoke test passes, and the `package.json` diff is exactly the three E7 devDependencies

**Rollback:** revert the partials, `src/styles/index.css` and the `main.tsx` import. `globals.css` is restored byte-for-byte from the baseline.

---

## Stage 2 — Value-preserving tokenization (Deliverable A; zero visual change)

**Entry:** Stage 1 accepted (no stop between Stages 1 and 2).

### WI-2.1 — Tokenization guard test (RED first) — M
- Create `tests/css-tokenization.test.ts` with one `it` per in-scope CSS file. Use the source-inspection style of `tests/design-tokens-accent-danger.test.ts`, including its `@module` / `Purpose:` header.
- The test enforces the A5 definition: the property families above, the rule 31:58-76 allowlist, and the rule 31:83-91 z-index table plus any Q10 exception, and the dev-only toolbar rules (`.dev-toolbar*`, `globals.css:1509-1547`) as an exception with file:line (DR21). `999px` pill radii join `50%` on the allowlist, and WI-2.1 edits rule 31 § Acceptable hardcoded values in the same commit (DR23).
- **Deferred list (A12):**
  - Class (b) literals are listed explicitly as `{ file, selector, property, value, stage: 3 | 4, item: N }`. A listed literal passes; anything else fails.
  - A separate `it` asserts the per-stage counts.
  - Class (b) literals owned by a Stage 4 item are tagged `stage: 4`, e.g. the toggle off-track `#ccc` in `.toggle-slider` (item 6).
- **Scanner fixtures:** a `describe` block feeds the scanner inline CSS strings with known violation counts. Without these, a scanner bug passes silently. Cover:
  - comments that contain literals
  - multi-line values
  - `@media` and `@keyframes` bodies
  - `var(--x, #fff)` fallbacks
  - `color-mix()` with a literal argument
- **Dead-code guard (A8), temporary:** assert that neither `index.html` nor any `src/**` file outside the candidates imports `src/App.css`, `src/components/TabBar/`, `Preview.tsx`, `ImageRenderer.tsx`, `usePreview.ts` or `preview.css`.
  - `exportService.ts` importing `mathRender.ts` stays allowed.
  - Its failure message names the TODOS.md entry "Remove dead App.css, TabBar and Preview".
  - `tests/table-alignment-rendering.test.ts:46-49` reads `preview.css` from disk; list it with the candidates rather than editing it.
  - Delete the guard when that cleanup lands.
- **RED evidence:** run the test on the post-Stage-1 tree and record the failing count per file.

### WI-2.2 — Value-preserving tokens — M
- Add proposal tokens only where their value equals the current literal. These are candidates to confirm against Appendix A:
  - the UI font-size ramp tokens (12/13/14px sites)
  - `--radius-control`, `--radius-popover` and `--radius-inner` (DR23), only at sites where both the value and the DR23 role already match. Every other radius goes on the deferred list for Stage 3, because snapping it changes pixels.
  - `--motion-duration-fast` (the 0.15s sites only)
  - the icon size tokens where current sizes match
- Theme-independent tokens go in `globals.css :root`. Theme-specific tokens go in both theme files together (rule 31 authoring rule 1).
- Class (c) resolutions come from the answers to Q6–Q10. A10 applies: 3 or more unrelated uses gets a semantic token; fewer uses stays an open question, with no invented token.
- **Rule edit (DR14), in the first token commit:** rule 31's "Token rationale and the decisions log live in the design doc that root `DESIGN.md` marks as current" gains an interim clause. While the UI redesign is in progress, its new and redefined tokens are logged in `docs/design/mdpro-ui-new/DESIGN.md` § Tokens. Any other token still goes to the current doc. WI-5.5 removes the clause.
- Add or confirm each new token's row in DESIGN.md § Tokens (rule 31 authoring rule 4, with the DR14 clause) without mirroring values (rule 31:18-19).
- Don't copy any value into this plan or DESIGN.md; cite `proposal-ab.html:21-61`.

### WI-2.3 — Migrate class (a) literals, file by file — M
- Replace class (a) literals with the equal-value tokens. Leave class (b) literals, which stay on the deferred list.
- Update CSS-pinning tests when an assertion names a literal that became a token. Name each updated test in the report:
  - `tests/design-tokens-accent-danger.test.ts`
  - `tests/settings-row-layout.test.ts`
  - `tests/source-scroll-layout.test.ts`
  - `tests/source-table-cell-highlight.test.ts`
  - `tests/milkdown-table-cell-highlight.test.ts`
  - `tests/milkdown-image-resize.test.ts`
  - `tests/milkdown-table-resize-handle.test.ts`
  - `tests/highlight-rendering.test.ts`
  - `tests/wide-table-fit-to-width.test.ts`
  - `tests/table-alignment-rendering.test.ts`
  - `tests/table-context-menu-component.test.ts` reads only TSX and is not affected.

### Stage 2 acceptance criteria
- [ ] G0 passes
- [ ] `tests/css-tokenization.test.ts` was shown failing before migration (counts in the report) and passes now
- [ ] Every remaining non-token literal is on the rule 31 allowlist, the z-index table, an approved exception, or the deferred list. The deferred list contains only class (b) entries, each tagged with its stage (3 or 4) and item.
- [ ] The computed-style diff against the Stage 0 baseline is empty for every `pnpm dev` surface × theme; Tauri-only cells show no visible difference. A mismatch is a bug to fix; never re-baseline in Stage 2.
- [ ] Every new token is declared in its correct file (`:root`, or both theme files) and documented in DESIGN.md without values
- [ ] Literal counts per file (before → after) are reported
- [ ] `CHANGELOG.md` `## [Unreleased]` has an entry for Deliverable A
- [ ] **STOP (Deliverable A):** the report is posted, the commit split is proposed, and the user has replied

**Proposed commit split (A, proposal only):**
1. `refactor(css): ordered styles/index.css entry and app CSS reader`
2. `refactor(css): split globals.css into ordered section partials`
3. `test(css): tokenization guard with deferred list`
4. `style(css): value-preserving token migration`

**Rollback:** revert the commits in reverse order. Each one leaves the build and tests green.

---

## Stage 3 — Visual retune (Deliverable B; items 1, 7, 8, 10, 11, 12, 15)

**Entry:** Deliverable A accepted; Q2 is answered (Q4 is closed by DR15).

### WI-3.0 — Audit `--color-border` used as a fill — S
- Review item 7 says to list consumers that use `--color-border` as a background or fill before it becomes a translucent mix.
- No existing surface token has the same value as `--color-border` in either theme, so a value-preserving retarget needs a new token.
  - **3 or more fill consumers (A10):** add a semantic fill token to both theme files that holds today's `--color-border` value, and retarget the consumers to it. The computed-style diff must stay empty.
  - **Fewer than 3:** retarget them to the nearest surface token as an intended Stage 3 change, and list it in the screenshot index.
- Either way, WI-3.1 then changes borders only.

### WI-3.1 — Theme token retune (items 1, 7, 8, 10, 15) — M
- In both `light.css` and `dark.css`, apply `proposal-ab.html:40-57`:
  - `color-scheme`
  - `--color-accent-soft` retune
  - `--color-border` as a text mix
  - new `--color-border-subtle` and `--color-hover`
  - per-theme `--shadow-soft`, which today exists only in `:root`; the Q2 answer decides the `:root` copy (proposed: keep it, guarded for parity)
- **Item 15 (optional, P2):** derive `--color-code-bg` (review :250).
- **Radii (DR23, required):** snap each deferred radius to its DR23 role.
  - 8px `.toolbar-button` and `.settings-category-btn`, 10px `.settings-search` and 4px `.settings-input` become `--radius-control`.
  - 8px table and image menus, 16px `.dialog-card` and `.settings-dialog`, 12px `.toast` and 12px grouped sections (`.shortcuts-section`, `.recovery-item`) become `--radius-popover`.
  - Nested parts (menu items, tab close, stepper buttons, inline edit, table and grid-picker cells) become `--radius-inner`. If a cell's before/after capture shows 4px breaking its borders, that cell uses `0`.
  - 24px `.toggle-slider` and the 3px About progress bar become `999px`. `.mcp-status-badge` loses its fill in WI-4.4, so its radius goes too.
  - Preflight re-runs the radius grep and assigns each remaining site a role. The selectors above are examples, not the full list.
- D4: `--color-bg`, `--color-surface`, `--color-text` and the other neutrals keep their values.
- **Rule edit:** rule 34 § Theme detection adds that each theme class sets `color-scheme`, so native scrollbars and form controls follow the theme.

### WI-3.2 — Migrate deferred class (b) literals (items 1, 11, 12) — M
- **Item 1:** `globals.css:1032` and `:1747` switch to `--color-accent-soft`.
- **Item 11 (DR12):** colors change instantly; only shape and visibility animate.
  - **Remove** color transitions (preflight re-lists the live sites): `.grid-picker-cell` (`globals.css:639`), the `.toggle-slider` track (`:1335`, `transition: 0.2s` covers every property), `.toc-entry__content` (`:1739`), and `.bottom-tabs__add` and `.bottom-tab` (`BottomTabs.css:24`, `:66`, both `all`). Preflight checks that `all` animated nothing but color. The dead `.tab` rule (`:1629`) is out of scope (A8).
  - **Keep, on the motion tokens:** the switch knob `transform` (`:1347`), and the hover-reveal `opacity` on `.tab__close` (`:1667`), `.bottom-tab__close` (`BottomTabs.css:105`) and `.mcp-copy-btn` (`:1423`). Spinner keyframes (`globals.css:810`, `imagePastePlugin.css:24`) keep rotating.
  - Add one `@media (prefers-reduced-motion: reduce)` block that sets the duration token to zero (proposal :60). Spinners keep rotating (DR13).
  - **Rule edit (DR13):** `.claude/rules/32-component-patterns.md` § Animations replaces "Wrap non-essential motion in `@media (prefers-reduced-motion: no-preference)`" with: every duration comes from the motion tokens, one `@media (prefers-reduced-motion: reduce)` block zeroes them, and progress spinners keep rotating. The modal-entry and theme-property sentences stay.
  - **Test:** extend the tokenization test so a `transition` or `transition-property` that names `background`, `background-color`, `color`, `border-color`, `box-shadow` or `all`, or has no property at all, fails in in-scope CSS.
- **Item 12:**
  - Snap the sub-12px chrome sizes (Baseline hotspots) to the ramp. Resolve the non-ramp sizes per DR22.
  - Add `--font-size-title: 16px` beside the ramp tokens.
  - Preflight sorts each non-ramp selector by role against proposal Board 3: dialog title (:230, :274), settings page title (:242), section label (:244) or card heading (:265). For example, `.settings-title` is the dialog title and `.settings-page-title` the page title; each settings page's `h3` is a page title or a card heading depending on what it heads (assumption — confirm per page).
  - Glyph sizes (`.toast-close`, `.settings-close`, `.settings-stepper button`) go on the deferred list, tagged Stage 4 WI-4.2, which replaces them with icons.
  - Give TOC rows and settings-nav rows `min-height: 28px`.
  - Keep the title-bar and tab-bar heights (review :217).
- **Hover:** row hover moves from `--color-panel` to `--color-hover` (review item 7).
- **Flat rows and tabs:** TOC rows, settings rail items and tabs get no border or shadow at rest; the radius shows only on the hover or selected fill (DESIGN.md § Tokens). The active tab's `--shadow-soft` is the one exception (proposal :45).
- **Item 8:** menus and toasts may use `--color-border-subtle` with the single `--shadow-soft`.
- Remove each migrated `stage: 3` entry from the deferred list.

### WI-3.3 — Focus ring (item 7, DR15) — S
- Add `--color-focus-ring: var(--color-accent)` to `:root`. The proposal's 70% mix (proposal :24) is not used: in the light theme it measures 2.91:1 on the surface and 2.68:1 on accent-soft. The theme classes sit on `<html>`, the same element as `:root`, so the token follows each theme's accent.
- Pattern 2 outlines and pattern 3's inset ring on TOC rows use it. Pattern 1 (input border and soft ring) and pattern 3's accent-soft fill are unchanged.
- Apply the drafted spec-column edit to `.claude/rules/33-focus-indicators.md`, and drop "recent dropdown" from pattern 3's surfaces (none is mounted, WI-1.2).
- Add `.toolbar-button:focus-visible`.
- **Rule edit (DR17):** rule 33's checklist line "Focus visibility holds at 200% browser zoom." becomes "Focus visibility holds at the 400×640 minimum window and with `zoom: 2` on `<html>` in Web Inspector."
- **Test:** `tests/focus-trap.test.ts` stays green. A source-inspection assertion checks that `:root` declares `--color-focus-ring: var(--color-accent)`, and that `.toolbar-button:focus-visible` exists and uses it.

### WI-3.4 — Raise the macOS floor to 13.1 (E1) — S
- Add `bundle.macOS.minimumSystemVersion: "13.1"` to `src-tauri/tauri.conf.json`. macOS 13.1 is the lowest release whose bundled WebKit (Safari 16.2) has `color-mix()`, which the app CSS already uses (`light.css:9-11`, `dark.css:9-11`). No `@supports` fallback is added.
- Change the target in `CLAUDE.md` ("macOS 13+") to macOS 13.1+. DESIGN.md § Product context already states the 13.1 floor; confirm it still does.
- **Verify:** after `pnpm tauri build`, the bundle's `Info.plist` has `LSMinimumSystemVersion` 13.1.

### WI-3.5 — Docs, evidence, QA — S
- Add or update DESIGN.md § Tokens rows for every new or changed token (names only).
- Capture after screenshots for the whole matrix.
- Measure contrast and run the rule 33 protocol.
- Run `/qa-only` on the changed surfaces.

### Stage 3 acceptance criteria
- [ ] G0 passes
- [ ] The tokenization deferred list has no `stage: 3` entries, the test has no `it.skip`, and the per-stage count check asserts 0 for Stage 3 (only `stage: 4` entries remain)
- [ ] Every theme-specific token change landed in both theme files in the same change (rule 31 authoring rule 1); none of the D4 neutral token values changed
- [ ] No chrome `font-size` below 12px (grep proof); non-ramp sizes are resolved per DR22, and the only chrome size outside the ramp is `--font-size-title`
- [ ] Every chrome `border-radius` is `--radius-control`, `--radius-popover`, `--radius-inner`, `50%`, `999px` or `0`, apart from the DR21 dev-toolbar exception (DR23)
- [ ] The title-bar and tab-bar heights are unchanged (computed height in both themes matches the baseline)
- [ ] A `prefers-reduced-motion: reduce` block exists and zeroes the motion duration token, and rule 32 § Animations describes that block (DR13)
- [ ] Only `transform` and `opacity` transitions remain, plus spinner keyframes (the DR12 test passes). Switching Light and Dark in `pnpm tauri dev` shows no fade on tabs, TOC rows, switches or the table grid picker, and hover highlights appear instantly
- [ ] `color-scheme` is set on `.theme-light` and `.theme-dark`; native scrollbars and checkboxes follow the theme in WKWebView (manual check)
- [ ] Focus outlines use `--color-focus-ring`, which equals the accent in both themes (DR15), rule 33's spec column names it, and `.toolbar-button:focus-visible` exists
- [ ] `tauri.conf.json` sets `minimumSystemVersion` to 13.1, and CLAUDE.md and DESIGN.md say macOS 13.1+ (E1)
- [ ] **Screenshot index:** every Appendix B cell has a before/after pair taken in `pnpm tauri dev` (E5), labelled "matches proposal" (same `?theme`/`?page`), "intentionally differs: <reason>", or "no reference"
- [ ] "No reference" surfaces received token changes only, with no layout, spacing or structure changes (checked against the diff)
- [ ] **Contrast table** for both themes. Nothing fails A9 unless it is flagged and explicitly accepted by the user. It covers:
  - text (4.5:1): `--color-text` and `--color-muted` on bg, surface and panel; placeholder text on the input fill; link text on the editor background
  - labels on fills (4.5:1): primary and danger button labels; the menu highlight (`--color-panel` on `--color-accent`, rule 34); active rows (accent text on accent-soft over surface and over bg)
  - the focus ring on bg, surface, panel and `--color-accent-soft` (3:1)
  - control boundaries (3:1): the toggle off-track, input borders, and the segmented-control selected fill against its track
  - disabled controls: recorded, not required (WCAG exempts inactive controls)
- [ ] Rule 33 checklist is done in both themes, at the default window, at 400×640 and with the DR17 2× scale, with who ran each check recorded
- [ ] `/qa-only` findings are listed, each marked fixed, deferred or out of scope
- [ ] Tokenization grep: hex, `rgb(` and `hsl(` in in-scope CSS return only lines that rule 31:58-76 or an approved exception permits
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable B
- [ ] **STOP (Deliverable B) — mandatory visual sign-off:** the user reviews the before/after index and explicitly approves before Stage 4

**Proposed commit split (B, proposal only):**
1. `style(css): retarget border-as-fill consumers`
2. `style(theme): derived borders, hover, accent-soft, shadow, color-scheme`
3. `style(css): instant color changes, motion tokens and reduced motion`
4. `style(css): chrome type ramp and row heights`
5. `style(css): focus ring` + `docs(rules): rule 33 focus-ring spec` (DR15)
6. `chore(config): macOS 13.1 minimum for color-mix()`
7. `docs(design): token entries`

**Rollback:** each commit reverts independently. Reverting B leaves A intact, with a zero-diff UI.

---

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

### WI-4.10 — External change dialog (DR5) — M
- **Why:**
  - "Modified" and "deleted" share one `ReloadDialog` (`App.tsx:487-494`, `:1163-1168`), and **Reload** has `autoFocus` (`ReloadDialog.tsx:38-40`).
  - `decideFileChange` never looks at unsaved edits (`src/utils/dataLossGuards.ts:68-88`), so Enter discards them.
  - A deleted file is offered Reload, which then fails in `handleReloadFile` (`App.tsx:606-620`) with a "Reload failed" toast.
  - Against rule 32: there is no Tab trap, and the dialog uses `aria-label` where the rule requires `aria-labelledby` / `aria-describedby`.
- **Guard first (pure):** `decideFileChange` also takes the active document's `isModified` and returns one of three prompts: changed with no edits, changed with unsaved edits, or deleted. `rename` and `ignore` are unchanged. The `switch` in `App.tsx` stays exhaustive (rule 60).
- **Dialog:**
  - Implements the DESIGN.md § External change dialog state table: titles, copy, button order, focus and Esc. The file name comes from the DR4 shared helper.
  - Tab is trapped in the dialog, following `handleDialogKeyDown` in `SettingsDialog.tsx` (rule 32).
  - The state is derived at render from the latest event and the current `isModified`, so a later event can never show the no-edits state over unsaved text.
- **Deleted → Save As…:** there is no Save As menu item, but the code path exists: `saveActiveDocumentAs` (`useDocument.ts:172-200`) opens the save picker and saves, as untitled documents already do (`:207`). "Save As…" calls it (Q14, closed). Preflight: confirm the file watcher follows the new path.
- **Tests** (through tdd-guardian, RED first):
  - Guard: changed + clean, changed + dirty, deleted (clean and dirty), renamed, another path, and a null event
  - **Data-loss regression:** in the unsaved-edits state, Enter does not call reload and the content is unchanged. This test fails against today's dialog.
  - In every state, Esc takes the left action and never reloads
  - The deleted state has no Reload button
  - Tab from the last button wraps to the first, and Shift+Tab wraps back
  - `tests/focus-trap.test.ts:83-93`: replace the ReloadDialog "primary action button has autoFocus" source match with per-state focus assertions (rule 33 asks new dialogs for equivalent assertions)
- **Logging:** keep `dialog.reload.reload` and `dialog.reload.ignore` (`ReloadDialog.tsx:19,32,43`). Add `dialog.reload.discard` and `dialog.reload.save_as`, each with `context.state`.

### WI-4.11 — Already-open guard (DR6) — S
- **Order:** no UI and no file overlap with the other Stage 4 items, so it runs first in Stage 4. WI-4.14 follows it.
- **Why:** `openDocumentFromPath` (`useDocument.ts:59-82`) and `openDocumentFromDialog` (`:92-100`) read the file and call `upsertDocument`. That call replaces any document with the same id (`documentStore.ts:45-64`), and the id is a hash of the path (`document.rs:57-64`). So re-opening an open file discards its unsaved edits with no prompt. The routes are ⌘O, recent files, Finder / `file:open` (`openPaths`, `App.tsx:553-567`) and a drop.
- **Behavior:** if the path is already open, activate that document and do not use the fresh read, whether or not it has unsaved edits.
  - No dialog and no toast: the tab switch is the one signal (rule 30 rule 5).
  - A change on disk is still handled by WI-4.10's dialog.
- **Check:** one pure helper, used by both open paths.
  - It compares the id the store uses. `Document::generate_id` (`document.rs:57-64`) hashes the path exactly as given, with no canonicalization.
    - So two spellings of one file (a symlink, or a `./` segment) still open twice.
    - That is today's behavior and stays out of scope.
  - The path route checks before calling `fileService.openFile`, which skips the read.
  - `open_file_dialog` (`file.rs:1094-1135`) reads the file before it returns, so the dialog route compares `result.document.id` and drops the fresh copy.
- **Tests** (through tdd-guardian, RED first):
  - **Data-loss regression:** with an open document that has unsaved edits, opening the same path leaves `content` and `isModified` unchanged and makes that document active. This test fails today.
  - The same case through the dialog path (Tauri mocked at the boundary)
  - A clean already-open document is also just activated
  - A different path still opens a new tab
- **Logging:** `tab.switch` with `context.reason: "already_open"` and the action id.

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

### WI-4.13 — Error toasts (DR9) — S
- **Order:** Lane B, right after WI-4.2. It uses the `Icon` close glyph and edits failure calls in `App.tsx`.
- **Why:**
  - `toastStore.ts` holds one `message` and always starts a 3000 ms timer, so every toast disappears on its own.
  - `Toast.tsx:13` always renders `role="status"` with `aria-live="polite"`. The component already accepts `onClose`, but `App.tsx:1189` passes none, so no toast has a dismiss button today.
  - About a dozen calls report failures with the same look and timing as successes, including `Save failed: ${message}` (`saveService.ts:40`) next to "Saved" (`:37`). Rule 60 requires save errors to reach the user.
  - DESIGN.md § Toasts specifies an error variant that nothing builds.
- **Store:** `showToast(message, options?)`, where `options.variant` is `"info" | "error"` and defaults to `"info"`.
  - No call passes `durationMs` today, so the options object replaces that parameter. Re-check with grep before changing the signature.
  - `info` keeps the 3000 ms timer.
  - `error` clears any pending timer and starts none, so it stays until dismissed or replaced.
  - Any new toast replaces the current one (rule 32: one at a time), and its own variant decides the timer. A timer started for an earlier `info` toast must never clear a later `error` toast.
- **Component:** reads the variant from the store.
  - `error`: `role="alert"`, the danger icon and left edge from DESIGN.md § Toasts, and a button named "Dismiss" that calls `clearToast`. Focus does not move to the toast.
  - `info`: unchanged: `role="status"`, `aria-live="polite"` and no button.
- **Error calls:** re-locate each by its message, since earlier work items move the line numbers.
  - `App.tsx`: `:530` open, `:596` export, `:614` reload, `:644` recover draft, `:655` discard draft, `:670` reopen with encoding, `:703` new window
  - `saveService.ts:40`; widen `SaveDeps.showToast` to take the options
  - `preferencesService.ts:78`
  - `useUpdater.ts:52` (a save failed, so the update was cancelled)
  - `imagePastePlugin.ts:161` and `:217`, and the batch summary at `:208` when `failureCount > 0`
  - the WI-4.6 "Close failed" toast at both Discard callers
- **Refusals stay `info`:** `imagePastePlugin.ts:85` and `:110`, `useUpdater.ts:28`, `App.tsx:724` and `:959`, and WI-4.12's unsupported-drop toast. Each tells the user what to do next instead of reporting a failure.
- **Open failures reach the user** (DESIGN.md § States › Documents):
  - Today `openDocumentFromPath` returns `null` for every failure that isn't an encoding error (`useDocument.ts:70-79`), and `openPaths` swallows the rest (`App.tsx:553-567`). Recent files, Finder / `file:open` and a drop show nothing (rule 60). Only ⌘O shows "Failed to open file" (`:530`), because the dialog path re-throws (`useDocument.ts:112-114`).
  - `openDocumentFromPath` re-throws non-encoding failures, as the dialog path already does. An encoding failure still opens the encoding dialog and shows no toast.
  - `handleOpenPath` shows one error toast, "Failed to open *name*", with the name from the DR4 helper. `openPaths` collects its failures and shows one toast for the batch, for example "Failed to open 3 files". ⌘O uses the same copy.
  - A file over the limit adds its reason: "Failed to open *name*: larger than 10 MB". The backend returns `FileError::FileTooLarge` for it (`src-tauri/src/commands/file.rs:162-168`). Other raw error text goes to the log only (rule 30 rule 3).
  - The large-file warning can't fire: it warns above 10 MB (`useDocument.ts:31`, `:66-68`, `:101-103`, `:126-128`; shown at `App.tsx:499-503`), and the backend refuses those files first (`file.rs:16`). It is a dead-code candidate (A8); list it, don't delete it.
- **Export success:** "Exported HTML to *path*" (`App.tsx:593`) puts an absolute path in primary UI (rule 30 rule 3). It becomes "Exported *name*" with the DR4 helper; the path goes to the log only.
- **Logging settings save:** `loggingService.setLoggingSettings` (`loggingService.ts:82-85`) goes through `safeInvoke`, which returns `null` on any failure (`:17-23`). The call then resolves with the requested settings, so a failed save looks saved. It calls `invoke` directly and rejects instead; the `AdvancedSettings` change is in WI-4.3.
- **Rule 32:** § Toast gains the variant contract in the same commit (DESIGN.md § Rule changes).
- **Tests** (through tdd-guardian, RED first):
  - The store, with fake timers: `info` clears after 3000 ms; `error` is still set long after; `error` after `info` cancels the pending timer; `info` after `error` replaces it and starts a timer
  - `Toast`, by role: `error` renders an alert whose "Dismiss" button clears the store; `info` renders a status with no button
  - Regression: `tests/save-blink.test.ts:106-115` expects the save rejection to pass the error variant. This test fails today.
  - `tests/preferences-save-failure.test.ts` and `tests/useUpdater.test.ts:96` assert the error variant
  - A source-inspection test, in the style of `tests/focus-trap.test.ts`, finds each `App.tsx` failure message above and asserts its call passes the error variant
  - **Regression:** opening a missing path through `handleOpenPath` shows one error toast naming the file. This test fails today. A batch of two failures through `openPaths` shows one toast with the count; an encoding failure shows none.
  - A `FileTooLarge` rejection gives "larger than 10 MB"; an unknown rejection gives no raw message in the toast
  - The export success toast contains the file name and no `/`
  - `setLoggingSettings` rejects when `invoke` rejects
- **Logging:** keep `toast.close` and add `context.variant`. Log nothing when a toast appears; each failure path already logs its own `fail` event.

### WI-4.14 — WYSIWYG follows text changed outside the editor (DR11) — M
- **Order:** right after WI-4.11, before the lanes split. It touches `App.tsx` and `MilkdownEditor.tsx`, which Lane B also edits.
- **Why:**
  - `useEditor` builds the Milkdown instance with `[activeDocumentId]` as its only dependency (`MilkdownEditor.tsx:173-203`) and reads the text once, through `defaultValueCtx` (`:188`). A store write that keeps the id never reaches the screen.
  - Reload writes that way: `handleReloadFile` (`App.tsx:606-620`) calls `replaceDocument`, which is `upsertDocument` with the same id (`useDocument.ts:155-160`). The screen keeps the old text.
  - The listener at `MilkdownEditor.tsx:245-250` writes what is on screen back to the store on the next edit. Typing after Reload therefore restores the old text plus the edit, and ⌘S saves that over the reloaded file (rule 60: data loss).
  - A WYSIWYG image drop appends to the store and expects the editor to re-render (`App.tsx:744-752`). The image stays off screen, and the next keystroke removes it from the store.
  - MCP writes already push into the live editor with `replaceAll` (`useMcpEvents.ts:135-144`). Source mode reads the store, so it is unaffected.
- **Preflight:** grep every `upsertDocument` and `updateDocumentContent` call that doesn't come from the Milkdown listener. Classify each as already pushed (MCP), to fix, or unable to change the text of an open WYSIWYG document (for example a save that only sets `path` and `isModified`). Put the table in the stop report.
- **Behavior:**
  - A store write from outside the editor reaches the live view before the next edit, following the MCP `replaceAll` pattern. Do not remount on a revision key; that loses the cursor and the undo history.
  - The push must not mark a reloaded document modified or rewrite its Markdown. Either skip the listener's write-back for that transaction, or drop a write-back whose text equals the store's (assumption — choose in preflight; Milkdown's serializer may normalize text the store kept verbatim).
  - If `replaceAll` throws, remount the editor from the store and log `fail`.
  - The logic lives in a new hook file (assumption: `src/components/Editor/useMilkdownExternalSync.ts`). `MilkdownEditor.tsx` is already 328 lines (rule 50).
- **Tests** (through tdd-guardian, RED first; the extracted hook with a fake editor, per rule 10's plugin row):
  - **Data-loss regression:** after Reload, the next editor update carries the reloaded text, not the old text. This test fails today.
  - An image drop in WYSIWYG pushes the new text into the editor.
  - The editor's own write-back does not trigger a push, so there is no loop.
  - `isModified` stays false after Reload.
  - A document switch builds the new editor once and does not also push.
- **Logging:** `editor.milkdown.external_sync` with `context.reason` (`reload`, `image_drop` or `store`), and `fail` when a push falls back to a remount.

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

---

## Stage 5 — `sourceFont` preference (Deliverable D; item 3, D2)

**Entry:** Deliverable C is accepted, **and** the E6 fix has landed in its own PR: a `config.json` parse failure no longer leads to any write over the file (TODOS.md P1). If the fix has not landed, stop here.

**First run vs upgrade (observed; re-verify in preflight):**
- A missing `~/.mdpro/config.json` is created from `UserPreferences::default()` (`src-tauri/src/services/preferences.rs:62-77`), so `EditorConfig::default()` decides the first-run value.
- An existing file goes through serde, so field-level defaults decide the upgrade value.
- If preflight finds this no longer holds, stop and ask.

### WI-5.1 — Rust model (E3) — S
- **Field:** add `source_font: String` to `EditorConfig` in `src-tauri/src/models/preferences.rs` (near `:568`).
  - It is serialized as `sourceFont`, with exactly two known values: `"mono"` and `"editor"`.
  - This follows the existing `font_family: String` pattern.
- **Upgrade defaults (review :100):**
  - The field gets `#[serde(default = …)]` returning `"editor"`, so existing files keep their current look.
  - `UserPreferences.editor` (`:54-56`) is plain `#[serde(default)]` today, which calls `EditorConfig::default()`. It gets a dedicated default fn that also yields `"editor"`, so a file with no `editor` block counts as an upgrade too.
- **First-run default (review :100):** `EditorConfig::default()` returns `"mono"`. It is reached only through `UserPreferences::default()`, which is written when no file exists.
- **Unknown values:** an unknown string deserializes without error and is interpreted at apply time (WI-5.3). Because there is no enum, the field adds no new whole-file parse failure.
- **Shared fixture:** `tests/fixtures/preferences-source-font.json` (assumption; match existing fixture folders) holds the cases below. Rust reads it with `include_str!`; the TS tests read the same file.
- **Tests (`cargo test`):**
  - `editor` present without `sourceFont` → `"editor"`
  - no `editor` block → `"editor"`
  - `UserPreferences::default()` (what a missing file becomes) → `"mono"`
  - `"mono"` and `"editor"` round-trip through serialize and deserialize
  - an unknown string (e.g. `"serif"`) loads without error and leaves every other preference intact
  - a merge that changes `sourceFont` preserves every sibling `editor` field

### WI-5.2 — TypeScript type and defaults — S
- Add `sourceFont: "mono" | "editor"` to `EditorConfig` in `src/types/preferences.ts` (near `:284`). `DEFAULT_EDITOR_CONFIG.sourceFont` is `"mono"`, matching Rust `Default`; `DEFAULT_PREFERENCES` must stay in sync with Rust.
- Add one shared `normalizeSourceFont(value: unknown): "mono" | "editor"`, which maps anything unknown to `"editor"`. Both the startup apply (WI-5.3) and Settings initialization (WI-5.4) use it, so an unknown stored value never reaches a two-option control.
- **Tests:**
  - Read the shared fixture and assert that the TS defaults agree with its known values.
  - `normalizeSourceFont` maps `"mono"`, `"editor"`, an unknown string, `undefined` and a non-string correctly.
  - Upgrade semantics are proven in Rust only, because TS never deserializes the file.

### WI-5.3 — Runtime application — S
- Declare `--source-font-family` in `:root`, defaulting to the mono stack (proposal :27; E8). `.cm-content` consumes it instead of `--editor-font-family`.
- `editorPrefApply.ts` sets `--source-font-family` at runtime from `normalizeSourceFont(value)`:
  - `"mono"` → the mono stack (proposal :27; confirm the mono token name in `:root`)
  - `"editor"` and any unknown value → `var(--editor-font-family)` (proposal :59), like the default branch of `fontFamilyToCss` (`editorPrefApply.ts:46-52`)
- Editor font size and `--editor-line-height` stay unchanged (review :97).
- Update rule 31:93-98 to list `--source-font-family` as the fourth runtime-toggled token.
- Update rule 30 § Core principles: cross-mode parity names Source mode's font as the stated exception (D2), and the mode list drops Preview, which isn't mounted (DR10).
- **Tests:** a pure-function test that `"mono"`, `"editor"` and an unknown string each produce the expected CSS variable assignment.

### WI-5.4 — Settings → Editor "Source font" row — S
- Add a row with Monospace / Follow editor font, using the Stage 4 row contract.
- It goes through `EditorSettings.handleChange` (`EditorSettings.tsx:30-34`), which sends the whole `editor` object and rolls back on failure. No new save path.
- Settings initialization (`EditorSettings.tsx:12-16`, which does `{ ...DEFAULT_EDITOR_CONFIG, ...p.editor }`) passes `sourceFont` through `normalizeSourceFont`.
- **Tests (userEvent):**
  - changing the option sends an `editor` payload with `sourceFont` changed and every sibling field unchanged
  - the applied variable changes
  - a rejected save rolls back both the row and the variable
  - the row has an accessible label
  - a stored unknown value shows "Follow editor font" as selected
- **Logging:** follow the existing preference-change logging pattern (rule 20).

### WI-5.5 — Make the redesign design system current (DR14) — S
- Runs last, after the other Stage 5 items.
- Root `DESIGN.md`: the new doc becomes the current design system, and the old doc becomes the record of the pre-redesign UI. The old doc itself is not edited.
- Rule 31: remove the DR14 interim clause, and name the new doc in the "today" parenthetical.
- `docs/design/mdpro-ui-new/DESIGN.md`: wording that calls it a target state or unshipped now describes the shipped UI. Open questions still open move to `TODOS.md`.
- CLAUDE.md links root `DESIGN.md` only, so it needs no change. Confirm with a grep for `mdpro-ui-old`.

### Stage 5 acceptance criteria
- [ ] G0 passes, including `cargo test`
- [ ] Upgrade path proven by Rust tests: a missing field and a missing `editor` block both give `"editor"`
- [ ] Upgrade path seen in Tauri with an existing `config.json` that has no `sourceFont`: Source mode renders exactly as before, and the screenshot matches the Stage 4 after-shot. `pnpm dev` cannot show this, because it returns `DEFAULT_PREFERENCES`.
  - Never touch the real `~/.mdpro/config.json`. `load_preferences` finds the file through `HOME` (`services/preferences.rs:51-60`).
  - Build once with `pnpm tauri dev`. Then, with the Vite server still running, launch the debug binary with `HOME` pointed at a temp directory that holds the fixture.
  - Record the `shasum` of the real file before and after; the two must match.
- [ ] Cold start in Tauri with `sourceFont: "editor"`: record whether a mono first paint is visible (E8). If it is, a TODO exists that covers first paint for all editor preferences.
- [ ] First-run path proven by test: no preferences file → `"mono"`
- [ ] An unknown `sourceFont` value loads without error, applies as Follow editor font, and leaves other preferences intact
- [ ] The Settings row switches Source mode between mono and the editor font live, in both themes; WYSIWYG is unaffected
- [ ] Editor font size and line height are unchanged in both options
- [ ] Rule 31:93-98 lists four runtime-toggled tokens; DESIGN.md is updated without values
- [ ] CJK caveat checked manually: tables with CJK are noted as not aligning exactly (review :102-103); scroll and selection mapping across mode switches is verified
- [ ] Source-mode screenshots for each option × theme; `/qa-only` findings triaged
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable D
- [ ] Root `DESIGN.md` marks the new doc current, and rule 31 has no interim clause (WI-5.5)
- [ ] **STOP (Deliverable D):** the report is posted, the commit split is proposed, and the user has replied

**Proposed commit split (D, proposal only; backend first, per the CLAUDE.md splitting strategy):**
1. `feat(prefs): sourceFont model (Rust)`
2. `feat(prefs): sourceFont type and apply (TS)`
3. `feat(settings): Source font row`
4. `docs(rules): rule 31 runtime token`
5. `docs(design): mark the redesign design system current`

**Rollback:** revert D. A missing-field preferences file stays valid in both directions, because the field is additive.

---

## Constraints (all stages)

- **Do not copy anything review §3 lists (:255-263):**
  - OpenAI Sans and the gray ramp
  - foreground-colored primary buttons
  - a control blue separate from the accent
  - neutral-step menu hover
  - the 46pt title bar and 24px chrome
  - a translucent sidebar, `superellipse`, `light-dark()`, `[data-theme]`
  - a Tailwind spacing scale or any `--space-N` scale
  - 12px body text
- **Keep:**
  - the solid-accent menu highlight (review :260; rule 32)
  - the current neutrals (D4)
  - the title-bar and tab-bar heights
  - the editor font size and `--editor-line-height`
- **No `--color-syntax-code`**; never copy `proposal-ab.html:63-69`.
- **No behavior changes** outside the numbered review items, WI-4.8 (DR2), WI-4.9 (DR3), WI-4.10 (DR5), WI-4.11 (DR6), WI-4.12 (DR7), WI-4.13 (DR9), WI-4.14 (DR11) and the WI-4.6 dialog fix (DR8). Do not build a command palette (Q11). Do not edit `docs/design/mdpro-ui-old/*` or `docs/design/mdpro-ui-new/proposal-ab.html`.
- **Do not delete** the dead-code candidates (A8).
- **No commits or pushes** unless the user asks. Never commit screenshots.

## Risks

| Risk | Mitigation |
|---|---|
| The split breaks tests that read `globals.css` from disk | WI-1.1 helper before the move; assertions are unchanged |
| Vite changes CSS order across partials | One ordered `src/styles/index.css`, read by the app, the test helper and the pure-move proof (E2); built-CSS order check in Stage 1 |
| A translucent `--color-border` changes elements that use it as a fill | WI-3.0 retargets fills first |
| `color-mix()` is unsupported at the WebKit floor | Floor raised to macOS 13.1 in WI-3.4 (E1) |
| A 70% focus ring misses 3:1 on soft or tinted fills | Contrast table in Stage 3; flag, don't silently retune |
| Snapping sub-12px text overflows tight chrome (tab badges, TOC) | Screenshot matrix at the default window, at 400×640 (DR16) and with the 2× scale (DR17) |
| Undeclared fallback tokens hide intended colors | Q6 resolved in Stage 2 |
| First run cannot be told apart from an upgrade | File presence decides (observed). Serde defaults cover both the field and the `editor` block; Rust tests cover both plus first run (WI-5.1) |
| A zero-change stage drifts by 1px or one color without anyone noticing | Computed-style JSON diff instead of visual comparison (E5) |
| Replacing native checkboxes breaks a setting's persistence | Table-driven per-site regression test (WI-4.3) |
| A corrupt `config.json` is overwritten at launch (pre-existing) | The E6 fix must land before Stage 5 |
| Keyboard behavior (Space on a switch) cannot be tested with plain DOM events in jsdom | Test-only Testing Library devDependencies (E7), pinned by the WI-1.0 smoke test |
| Existing users see mono for a moment before preferences load | Accepted (E8); checked in Stage 5 acceptance |
| The manual upgrade check overwrites the developer's real preferences | Temp `HOME` plus a before/after checksum of the real file (Stage 5) |
| The main bar adds a row above the editor when the sidebar is shown | It uses `--title-bar-height`, the sidebar strip's height, so the top edges align; the lost editor height is judged at Stage 4 sign-off |
| Enter in the Discard confirmation discards unsaved edits until Stage 4 lands | Accepted in DR8. WI-4.6's regression test fails on today's dialog |
| A failed save looks like "Saved" and disappears after 3 seconds until Stage 4 lands | Accepted in DR9. WI-4.13's save-failure regression test fails on today's store |
| A later info toast replaces an error toast before it is read | Accepted: rule 32 allows one toast at a time, and each failure path also logs its own `fail` event |
| The drop target stays visible if Tauri never sends `leave`, for example when a drag is cancelled | WI-4.12 also clears the target on `drop` and on window blur; checked by hand in `pnpm tauri dev` |
| Re-opening or dropping an open file discards its unsaved edits until Stage 4 lands | Accepted in DR6. WI-4.11 runs first in Stage 4, and its regression test fails on today's open path |
| Enter in the external-change dialog discards unsaved edits until Stage 4 lands | Accepted in DR5. WI-4.10's regression test fails on today's dialog, and rule 60 treats the path as a blocker for any earlier release |
| Not mounting an editor with no document breaks the launch view-mode effect or the first Milkdown mount | WI-4.9 preflight reads both paths; a component test opens a document after the empty state and asserts the editor mounts |
| Word count stalls typing on large files | Pure util off the keystroke path with a debounce; checked against a file near the 10MB limit (WI-4.8) |
| Typing after Reload or an image drop in WYSIWYG writes the old text back, and ⌘S saves it, until Stage 4 lands | Accepted in DR11. WI-4.14 runs right after WI-4.11, and its regression test fails on today's editor |
| Pushing outside text into Milkdown marks a reloaded document modified or rewrites its Markdown | WI-4.14 tests that `isModified` stays false after Reload and that the editor's own write-back causes no push |
| Re-throwing open failures shows errors that launch opens used to hide | One toast per batch, with the count; raw messages go to the log only (WI-4.13) |
| A narrow threshold drifts as labels or values change, and a field clips instead of hiding | Thresholds come from the widest realistic values and live in one partial; the 400×640 and 959px screenshots are retaken at each Stage 4 stop (DR16) |
| In a narrow window VoiceOver no longer reads the hidden status fields | Accepted in DR16: they return when the window widens, and the cursor position always stays |

## What already exists (reuse, don't rebuild)

| Existing | Reused by |
|---|---|
| `.toolbar-button.danger` (`globals.css:1195`) | WI-4.6 destructive confirm |
| `Toast`'s unused `onClose` prop and the `.toast-close` style (`App.tsx:1189` passes no `onClose`) | WI-4.13 dismiss button |
| `.toggle-switch` / `.toggle-slider` CSS (`globals.css:1314-1345`) | `ToggleSwitch` wraps it; no new switch styles |
| The `fontFamilyToCss` default-branch fallback (`editorPrefApply.ts:46-52`) | `sourceFont` apply (WI-5.3) |
| `EditorSettings.handleChange`: full `editor` object save plus rollback; the failure toast in `preferencesService.setPreferences` | Source font row (WI-5.4) |
| `load_preferences` writes defaults when the file is missing (`services/preferences.rs:62-77`) | First-run detection, with no new flag (WI-5.1) |
| The source-inspection pattern of `tests/design-tokens-accent-danger.test.ts`; `tests/focus-trap.test.ts` | WI-2.1, WI-3.3, WI-4.6, WI-4.7 |
| `color-mix()` already ships in 7 places (e.g. `dark.css:9`) | E1 makes official the macOS floor it already needs |
| The MCP `replaceAll` push into the live editor (`useMcpEvents.ts:135-144`) | WI-4.14 |
| Table menu keyboard traversal (`TableContextMenu/index.tsx:146-172`) | WI-4.15 extracts it into the shared hook |
| The save picker and save path `saveActiveDocumentAs` (`useDocument.ts:172-200`) | WI-4.10's "Save As…" (Q14) |
| The General and Editor load-failure line (`GeneralSettings.tsx:73`) and the `MarkdownSettings` rollback (`:30-39`) | WI-4.3 settings states |

## NOT in scope

- Review §4 artboard work (designing the undrawn surfaces). Those surfaces get token changes only, except the empty state, which WI-4.9 builds (DR3), the external-change dialog, which WI-4.10 rebuilds (DR5), and the drop target, which WI-4.12 builds (DR7).
- A command palette, unless the app already has one (Q11).
- Density changes, title-bar and tab-bar height changes.
- Deleting `src/App.css`, `src/components/TabBar/`, the Preview pane files, `Sidebar/Sidebar.tsx` and `FileItem.tsx`, or the large-file warning (list them only).
- Restyling or re-mounting the Preview pane (DR10). Its dark code theme is unsolved, because `Preview.tsx:6` imports only the light `github.css`, and has to be solved before any re-mount.
- A stylelint setup or any new runtime dependency.
- The rejected D3 code hue.
- Fixing the existing `config.json` overwrite inside this plan. It is a separate PR that gates Stage 5 (E6; TODOS.md P1).
- Removing the first-paint delay that all editor preferences already have (E8).
- An `@supports` fallback for `color-mix()`, which E1 makes unnecessary.
- Page zoom (⌘= / ⌘−). mdpro has none today, and the DR17 2× check stands in for it (TODOS candidate).
- An app error boundary. `src/` has none (no `componentDidCatch`), so a render error leaves a blank window with no message and no way back (TODOS candidate).
- The update download failure copy. About shows the raw error, `Download failed: ${msg}` (`AboutSettings.tsx:152-155`), while a failed check shows friendly copy (`:105`). Rule 30 rule 3 wants the raw text in the log only (TODOS candidate).
- Asking before unsaved shortcut edits are dropped. Esc closes Settings with no dirty check (`SettingsDialog.tsx:63-65`) and the closed dialog unmounts its pages (`:110`), so Shortcuts edits vanish without a prompt. WI-4.3 restyles the banner only (TODOS candidate).
- A Save As menu item. The ⌘⇧S preference and its Shortcuts row exist (`src/types/preferences.ts:87`, `:162`; `KeyboardShortcutsSettings.tsx:27`), but no menu item or handler uses them. WI-4.10 reaches `saveActiveDocumentAs` from the dialog only (Q14) (TODOS candidate).

## Acceptance Criteria

- [ ] Stage 0 gate: the plan is approved and A1–A12 / Q1–Q14 are answered or waived
- [ ] Deliverable A: `globals.css` split with a pure-move proof; tokenization guard is green; empty computed-style diff against the baseline
- [ ] Deliverable B: proposal token retune applied in both themes; deferred list empty; contrast table and rule 33 checklist recorded; **user visual sign-off received**
- [ ] Deliverable B also raises the macOS floor to 13.1 in `tauri.conf.json`, CLAUDE.md and DESIGN.md
- [ ] Deliverable C: items 2, 4, 5, 6, 9, 13, 14, the DR2 main bar and status strip, the DR3 empty state, the DR5 external-change dialog and the DR6 already-open guard (each with its data-loss regression test), the DR7 drop target, the DR8 destructive confirmation (with its data-loss regression test), the DR9 error toasts (with the save-failure and open-failure regression tests), and the DR11 WYSIWYG sync (with its Reload regression test), all implemented with behavior tests; `--settings-btn-*` retired; deferred list empty; no new runtime dependency; **user visual sign-off received**
- [ ] E6: the `config.json` overwrite fix landed before Stage 5 started
- [ ] Deliverable D: `sourceFont` upgrade, first-run and unknown-value semantics proven in Rust tests against a fixture shared with TS; unknown values are normalized in the UI; the real preferences file stayed untouched during manual checks; rule 31 lists four runtime tokens
- [ ] `pnpm build`, `pnpm test:run` and `cargo test` all exit 0 at the end of every stage
- [ ] In-scope app CSS is 100% tokenized per A5: the grep returns only permitted lines
- [ ] DESIGN.md documents every new token without values; CHANGELOG Unreleased covers A–D
- [ ] `docs/guide/manual-test-ui-redesign.md` covers every changed surface
- [ ] No screenshots, `.prompts/` artifacts or commits were added without the user's request

## Implementation tasks (tracking)

- [ ] **T0 (S+M)** — Stage 0 — WI-0.1…0.6 — Verify: the Stage 0 acceptance list and the user's approval
- [ ] **T1a (S)** — Test tooling — WI-1.0 — Files: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `tests/testing-library-smoke.test.tsx` — Verify: `pnpm test:run`, `pnpm build`
- [ ] **T1 (S)** — Ordered CSS entry and reader helper — WI-1.1 — Files: `src/styles/index.css`, `src/main.tsx`, `src/test/appCss.ts`, 4 CSS-reading tests — Verify: `pnpm test:run`, empty computed-style diff
- [ ] **T2 (M)** — Split `globals.css` — WI-1.2 — Files: `src/styles/globals.css`, `src/styles/sections/`, `src/styles/index.css` — Verify: pure-move diff, empty computed-style diff
- [ ] **T3 (M)** — Tokenization guard with scanner fixtures, stage-tagged deferred list and dead-code guard — WI-2.1 — Files: `tests/css-tokenization.test.ts`, `.claude/rules/31-design-tokens.md` (§ Acceptable hardcoded values, DR23) — Verify: RED evidence, then green
- [ ] **T4 (M)** — Value-preserving tokens and migration — WI-2.2/2.3 — Files: `src/styles/**`, the co-located CSS, `DESIGN.md` — Verify: G0, empty computed-style diff
- [ ] **T5 (M)** — Visual retune and macOS 13.1 floor — WI-3.0…3.5 — Files: theme files, partials, `DESIGN.md`, `CLAUDE.md`, `src-tauri/tauri.conf.json`, rule 33 (DR15 spec column, DR17 checklist) — Verify: Stage 3 list and visual sign-off in WKWebView
- [ ] **T6 (M)** — HighlightStyle — WI-4.1 — Files: `src/components/Editor/extensions/syntax.ts`, `editorPrefApply.ts` — Verify: `pnpm test:run`
- [ ] **T7 (M)** — Icon wrapper — WI-4.2 — Files: `src/components/common/`, `SettingsDialog.tsx`, `BottomTabs.tsx` and `BottomTabs.css` (tab markup), rule 32 (§ Tab bar), `TOCSidebar.tsx`, `IntegrationsSettings.tsx`, `AboutSettings.tsx`, `KeyboardShortcutsSettings.tsx` — Verify: `pnpm test:run`
- [ ] **T8 (M)** — ToggleSwitch, settings rows and badge — WI-4.3/4.4 — Files: `src/components/common/ToggleSwitch.tsx`, settings panels, `IntegrationsSettings.tsx`, `SettingsDialog.tsx` (MCP read), CSS — Verify: `pnpm test:run`, including the per-site regression test, the settings state tests, the row-name test and the focus-visible check
- [ ] **T9 (M)** — Segmented control — WI-4.5 — Files: `App.tsx`, `Sidebar/index.tsx`, new component — Verify: `pnpm test:run`
- [ ] **T10 (S)** — Destructive confirm and settings rail — WI-4.6/4.7
  - **Files:** `ConfirmDialog.tsx`, the two mounted Discard callers (`App.tsx`, `BottomTabs.tsx`), `tests/focus-trap.test.ts`, `.claude/rules/32-component-patterns.md` (first-focus exception) and rule 33 (pattern 3), theme files, `SettingsDialog.tsx` (rail tabs)
  - **Verify:** `pnpm test:run`, including the DR8 Enter regression. Then in `pnpm tauri dev`, press ⌘W on a document with unsaved edits and then Enter; the text must stay. Open Settings at 400×640: the rail is icon-only and rows wrap.
- [ ] **T12 (M)** — Main bar and status strip — WI-4.8 — Files: `App.tsx`, `Sidebar/index.tsx`, new bar and strip components, a word-count util, the cursor-source wiring, the layout CSS partial — Blocks: T9 — Verify: `pnpm test:run`; drag region and traffic lights in `pnpm tauri dev`; the window at 400×640 in both sidebar states and at 959px
- [ ] **T13 (S)** — Empty state — WI-4.9 — Files: `App.tsx`, a new empty-state component, `TOCSidebar.tsx`, the layout CSS partial — Blocks: T12 — Verify: `pnpm test:run`; in `pnpm tauri dev`, launch with no file, close the last tab, and drop a `.md` file
- [ ] **T14 (M)** — External change dialog — WI-4.10 — Files: `src/utils/dataLossGuards.ts`, `src/components/common/ReloadDialog.tsx`, `App.tsx`, `tests/focus-trap.test.ts`, new guard and dialog tests — Blocks: T13 — Verify: `pnpm test:run`; the three states by hand in `pnpm tauri dev`
- [ ] **T15 (S)** — Already-open guard — WI-4.11 — Files: `src/hooks/useDocument.ts`, a pure helper, new tests — Blocks: none (first in Stage 4) — Verify: `pnpm test:run`; in `pnpm tauri dev`, edit a file, then re-open it by ⌘O, recent files and a drop
- [ ] **T16 (S)** — Drop target — WI-4.12
  - **Files:** a new pure helper, a new hook, `App.tsx`, the workspace and empty-state CSS, and new tests
  - **Blocks:** T14
  - **Verify:** `pnpm test:run`. Then in `pnpm tauri dev`, in both themes and with and without a document, drag each file mix over the window, drop it, and cancel one drag with Esc.
- [ ] **T17 (S)** — Error toasts — WI-4.13
  - **Files:** `src/stores/toastStore.ts`, `src/components/common/Toast.tsx`, `App.tsx`, `useDocument.ts`, `loggingService.ts`, `saveService.ts`, `preferencesService.ts`, `useUpdater.ts`, `imagePastePlugin.ts`, the toast CSS, `.claude/rules/32-component-patterns.md` (§ Toast), and tests
  - **Blocks:** T7 (the `Icon` wrapper)
  - **Verify:** `pnpm test:run`. Then in `pnpm tauri dev`, in both themes, make a save fail (for example into a folder made read-only with `chmod a-w`). The toast must stay, "Dismiss" must clear it, and VoiceOver must read it. Open a missing file from recent files; one error toast names it.
- [ ] **T18 (M)** — WYSIWYG follows outside writes — WI-4.14
  - **Files:** `src/components/Editor/MilkdownEditor.tsx`, a new sync hook, `App.tsx` (the image-drop write, if the preflight routes it through the hook), and new tests
  - **Blocks:** T15
  - **Verify:** `pnpm test:run`, including the Reload regression. Then in `pnpm tauri dev`, in WYSIWYG: change an open file in another app, choose Reload, type, press ⌘S, and check that the file holds both changes. Drop an image, type, and check that the image stays. No unsaved dot appears after Reload.
- [ ] **T19 (S)** — Menu keyboard contract — WI-4.15 — Files: `TableContextMenu/index.tsx`, `SourceTableContextMenu/index.tsx`, `ImageContextMenu.tsx` and its CSS, the new hook, rule 32 (§ Context menu contract), new tests — Blocks: none — Verify: `pnpm test:run`; in `pnpm tauri dev`, in both themes, open each menu and use it with arrow keys, Home/End, Enter and Escape, and scroll to close it
- [ ] **T11 (M)** — `sourceFont` — WI-5.1…5.4 — Files: `preferences.rs`, `preferences.ts`, `editorPrefApply.ts`, `EditorSettings.tsx`, the shared fixture, `normalizeSourceFont`, rule 31 — Blocked by: the E6 fix PR — Verify: `cargo test`, `pnpm test:run`

Sizes (S/M) are planning estimates, not commitments.

---

## Stop report template (posted at each of the five stops)

1. **Summary:** stages done; review items done or deferred, by number; which assumptions were confirmed or changed.
2. **Token changes:** names only, with file:line.
3. **CSS file map:** before → after, with line counts.
4. **Literal inventory:** before and after counts per file; every remaining exception with file:line and the rule 31 clause, or approved exception, that allows it.
5. **Tests:** new and updated test files; exact commands run, with exit codes.
6. **Visual evidence:** computed-style diff commands and results (Stages 1–2); before/after screenshot paths (outside the repo) per surface × theme, with window size, scale and engine (`/browse` or `pnpm tauri dev`); mismatches and "no reference" flags.
7. **Contrast table and rule 33 checklist results.**
8. **`/plan-design-review` or `/qa-only` findings:** each marked fixed, deferred or out of scope.
9. **Open questions, dead-code candidates, and the proposed commit split.**

---

## Appendix A — Literal classification (filled in WI-0.2)

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| _to fill_ | | | | | | |

## Appendix B — QA surface matrix (filled in WI-0.3 / WI-0.4)

| Surface | Reference | Runs under | Light before | Dark before | Light after | Dark after | Size / scale | Notes |
|---|---|---|---|---|---|---|---|---|
| Main window — Source | has reference | `pnpm dev` | | | | | | |
| Main window — WYSIWYG | no reference: the proposal draws Source only (:386-427) | `pnpm dev` | | | | | | Compare the chrome with the Source shot; content follows DESIGN.md § Tokens |
| Main bar — sidebar shown and hidden | has reference (Board 1) | `pnpm dev`; drag region and traffic lights in Tauri | | | | | | New in WI-4.8; "before" is the mode label |
| Status strip | has reference (Board 1) | `pnpm dev` | | | | | | New in WI-4.8; no "before" shot |
| Narrow window — 400×640 with the sidebar shown and hidden; 959px wide | no reference (DR16) | `pnpm dev` viewport; confirm in Tauri | | | | | | Main bar, status strip and bottom tabs; nothing clips |
| Settings dialog at 400×640 | no reference (DR16) | `pnpm dev` viewport; confirm in Tauri | | | | | | Icon-only rail; rows wrap |
| Sidebar / TOC active row | has reference | `pnpm dev` | | | | | | |
| Insert modal / link modal | no reference; the shell, type steps and buttons follow the proposal's mini-dialog (:538-544) | `pnpm dev` | | | | | | |
| Table and image context menus | table menu has reference (:546-557); image menu no reference, follows the table menu | `pnpm dev` | | | | | | WI-4.15: also capture the image menu with Custom… open |
| Settings — each page | Integrations / Export / Editor drawn; others no reference | `pnpm dev` / Tauri | | | | | | All eight row panels get the WI-4.3 row markup; Shortcuts and About keep their layouts |
| Toasts | has reference (:558-564) | `pnpm dev` | | | | | | |
| Preview pane | none: not mounted since `4570de3` (DR10) | n/a | n/a | n/a | n/a | n/a | | Dead-code candidate (A8); no screenshots |
| Recent files | none: the native "Open Recent" submenu (`menu.rs:73-96`), which the app doesn't style | Tauri | n/a | n/a | n/a | n/a | | No in-app dropdown exists. Check that labels are file names only (`menu.rs:65-71`) and that the empty submenu shows a disabled "No Recent Files" item |
| Disabled-with-reason button | has reference (:535-536, a static swatch) | `pnpm dev`, at whatever disabled button WI-0.3 finds | | | | | | The proposal's example string isn't in `src/`. If WI-0.3 finds no disabled button with a reason, mark the row n/a |
| External-change dialog — changed / changed with edits / deleted | local mockup only (DR1, not committed) | Tauri | | | | | | Rebuilt in WI-4.10 (DR5); one shot per state |
| Draft recovery and encoding dialogs | no reference; compare with the external-change dialog | Tauri | | | | | | Token changes only; the same shell, type steps and buttons as the other dialogs |
| Drag-and-drop target, six states (WI-4.12) | local mockup only (DR1, not committed) | Tauri | | | | | | Also cancel a drag with Esc and check the target clears |
| Empty / no-tabs state | has reference (proposal :607-609, a static swatch) | `pnpm dev` | | | | | | Today: a blank read-only editor (`App.tsx:1136-1146`) |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 3 | ISSUES_FOUND | Plan review: 9 findings, 8 folded, 1 invalid. Decision consult: 10 verdicts (4 agree, 5 agree-with-changes, 1 disagree) plus 3 cross-cutting issues, all accepted. Design outside voices (Codex and an independent Claude subagent): 34 findings, taken into Passes 1–7. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (before the design review) | 29 issues, 0 critical gaps. It predates WI-4.8–4.15, T12–T19 and their tests. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES_OPEN | score: 6/10 → 9/10, 23 decisions (DR1–DR23); 3 proposed answers wait for the Stage 0 gate |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** In the eng review, Codex caught three factual errors in the draft: the preferences file is `config.json`, not `preferences.json`; the checkbox inventory was wrong; and so was the `color-mix` release claim. It also showed that the preferences overwrite happens at every launch, which escalated D8 into E6, and it found that Testing Library is not installed (E7). In the design review, it found that Appendix B marked undrawn surfaces as having references, and that this report said "ready to implement" while the Stage 0 gate was still open.
- **CROSS-MODEL:** In the eng review, the two models agreed on D1–D7, D9 and D10, and the changes Codex asked for were accepted as refinements (E3–E5). They disagreed on D8; the user sided with Codex (E6).
- **VERDICT:** Design reviewed; eng review was CLEAR but predates the design review's new work items, so re-run `/plan-eng-review` before implementing. Implementation starts only after the Stage 0 gate. Stage 5 stays blocked until the E6 fix lands.

**UNRESOLVED DECISIONS:**
- Q2: keep the duplicated `:root` light values, with a parity guard (proposed; confirm at the Stage 0 gate)
- Q6: replace the undeclared success, error and tertiary-text tokens with `--color-danger`, `--color-muted` and `--color-text`, with no green (proposed; confirm at the Stage 0 gate)
- Q10: allow `z-index: 1` at `MilkdownEditor.css:214` as a local stacking exception (proposed; confirm at the Stage 0 gate)
