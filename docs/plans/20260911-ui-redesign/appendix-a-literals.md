# UI redesign — Appendix A: literal inventory and classification (WI-0.2)

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

This appendix lists every literal (non-`var()`) value in the tokenized categories, in every `src/**/*.css` file. It is the deliverable of WI-0.2 ([Stage 0](./stage-0-inventory.md)). Stage 2 tokenizes the class-(a) rows, Stage 3 snaps the class-(b) rows, and the class-(c) rows are new tokens or exceptions. Every class-(c) row now has a ruling; the user's 2026-10-03 rulings R1–R10 closed the last open ones (see [Rulings](#rulings-user-2026-10-03)).

## Scope and method

- **Commit.** Every `file:line` is valid at **a5767d5**, read from a clean checkout. The [baseline protocol](./baseline-protocol.md) measured at 0a3675e. The line drift between the two commits is mapped in [Line drift](#line-drift-from-0a3675e).
- **Categories.** These follow the A5 definition of "100% tokenized":
  - colour (hex, `rgb()`/`rgba()`, `hsl()`, named colours)
  - `font-size`
  - `font-family`
  - `border-radius`
  - `transition` and `animation`
  - `z-index`
  - `box-shadow`
  - icon `width`/`height`

  The scan found **zero** literal `font-family` values in scope and **zero** icon `width`/`height` declarations, because there are no SVG icon rules yet. Spacing is not a tokenized category, since rule 31 accepts the ad-hoc 4–40px scale.
- **Exclusions** follow A5:
  - token definitions in `globals.css :root` (lines 1–48)
  - `themes/light.css` and `themes/dark.css`
  - KaTeX
  - `App.css`, which is dead code. Its 26 literals are still listed in [Out of scope: App.css](#out-of-scope-appcss) so nothing is silently dropped.

  Selectors whose only consumer is A8 dead code (`TabBar/`, `Sidebar/Sidebar.tsx`, `FileItem.tsx`) are **kept** in the table. They are marked in the Stage column, because they sit in `globals.css`, which is in scope, and WI-1.x deletes them. **2026-10-08:** the 6 `Sidebar.tsx` / `FileItem.tsx` rows are gone from the tree — the components and their CSS were deleted ([ADR-0059](../../adr/0059-open-documents-live-in-the-tabs-not-in-the-sidebar.md)). The rows and counts below are kept as the scan recorded them.
- **Extraction.** A comment-stripping scanner walked every CSS file. It tracked the selector stack (including `@media` / `@keyframes`) and recorded the declaration line, not the rule line. Its raw list was then cross-checked against the baseline's grep counts (see [Reconciliation](#reconciliation-against-the-baseline-table)). Each row was then classified by hand. No row is unclassified.
- **Proposal tokens used as targets** (`proposal-ab.html:21-61`, DR22, DR23):

  | Token | Value |
  |---|---|
  | `--font-size-ui-sm` | 12px |
  | `--font-size-ui` | 13px |
  | `--font-size-ui-lg` | 14px |
  | `--font-size-title` | 16px |
  | `--radius-inner` | 4px |
  | `--radius-control` | 6px |
  | `--radius-popover` | 10px |
  | `--icon-size-sm` / `--icon-size-md` | 14 / 16px |
  | `--motion-duration-fast` | 150ms |
  | `--motion-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
  | `--shadow-soft` | per theme |

  The existing colour tokens are those in `:root` / `light.css` / `dark.css`.

### Class key

| Class | Meaning |
|---|---|
| **a** | An existing or proposal token has exactly this value, so tokenizing is value-preserving (Stage 2, WI-2.3). |
| **b** | Tokenizing changes the rendered value. The target token and delta are named, and the stage is where the snap is allowed. |
| **c** | A new token or an exception is needed. It is linked to Q6–Q10, or flagged "no Q6–Q10 match" when no open question covers it. Since the 2026-10-03 rulings, every (c) row is marked `c (ruled Rn)` for a new token or `c (exception, Rn)` for an exception; rows that predate them keep their Q7/Q10 reference. |
| **allowed** | A fourth marker, added so the counts reconcile. The literal is already permitted under A5 and needs no work, e.g.: rule 31 z-index layers (10/20/30/100/1000), `50%` circles, `0`, `none`, `transparent`, `inherit`, `currentColor`, `em` sizes in editor content, shadows whose geometry is literal but whose colour is a `var()`, and `var(--x, fallback)` defensive fallbacks. |

### Stage key

| Stage value | Meaning |
|---|---|
| `2 (WI-2.3)` | Value-preserving swap in Stage 2. |
| `3 (WI-3.1, DR23)` | Radius snap in the Stage 3 retune. |
| `3 (WI-3.2 item N)` | The numbered WI-3.2 bullet that owns the snap. |
| `4 (WI-4.x)` | The component WI that replaces the selector. |
| `2 (WI-2.2 new token)` | A new token, ruled 2026-10-03 (R2, R6), declared in WI-2.2 with today's value, so the swap is value-preserving. |
| `3 (WI-3.2 rulings)` | A value-changing 2026-10-03 ruling (R1, R3, R5, R7, R10), owned by WI-3.2's rulings bullet. |
| `WI-2.1 exception` | Recorded in the WI-2.1 exception list. |
| ~~`WI-2.2 per Q6, but not value-preserving`~~ | No rows since the 2026-10-03 rulings: R10 moved the three Q6 rows to `3 (WI-3.2 rulings)`. |
| ~~`open` / `open (Q9 follow-up)`~~ | No rows since the 2026-10-03 rulings: R1–R9 gave each of them a target. |
| `skip, dead (A8): …` | The selector's only consumer is dead code; WI-1.x deletes it. |
| `WI-1.2 deletes` | Recent-dropdown rules that WI-1.2 removes. |
| `orphan, no consumer` | No `.tsx`/`.ts` file references the selector at a5767d5. A deletion candidate, not a tokenization target. |
| `—` | Allowed; nothing to do. |

## Inventory


### `src/styles/globals.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `globals.css:121` | `.sidebar-header` | `font-size` | `11px` | b | `--font-size-ui-sm` (+1px) | 3 (WI-3.2 item 12) |
| `globals.css:131` | `.sidebar-empty` | `font-size` | `14px` | a | `--font-size-ui-lg` | skip, dead (A8): `Sidebar/Sidebar.tsx` |
| `globals.css:147` | `.file-item` | `border-radius` | `10px` | b | `--radius-control` (−4px) | skip, dead (A8): `FileItem.tsx` |
| `globals.css:153` | `.file-item.is-active` | `box-shadow` | `0 0 0 1px var(--color-accent-soft)` | allowed | colour is `var()`; 1px ring geometry (rule 31) | skip, dead (A8): `FileItem.tsx` |
| `globals.css:171` | `.file-item-title` | `font-size` | `14px` | a | `--font-size-ui-lg` | skip, dead (A8): `FileItem.tsx` |
| `globals.css:175` | `.file-item-path` | `font-size` | `12px` | a | `--font-size-ui-sm` | skip, dead (A8): `FileItem.tsx` |
| `globals.css:184` | `.file-item-close` | `font-size` | `18px` | b | glyph → icon (DR22 skips it) | skip, dead (A8): `FileItem.tsx` |
| `globals.css:218` | `.sidebar-mode-label` | `font-size` | `10px` | b | `--font-size-ui-sm` (+2px); WI-4.5 later replaces the label | 3 (WI-3.2 item 12) |
| `globals.css:224` | `.sidebar-mode-label` | `border-radius` | `4px` | b | `--radius-control` (+2px); a chip, not a nested part, so not `--radius-inner`; WI-4.5 later replaces the label | 3 (WI-3.1, DR23) |
| `globals.css:279` | `.pane-title` | `font-size` | `12px` | a | `--font-size-ui-sm` | orphan, no consumer |
| `globals.css:349` | `.editor-shell .cm-selectionBackground` | `background` | `rgba(96, 165, 250, 0.25)` | b | [R5](#rulings-user-2026-10-03): `color-mix()` from `--color-accent` at 25%. Dark is unchanged (its accent is `#60a5fa`); light becomes `#2563eb` at 25% | 3 (WI-3.2 rulings) |
| `globals.css:362` | `.editor-shell .cm-table-active-cell` | `border-radius` | `2px` | b | `--radius-inner` (+2px), or `0` if 4px breaks the cell border | 3 (WI-3.1, DR23) |
| `globals.css:385` | `.toolbar-mode` | `font-size` | `12px` | a | `--font-size-ui-sm` | orphan, no consumer |
| `globals.css:415` | `.toolbar-recent-list` | `border-radius` | `12px` | b | `--radius-popover` (−2px) | WI-1.2 deletes |
| `globals.css:421` | `.toolbar-recent-list` | `z-index` | `10` | allowed | rule 31 z-index table, "Recent dropdown" row | WI-1.2 deletes (rule and table row) |
| `globals.css:430` | `.toolbar-recent-item` | `border-radius` | `8px` | b | `--radius-inner` (−4px) | WI-1.2 deletes |
| `globals.css:439` | `.toolbar-recent-empty` | `font-size` | `12px` | a | `--font-size-ui-sm` | WI-1.2 deletes |
| `globals.css:447` | `.toolbar-button` | `border-radius` | `8px` | b | `--radius-control` (−2px) | 3 (WI-3.1, DR23) |
| `globals.css:449` | `.toolbar-button` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:466` | `.dialog-backdrop` | `background` | `rgba(15, 23, 42, 0.35)` | c (ruled R6) | [R6](#rulings-user-2026-10-03): new `--color-scrim`, declared with today's value. One use: a user override of A10 | 2 (WI-2.2 new token) |
| `globals.css:470` | `.dialog-backdrop` | `z-index` | `20` | allowed | rule 31 z-index table, "Dialog backdrop" | — |
| `globals.css:477` | `.dialog-card` | `border-radius` | `16px` | b | `--radius-popover` (−6px) | 3 (WI-3.1, DR23) |
| `globals.css:484` | `.dialog-title` | `font-size` | `16px` | b | `--font-size-ui-lg` (−2px), the DR22 dialog-title role; the value equals `--font-size-title` but DR22 does not give that role to dialog titles | 3 (WI-3.2 item 12) |
| `globals.css:490` | `.dialog-message` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:509` | `.table-context-menu` | `z-index` | `1000` | allowed | rule 31 z-index table, "Inline context menu" | — |
| `globals.css:512` | `.table-context-menu` | `border-radius` | `8px` | b | `--radius-popover` (+2px) | 3 (WI-3.1, DR23) |
| `globals.css:516` | `.table-context-menu` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:537` | `.table-context-menu-group-label` | `font-size` | `11px` | b | `--font-size-ui-sm` (+1px), DR22 section label | 3 (WI-3.2 item 12) |
| `globals.css:557` | `.table-context-menu-item` | `border-radius` | `6px` | b | `--radius-inner` (−2px), menu item | 3 (WI-3.1, DR23) |
| `globals.css:583` | `.table-context-menu-item-hint` | `font-size` | `11px` | b | `--font-size-ui-sm` (+1px) | 3 (WI-3.2 item 12) |
| `globals.css:618` | `.dialog-title-hint` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:640` | `.grid-picker-cell` | `border-radius` | `2px` | b | `--radius-inner` (+2px), or `0` if 4px breaks the cell border | 3 (WI-3.1, DR23) |
| `globals.css:644` | `.grid-picker-cell` | `transition` | `background 0.05s ease, border-color 0.05s ease` | b | remove: colour transition (DR12); 0.05s has no token | 3 (WI-3.2 item 11) |
| `globals.css:659` | `.table-insert-count` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:666` | `.table-insert-divider` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:683` | `.table-insert-label` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:691` | `.table-insert-input` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `globals.css:695` | `.table-insert-input` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:702` | `.table-insert-input:focus` | `box-shadow` | `0 0 0 2px var(--color-accent-soft)` | allowed | rule 33 pattern 1 ring; colour is `var()`, 2px geometry (rule 31) | — |
| `globals.css:706` | `.table-insert-error` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:710` | `.table-insert-error` | `border-radius` | `6px` | a | `--radius-control` (inline error box; judgment) | 2 (WI-2.3) |
| `globals.css:723` | `.link-insert-label` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:734` | `.link-insert-input` | `border-radius` | `8px` | b | `--radius-control` (−2px), input | 3 (WI-3.1, DR23) |
| `globals.css:738` | `.link-insert-input` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:746` | `.link-insert-input:focus` | `box-shadow` | `0 0 0 2px var(--color-accent-soft)` | allowed | rule 33 pattern 1 ring; colour is `var()`, 2px geometry (rule 31) | — |
| `globals.css:751` | `.toolbar-button--primary` | `color` | `#fff` | c (ruled R2) | [R2](#rulings-user-2026-10-03): new `--color-on-accent`, declared with today's `#fff` (A10: :751, :1187, :1351 are 3 uses) | 2 (WI-2.2 new token) |
| `globals.css:756` | `.toolbar-button--primary:hover:not(:disabled)` | `background` | `#1d4ed8` | b | [R3](#rulings-user-2026-10-03): `color-mix()` over `--color-accent`. No mix reproduces `#1d4ed8` exactly, and dark hover stops being the light-theme blue | 3 (WI-3.2 rulings) |
| `globals.css:772` | `.recovery-item` | `border-radius` | `12px` | b | `--radius-popover` (−2px), grouped section | 3 (WI-3.1, DR23) |
| `globals.css:792` | `.recovery-path, .recovery-time` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:805` | `.loading-spinner` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:814` | `.spinner` | `border-radius` | `50%` | allowed | rule 31: `50%` circle | — |
| `globals.css:815` | `.spinner` | `animation` | `spin 0.8s linear infinite` | c (exception, R4) | [R4](#rulings-user-2026-10-03): WI-2.1 exception. DR13 keeps spinners rotating, so the zeroed `--motion-duration-fast` cannot carry it | WI-2.1 exception |
| `globals.css:830` | `.toast` | `border-radius` | `12px` | b | `--radius-popover` (−2px) | 3 (WI-3.1, DR23) |
| `globals.css:836` | `.toast` | `z-index` | `30` | allowed | rule 31 z-index table, "Toast" | — |
| `globals.css:842` | `.toast-close` | `font-size` | `18px` | b | × glyph → WI-4.2 icon at `--icon-size-md` (−2px box) | 4 (WI-4.2) |
| `globals.css:852` | `.encoding-path` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:869` | `.settings-dialog` | `border-radius` | `16px` | b | `--radius-popover` (−6px) | 3 (WI-3.1, DR23) |
| `globals.css:886` | `.settings-title` | `font-size` | `18px` | b | `--font-size-ui-lg` (−4px), DR22 dialog title | 3 (WI-3.2 item 12) |
| `globals.css:893` | `.settings-close` | `font-size` | `24px` | b | × glyph → WI-4.2 icon at `--icon-size-md` (−8px) | 4 (WI-4.2) |
| `globals.css:923` | `.settings-search` | `border-radius` | `10px` | b | `--radius-control` (−4px); DR23 names this selector as live | orphan, no consumer |
| `globals.css:925` | `.settings-search` | `font-size` | `13px` | a | `--font-size-ui` | orphan, no consumer |
| `globals.css:934` | `.settings-sidebar-title` | `font-size` | `11px` | b | `--font-size-ui-sm` (+1px) | orphan, no consumer |
| `globals.css:947` | `.settings-category-btn` | `border-radius` | `8px` | b | `--radius-control` (−2px) | 3 (WI-3.1, DR23) |
| `globals.css:949` | `.settings-category-btn` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:976` | `.shortcuts-header h3` | `font-size` | `18px` | b | `--font-size-title` (−2px) as page title; confirm per page (WI-3.2) | 3 (WI-3.2 item 12) |
| `globals.css:982` | `.shortcuts-header p` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:988` | `.shortcuts-section` | `border-radius` | `12px` | b | `--radius-popover` (−2px), grouped section | 3 (WI-3.1, DR23) |
| `globals.css:994` | `.shortcuts-section h4` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1015` | `.shortcut-label` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:1021` | `.shortcut-value` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `globals.css:1023` | `.shortcut-value` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1037` | `.shortcut-value.is-editing` | `background` | `rgba(37, 99, 235, 0.1)` | b | `--color-accent-soft`: light α 0.10 → 18% today, 14% after WI-3.1; dark gets `#60a5fa` at 22% instead of light blue at 10% | 3 (WI-3.2 item 1) |
| `globals.css:1052` | `.settings-page-title` | `font-size` | `15px` | b | `--font-size-title` (+1px) | 3 (WI-3.2 item 12) |
| `globals.css:1058` | `.settings-page-desc` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1070` | `.settings-dirty-banner` | `background` | `rgba(245, 158, 11, 0.12)` | b | `--color-accent-soft` fill (DR21, Q7) | 4 (WI-4.3) |
| `globals.css:1071` | `.settings-dirty-banner` | `border` | `1px solid rgba(245, 158, 11, 0.4)` | b | `--color-accent` border (DR21, Q7) | 4 (WI-4.3) |
| `globals.css:1072` | `.settings-dirty-banner` | `border-radius` | `6px` | a | `--radius-control` (banner; judgment) | 2 (WI-2.3) |
| `globals.css:1073` | `.settings-dirty-banner` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1077` | `.settings-dirty-banner button` | `border-radius` | `4px` | b | `--radius-control` (+2px), button | 3 (WI-3.1, DR23) |
| `globals.css:1081` | `.settings-dirty-banner button` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1086` | `.settings-placeholder h3` | `font-size` | `18px` | b | `--font-size-title` (−2px) | orphan, no consumer |
| `globals.css:1092` | `.settings-placeholder p` | `font-size` | `13px` | a | `--font-size-ui` | orphan, no consumer |
| `globals.css:1103` | `.settings-placeholder-card` | `border-radius` | `12px` | b | `--radius-popover` (−2px) | orphan, no consumer |
| `globals.css:1106` | `.settings-placeholder-card` | `font-size` | `13px` | a | `--font-size-ui` | orphan, no consumer |
| `globals.css:1112` | `.settings-placeholder-note` | `font-size` | `12px` | a | `--font-size-ui-sm` | orphan, no consumer |
| `globals.css:1119` | `.settings-general h3` | `font-size` | `18px` | b | `--font-size-title` (−2px) | orphan, no consumer |
| `globals.css:1125` | `.settings-general p` | `font-size` | `13px` | a | `--font-size-ui` | orphan, no consumer |
| `globals.css:1141` | `.settings-form-row` | `border-radius` | `10px` | b | `--radius-control` (−4px) | orphan, no consumer |
| `globals.css:1145` | `.settings-form-row label` | `font-size` | `14px` | a | `--font-size-ui-lg` | orphan, no consumer |
| `globals.css:1152` | `.settings-select` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `globals.css:1154` | `.settings-select` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1166` | `.settings-form-hint` | `font-size` | `12px` | a | `--font-size-ui-sm` | orphan, no consumer |
| `globals.css:1187` | `.toolbar-button.primary` | `color` | `white` | c (ruled R2) | [R2](#rulings-user-2026-10-03): as :751, `--color-on-accent` | 2 (WI-2.2 new token) |
| `globals.css:1192` | `.toolbar-button.primary:hover` | `background` | `#1d4ed8` | b | [R3](#rulings-user-2026-10-03): as :756, `color-mix()` over `--color-accent` | 3 (WI-3.2 rulings) |
| `globals.css:1197` | `.toolbar-button.small` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1215` | `.settings-integrations h3` | `font-size` | `18px` | b | `--font-size-title` (−2px) as page title; confirm per page (WI-3.2) | 3 (WI-3.2 item 12) |
| `globals.css:1221` | `.settings-integrations h4` | `font-size` | `15px` | b | `--font-size-ui` (−2px) as DR22 card heading (judgment) | 3 (WI-3.2 item 12) |
| `globals.css:1230` | `.settings-error` | `border-radius` | `6px` | a | `--radius-control` (inline error box; judgment) | 2 (WI-2.3) |
| `globals.css:1232` | `.settings-error` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1250` | `.settings-section-label` | `font-size` | `11px` | b | `--font-size-ui-sm` (+1px), DR22 section label | 3 (WI-3.2 item 12) |
| `globals.css:1264` | `.settings-stepper` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `globals.css:1271` | `.settings-stepper button` | `font-size` | `16px` | b | +/− glyph → WI-4.2 icon at `--icon-size-md` (same 16px box) | 4 (WI-4.2) |
| `globals.css:1275` | `.settings-stepper button` | `border-radius` | `3px` | b | `--radius-inner` (+1px), stepper button | 3 (WI-3.1, DR23) |
| `globals.css:1284` | `.settings-stepper span` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1302` | `.settings-row-label strong` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:1307` | `.settings-row-description` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1339` | `.toggle-slider` | `background-color` | `#ccc` | b | text-based `color-mix()` off-track (item 6) | 4 (WI-4.4) |
| `globals.css:1340` | `.toggle-slider` | `transition` | `0.2s` | b | remove: `transition: 0.2s` animates every property, including the track colour (DR12) | 3 (WI-3.2 item 11) |
| `globals.css:1341` | `.toggle-slider` | `border-radius` | `24px` | b | `999px` (DR23 pill); no rendered change, the track is 24px tall | 3 (WI-3.1, DR23) |
| `globals.css:1351` | `.toggle-slider:before` | `background-color` | `white` | c (ruled R2) | [R2](#rulings-user-2026-10-03): knob → `--color-on-accent`, as :751. WI-4.4 retunes the track but names no knob colour | 2 (WI-2.2 new token) |
| `globals.css:1352` | `.toggle-slider:before` | `transition` | `0.2s` | b | `transform var(--motion-duration-fast) var(--motion-ease-out)`: 0.2s → 150ms, `ease` → ease-out curve, `all` → `transform` | 3 (WI-3.2 item 11) |
| `globals.css:1353` | `.toggle-slider:before` | `border-radius` | `50%` | allowed | rule 31: `50%` circle | — |
| `globals.css:1370` | `.mcp-status-badge` | `border-radius` | `12px` | b | removed with the fill (DR23, item 6) | 4 (WI-4.4) |
| `globals.css:1371` | `.mcp-status-badge` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1376` | `.mcp-status-badge.running` | `background` | `#dcfce7` | b | no fill (item 6) | 4 (WI-4.4) |
| `globals.css:1377` | `.mcp-status-badge.running` | `color` | `#16a34a` | b | muted text plus a dot (item 6) | 4 (WI-4.4) |
| `globals.css:1408` | `.mcp-status-note` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1415` | `.mcp-status-dot` | `border-radius` | `50%` | allowed | rule 31: `50%` circle | — |
| `globals.css:1424` | `.mcp-server-info` | `border-radius` | `8px` | b | `--radius-popover` (+2px), grouped section (judgment) | 3 (WI-3.1, DR23) |
| `globals.css:1434` | `.mcp-info-label` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1441` | `.mcp-info-value` | `border-radius` | `4px` | a | `--radius-inner`, nested in `.mcp-server-info` | 2 (WI-2.3) |
| `globals.css:1443` | `.mcp-info-value` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1449` | `.mcp-info-hint` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1458` | `.mcp-copy-btn` | `font-size` | `14px` | b | 📋 glyph → WI-4.2 icon at `--icon-size-sm` (same 14px box) | 4 (WI-4.2) |
| `globals.css:1460` | `.mcp-copy-btn` | `transition` | `opacity 0.15s` | a | `--motion-duration-fast` (hover-reveal opacity, kept by DR12) | 2 (WI-2.3) |
| `globals.css:1468` | `.mcp-copy-btn.small` | `font-size` | `11px` | b | `--font-size-ui-sm` (+1px); must clear Stage 3's sub-12px gate before WI-4.2 swaps the glyph | 3 (WI-3.2 item 12) |
| `globals.css:1485` | `.mcp-installations-description` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1502` | `.mcp-client-row` | `border-radius` | `8px` | b | `--radius-popover` (+2px), grouped section (judgment) | 3 (WI-3.1, DR23) |
| `globals.css:1512` | `.mcp-client-status` | `font-size` | `16px` | b | `--font-size-ui` (−3px), DR22 | 3 (WI-3.2 item 12) |
| `globals.css:1517` | `.mcp-client-status.installed` | `color` | `#16a34a` | b | [R1](#rulings-user-2026-10-03): `--color-text`, extending Q6 by analogy (green → text colour) | 3 (WI-3.2 rulings) |
| `globals.css:1527` | `.mcp-client-details strong` | `font-size` | `14px` | a | `--font-size-ui-lg` | 2 (WI-2.3) |
| `globals.css:1535` | `.mcp-client-path` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1551` | `.dev-toolbar` | `z-index` | `100` | allowed | rule 31 z-index table, "Dev toolbar" | removed in `1703dbb` (was: —) |
| `globals.css:1556` | `.dev-toolbar` | `background` | `#fef3c7` | c | DR21 dev-toolbar exception (Q7) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1557` | `.dev-toolbar` | `border` | `1px solid #f59e0b` | c | DR21 dev-toolbar exception (Q7) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1559` | `.dev-toolbar` | `border-radius` | `0 0 8px 8px` | c | DR21 dev-toolbar exception (Q7; DR23 defers to DR21) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1560` | `.dev-toolbar` | `font-size` | `12px` | a | `--font-size-ui-sm`, or fold into the DR21 exception | removed in `1703dbb` (was: 2 (WI-2.3)) |
| `globals.css:1565` | `.dev-toolbar-label` | `color` | `#92400e` | c | DR21 dev-toolbar exception (Q7) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1572` | `.dev-toolbar-button` | `background` | `#f59e0b` | c | DR21 dev-toolbar exception (Q7) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1573` | `.dev-toolbar-button` | `color` | `white` | c | DR21 dev-toolbar exception (Q7) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1575` | `.dev-toolbar-button` | `border-radius` | `4px` | c | DR21 dev-toolbar exception (Q7; DR23 defers to DR21) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1576` | `.dev-toolbar-button` | `font-size` | `12px` | a | `--font-size-ui-sm`, or fold into the DR21 exception | removed in `1703dbb` (was: 2 (WI-2.3)) |
| `globals.css:1581` | `.dev-toolbar-button:hover` | `background` | `#d97706` | c | DR21 dev-toolbar exception (Q7) | removed in `1703dbb` (was: WI-2.1 exception) |
| `globals.css:1644` | `.tab-bar__new-tab` | `border-radius` | `6px` | a | `--radius-control` | skip, dead (A8): `TabBar/` |
| `globals.css:1645` | `.tab-bar__new-tab` | `font-size` | `18px` | b | glyph → icon (DR22 skips it) | skip, dead (A8): `TabBar/` |
| `globals.css:1661` | `.tab` | `border-radius` | `6px` | a | `--radius-control` | skip, dead (A8): `TabBar/` |
| `globals.css:1666` | `.tab` | `transition` | `background 0.15s ease, opacity 0.3s ease` | b | remove (DR12); stage-3 marks `.tab` out of scope | skip, dead (A8): `TabBar/` |
| `globals.css:1675` | `.tab--active` | `box-shadow` | `0 1px 3px rgba(0, 0, 0, 0.08)` | b | `--shadow-soft` | skip, dead (A8): `TabBar/` |
| `globals.css:1680` | `.tab__title` | `font-size` | `13px` | a | `--font-size-ui` | skip, dead (A8): `TabBar/` |
| `globals.css:1699` | `.tab__close` | `border-radius` | `4px` | a | `--radius-inner` | skip, dead (A8): `TabBar/` |
| `globals.css:1700` | `.tab__close` | `font-size` | `14px` | b | × glyph → icon | skip, dead (A8): `TabBar/` |
| `globals.css:1704` | `.tab__close` | `transition` | `opacity 0.15s ease` | a | `--motion-duration-fast`; explicit `ease` → ease-out is (b). Stage 3 lists this as a live keep; it is `TabBar/`-only | skip, dead (A8): `TabBar/` |
| `globals.css:1719` | `.tab__dirty-indicator` | `font-size` | `10px` | b | `--font-size-ui-sm` (+2px) | skip, dead (A8): `TabBar/` |
| `globals.css:1727` | `.tab__pin-indicator` | `font-size` | `10px` | b | `--font-size-ui-sm` (+2px) | skip, dead (A8): `TabBar/` |
| `globals.css:1744` | `.toc-sidebar__header` | `font-size` | `14px` | a | `--font-size-ui-lg` | orphan, no consumer |
| `globals.css:1751` | `.toc-sidebar__empty-message` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1774` | `.toc-entry__content` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `globals.css:1776` | `.toc-entry__content` | `transition` | `background 0.15s ease` | b | remove: colour transition (DR12) | 3 (WI-3.2 item 11) |
| `globals.css:1784` | `.toc-entry__content--active` | `background` | `rgba(37, 99, 235, 0.1)` | b | as :1037 | 3 (WI-3.2 item 1) |
| `globals.css:1811` | `.toc-entry__collapse-icon` | `font-size` | `10px` | b | `--font-size-ui-sm` (+2px); WI-4.2 later swaps the caret for an icon at `--icon-size-sm` | 3 (WI-3.2 item 12) |
| `globals.css:1831` | `.settings-input` | `border-radius` | `4px` | b | `--radius-control` (+2px), input (DR23) | 3 (WI-3.1, DR23) |
| `globals.css:1834` | `.settings-input` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1839` | `.toc-entry__text` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1858` | `.about-app-name` | `font-size` | `18px` | b | `--font-size-title` (−2px), DR22 About app name | 3 (WI-3.2 item 12) |
| `globals.css:1864` | `.about-version` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1874` | `.about-status-text` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1879` | `.about-status-ok` | `color` | `var(--color-success, #34c759)` | b | Q6: `--color-text` (renders `#1a1a1a` instead of `#34c759`); [R10](#rulings-user-2026-10-03) moved it out of Stage 2 | 3 (WI-3.2 rulings) |
| `globals.css:1883` | `.about-status-error` | `color` | `var(--color-error, #ff3b30)` | b | Q6: `--color-danger` (renders `#dc2626` instead of `#ff3b30`); [R10](#rulings-user-2026-10-03) moved it out of Stage 2 | 3 (WI-3.2 rulings) |
| `globals.css:1887` | `.about-status-disabled` | `color` | `var(--color-text-tertiary, #999)` | b | Q6: delete the colour line (inherits `.about-status-text`'s `--color-text-secondary` instead of `#999`); [R10](#rulings-user-2026-10-03) moved it out of Stage 2 | 3 (WI-3.2 rulings) |
| `globals.css:1898` | `.about-release-notes` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `globals.css:1905` | `.about-release-notes` | `border-radius` | `6px` | a | `--radius-control` (notes box; judgment) | 2 (WI-2.3) |
| `globals.css:1912` | `.about-release-notes h1, .about-release-notes h2, .about-release-notes h3` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `globals.css:1932` | `.about-progress-bar` | `border-radius` | `3px` | b | `999px` (DR23 pill); no rendered change, the bar is 6px tall | 3 (WI-3.1, DR23) |
| `globals.css:1938` | `.about-progress-bar::-webkit-progress-bar` | `border-radius` | `3px` | b | `999px` (DR23 pill); no rendered change, the bar is 6px tall | 3 (WI-3.1, DR23) |
| `globals.css:1942` | `.about-progress-bar::-webkit-progress-value` | `background` | `var(--color-accent, #007aff)` | allowed | rule 31 defensive fallback; `--color-accent` is always declared, so `#007aff` never renders | — |
| `globals.css:1943` | `.about-progress-bar::-webkit-progress-value` | `border-radius` | `3px` | b | `999px` (DR23 pill); no rendered change, the bar is 6px tall | 3 (WI-3.1, DR23) |
| `globals.css:1947` | `.about-progress-label` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |

### `src/components/Editor/MilkdownEditor.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `MilkdownEditor.css:51` | `.milkdown-editor .ProseMirror h1` | `font-size` | `2em` | allowed | A5: `em` inside editor content | — |
| `MilkdownEditor.css:58` | `.milkdown-editor .ProseMirror h2` | `font-size` | `1.5em` | allowed | A5: `em` inside editor content | — |
| `MilkdownEditor.css:65` | `.milkdown-editor .ProseMirror h3` | `font-size` | `1.25em` | allowed | A5: `em` inside editor content | — |
| `MilkdownEditor.css:72` | `.milkdown-editor .ProseMirror h4` | `font-size` | `1.1em` | allowed | A5: `em` inside editor content | — |
| `MilkdownEditor.css:79` | `.milkdown-editor .ProseMirror h5` | `font-size` | `1em` | allowed | A5: `em` inside editor content | — |
| `MilkdownEditor.css:86` | `.milkdown-editor .ProseMirror h6` | `font-size` | `0.9em` | allowed | A5: `em` inside editor content | — |
| `MilkdownEditor.css:99` | `.milkdown-editor .ProseMirror code` | `border-radius` | `4px` | a | [R9](#rulings-user-2026-10-03): `--radius-inner` (same value), the Q9 follow-up | 2 (WI-2.3) |
| `MilkdownEditor.css:105` | `.milkdown-editor .ProseMirror pre` | `border-radius` | `8px` | c (exception, R9) | [R9](#rulings-user-2026-10-03): content exception (DR23 gives editor-content shapes no role), the Q9 follow-up | WI-2.1 exception |
| `MilkdownEditor.css:141` | `.milkdown-editor .ProseMirror table` | `font-size` | `14px` | b | [R7](#rulings-user-2026-10-03): `0.875em`. Equal to 14px only at the default 16px editor size; it now scales with the editor font-size preference (`editorPrefApply.ts:122`) | 3 (WI-3.2 rulings) |
| `MilkdownEditor.css:214` | `.milkdown-editor .ProseMirror .column-resize-handle` | `z-index` | `1` | c | Q10 answered: local stacking exception for `.column-resize-handle` | WI-2.1 exception |
| `MilkdownEditor.css:266` | `.milkdown-editor .ProseMirror mark` | `background` | `rgba(255, 85, 130, 0.65)` | c (exception, R8) | [R8](#rulings-user-2026-10-03): highlight-fill exception | WI-2.1 exception |
| `MilkdownEditor.css:268` | `.milkdown-editor .ProseMirror mark` | `border-radius` | `4px` | a | [R9](#rulings-user-2026-10-03): as :99, `--radius-inner` | 2 (WI-2.3) |

### `src/components/BottomTabs/BottomTabs.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `BottomTabs.css:21` | `.bottom-tabs__add` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `BottomTabs.css:23` | `.bottom-tabs__add` | `font-size` | `18px` | b | + glyph → WI-4.2 icon at `--icon-size-sm` (−4px) | 4 (WI-4.2) |
| `BottomTabs.css:24` | `.bottom-tabs__add` | `transition` | `all 0.15s` | b | remove: `all` (DR12; preflight confirms it animated only colour) | 3 (WI-3.2 item 11) |
| `BottomTabs.css:59` | `.bottom-tab` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `BottomTabs.css:64` | `.bottom-tab` | `border-radius` | `6px` | a | `--radius-control` | 2 (WI-2.3) |
| `BottomTabs.css:66` | `.bottom-tab` | `transition` | `all 0.15s` | b | remove: `all` (DR12; preflight confirms it animated only colour) | 3 (WI-3.2 item 11) |
| `BottomTabs.css:79` | `.bottom-tab--active` | `box-shadow` | `0 1px 2px rgba(0, 0, 0, 0.05)` | b | `--shadow-soft`, the active-tab exception (proposal :45); today a 1–2px black 5% shadow | 3 (WI-3.2) |
| `BottomTabs.css:86` | `.bottom-tab__modified` | `border-radius` | `50%` | allowed | rule 31: `50%` circle | — |
| `BottomTabs.css:102` | `.bottom-tab__close` | `border-radius` | `4px` | a | `--radius-inner` (tab close, DR23) | 2 (WI-2.3) |
| `BottomTabs.css:103` | `.bottom-tab__close` | `font-size` | `14px` | b | × glyph → WI-4.2 icon at `--icon-size-sm` (same 14px box) | 4 (WI-4.2) |
| `BottomTabs.css:105` | `.bottom-tab__close` | `transition` | `opacity 0.15s` | a | `--motion-duration-fast` (hover-reveal opacity, kept by DR12) | 2 (WI-2.3) |
| `BottomTabs.css:115` | `.bottom-tab__close:hover` | `background` | `rgba(0, 0, 0, 0.08)` | b | `--color-hover`: black 8% → text 5% (light) / 8% (dark) | 3 (WI-3.2 hover) |

### `src/components/Editor/ImageContextMenu.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `ImageContextMenu.css:3` | `.image-context-menu` | `z-index` | `1000` | allowed | rule 31 z-index table, "Inline context menu" | — |
| `ImageContextMenu.css:7` | `.image-context-menu` | `border-radius` | `8px` | b | `--radius-popover` (+2px) | 3 (WI-3.1, DR23) |
| `ImageContextMenu.css:16` | `.image-context-menu-label` | `font-size` | `12px` | a | `--font-size-ui-sm` | 2 (WI-2.3) |
| `ImageContextMenu.css:26` | `.image-context-menu-button` | `border-radius` | `6px` | b | `--radius-inner` (−2px), menu item | 3 (WI-3.1, DR23) |
| `ImageContextMenu.css:51` | `.image-context-menu-input` | `border-radius` | `6px` | a | `--radius-control` (an input nested in the menu; judgment) | 2 (WI-2.3) |
| `ImageContextMenu.css:60` | `.image-context-menu-apply` | `border-radius` | `6px` | a | `--radius-control` (a button nested in the menu; judgment) | 2 (WI-2.3) |

### `src/plugins/milkdown/inlineEditPlugin.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `inlineEditPlugin.css:5` | `.milkdown-editor .ProseMirror .milkdown-inline-expanded` | `transition` | `none` | allowed | `none` (rule 31) | — |
| `inlineEditPlugin.css:14` | `.milkdown-editor .ProseMirror .milkdown-link-expanded` | `border-radius` | `3px` | b | `--radius-inner` (+1px), inline edit (DR23) | 3 (WI-3.1, DR23) |

### `src/plugins/milkdown/imagePastePlugin.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `imagePastePlugin.css:10` | `.image-paste-placeholder` | `border-radius` | `6px` | a | `--radius-control` (placeholder box; judgment) | 2 (WI-2.3) |
| `imagePastePlugin.css:12` | `.image-paste-placeholder` | `font-size` | `13px` | a | `--font-size-ui` | 2 (WI-2.3) |
| `imagePastePlugin.css:23` | `.image-paste-placeholder::before` | `border-radius` | `50%` | allowed | rule 31: `50%` circle | — |
| `imagePastePlugin.css:24` | `.image-paste-placeholder::before` | `animation` | `spin 0.8s linear infinite` | c (exception, R4) | [R4](#rulings-user-2026-10-03): as globals :815 (spinner, DR13) | WI-2.1 exception |

### `src/plugins/codemirror/wysiwygDecorationsPlugin.css`

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| `wysiwygDecorationsPlugin.css:5` | `.wysiwyg-marker` | `font-size` | `10px` | b | `--font-size-ui-sm` (+2px) | 3 (WI-3.2 item 12) |
| `wysiwygDecorationsPlugin.css:8` | `.wysiwyg-marker` | `border-radius` | `6px` | a | `--radius-control` (marker chip; judgment) | 2 (WI-2.3) |

### Out of scope: App.css

`src/App.css` is A5-excluded dead code (A8). Its 26 literals, 19 of them colours, are listed only so the reconciliation is complete. They are not classified, because the file is deleted rather than tokenized.

| File:line | Selector | Property | Value |
|---|---|---|---|
| `App.css:2` | `.logo.vite:hover` | `filter` | `drop-shadow(0 0 2em #747bff)` |
| `App.css:6` | `.logo.react:hover` | `filter` | `drop-shadow(0 0 2em #61dafb)` |
| `App.css:9` | `:root` | `font-family` | `Inter, Avenir, Helvetica, Arial, sans-serif` |
| `App.css:10` | `:root` | `font-size` | `16px` |
| `App.css:14` | `:root` | `color` | `#0f0f0f` |
| `App.css:15` | `:root` | `background-color` | `#f6f6f6` |
| `App.css:37` | `.logo` | `transition` | `0.75s` |
| `App.css:41` | `.logo.tauri:hover` | `filter` | `drop-shadow(0 0 2em #24c8db)` |
| `App.css:51` | `a` | `color` | `#646cff` |
| `App.css:56` | `a:hover` | `color` | `#535bf2` |
| `App.css:65` | `input, button` | `border-radius` | `8px` |
| `App.css:68` | `input, button` | `font-size` | `1em` |
| `App.css:70` | `input, button` | `font-family` | `inherit` |
| `App.css:71` | `input, button` | `color` | `#0f0f0f` |
| `App.css:72` | `input, button` | `background-color` | `#ffffff` |
| `App.css:73` | `input, button` | `transition` | `border-color 0.25s` |
| `App.css:74` | `input, button` | `box-shadow` | `0 2px 2px rgba(0, 0, 0, 0.2)` |
| `App.css:82` | `button:hover` | `border-color` | `#396cd8` |
| `App.css:85` | `button:active` | `border-color` | `#396cd8` |
| `App.css:86` | `button:active` | `background-color` | `#e8e8e8` |
| `App.css:100` | `@media (prefers-color-scheme: dark) :root` | `color` | `#f6f6f6` |
| `App.css:101` | `@media (prefers-color-scheme: dark) :root` | `background-color` | `#2f2f2f` |
| `App.css:105` | `@media (prefers-color-scheme: dark) a:hover` | `color` | `#24c8db` |
| `App.css:110` | `@media (prefers-color-scheme: dark) input, button` | `color` | `#ffffff` |
| `App.css:111` | `@media (prefers-color-scheme: dark) input, button` | `background-color` | `#0f0f0f98` |
| `App.css:114` | `@media (prefers-color-scheme: dark) button:active` | `background-color` | `#0f0f0f69` |

## Summary

### By file and class (in scope)

| File | a | b | c | allowed | Rows | of which dead or orphan |
|---|---|---|---|---|---|---|
| `globals.css` | 76 | 76 | 13 | 12 | 177 | 37 |
| `MilkdownEditor.css` | 2 | 1 | 3 | 6 | 12 | 0 |
| `BottomTabs.css` | 5 | 6 | 0 | 1 | 12 | 0 |
| `ImageContextMenu.css` | 3 | 2 | 0 | 1 | 6 | 0 |
| `inlineEditPlugin.css` | 0 | 1 | 0 | 1 | 2 | 0 |
| `imagePastePlugin.css` | 2 | 0 | 1 | 1 | 4 | 0 |
| `wysiwygDecorationsPlugin.css` | 1 | 1 | 0 | 0 | 2 | 0 |
| **Total** | **89** | **87** | **17** | **22** | **215** | **37** |
| **Live selectors only** | **70** | **71** | **17** | **20** | **178** | — |

*Recounted 2026-10-03 after the [rulings](#rulings-user-2026-10-03).* Ten class-(c) rows changed class, all of them live: eight became (b) (R1, R3 ×2, R5, R7, R10 ×3) and two became (a) (R9 `code` and `mark`). The other seven rulings' rows stay (c), now as ruled new tokens (R2 ×3, R6) or exceptions (R4 ×2, R8, R9 `pre`). Before the rulings the totals were 87 / 79 / 27 / 22, and the live counts 68 / 63 / 27 / 20. No row was added or removed, so the row totals, the category table and the reconciliation below are unchanged.

The 37 dead or orphan rows are all in `globals.css`:
- 17 A8-dead rows: 11 `TabBar/` `.tab*` rows (1644–1727) and 6 `Sidebar.tsx` / `FileItem.tsx` rows.
- 4 recent-dropdown rows that WI-1.2 deletes.
- 16 orphan rows.

~~Stage 2's real workload is the live count: **68 value-preserving swaps, 63 snaps, and 27 rulings or exceptions**.~~ **Recounted 2026-10-03:** the live count is **70 class (a) swaps, 71 class (b) snaps deferred to Stages 3–4, and 17 class (c) rows**. The 17 are 4 new-token sites that Stage 2 swaps value-preservingly (R2, R6) and 13 WI-2.1 exceptions (8 dev toolbar, Q10, R4 ×2, R8, R9 `pre`). Stage 2 therefore makes 74 value-preserving swaps, and none of its work changes a computed style.

**2026-10-07 — dev toolbar removed.** `1703dbb` deleted the `.dev-toolbar*` rules, so the 11 dev-toolbar rows (`globals.css:1551-1581` at a5767d5) are marked "removed in `1703dbb`" above and no longer count. They were all live: 1 allowed (z-index), 8 class (c) WI-2.1 exceptions and 2 class (a) font sizes. The tables in this summary stay as recorded at a5767d5. After the removal: the live count is **68 (a) / 71 (b) / 9 (c) / 19 allowed = 167** (was 70 / 71 / 17 / 20 = 178); the full total is 87 / 87 / 9 / 21 = 204 (was 215), and `globals.css` has 166 rows (was 177). Stage 2 makes **72** value-preserving swaps (68 (a) + 4 new-token), and the WI-2.1 exceptions drop from 13 to **5** (Q10, R4 ×2, R8, R9 `pre`). In the by-stage table, `2 (WI-2.3)` becomes 68, `WI-2.1 exception` 5 and `—` 19. The by-category table is not recounted.

### By file and category (in scope)

| File | Colour | Font size | Radius | Transition / animation | z-index | Box shadow |
|---|---|---|---|---|---|---|
| `globals.css` | 25 | 88 | 47 | 8 | 5 | 4 |
| `MilkdownEditor.css` | 1 | 7 | 3 | 0 | 1 | 0 |
| `BottomTabs.css` | 1 | 3 | 4 | 3 | 0 | 1 |
| `ImageContextMenu.css` | 0 | 1 | 4 | 0 | 1 | 0 |
| `inlineEditPlugin.css` | 0 | 0 | 1 | 1 | 0 | 0 |
| `imagePastePlugin.css` | 0 | 1 | 2 | 1 | 0 | 0 |
| `wysiwygDecorationsPlugin.css` | 0 | 1 | 1 | 0 | 0 | 0 |

### By stage

| Stage | Rows |
|---|---|
| 2 (WI-2.3) | 70 |
| 3 (WI-3.1, DR23) | 25 |
| — | 20 |
| 3 (WI-3.2 item 12) | 16 |
| orphan, no consumer | 16 |
| WI-2.1 exception | 13 |
| skip, dead (A8): `TabBar/` | 11 |
| 3 (WI-3.2 rulings) | 8 |
| 3 (WI-3.2 item 11) | 6 |
| 4 (WI-4.2) | 6 |
| skip, dead (A8): `FileItem.tsx` | 5 |
| 2 (WI-2.2 new token) | 4 |
| 4 (WI-4.4) | 4 |
| WI-1.2 deletes | 3 |
| 3 (WI-3.2 item 1) | 2 |
| 4 (WI-4.3) | 2 |
| skip, dead (A8): `Sidebar/Sidebar.tsx` | 1 |
| WI-1.2 deletes (rule and table row) | 1 |
| 3 (WI-3.2) | 1 |
| 3 (WI-3.2 hover) | 1 |

The 2026-10-03 rulings emptied three stage values — `open` (was 12), `open (Q9 follow-up)` (was 3) and `WI-2.2 per Q6, but not value-preserving` (was 3) — and added `3 (WI-3.2 rulings)` and `2 (WI-2.2 new token)`. Before them, `2 (WI-2.3)` was 68 and `WI-2.1 exception` was 9. For the counts after `1703dbb` removed the dev toolbar, see the 2026-10-07 note above.

## Rulings (user, 2026-10-03)

The user ruled on every class-(c) row that was still open, plus the Q9 follow-up and the Q6 staging question ([Plan discrepancies](#plan-discrepancies-found-while-inventorying), item 3). Each ruling's class follows the [class key](#class-key): a new token stays (c), marked ruled; a `color-mix()` or `em` target that changes the rendered value is (b); an exception is (c) with stage `WI-2.1 exception`, as the DR21 and Q10 rows already are. A ruling that changes pixels goes to Stage 3, never to Stage 2, so Stage 2 stays a computed-style no-op with no exceptions to that gate.

| ID | Rows | Ruling | Resulting class | Target token / exception | Stage / WI |
|---|---|---|---|---|---|
| R1 | `globals.css:1517` | `.mcp-client-status.installed` `#16a34a` → `--color-text`, extending Q6 by analogy | b | `--color-text`: green becomes the text colour in both themes | 3 (WI-3.2 rulings) |
| R2 | `globals.css:751`, `:1187`, `:1351` | White on accent → a new token `--color-on-accent`. A10 is met (3 unrelated uses). | c (ruled) | New `--color-on-accent`, declared with today's `#fff` | 2 (WI-2.2 new token). Its rows in rule 31 and DESIGN.md land in the same commit. |
| R3 | `globals.css:756`, `:1192` | Primary-button hover `#1d4ed8` → `color-mix()` over `--color-accent` | b | `color-mix()` over `--color-accent`. No mix reproduces `#1d4ed8` exactly, and the dark theme's hover stops being the light-theme blue. | 3 (WI-3.2 rulings) |
| R4 | `globals.css:815`, `imagePastePlugin.css:24` | Spinners `spin 0.8s linear infinite` → a WI-2.1 exception | c (exception) | WI-2.1 exception; DR13 keeps spinners rotating | WI-2.1 exception |
| R5 | `globals.css:349` | CodeMirror selection `rgba(96, 165, 250, 0.25)` → `color-mix()` derived from `--color-accent` | b | `color-mix()` of `--color-accent` at 25%. Dark is unchanged, because `#60a5fa` is the dark accent; light becomes `#2563eb` at 25%. | 3 (WI-3.2 rulings) |
| R6 | `globals.css:466` | Dialog scrim `rgba(15, 23, 42, 0.35)` → a new token `--color-scrim` | c (ruled) | New `--color-scrim`, declared with today's value. One use: a user override of A10. | 2 (WI-2.2 new token). Its rows in rule 31 and DESIGN.md land in the same commit. |
| R7 | `MilkdownEditor.css:141` | Milkdown table `font-size: 14px` → `0.875em` | b | `0.875em`. It equals 14px only at the default 16px editor size and now scales with the editor font-size preference (`editorPrefApply.ts:122`). | 3 (WI-3.2 rulings) |
| R8 | `MilkdownEditor.css:266` | Milkdown highlight fill `rgba(255, 85, 130, 0.65)` → an exception | c (exception) | WI-2.1 exception | WI-2.1 exception |
| R9 | `MilkdownEditor.css:99`, `:268`; `:105` | Q9 follow-up on content radii: `code` and `mark` → `--radius-inner`; `pre` → a content exception | a (`code`, `mark`); c (exception) (`pre`) | `--radius-inner` at the same 4px; `pre` 8px stays as a content exception | 2 (WI-2.3) for `code` and `mark`; WI-2.1 exception for `pre` |
| R10 | `globals.css:1879`, `:1883`, `:1887` | Q6's three `.about-status-*` replacements move from WI-2.2 to Stage 3 | b | Q6's targets are unchanged: `--color-text`, `--color-danger`, and drop the colour line | 3 (WI-3.2 rulings) |

**Obligation carried by R2 and R6.** `--color-on-accent` and `--color-scrim` are added to `.claude/rules/31-design-tokens.md` and to DESIGN.md § Tokens **in the same commit that introduces them** (WI-2.2), not in a later docs pass. [Stage 2](./stage-2-tokenize.md) WI-2.2 carries this as a task.

**Where the rulings sit against the plan's own rules.** These are recorded, not resolved:
- **R6 vs A10.** A10 (and WI-2.2) give a semantic token only to 3 or more unrelated uses; the scrim has one. R6 is the user's explicit override for this one token, and A10 is otherwise unchanged. **Resolved at stop point 1 (2026-10-08):** A10 now names it — "Exception: `--color-scrim` (R6, one use, user ruling 2026-10-03)."
- **R7 and "zero visual change".** At the default 16px editor size, `0.875em` computes to 14px, so the Stage 2 computed-style diff would stay empty. A user with a different editor font size would still see the table text change, which breaks Deliverable A's "zero visual change". R7 is therefore staged in Stage 3 as class (b), not in Stage 2.
- **R2 and contrast.** `--color-on-accent` keeps today's `#fff` in both themes, so Stage 2 is unchanged. White on the dark accent `#60a5fa` is about 2.5:1, below A9's 4.5:1 for labels. That is today's rendering, not a regression. The Stage 3 contrast table (primary button labels) is where a per-theme value would be decided.

## Class (c) grouped by open question

### Q6 — status colours (answered: replace, do not declare)

- `globals.css:1879` `.about-status-ok` → `--color-text`
- `globals.css:1883` `.about-status-error` → `--color-danger`
- `globals.css:1887` `.about-status-disabled` → drop the colour line

The answer is settled, but it changes rendered values. See [Plan discrepancies](#plan-discrepancies-found-while-inventorying), item 3. **2026-10-03 ruling R10:** these three rows move to Stage 3 (WI-3.2) and are now class (b).

- `globals.css:1517` `.mcp-client-status.installed` `#16a34a`: a green status that Q6 does not name. WI-4.4 says there is no green token. ~~**Needs a ruling** that extends Q6 by analogy (candidate `--color-text`).~~ **2026-10-03 ruling R1:** `--color-text`, extending Q6 by analogy; class (b) in Stage 3 (WI-3.2).

### Q7 / DR21 — warning colour (answered: no warning token; dev toolbar is an exception)

- **WI-2.1 exception rows** (8): `globals.css:1556`, `:1557`, `:1559`, `:1565`, `:1572`, `:1573`, `:1575`, `:1581` (all `.dev-toolbar*`). (2026-10-07: moot. `1703dbb` deleted these rules, so DR21 now has no exception rows.)
- The amber dirty banner (`:1070`, `:1071`) is **not** class (c). DR21 moves it to accent-soft in WI-4.3, so it is class (b) at stage 4 (WI-4.3).

### Q8 / DR22 — chrome font sizes off the ramp (answered)

There is no class (c) left. DR22 assigns every off-ramp chrome size a role, so each of these rows is class (b) with its delta:
- dialog title
- section labels
- card headings
- `.mcp-client-status`
- page title
- About app name

Glyph sizes are class (b) as well, going to WI-4.2 icons.

### Q9 / DR23 — radii (answered for chrome)

These editor-content shapes have no DR23 role. They form a Q9 follow-up, **answered by the 2026-10-03 ruling [R9](#rulings-user-2026-10-03)**:
- `MilkdownEditor.css:99` (`code`, 4px, ~~candidate `--radius-inner`, same value~~) → `--radius-inner`, class (a), Stage 2 (WI-2.3)
- `MilkdownEditor.css:105` (`pre`, 8px, ~~candidate `--radius-popover` +2px, or a content exception~~) → a content exception, WI-2.1
- `MilkdownEditor.css:268` (`mark`, 4px) → `--radius-inner`, class (a), Stage 2 (WI-2.3)

### Q10 — local z-index (answered: local exception)

- `MilkdownEditor.css:214` `.column-resize-handle` `z-index: 1` → a WI-2.1 exception.

### Not covered by Q6–Q10 (~~new questions needed~~ ruled 2026-10-03)

The candidate column is kept as the record of what was weighed. The ruling column is what the user chose; see [Rulings](#rulings-user-2026-10-03).

| Rows | Literal | Why it is class (c) | Candidate ruling | Ruling (2026-10-03) |
|---|---|---|---|---|
| `globals.css:751`, `:1187`, `:1351` | `#fff` / `white` on accent | No token equals white in both themes | `--color-panel` (rule 34 menu-highlight pattern; changes dark only) or a new `--color-on-accent`. A10 is met (3 unrelated uses). | R2: new `--color-on-accent`, WI-2.2 |
| `globals.css:756`, `:1192` | `#1d4ed8` primary hover | No darker-accent token | `color-mix()` over `--color-accent`, or drop the darken (two uses, so A10 keeps it open) | R3: `color-mix()` over `--color-accent`, class (b), WI-3.2 |
| `globals.css:815`, `imagePastePlugin.css:24` | `spin 0.8s linear infinite` | A5 wants animation duration via `var()`, but DR13 keeps spinners rotating, so the zeroed `--motion-duration-fast` cannot carry it | WI-2.1 exception, or a non-zeroed `--motion-duration-spin` | R4: WI-2.1 exception |
| `globals.css:349` | `rgba(96, 165, 250, 0.25)` CodeMirror selection | One use, no token | Exception, or derive from `--color-accent` via `color-mix()` | R5: `color-mix()` from `--color-accent`, class (b), WI-3.2 |
| `globals.css:466` | `rgba(15, 23, 42, 0.35)` dialog scrim | One use, no token | Exception, or a `--color-scrim` token | R6: new `--color-scrim`, WI-2.2 (overrides A10) |
| `MilkdownEditor.css:141` | table `font-size: 14px` | A5 allows only `em`/`%` in content, and DR22 covers chrome only | `0.875em` (scales with editor size), or an exception | R7: `0.875em`, class (b), WI-3.2 |
| `MilkdownEditor.css:266` | `rgba(255, 85, 130, 0.65)` highlight fill | One use, no token | Exception, or a `--color-highlight` token | R8: WI-2.1 exception |

## Reconciliation against the baseline table

The baseline table ([baseline protocol](./baseline-protocol.md) § Baseline) counts colour literals and `px` font sizes per file. It also counts `globals.css` radius/transition/z-index/box-shadow. Its counting commands reproduce exactly at the baseline commits, so differences below come from three causes:
- the commit moved
- the token-definition lines in `:root` are excluded here
- the grep pattern misses or over-matches something

The counting commands:

```sh
/usr/bin/grep -oE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' FILE | /usr/bin/wc -l   # colours
/usr/bin/grep -cE 'font-size:\s*[0-9.]+px' FILE                                  # px font sizes
```

These are the same grep counts at each commit, before any exclusion:

| `globals.css` at | Lines | Colours (grep) | px font sizes (grep) | radius / transition / z-index / box-shadow |
|---|---|---|---|---|
| 0a3675e | 1918 | 49 | 88 | 47 / 7 / 5 / 1 |
| 0ca5a41 (baseline table) | 1917 | 48 | 88 | 47 / 7 / 5 / 1 |
| a5767d5 (this appendix) | 1955 | 48 | 89 | 47 / 7 / 5 / 1 |

### Per file and category: appendix rows vs baseline

| File | Category | Baseline | Grep at a5767d5 | Appendix rows | Difference explained |
|---|---|---|---|---|---|
| `globals.css` | Colour | 48 | 48 | 25 | −23 `:root` occurrences on 22 lines (token definitions, A5-excluded); −2 false positives, `#390` issue numbers in comments at `:505` and `:604`. That leaves 23 real lines. Then −1, because `:1675`'s `rgba()` sits inside a `box-shadow` and is a shadow row, and +3, for the named `white` at `:1187`, `:1351`, `:1573`, which the hex grep cannot see. |
| `globals.css` | px font size | 88 | 89 | 88 | +1 since the baseline: the MCP commits (8050803 / d211550 / 3a78ed1) added a `font-size: 12px`. −1 for `:31 --editor-font-size: 16px`, a `:root` token definition. |
| `globals.css` | Radius | 47 | 47 | 47 | Match. |
| `globals.css` | Transition / animation | 7 | 7 | 8 | +1 for the `.spinner` `animation` at `:815`, which the baseline counts did not include (it counted `transition` only). |
| `globals.css` | z-index | 5 | 5 | 5 | Match. All five are rule 31 table values. |
| `globals.css` | Box shadow | 1 | 1 | 4 | The baseline's 1 is the literal-colour shadow at `:1675`. +3 are shadows with a literal geometry but a `var()` colour (`:153`, `:702`, `:746`), listed as allowed so the inventory is complete. |
| `MilkdownEditor.css` | Colour | 1 | 1 | 1 | Match (`:266`). |
| `MilkdownEditor.css` | px font size | 1 | 1 | 7 | Match on `px` (`:141`). +6 `em` heading sizes (`:51`–`:86`): allowed under A5 and invisible to a `px` grep. |
| `BottomTabs.css` | Colour | 2 | 2 | 1 | `:79`'s `rgba()` is inside a `box-shadow`, so it is the file's one shadow row. `:115` is the colour row. |
| `BottomTabs.css` | px font size | 3 | 3 | 3 | Match. |
| `ImageContextMenu.css` | Colour / px font size | 0 / 1 | 0 / 1 | 0 / 1 | Match. |
| `inlineEditPlugin.css` | Colour / px font size | 0 / 0 | 0 / 0 | 0 / 0 | Match. |
| `imagePastePlugin.css` | Colour / px font size | 0 / 1 | 0 / 1 | 0 / 1 | Match. |
| `wysiwygDecorationsPlugin.css` | Colour / px font size | 0 / 1 | 0 / 1 | 0 / 1 | Match. |

The baseline never measured radius/transition/z-index/box-shadow outside `globals.css`. Those rows here (the non-`globals.css` lines of the category table above) are new counts with nothing to reconcile against: 14 radius, 5 transition/animation, 2 z-index, 1 box shadow.

**`App.css`**: 26 out-of-scope literals, 19 of them colours. The 19 matches the baseline's dead-code note.

## Plan discrepancies found while inventorying

These are inputs for the lead. This appendix does not resolve them; where a later ruling did, the item says so. Stop point 1 (user, 2026-10-08) resolved 1, 2, 7 and 8 and deferred 6.

1. **`.tab__close` is dead, not a live keep.** Stage 3 lists the `opacity` transition at old `:1667` (now `globals.css:1704`) as a live hover-reveal to keep under DR12. Its only consumer is `TabBar/`, which is A8 dead code. The live hover-reveal is `BottomTabs.css:105` `.bottom-tab__close`. **Resolved at stop point 1 (2026-10-08):** [Stage 3](./stage-3-retune.md) WI-3.2 drops `.tab__close` from the DR12 keep list and names it dead with `TabBar/` (A8).
2. **`.settings-search` has no consumer.** DR23 and Stage 3 name it as a radius site, but no `.tsx` references it at a5767d5. Nor does any other selector marked `orphan, no consumer`:
   - `.pane-title`
   - `.toolbar-mode`
   - `.settings-sidebar-title`
   - `.settings-placeholder*`
   - `.settings-general`
   - `.settings-form-row`
   - `.settings-form-hint`
   - `.toc-sidebar__header`

   **Resolved at stop point 1 (2026-10-08):** [Stage 3](./stage-3-retune.md) WI-3.1 no longer names `.settings-search` as a radius site, and [Stage 4a](./stage-4a-components.md) WI-4.3 marks its `.settings-general p` example as an orphan. The orphan rows stay in the inventory as deletion candidates, not tokenization targets.
3. **Q6 is not value-preserving, but targets WI-2.2.** Stage 2's gate is an empty computed-style diff. All three Q6 replacements change the rendered colour: `#34c759` → `#1a1a1a`, `#ff3b30` → `#dc2626`, `#999` → inherited secondary. Either Q6 moves to Stage 3 / WI-4.x, or the Stage 2 diff gets a declared Q6 carve-out. **Resolved by the 2026-10-03 ruling [R10](#rulings-user-2026-10-03):** Q6 moves to Stage 3 (WI-3.2), and the Stage 2 diff gets no carve-out.
4. **Spinners fall between A5 and DR13** (see the table above). No allowlist or exception covers `spin 0.8s linear infinite` today. **Resolved by the 2026-10-03 ruling [R4](#rulings-user-2026-10-03):** a WI-2.1 exception.
5. **Editor-content literals have no DR role.** These are not covered by DR22 or DR23, which are both chrome-scoped:
   - `MilkdownEditor.css` table `14px`
   - the `code`/`pre`/`mark` radii
   - the `mark` fill

   **Resolved by the 2026-10-03 rulings [R7, R8 and R9](#rulings-user-2026-10-03):** the table size becomes `0.875em` (Stage 3), the `mark` fill and the `pre` radius become WI-2.1 exceptions, and `code`/`mark` radii take `--radius-inner`.
6. **14px role mismatches.** The live class (a) 14px sites map to `--font-size-ui-lg` by value. DESIGN.md § Tokens gives `--font-size-ui-lg` only two roles, dialog titles and the settings header. These rows are body or label text that DESIGN.md's roles would put on `--font-size-ui` (13px):
   - `.dialog-message` (`:490`)
   - the table and link insert inputs (`:695`, `:738`)
   - `.settings-category-btn` (`:949`)
   - `.shortcut-label` (`:1015`)
   - `.settings-row-label strong` (`:1302`)
   - `.mcp-client-details strong` (`:1527`)

   They are classified (a) by value. A role-driven move to 13px is a Stage 3/4 decision. **Deferred to Stage 3/4, by user decision at stop point 1 (2026-10-08).** No value changes here.
7. **`stage-4a-components.md` cites `globals.css:1335` for the toggle track `#ccc`.** At 0a3675e that line is the toggle's `transition`, and `#ccc` was `:1334`. At a5767d5 `#ccc` is `:1339`. **Resolved at stop point 1 (2026-10-08):** stage-4a already cites `globals.css:1339`, re-pointed by the WI-0.6 re-run (`a00f089`).
8. **Two class (b) rows have no numbered owner.** `BottomTabs.css:79` (shadow → `--shadow-soft`) and `:115` (hover → `--color-hover`) fall under WI-3.2's prose bullets, which carry no item number. They are staged as `3 (WI-3.2)` and `3 (WI-3.2 hover)`. **Resolved at stop point 1 (2026-10-08):** [Stage 3](./stage-3-retune.md) WI-3.2 now names each row under its owning bullet — `:79` under *Flat rows and tabs*, `:115` under *Hover*.

## Line drift from 0a3675e

`globals.css` line numbers cited in the plan were taken at 0a3675e. At a5767d5 they shift as follows:

| Old range | Shift |
|---|---|
| Before about `:498` | −1 (the `--color-preview-bg` deletion in 0ca5a41) |
| `:498`–`:1373` | +5 |
| After `:1373` | +37 (MCP settings additions) |

| Plan citation (0a3675e) | a5767d5 |
|---|---|
| Sub-12px hotspots `:122`, `:219`, `:532`, `:578`, `:929`, `:1245`, `:1431`, `:1682`, `:1690`, `:1774` | `:121`, `:218`, `:537`, `:583`, `:934`, `:1250`, `:1468`, `:1719`, `:1727`, `:1811` |
| Transitions `:639`, `:1335`, `:1347`, `:1423`, `:1629`, `:1667`, `:1739` | `:644`, `:1340`, `:1352`, `:1460`, `:1666`, `:1704`, `:1776` |
| Accent fills `:1032`, `:1747` | `:1037`, `:1784` |
| Toggle track `#ccc` `:1334` | `:1339` |
| Running badge `:1371`–`:1372` | `:1376`–`:1377` |
| Dev toolbar `:1509`–`:1547` | `:1546`–`:1583` |
| Dirty banner `:1059`–`:1068` | `:1064`–`:1073` |
| Q6 lines `:1842`, `:1846`, `:1850` | `:1879`, `:1883`, `:1887` |
