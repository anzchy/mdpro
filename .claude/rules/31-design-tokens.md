---
description: Design token authoring rules — names, theme parity, exception list for hardcoded literals.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
  - "src/styles/**/*"
---

# 31 — Design Tokens

CSS custom properties live in three files (single source of truth — do not
redeclare token names elsewhere):

- `src/styles/globals.css` — `:root` defaults
- `src/styles/themes/light.css` — `.theme-light` overrides
- `src/styles/themes/dark.css` — `.theme-dark` overrides

For the actual token values, **read those files**. Don't mirror them
here — the doc would silently rot.

See `DESIGN.md` for token rationale, color taxonomy narrative, and
the in-progress migration list.

## Authoring rules

1. **Add to both theme files in the same commit.** Light-only or
   dark-only is a review finding — the missing override is a silent break.
2. **Semantic names**, not value names. `--color-accent-soft` not
   `--blue-100`. Tokens must survive a rebrand.
3. **Use `color-mix()` for soft variants** when the value derives from a
   base accent. Reskinning then stays local to the base.
4. **Update `DESIGN.md` when adding a token.** Tokens without doc
   entries are invisible to future readers.
5. **No component-local token leaks.** If `.foo { --bar: 4px; }` declares
   a token, only `.foo` and descendants may consume it. Cross-component
   reuse → promote to a global token.

## Selection / active-state pattern

```css
.item.is-active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
```

## Frame ownership for nested containers

Wrapper owns the frame (background, border, radius). Children stay
flat. Applies to: code blocks, table scroll wrappers, image-resize
wrappers, future callout containers.

```css
.code-block-wrapper { background: var(--color-code-bg); border: 1px solid var(--color-border); border-radius: 8px; }
.code-block-wrapper pre { background: transparent; border: none; border-radius: 0; }
```

## Acceptable hardcoded values (do not tokenize)

- `0.5px` retina sub-pixel borders
- `1px` and `2px` borders, dividers, focus underlines
- `3px` fine positioning offsets
- Focus indicator geometry (`bottom: 2px; left: 4px;` on `::after`)
- `0`, `auto`, `inherit`, `initial`, `unset`, `none`
- `50%` for circles
- Animation keyframe percentages
- `transform: scale()/translate()` arithmetic
- `rgba()` lines that precede `color-mix()` lines (browser fallback)
- Defensive `var(--xyz, #fallback)` fallbacks

Spacing literals from the ad-hoc scale (4 / 6 / 8 / 12 / 16 / 20 /
24 / 32 / 40px) are also acceptable. Don't introduce a primitive
`--space-N` scale until the same value appears in 3+ unrelated places
(rule of three). The same `4px` may be a `padding`, a `gap`, a
`top:` offset, or a `border-width` — match property to purpose, don't
substitute by value.

## Z-index hierarchy

Pin every floating surface to one of these layers. New layers must
update this table in the same commit.

| Layer | z-index | Used by |
|---|---|---|
| Base | `auto` | Editor, sidebar, split divider |
| Recent dropdown | `10` | `.toolbar-recent-list` |
| Dialog backdrop | `20` | `.dialog-backdrop` |
| Toast | `30` | `.toast` |
| Dev toolbar (web only) | `100` | `.dev-toolbar` |
| Inline context menu | `1000` | `.image-context-menu`, `.table-context-menu` (planned) |
| Future portaled modal | `9999` | (reserved) |

## Layout tokens (runtime-toggled)

Only three tokens change at runtime: `--editor-font-family`,
`--editor-font-size`, `--editor-line-height` (Settings dialog). UI
chrome (`--font-sans`) is fixed — never set `system-ui` /
`-apple-system` directly on a non-editor surface.

`--traffic-lights-end` and `--traffic-lights-clearance{,-main}` are
toggled by `body.tauri-macos` in `main.tsx`. Top-of-window chrome
must respect them or it collides with the macOS traffic-light buttons.
