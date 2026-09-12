---
description: Component contracts (modal, context menu, button, toast, table) — ARIA, focus trap, single-source-of-truth file.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
---

# 32 — Component Patterns

Component contracts only. CSS examples live in the component's own
`.css` file or `globals.css`. See `DESIGN.md` for visual narrative.

## Single source of truth for styles

A component's styles live in **one** file. Do not redeclare them in
both `globals.css` and a co-located stylesheet — import order silently
picks a winner.

| Surface | File |
|---|---|
| App shell, sidebar, dialog backdrop, toast, settings | `src/styles/globals.css` |
| Milkdown editor surface | `src/components/Editor/MilkdownEditor.css` |
| Image context menu | `src/components/Editor/ImageContextMenu.css` |
| Link insert modal | `globals.css` (`.link-insert-*`) |
| Future per-component | co-locate as `Component.tsx` + `Component.css` |

## Modal contract

- Use `.dialog-backdrop` + `.dialog-card` from `globals.css`.
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (title) +
  `aria-describedby` (subtitle / live message).
- **Trap Tab inside the dialog with an inline `onKeyDown` loop.** No shared
  hook exists: collect focusable descendants, wrap Tab from last to first and
  Shift+Tab from first to last (`handleDialogKeyDown` in
  `src/components/common/SettingsDialog.tsx`; also
  `src/components/Editor/TableInsertModal/index.tsx`).
- First-focused element is the most-likely-edited control, not title/cancel.
- Esc closes (cancels). Enter from any input submits. Backdrop click
  cancels; `.dialog-card` click stops propagation.
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

- `min-width: 80px; max-width: 180px;` with truncation.
- Active tab uses `--color-panel` background + subtle shadow.
- Dirty indicator: italic title + `•` (`--color-accent`).
- Close button: opacity 0 by default, opacity 1 on `.tab:hover` or `.tab--active`.

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
- Wrap non-essential motion in `@media (prefers-reduced-motion: no-preference)`.

## Scrollbars

mdpro uses platform-default scrollbars. The only exception is the
tab-bar horizontal scroller (`.tab-bar__scroll-container`), which hides
its own scrollbar with `scrollbar-width: none`.
