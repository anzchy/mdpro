---
description: Design token authoring rules — names, theme parity, exception list for hardcoded literals, z-index layers, runtime layout tokens.
paths:
  - "src/**/*.css"
  - "src/App.tsx"
  - "src/main.tsx"
---

# 31 — Design Tokens

CSS custom properties live in three files (single source of truth — do not
redeclare token names elsewhere):

- `src/styles/globals.css` — `:root` defaults
- `src/styles/themes/light.css` — `.theme-light` overrides
- `src/styles/themes/dark.css` — `.theme-dark` overrides

For the actual token values, **read those files**. Don't mirror them
here — the doc would silently rot.

Token rationale and the decisions log live in the design doc that root
`DESIGN.md` marks as current (today `docs/design/mdpro-ui-old/DESIGN.md`).

## Authoring rules

1. **Add to both theme files in the same commit.** Light-only or
   dark-only is a review finding — the missing override is a silent break.
2. **Semantic names**, not value names. `--color-accent-soft` not
   `--blue-100`. Tokens must survive a rebrand.
3. **Use `color-mix()` for soft variants** when the value derives from a
   base accent. Reskinning then stays local to the base.
4. **Log a new token in the current design doc's decisions log.** Tokens
   without doc entries are invisible to future readers.
5. **No component-local token leaks.** If `.foo { --bar: 4px; }` declares
   a token, only `.foo` and descendants may consume it. Cross-component
   reuse → promote to a global token.

## Frame ownership for nested containers

Wrapper owns the frame (background, border, radius, outer margin). Children
stay flat. Example: `.tableWrapper` owns the scroll and bottom margin, and
`.tableWrapper > table` sets `margin: 0` (`MilkdownEditor.css`). Code blocks
have no wrapper today: `pre` owns the frame in `MilkdownEditor.css`. Adding
a wrapper means moving the frame onto it.

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
| Inline context menu | `1000` | `.image-context-menu`, `.table-context-menu` |
| Future portaled modal | `9999` | (reserved) |

## Layout tokens (runtime-toggled)

Only four tokens change at runtime: `--editor-font-family`,
`--editor-font-size`, `--editor-line-height`, `--editor-content-width`
(Settings dialog, via `src/components/common/settings/editorPrefApply.ts`). UI
chrome (`--font-sans`) is fixed — never set `system-ui` /
`-apple-system` directly on a non-editor surface.

`--traffic-lights-end` and `--traffic-lights-clearance{,-main}` are
toggled by `body.tauri-macos` in `main.tsx`. Top-of-window chrome
must respect them or it collides with the macOS traffic-light buttons.
