---
description: Dark/light theme convention — `.theme-light` / `.theme-dark` class, when to override, canonical visual-QA checklist.
paths:
  - "src/**/*.css"
  - "src/App.tsx"
  - "src/main.tsx"
---

# 34 — Dark Theme

All styling must work in both themes.

## Theme detection

mdpro toggles **`.theme-light`** / **`.theme-dark`** on the `<html>`
element in `App.tsx`. Token file locations: `31-design-tokens.md`.

| Selector | Status |
|---|---|
| `.theme-light` / `.theme-dark` | **Use these** |
| `[data-theme]` | Don't use — different convention; would force migrating App.tsx |
| `@media (prefers-color-scheme: dark)` | Limited — only in `App.css` for the pre-React paint flash |

`prefers-color-scheme` is honored at the **preference resolution
layer** (`preferencesService.ts`) when the user picks "system"; the
class on `<html>` is still `.theme-light` / `.theme-dark`.

## When overrides are needed

Most cases need **no override** — tokens swap automatically:

```css
.component {
  background: var(--color-bg);
  color: var(--color-text);
  border-color: var(--color-border);
}
```

Override only when:
1. You use raw `rgba()` for translucency and the source color must
   change (light: black-with-alpha, dark: white-with-alpha).
2. A specific effect needs different opacity for readability against
   a dark background.
3. No token exists for the case — **add the token to both theme files
   first** (rule 31), then reference it.

## Translucent surface pattern

Prefer `color-mix()` with `var(--color-text)` over raw rgba:

```css
.row:hover { background: color-mix(in srgb, var(--color-text) 5%, transparent); }
```

This adapts naturally to both themes. Only fall back to per-theme rgba
when `color-mix()` won't work.

## Inverted text

**Use `var(--color-panel)`, not `color: white`, for text on an active
accent fill.** `white` breaks when the panel is light.

## Testing requirements

Before committing CSS:
1. **Both themes.** Open the affected screen in `pnpm tauri dev` and
   toggle. Don't ship CSS based on only-one-theme testing.
2. **Reference document.** Render a sample with the full register
   (headings, lists, blockquotes, code, tables, images, links).
3. **Contrast ratios** (WCAG AA): body text 4.5:1, large text (≥18px or
   bold ≥14px) 3:1. Accent on panel must clear 3:1 for buttons,
   4.5:1 for accent text.
4. **Focus indicators.** Re-test after dark-theme changes (rule 33).
5. **Theme switch flicker.** mdpro deliberately doesn't transition
   theme-related properties — verify the swap is clean.
