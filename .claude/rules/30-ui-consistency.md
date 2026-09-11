---
description: UI consistency index — six universal discipline rules, pointers to detailed design rules 31-34.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
  - "src/plugins/**/*.ts"
---

# 30 — UI Consistency

> Index. Detailed specs in `31-design-tokens.md`, `32-component-patterns.md`,
> `33-focus-indicators.md`, `34-dark-theme.md`. Design register and decisions
> log: root `DESIGN.md`, an index into `docs/design/`.

## Core principles

- **Preserve established patterns and visual language.** Prefer incremental
  adjustments over redesigns unless the user asks; piecemeal restyling leaves
  surfaces that no longer match.
- **Keep cross-mode parity.** WYSIWYG (Milkdown), Source (CodeMirror 6), and
  Preview must feel like one product: same fonts, colors, spacing scale, and
  selection / highlight behavior unless there's a stated reason.

## Universal discipline rules (apply to every UI surface)

These six rules govern user-facing behavior, not specific components. They
are review-blocking.

1. **One primary action per surface.** One `solid` button / one `is-active`
   tab / one default-focused input. Two equally-prominent actions split
   user attention and lose both.
2. **Render-if-nonzero.** `0 unsaved · 0 KB · …` never ships. Filter
   zero-value fields out before joining strings; conditionally render
   metadata badges; collapse empty groups.
3. **No internal identifiers in primary UI.** Document IDs, `nanoid`s,
   absolute paths, hashes, and Tauri scheme URLs belong behind a
   disclosure (`<details>`) or tooltip — never on a row that normal
   users read.
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
