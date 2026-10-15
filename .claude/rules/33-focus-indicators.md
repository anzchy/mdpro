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
| 2 | **Outline** | toolbar buttons, popover menu items, primary buttons | `:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }`. `--color-focus-ring` is declared in `:root` as `var(--color-accent)`, so it follows the theme and stays at 3:1 or better (DR15) |
| 3 | **Background highlight** | sidebar rows, tabs, TOC entries, settings categories | `:focus-visible { background: var(--color-accent-soft); }` (selected items add a border or text-color change so focus and selection are distinguishable). TOC rows also add an inset ring: `outline: 2px solid var(--color-focus-ring); outline-offset: -2px;`. Focus lands on the row's link, so the row matches `:has(.toc-entry__link:focus-visible)` and the link draws no ring of its own |
| 4 | **Editor content widget** | image resize handles, embedded controls inside contenteditable | Each widget defines its own `:focus-visible` — global resets don't reach inside ProseMirror |

## Hard rules

1. **Never remove focus without a replacement.** `outline: none` is
   only valid when paired with a visible substitute (border + ring).
2. **Never apply `outline: none` globally.**
3. **Don't combine three indicators** (outline + border + box-shadow on
   the same element looks accidental — pick one pattern).
4. **Test in both themes**: the accent changes from `#2563eb` to `#60a5fa`.
5. **Focus must work without color alone.** All four patterns are
   shape changes (ring, outline, background) — colorblind users can
   perceive them. Never rely solely on a `color:` change. An opacity
   tweak (`opacity: 0.95`) or a `title` tooltip is not a focus signal either.
6. **Use `:focus-visible`, not `:focus`** for new code. Mouse clicks
   shouldn't paint focus rings on buttons; keyboard tabbing should.
   `:focus` is acceptable on text inputs (typing = "I want focus visible").

## Testing checklist

- [ ] Tab through every interactive element in the affected screen.
- [ ] Focus visible at every stop in light **and** dark theme.
- [ ] DOM order ≈ visual order (focus order is logical).
- [ ] Modal: Tab and Shift-Tab loop within; Esc returns focus to invocation source.
- [ ] Focus visibility holds at the 400×640 minimum window and with `zoom: 2` on `<html>` in Web Inspector.

`tests/focus-trap.test.ts` matches component source text: dialogs handle
Escape, primary buttons carry `autoFocus` (except `ConfirmDialog`,
`ReloadDialog` and `McpWriteConfirmDialog`, which focus on open through
`useVisibleInitialFocus` — `focus({ focusVisible: true })` — instead, because
WebKit draws no ring for autofocus after a mouse interaction — D53, D63),
`RecoveryDialog` has no Escape
close, and `DevToolbar` is out of tab order (`tabIndex={-1}`). It does not
test Tab-loop trapping, so verify that by hand. New dialogs must add
equivalent assertions.
