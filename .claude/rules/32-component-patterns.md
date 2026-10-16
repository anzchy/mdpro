---
description: Component contracts (modal, context menu, button, toast, table) — ARIA, focus trap, single-source-of-truth file.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
---

# 32 — Component Patterns

Component contracts only. CSS examples live in the component's own
`.css` file or the app CSS partial that owns the surface (table below).
See `DESIGN.md` for visual narrative.

## Single source of truth for styles

A component's styles live in **one** file. Do not redeclare them in
both an app CSS file (`globals.css` or a `src/styles/sections/` partial)
and a co-located stylesheet — import order silently picks a winner.
App CSS loads through `src/styles/index.css`, whose `@import` order is
the cascade order; do not reorder it.

| Surface | File |
|---|---|
| `:root` tokens, reset, base | `src/styles/globals.css` |
| App shell, sidebar | `src/styles/sections/app-shell.css` |
| Dialog backdrop, `.dialog-card` | `src/styles/sections/buttons-dialog.css` |
| Toast | `src/styles/sections/recovery-toast.css` |
| Settings | `src/styles/sections/settings-shell.css`, `settings-pages.css`, `settings-rows.css`, `settings-mcp.css`, `settings-about.css` |
| Milkdown editor surface | `src/components/Editor/MilkdownEditor.css` |
| Image context menu | `src/components/Editor/ImageContextMenu.css` |
| Link insert modal | `src/styles/sections/link-insert-modal.css` (`.link-insert-*`) |
| Future per-component | co-locate as `Component.tsx` + `Component.css` |

## Modal contract

- Use `.dialog-backdrop` + `.dialog-card` from `src/styles/sections/buttons-dialog.css`.
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (title) +
  `aria-describedby` (subtitle / live message).
- **Trap Tab inside the dialog with an inline `onKeyDown` loop.** No shared
  hook exists: collect focusable descendants, wrap Tab from last to first and
  Shift+Tab from first to last (`handleDialogKeyDown` in
  `src/components/common/SettingsDialog.tsx`; also
  `src/components/Editor/TableInsertModal/index.tsx`).
- First-focused element is the most-likely-edited control, not title/cancel.
- Esc closes (cancels) — except `RecoveryDialog`, which deliberately has no
  Escape close so a data-loss recovery prompt can't be dismissed by accident
  (asserted by `tests/focus-trap.test.ts`; see `33-focus-indicators.md`).
  Enter from any input submits. Backdrop click cancels — except `RecoveryDialog`,
  where it does nothing, for the same reason ([ADR-0056](../../docs/adr/0056-recovery-stays-a-forced-choice-and-encoding-opens-on-cancel.md));
  `.dialog-card` click stops propagation.
- Two-button row: Cancel (left, secondary) and Primary (right).

## Context menu contract

- Position: `fixed`, anchored to `event.clientX/Y`, clamped to viewport.
- Listener registered on the host container (e.g. `#milkdown-container`);
  each handler reads `event.target.closest("<own-selector>")` and bails
  when no match. Multiple menus on the same container are fine if each
  owns its target selector.
- Right-click on an image inside a table cell must open the **image**
  menu, not the table menu. Order-independent — bail when target isn't
  yours.
- Stale-position guard: between menu open and click, the document may
  change. Wrap action dispatch in try/catch and re-validate the target
  node before applying.
- Dismiss: `pointerdown` outside, Escape, window resize, scroll.
- ARIA: `role="menu"` + `aria-label`; items `role="menuitem"`;
  groups `role="group"` with `aria-label`.
- **Sectioning at ≥10 items.** Group with labels and `<hr>` separators.
  Destructive items use `var(--color-danger)` and invert on hover.

## Button states

- Active is a class (`.is-active`), not `:hover`. They're different states.
- Two variants exist (`.toolbar-button--primary` and `.toolbar-button.primary`)
  — pick either; flag inconsistency in PR review when touching adjacent code.

## Form input

Text inputs use focus pattern 1 (border + soft ring) from `33-focus-indicators.md`.

## Tab bar

- The tab name truncates at `max-width: 150px` (`.bottom-tab__name`).
- Active tab is filled, not lifted: `--color-tab-active-fill`, no shadow
  (D231 6c; tokens in `31-design-tokens.md`).
- Dirty indicator: a 6px dot, `--color-accent`; on the active tab
  `--color-tab-active-accent`.
- Close button: opacity 0 at rest, 0.5 on hover or keyboard focus within the
  tab, and always shown on the active tab at `--tab-active-close-opacity`.
- Source of truth: `src/components/BottomTabs/BottomTabs.css`.

## Code block

`pre` owns the frame; there is no wrapper (see `31-design-tokens.md` § "Frame ownership").
Inline `code` reuses `--color-code-bg` directly.

## Table (WYSIWYG editor)

Wide tables scroll inside prosemirror-tables' `.tableWrapper` (`overflow-x: auto`;
inner table `width: max-content; min-width: 100%`). The `.milkdown` scroll root
sets `overflow-x: hidden` on purpose so the wrapper, not the whole editor, takes
the horizontal scroll (`src/components/Editor/MilkdownEditor.css`).

## Toast

- `fixed; right: 20px; bottom: 20px;` z-index per the table in `31-design-tokens.md`.
- One toast at a time. Replace, don't stack — pairs with rule 30
  "one signal per surface".

## Animations

- Keep short and functional (modal entry: 0.1s fade + 2px translateY).
- Don't transition theme-related properties — they cause flickers
  during theme switch.
- Colours change instantly; only `transform` and `opacity` transition
  (DR12). Every duration comes from the motion tokens
  (`--motion-duration-fast`), and one
  `@media (prefers-reduced-motion: reduce)` block in `globals.css` zeroes
  them. Progress spinners keep rotating: their keyframes are not on the
  token (DR13).

## Scrollbars

mdpro uses platform-default scrollbars. The only exception is the
tab-bar horizontal scroller (`.tab-bar__scroll-container`), which hides
its own scrollbar with `scrollbar-width: none`.
