---
description: Component contracts (modal, context menu, button, toast) — ARIA, focus, single-source-of-truth file.
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

- Use `.dialog-backdrop` + `.dialog-card` from `globals.css`. Never use
  `window.confirm` / `alert` / `prompt` — they're unreliable in Tauri
  webviews and unstyleable.
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (title) +
  `aria-describedby` (subtitle / live message).
- Focus trap (`useFocusTrap`). First-focused element is the
  most-likely-edited control, not title/cancel.
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
- Disabled buttons must state the reason inline (`Save (no changes)`),
  not in a tooltip.
- Two variants exist (`.toolbar-button--primary` and `.toolbar-button.primary`)
  — pick either; flag inconsistency in PR review when touching adjacent code.

## Form input

Focus ring is `border-color: var(--color-accent)` + `box-shadow: 0 0 0 2px var(--color-accent-soft)`.
Both pieces required — drop the ring and you've broken accessibility
(see `33-focus-indicators.md`).

## Tab bar

- `min-width: 80px; max-width: 180px;` with truncation.
- Active tab uses `--color-panel` background + subtle shadow.
- Dirty indicator: italic title + `•` (`--color-accent`).
- Close button: opacity 0 by default, opacity 1 on `.tab:hover` or `.tab--active`.

## Code block

Wrapper owns frame (see `31-design-tokens.md` § "Frame ownership").
Inline `code` reuses `--color-code-bg` directly without a wrapper.

## Table (rendered Markdown)

Wide tables that exceed `--editor-content-width` need a horizontal
scroll wrapper:
```css
.table-scroll-container { overflow-x: auto; max-width: 100%; }
.table-scroll-container table { width: max-content; min-width: 100%; }
```
Never set `overflow-x: hidden` on a table ancestor without a scroll wrapper.

## Toast

- `fixed; right: 20px; bottom: 20px;` z-index `30`.
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
