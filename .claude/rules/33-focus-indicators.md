---
description: Keyboard focus indicator contracts — four patterns, WCAG requirements, never remove without replacement.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
---

# 33 — Focus Indicators

Keyboard focus must ALWAYS be visible. Removing `outline` without a
replacement is a WCAG violation, not a style choice.

mdpro uses **four** focus patterns. Pick the one that matches the
surface; don't invent a fifth.

| # | Pattern | Used by | Spec |
|---|---|---|---|
| 1 | **Border + soft ring** | text inputs in modals, settings, link/table insert | `border-color: var(--color-accent); box-shadow: 0 0 0 2px var(--color-accent-soft);` (and `outline: none` is allowed *because* the ring is the replacement) |
| 2 | **Outline** | toolbar buttons, popover menu items, primary buttons | `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` |
| 3 | **Background highlight** | sidebar rows, tabs, TOC entries, recent dropdown, settings categories | `:focus-visible { background: var(--color-accent-soft); }` (selected items add a border or text-color change so focus and selection are distinguishable) |
| 4 | **Editor content widget** | image resize handles, embedded controls inside contenteditable | Each widget defines its own `:focus-visible` — global resets don't reach inside ProseMirror |

## Hard rules

1. **Never remove focus without a replacement.** `outline: none` is
   only valid when paired with a visible substitute (border + ring).
2. **Never apply `outline: none` globally.**
3. **Don't combine three indicators** (outline + border + box-shadow on
   the same element looks accidental — pick one pattern).
4. **Test in both themes.** Focus visibility on `#2563eb` against
   `#ffffff` is not the same as `#60a5fa` against `#0f1115`.
5. **Focus must work without color alone.** All four patterns are
   shape changes (ring, outline, background) — colorblind users can
   perceive them. Never rely solely on a `color:` change.
6. **Use `:focus-visible`, not `:focus`** for new code. Mouse clicks
   shouldn't paint focus rings on buttons; keyboard tabbing should.
   `:focus` is acceptable on text inputs (typing = "I want focus visible").

## Common violations

- `:focus { outline: none; }` with no replacement.
- Focus indicated only by `color:` change — fails for colorblind users.
- Subtle opacity tweak as the focus signal (`opacity: 0.95`).
- Tooltip-only feedback that relies on `title` attribute.

## Testing checklist

- [ ] Tab through every interactive element in the affected screen.
- [ ] Focus visible at every stop in light **and** dark theme.
- [ ] DOM order ≈ visual order (focus order is logical).
- [ ] Modal: Tab and Shift-Tab loop within; Esc returns focus to invocation source.
- [ ] Focus visibility holds at 200% browser zoom.

mdpro has tests for focus traps in `tests/focus-trap.test.ts`. New
interactive primitives must add equivalent coverage.
