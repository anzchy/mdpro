---
description: UI consistency index — six universal discipline rules, pointers to detailed design rules 31-34.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
---

# 30 — UI Consistency

> Index. Detailed specs in `31-design-tokens.md`, `32-component-patterns.md`,
> `33-focus-indicators.md`, `34-dark-theme.md`. Aspirational register in
> `DESIGN.md` at the repo root.

## Core principles

- Preserve established patterns and visual language. Prefer incremental
  adjustments over redesigns unless the user asks.
- Cross-mode parity: WYSIWYG (Milkdown), Source (CodeMirror 6), and Preview
  must feel like one product. Same fonts, same colors, same spacing scale,
  same selection / highlight behavior unless there's a reason.
- Tokens first. See `31-design-tokens.md`. Hardcoded colors are a review
  finding; pixel literals are allowed only for the explicit exception list
  in `31-design-tokens.md` § "Acceptable hardcoded values" (1-2px borders,
  focus geometry, `50%` circles, keyframe percentages, `var()` fallbacks).
- Visible keyboard focus. See `33-focus-indicators.md`. Removing
  `outline` without a replacement is a WCAG violation, not a style choice.
- Light + dark parity. See `34-dark-theme.md`. Test both themes before commit.

## Universal discipline rules (apply to every UI surface)

These five rules govern user-facing behavior, not specific components. They
are review-blocking.

1. **One primary action per surface.** One `solid` button / one `is-active`
   tab / one default-focused input. Two equally-prominent actions split
   user attention and lose both.
2. **Render-if-nonzero.** `0 unsaved · 0 KB · …` never ships. Filter
   zero-value fields out before joining strings; conditionally render
   metadata badges; collapse empty groups.
3. **No internal identifiers in primary UI.** Document IDs, `nanoid`s,
   absolute paths, hashes, and Tauri scheme URLs belong behind a
   disclosure (`<details>`), tooltip, or `<DevBadge>` — never on a row that
   normal users read.
4. **Disabled buttons state a reason inline.** A grayed button is unhelpful
   without context. Place the reason next to the button (`Save (no changes)`),
   not in a tooltip the user has to discover.
5. **One signal per surface for a single event.** A given event fires
   exactly one of: toast, banner, inline note, modal. Never two. No status
   spray.
6. **Never use `window.confirm` / `alert` / `prompt`.** They are
   unreliable in Tauri webviews and unstyleable. Use the dialog primitives
   (`.dialog-card`, `LinkInsertModal` shell). See `32-component-patterns.md`.

Together with project rule `25-careful-mode.md` (destructive shell ops),
these cover the user-facing UX safety floor.

## Quick reference

| Need | Where |
|---|---|
| Color / spacing / radius / shadow tokens | `31-design-tokens.md` |
| Popup / modal / context-menu / button patterns | `32-component-patterns.md` |
| Keyboard focus indicators (4 patterns) | `33-focus-indicators.md` |
| Light/dark theme conventions | `34-dark-theme.md` |
| Aesthetic register, "memorable thing" | `DESIGN.md` |
| Keyboard shortcut sync (3 files) | `41-keyboard-shortcuts.md` |
| Logging conventions for new features | `20-logging-and-docs.md` |

## Visual QA before commit

When you change CSS or add a new visual surface:

1. Open the affected screen in `pnpm tauri dev` in **both** `theme-light`
   and `theme-dark`.
2. Tab through every new interactive element. Focus must be visible at
   every stop.
3. If you touched the editor or the markdown renderer, render a
   representative document (headings H1–H6, lists, blockquotes, code,
   tables, images, links) and check both themes. Keep a fixture document
   in `tests/fixtures/` for this purpose.
4. Verify color contrast on any new text/background pair. WCAG AA:
   4.5:1 for body text, 3:1 for ≥18px or bold ≥14px.
