# UI redesign plan — CSS file map and rule 33 draft (WI-0.5)

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks. Consumed by [Stage 1](stage-1-split.md) (WI-1.1, WI-1.2) and [Stage 3](stage-3-retune.md) (WI-3.3).

**Source:** every line number below is valid at commit `4ebfc89` (`src/styles/globals.css`, 1916 lines). The map was first read at `a5767d5` (1955 lines) from the clean worktree `mdpro-wt/verify-a5767d5`; lines `:1-1544` are identical at both commits, and every line from `:1545` on is 39 lower at `4ebfc89` (see the 2026-10-07 note). Where a number is in the dead-CSS commit's numbering (after WI-1.2 deletes the `.toolbar-recent*` rules), it says so.

**2026-10-07 — Dev Toolbar removed.** Commit `1703dbb` deleted the Dev Toolbar block from `globals.css`: the comment `/* Dev Toolbar - only visible in browser mode */` and the `.dev-toolbar*` rules, 39 lines (`a5767d5:1545-1583`; git's diff reports it as `:1545-1561` plus `:1563-1584`, the same text, because the blank lines are interchangeable). Nothing else in the file changed between `a5767d5` and `4ebfc89`. The user decided on 2026-10-05 to keep `1703dbb` and treat it like the `.toolbar-recent*` deletion (the dead-CSS precedent), so the `dev-toolbar.css` partial is gone from the map: 15 partials instead of 16. The block's leftover trailing blank line (`4ebfc89:1545`) stays at the end of `settings-mcp.css`, so `responsive.css` still opens on `@media`. Every range and the dry run below were redone against `4ebfc89`.

**Status:** proposed, awaiting the Stage 0 gate. The map was dry-run in a scratch copy (re-run against `4ebfc89` on 2026-10-07): building the partials from these ranges and running the Stage 1 pure-move proof gives an empty diff, and the plain concatenation is byte-identical to the dead-CSS file (§3.4).

## 1. Section banners in `globals.css`

`globals.css` has **30 top-level comments**: 8 section banners, 13 settings sub-banners, and 9 rule annotations (a comment that describes the rule below it rather than opening a section). Comments inside a rule block (`:18`, `:25`, `:29`, `:34`, `:42` inside `:root`; `:69`, `:70`, `:112` trailing; `:518` inside `.table-context-menu`) are not banners and are not listed.

Each row runs from its comment to the line before the next top-level comment. The ranges cover `:1-1916` with no gap and no overlap.

| # | Lines | Count | Comment text | Kind | What the range actually holds |
|---|---|---|---|---|---|
| 0 | 1-64 | 64 | (none) | — | `:root` tokens `:1-47`, reset `*` `:48-50`, `html, body, #root` `:52-56`, `body` `:58-63` |
| 1 | 65-200 | 136 | macOS + Tauri overlay titlebar: activate traffic-light clearances. | annotation | `body.tauri-macos` `:67-71`; then **unbannered**: `a` `:73-76`, app shell `:78-107`, sidebar and `.file-item*` `:108-192`, `.main` `:193-200` |
| 2 | 201-215 | 15 | Custom Title Bar (Typora-style) + Sidebar: traffic-lights zone … | banner + annotation | `.sidebar-traffic-area` `:206-214` |
| 3 | 216-226 | 11 | View-mode badge (WYSIWYG / SPLIT / EDITOR / PREVIEW) | annotation | `.sidebar-mode-label` |
| 4 | 227-355 | 129 | Main area: traffic-lights zone shown only when the sidebar is hidden. | annotation | `.main-traffic-area` `:230-238`; then **unbannered**: `.busy-indicator` `:240`, `.workspace` `:246`, split view and panes `:253-290`, `.preview-scroll` `:292`, `.editor-shell*` `:298-354` |
| 5 | 356-498 | 143 | Active table cell highlight in source mode (table-CRUD WI-2.5). | annotation | `.editor-shell .cm-table-active-cell` `:360-363`; then **unbannered**: `.wysiwyg-preview*` `:365-372`, `.toolbar-buttons`/`.toolbar-modes`/`.toolbar-mode*` `:374-394`, **`.toolbar-recent*` `:396-442` (dead, §2)**, `.toolbar-button*` `:444-461`, `.dialog-*` `:463-497` |
| 6 | 499-504 | 6 | MCP write confirmation (ADR-0042): focus pattern 2, accent follows the theme. | annotation | `.mcp-confirm-dialog .toolbar-button:focus-visible` |
| 7 | 505-603 | 99 | Table Context Menu (table-CRUD WI-1.3, issue #390) | banner | `.table-context-menu*` |
| 8 | 604-714 | 111 | Table Insert Modal (table-CRUD WI-1.1, issue #390) | banner | `.table-insert-*`, `.grid-picker*`; **stray** `.dialog-title` `:610-615` and `.dialog-title-hint` `:617-622` |
| 9 | 715-862 | 148 | Link Insert Modal (issue #25) | banner | `.link-insert-*` `:717-747`; **stray** `.toolbar-button--primary*` `:749-762`; then **unbannered** `.recovery-*` `:764-799`, `.loading-spinner`/`.spinner`/`@keyframes spin` `:801-822`, **`.toast*` `:824-850`**, `.encoding-*` `:851-862` |
| 10 | 863-1040 | 178 | Settings Dialog | banner | dialog shell `:864-966`; shortcuts page `.shortcuts-*`/`.shortcut-*` `:968-1039` |
| 11 | 1041-1046 | 6 | Settings nav icon | sub-banner | `.settings-nav-icon` |
| 12 | 1047-1062 | 16 | Settings page layout | sub-banner | `.settings-page-*` |
| 13 | 1063-1115 | 53 | Dirty shortcuts banner | sub-banner | `.settings-dirty-banner*`; `.settings-placeholder*` `:1084-1114` |
| 14 | 1116-1208 | 93 | Settings General Page | sub-banner | `.settings-general`, `.settings-form*`, `.settings-select*`, `.settings-footer*`; **stray** `.toolbar-button.primary/.small/.danger` `:1185-1207` |
| 15 | 1209-1247 | 39 | Integrations Settings | sub-banner | `.settings-integrations*`, `.settings-error`, `.settings-row` `:1236-1246` |
| 16 | 1248-1257 | 10 | Section label (TYPOGRAPHY, BEHAVIOR) | sub-banner | `.settings-section-label` |
| 17 | 1258-1317 | 60 | Custom font size stepper | sub-banner | `.settings-stepper*`; `.settings-row-content/-label/-description/-control` `:1287-1316` |
| 18 | 1318-1363 | 46 | Toggle Switch | sub-banner | `.toggle-switch*`, `.toggle-slider*` |
| 19 | 1364-1379 | 16 | MCP Status Badge | sub-banner | `.mcp-status-badge`, `.running` |
| 20 | 1380-1390 | 11 | ADR-0039 launch states — existing tokens only, so both themes follow. | annotation | `.mcp-status-badge.off/.failed` |
| 21 | 1391-1397 | 7 | ADR-0040: `stopping` is the live switch's other transition, styled like `starting`. | annotation | `.mcp-status-badge.starting, .stopping` |
| 22 | 1398-1418 | 21 | Badge + single inline note under the "Enable MCP Server" label | sub-banner | `.mcp-server-status`, `.mcp-status-note`, `.mcp-status-dot` |
| 23 | 1419-1471 | 53 | MCP Server Info | sub-banner | `.mcp-server-info`, `.mcp-info-*`, `.mcp-copy-btn*` |
| 24 | 1472-1476 | 5 | MCP Actions | sub-banner | `.mcp-actions` |
| 25 | 1477-1565 | 89 | MCP Installations | sub-banner | `.mcp-installations*`, `.mcp-client-*` `:1477-1543`; **stray** `@media (max-width: 960px)` `:1546-1565` (app shell and split view; its Dev Toolbar banner went with `1703dbb`) |
| 26 | 1566-1691 | 126 | ========== Tab Bar Styles ========== | banner | `.tab-bar*`, `.tab*` |
| 27 | 1692-1787 | 96 | ========== TOC Sidebar Styles ========== | banner | `.toc-sidebar*`, `.toc-entry*` up to `.toc-entry__link` |
| 28 | 1788-1812 | 25 | Text input used in settings rows | annotation | **stray** `.settings-input` `:1789-1797` inside the TOC section; then TOC resumes: `.toc-entry__text` `:1799-1805`, `.toc-entry__children` `:1807-1811` |
| 29 | 1813-1916 | 104 | About Settings | banner | `.about-*` |

**Rules outside their banner.** All of them stay where they are in Stage 1, because moving any of them reorders the cascade. They are listed so a later stage can rehome them deliberately.

| Rule | Lines | Sits under | Belongs with | Consumers |
|---|---|---|---|---|
| `.dialog-title` (second block) and `.dialog-title-hint` | 610-622 | Table Insert Modal | the dialog rules at `:463-497` | every `.dialog-title` (it adds `display: flex` globally) |
| `.toolbar-button--primary*` | 749-762 | Link Insert Modal | `.toolbar-button` at `:444-461` | `McpWriteConfirmDialog.tsx:126`, `TableInsertModal/index.tsx:249`, `LinkInsertModal.tsx:131` |
| `.recovery-*`, spinner, `@keyframes spin`, `.toast*`, `.encoding-*` | 764-862 | Link Insert Modal (no banner of their own) | their own sections | `@keyframes spin` is also used by `src/plugins/milkdown/imagePastePlugin.css:24` |
| `.toolbar-button.primary/.small/.danger` | 1185-1207 | Settings General Page | `.toolbar-button` | `KeyboardShortcutsSettings.tsx:256`, `McpClientList.tsx:70-86` |
| `@media (max-width: 960px)` | 1546-1565 | MCP Installations (Dev Toolbar until `1703dbb`) | the app shell rules | overrides `.app-shell`, `.split-view`, `.split-pane`, `.split-divider` |
| `.settings-input` | 1788-1797 | TOC Sidebar (splits it in two) | settings rows | `ExportSettings.tsx:279` |

The plan's Settings span `:858-1435` is stale twice over. At `0a3675e` the `Settings Dialog` banner was `:858` and `:1435` was the `MCP Actions` banner, so the range already stopped short of MCP Actions and MCP Installations. At `4ebfc89` (as at `a5767d5`) the contiguous Settings block is `:863-1544` (682 lines), and About Settings is a separate block at `:1813-1916` (`:1852-1955` at `a5767d5`).

## 2. Dead `.toolbar-recent*` CSS (WI-1.2 first commit)

**Verdict: dead.** Delete `globals.css:396-443` at `4ebfc89` (the same lines at `a5767d5`): the seven rules `:396-442` plus the blank line `:443`, 48 lines. The next line, `.toolbar-button {` at `:444`, becomes `:396`.

Evidence, all at `a5767d5`:

- `/usr/bin/grep -rn "toolbar-recent\|recent-list\|recent-item\|recent-empty" src tests index.html src-tauri/src` matches only `src/styles/globals.css:396, 400, 404, 408, 424, 434, 438`.
- No dynamically built class name can produce it. `/usr/bin/grep -rnE 'toolbar-\$\{|`toolbar-|"toolbar-" *\+|'"'"'toolbar-'"'"' *\+' src tests` returns nothing, and no `className` in `src` or `tests` mentions `recent`.
- No `<details>` or `<summary>` element exists in `src` (the rules style `summary` and `::-webkit-details-marker`).
- Recent files exist only as the native "Open Recent" submenu: `build_recent_submenu` is called at `src-tauri/src/menu.rs:124` and defined at `src-tauri/src/menu_recent.rs:60`. (WI-0.5's `menu.rs:73-96` citation is stale.)

**Rule 31 row confirmed stale.** `.claude/rules/31-design-tokens.md:74` reads `| Recent dropdown | \`10\` | \`.toolbar-recent-list\` |`. The only `z-index: 10` in app CSS is `globals.css:421`, inside `.toolbar-recent-list`, so the row and the rule disappear together. Rule 33 `:20` also names "recent dropdown" in pattern 3; WI-3.3 removes it (§4).

**Further unconsumed selectors, not in WI-1.2's scope.** The same grep finds no consumer in `src` or `tests` for `.toolbar-buttons`, `.toolbar-modes`, `.toolbar-mode*` (`:374-394`), `.pane-title`, `.pane-content`, `.preview-scroll` (`:278-296`), `.wysiwyg-preview*` (`:365-372`) or `.settings-search*` (`:919-931`). WI-1.2 deletes only `.toolbar-recent*`, as planned. These are recorded for a separate dead-CSS item, because deleting them would need its own empty computed-style diff. Separately, `AboutSettings.tsx:246` and `:285` use `className="toolbar-button-primary"`, which no stylesheet defines (the defined names are `.toolbar-button--primary` and `.toolbar-button.primary`), so the About "Install Update" and "Restart to Apply" buttons render as unstyled native buttons.

## 3. Partial file map (WI-1.1 / WI-1.2)

### 3.1 Map

Location: `src/styles/sections/<name>.css`, as Stage 1 assumes. The names carry **no numeric prefix**: the order lives only in `src/styles/index.css` (E2), and a prefix would be a second copy of it.

`globals.css` keeps the `:root` tokens and base rules (A6, rule 31): a contiguous prefix, so keeping it first preserves the order. Every other range moves verbatim. Partials are contiguous, in source order, and none skips or reorders a line.

| Import position | File | Lines at `4ebfc89` | Lines in the dead-CSS commit | Count | Holds |
|---|---|---|---|---|---|
| 1 | `globals.css` (kept) | 1-77 | 1-77 | 77 | `:root`, reset, `html/body/#root`, `body`, `body.tauri-macos`, `a` |
| 2 | `sections/app-shell.css` | 78-297 | 78-297 | **220** | app shell, sidebar, `.file-item*`, `.main`, traffic-light areas, mode badge, busy indicator, workspace, split view, panes |
| 3 | `sections/editor-source.css` | 298-373 | 298-373 | 76 | `.editor-shell` CodeMirror rules, source table-cell highlight, `.wysiwyg-preview*` |
| 4 | `sections/buttons-dialog.css` | 374-504 minus 396-443 | 374-456 | 83 | `.toolbar-buttons/-modes/-mode*`, `.toolbar-button` base, `.dialog-backdrop`, `.dialog-card`, `.dialog-title/-message/-actions`, MCP confirm focus rule |
| 5 | `sections/table-context-menu.css` | 505-603 | 457-555 | 99 | `.table-context-menu*` |
| 6 | `sections/table-insert-modal.css` | 604-714 | 556-666 | 111 | table insert modal, grid picker, stray `.dialog-title` block |
| 7 | `sections/link-insert-modal.css` | 715-763 | 667-715 | 49 | `.link-insert-*`, stray `.toolbar-button--primary*` |
| 8 | `sections/recovery-toast.css` | 764-862 | 716-814 | 99 | recovery list, spinner and `@keyframes spin`, `.toast*`, `.encoding-*` |
| 9 | `sections/settings-shell.css` | 863-1040 | 815-992 | 178 | sub-banner "Settings Dialog": dialog shell, sidebar rail, categories, shortcuts page |
| 10 | `sections/settings-pages.css` | 1041-1208 | 993-1160 | 168 | sub-banners nav icon → Settings General Page: page header, dirty banner, placeholders, form, select, footer, stray `.toolbar-button.primary/.small/.danger` |
| 11 | `sections/settings-rows.css` | 1209-1363 | 1161-1315 | 155 | sub-banners Integrations → Toggle Switch: `.settings-row*`, section label, stepper, toggle switch |
| 12 | `sections/settings-mcp.css` | 1364-1545 | 1316-1497 | 182 | sub-banners MCP Status Badge → MCP Installations (ends with the two blank lines `:1544-1545`; the second is the Dev Toolbar block's leftover) |
| 13 | `sections/responsive.css` | 1546-1565 | 1498-1517 | 20 | `@media (max-width: 960px)` for app shell and split view |
| 14 | `sections/tab-bar.css` | 1566-1691 | 1518-1643 | 126 | `.tab-bar*`, `.tab*` |
| 15 | `sections/toc-sidebar.css` | 1692-1812 | 1644-1764 | 121 | `.toc-sidebar*`, `.toc-entry*`, stray `.settings-input` |
| 16 | `sections/settings-about.css` | 1813-1916 | 1765-1868 | 104 | `.about-*` |
| 17 | `themes/light.css` | — | — | 27 | unchanged |
| 18 | `themes/dark.css` | — | — | 27 | unchanged |

**15 partials. The largest is `app-shell.css` at 220 lines**, and every app CSS file is under 300 (the themes are 27 lines each; the largest co-located sheet, `MilkdownEditor.css`, is 269). Settings (682 lines) splits into four partials along its sub-banners. About Settings stays its own partial, because the Tab Bar and TOC sections sit between it and the rest of Settings, and merging it would reorder the cascade.

`src/styles/index.css` after WI-1.2:

```css
@import "./globals.css";
@import "./sections/app-shell.css";
@import "./sections/editor-source.css";
@import "./sections/buttons-dialog.css";
@import "./sections/table-context-menu.css";
@import "./sections/table-insert-modal.css";
@import "./sections/link-insert-modal.css";
@import "./sections/recovery-toast.css";
@import "./sections/settings-shell.css";
@import "./sections/settings-pages.css";
@import "./sections/settings-rows.css";
@import "./sections/settings-mcp.css";
@import "./sections/responsive.css";
@import "./sections/tab-bar.css";
@import "./sections/toc-sidebar.css";
@import "./sections/settings-about.css";
@import "./themes/light.css";
@import "./themes/dark.css";
```

### 3.2 Order-sensitive overrides

Source order alone settles each of these: the selectors have equal specificity and set the same property on one element, or a media query restates a rule. All of them cross a partial boundary, so the import order above must hold exactly, and a "tidy" reorder of `index.css` breaks them silently.

| Later rule (wins) | Earlier rule | Property | Element | Partials, in required order |
|---|---|---|---|---|
| `@media (max-width: 960px)` `.app-shell`, `.split-view`, `.split-pane` (`!important`), `.split-divider` `:1546-1565` | the base rules `:78-290` | `grid-template-columns`, `flex-direction`, `width`, `height`/`cursor` | app shell and split view under 960px | `app-shell` → `responsive` |
| `.table-insert-modal` `:606` | `.dialog-card` `:473` | `width` (380px vs 420px) | `TableInsertModal/index.tsx:182` | `buttons-dialog` → `table-insert-modal` |
| `.link-insert-modal` `:717` | `.dialog-card` `:473` | `width` (360px vs 420px) | `LinkInsertModal.tsx:101` | `buttons-dialog` → `link-insert-modal` |
| `.toolbar-button--primary:disabled` `:759` | `.toolbar-button:disabled` `:458` | `opacity` (0.45 vs 0.5) | the three primary buttons | `buttons-dialog` → `link-insert-modal` |
| `.toolbar-button.danger` `:1200` | `.toolbar-button:hover` `:454` | `border-color` (danger vs accent on hover) | `McpClientList.tsx:77` | `buttons-dialog` → `settings-pages` |
| `.dialog-title` `:610` | `.dialog-title` `:482` | additive today (no shared property), but any later edit to either block becomes order-dependent | every dialog title | `buttons-dialog` → `table-insert-modal` |
| `themes/light.css`, `themes/dark.css` | everything above | theme tokens and theme-scoped rules | — | all partials → themes |

`@keyframes spin` (`recovery-toast.css`) is not order-sensitive: keyframe names are global, so `imagePastePlugin.css` keeps resolving it.

### 3.3 Tests that read CSS from disk

WI-1.1 switches all four to `src/test/appCss.ts`, so no test path names a partial. With the helper's concatenation the assertions keep passing unchanged. If a test reads per file instead, it needs these partials:

| Test | Selectors it asserts | Holder after WI-1.2 |
|---|---|---|
| `tests/design-tokens-accent-danger.test.ts` | `--color-accent-soft`, `--color-danger`, `--color-danger-soft` in `:root` | `globals.css` (`:9-11`) |
| | `.link-insert-input:focus` | `link-insert-modal.css` |
| | `.table-insert-input:focus`, `.table-insert-error` | `table-insert-modal.css` |
| | `.toolbar-button.danger`, `.toolbar-button.danger:hover` | `settings-pages.css` (stray, §1) |
| | theme tokens | `themes/light.css`, `themes/dark.css` (paths unchanged) |
| `tests/settings-row-layout.test.ts` | `.settings-row`, `.settings-row-content` | `settings-rows.css` |
| `tests/source-scroll-layout.test.ts` | `.editor-shell`, `.editor-shell .cm-theme-light,\n.editor-shell .cm-theme-dark`, `.editor-shell .cm-scroller` | `editor-source.css` |
| `tests/source-table-cell-highlight.test.ts` | `cm-table-active-cell` | `editor-source.css` |

- `source-table-cell-highlight.test.ts:78-92` skips a missing candidate file (`existsSync … continue`) and checks `globals.css` and `MilkdownEditor.css`. Neither holds the rule after the move (`MilkdownEditor.css` has 0 matches), so the test fails loudly unless it uses the helper. It cannot pass silently.
- `settings-row-layout.test.ts:22` takes the first `\.settings-row\s*\{` match. The concatenation keeps `:1236` first, so the match does not change.
- `tests/table-alignment-rendering.test.ts:39` names `globals.css` in a comment only and needs no change.

### 3.4 Pure-move proof, dry run

In a scratch copy, `sed '396,443d'` on the `4ebfc89` file (`git show 4ebfc89:src/styles/globals.css`, which includes `1703dbb`) produced the dead-CSS file (1868 lines). The 16 files (`globals.css` plus 15 partials) were built from the dead-CSS column above, and `index.css` was written as in §3.1. Then:

- the Stage 1 acceptance command (strip single-line comments from both sides, concatenate the files `index.css` lists minus the themes) gave **no output**;
- `cmp` of the plain concatenation against the dead-CSS file reported them **byte-identical**;
- the same 16 files cut from the `4ebfc89` column and concatenated are byte-identical to `globals.css` at `4ebfc89`.

Last run 2026-10-07 against `4ebfc89`. The real proof's base is the WI-1.2 dead-CSS commit, built on a HEAD that includes `1703dbb`; a base without it (`a5767d5`) puts the 39 Dev Toolbar lines in the diff.

Two constraints keep the real proof empty:

1. **Partial headers.** The proof strips only one-line `/* … */` comments. A header added to a partial must be a single line with no blank line after it, or the diff is no longer empty. Ten partials already open with their original banner (`table-context-menu`, `table-insert-modal`, `link-insert-modal`, the four `settings-*` Settings partials, `tab-bar`, `toc-sidebar`, `settings-about`). The five that open on a bare rule (`app-shell`, `editor-source`, `buttons-dialog`, `recovery-toast`, `responsive`) can take a one-line header or none.
2. **Multi-line comments** (`:65-66`, `:202-205`, `:227-229`, `:356-359`, `:518-521`) are not stripped on either side. They must move verbatim.

### 3.5 Rule 32 ownership after the move

For the WI-1.2 rule edit (rule 32 § Single source of truth and the modal contract):

| Surface | File |
|---|---|
| App shell, sidebar | `src/styles/sections/app-shell.css` |
| Dialog backdrop, `.dialog-card` (modal contract) | `src/styles/sections/buttons-dialog.css` |
| Toast | `src/styles/sections/recovery-toast.css` |
| Settings | `src/styles/sections/settings-shell.css`, `settings-pages.css`, `settings-rows.css`, `settings-mcp.css`, `settings-about.css` |
| Link insert modal (`.link-insert-*`) | `src/styles/sections/link-insert-modal.css` |

Rule 31 keeps `globals.css` for the `:root` tokens.

## 4. Rule 33 spec-column edit (DR15) — draft, not applied

### 4.1 Every focus rule in app CSS

`/usr/bin/grep -rn ":focus" src --include='*.css'` finds **6** rules, all in `globals.css`: 3 `:focus-visible` and 3 `:focus`. No component or plugin stylesheet has one. Lines in the "after WI-1.2" column are in the partial.

| `a5767d5` | After WI-1.2 | Selector | Declarations | Pattern | DR15 effect |
|---|---|---|---|---|---|
| `globals.css:500` | `buttons-dialog.css:79` | `.mcp-confirm-dialog .toolbar-button:focus-visible` | `outline: 2px solid var(--color-accent); outline-offset: 2px` | 2 | colour → `--color-focus-ring` |
| `globals.css:577` | `table-context-menu.css:73` | `.table-context-menu-item:focus-visible` | `outline: 2px solid var(--color-accent); outline-offset: -2px` | 2 (inset, inside a scrolling menu) | colour → `--color-focus-ring` |
| `globals.css:653` | `table-insert-modal.css:50` | `.grid-picker-cell:focus-visible` | `outline: 2px solid var(--color-accent); outline-offset: 1px` | 2 | colour → `--color-focus-ring` |
| `globals.css:700` | `table-insert-modal.css:97` | `.table-insert-input:focus` (`outline: none` at `:696`) | accent border + `0 0 0 2px var(--color-accent-soft)` ring | 1 | none |
| `globals.css:744` | `link-insert-modal.css:30` | `.link-insert-input:focus` (`outline: none` at `:739`) | accent border + accent-soft ring | 1 | none |
| `globals.css:1160` | `settings-pages.css:120` | `.settings-select:focus` | `outline: none; border-color: var(--color-accent)` — **no soft ring** | 1, incomplete | none (the missing ring is a pattern 1 gap, not DR15) |

Related findings the draft does not change:

- **No pattern 3 rule exists.** No `:focus-visible` rule targets any pattern 3 surface (`.toc-entry*`, `.tab*`, `.settings-category-btn`, `.file-item*`). WI-3.3's "pattern 3's inset ring on TOC rows uses the token" therefore has to **add** a TOC rule, not retune one. `.toolbar-button:focus-visible` is likewise absent; WI-3.3 already plans to add it.
- **`outline: none` without a replacement:** `.settings-search` at `globals.css:926` has no `:focus` rule (a hard rule 1 breach), but no component renders it (§2). `src/App.css:91` sets `input, button { outline: none; }` globally (a hard rule 2 breach), but `App.css` is not imported anywhere (A8 dead-code candidate), so it has no runtime effect. `MilkdownEditor.css:42` removes the outline on the contenteditable `.ProseMirror`, where the caret is the indicator.
- **Selection outlines, not focus:** `MilkdownEditor.css:191` (`td/th.selectedCell`) and `:261` (`img[data-mdpro-image-selected]`) draw a 2px accent outline for selection. DR15 covers focus only, so they keep `--color-accent`.
- The pattern 2 offset varies today: 2px, -2px and 1px. The draft keeps "2px" as the default and does not standardise the others.

### 4.2 Draft

Edit `.claude/rules/33-focus-indicators.md` rows 2 and 3 of the pattern table (`:19-20`). Row 1 and row 4 are unchanged (DR15: pattern 1 is unchanged). WI-3.3 applies it in its `docs(rules): rule 33 focus-ring spec` commit, together with the separate DR17 checklist edit already written in `stage-3-retune.md`.

**Before** (`:19-20` at `a5767d5`):

```markdown
| 2 | **Outline** | toolbar buttons, popover menu items, primary buttons | `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` |
| 3 | **Background highlight** | sidebar rows, tabs, TOC entries, recent dropdown, settings categories | `:focus-visible { background: var(--color-accent-soft); }` (selected items add a border or text-color change so focus and selection are distinguishable) |
```

**After:**

```markdown
| 2 | **Outline** | toolbar buttons, popover menu items, primary buttons | `:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }`. `--color-focus-ring` is declared in `:root` as `var(--color-accent)`, so it follows the theme and stays at 3:1 or better (DR15) |
| 3 | **Background highlight** | sidebar rows, tabs, TOC entries, settings categories | `:focus-visible { background: var(--color-accent-soft); }` (selected items add a border or text-color change so focus and selection are distinguishable). TOC rows also add an inset ring: `outline: 2px solid var(--color-focus-ring); outline-offset: -2px;` |
```

What changes:

1. Pattern 2's colour: `var(--color-accent)` → `var(--color-focus-ring)`, with the token's definition named (DR15).
2. Pattern 3 gains the TOC inset ring in `--color-focus-ring` (DR15, `stage-3-retune.md` WI-3.3). The fill stays `--color-accent-soft`.
3. Pattern 3's surfaces drop "recent dropdown" (WI-3.3; no such dropdown is mounted, and WI-1.2 deletes its CSS).

**Choice for the WI-3.3 author to confirm.** The plan says "inset ring" but never gives its syntax. The draft uses a negative-offset outline, the form `.table-context-menu-item:focus-visible` already uses (`globals.css:577-580`): pattern 3 stays one shape change on `outline`, and `box-shadow` stays free for pattern 1's ring (hard rule 3). The alternative is `box-shadow: inset 0 0 0 2px var(--color-focus-ring);`. Either keeps the 2px width of pattern 2.

**Not in this draft:**

- WI-4.7 later extends the inset-ring sentence to the settings rail ("TOC rows and the settings rail add an inset ring; on the rail, focus always sits on the selected tab"), per `stage-4a-components.md:167` and `DESIGN.md` § Focus.
- Hard rule 4 ("the accent changes from `#2563eb` to `#60a5fa`") stays true, because the token equals the accent. It needs no edit.

## 5. Stale references found (not edited here)

| Where | Says | At `a5767d5` |
|---|---|---|
| `stage-0-inventory.md` WI-0.5 | `.toolbar-recent*` "from `globals.css:397`" | `:396` |
| `stage-0-inventory.md` WI-0.5 | "Settings spans `:858-1435`" | `:863-1544`, plus About at `:1852-1955` (§1) |
| `stage-0-inventory.md` WI-0.5 | Open Recent at `menu.rs:73-96` | `menu.rs:124` → `menu_recent.rs:60` |
| `stage-0-inventory.md` WI-0.5 | `.toast` at `:819` | `:824` |
| `stage-4a-components.md:61` | toggle switch at `globals.css:1314-1356` | `:1318-1363` |
| `baseline-protocol.md` (per WI-0.1 §3.4) | "only two `:focus-visible`" | three: `:500`, `:577`, `:653` |
