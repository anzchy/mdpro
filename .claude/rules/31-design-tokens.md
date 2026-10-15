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
While the UI redesign is in progress, its new and redefined tokens are
logged in `docs/design/mdpro-ui-new/DESIGN.md` § Tokens instead; any other
token still goes to the current doc (DR14; plan P WI-5.5 removes this
clause).

## Redesign tokens (plan P)

Declared once in `globals.css :root`, because today they have the same value
in both themes. Roles are in the new design doc's § Tokens.

- `--color-on-accent`: text and knobs on an accent fill (R2)
- `--color-scrim`: the dialog backdrop (R6; one use, a user override of the
  rule of three)
- `--font-size-ui-sm`, `--font-size-ui`, `--font-size-ui-lg`: the chrome type
  ramp
- `--radius-inner`, `--radius-control`, `--radius-popover`: the chrome radii
  (DR23)
- `--motion-duration-fast`: hover-reveal opacity transitions (DR12)

Per theme (both theme files, with a light copy in `:root`, Q2), derived
from `--color-text` by `color-mix()` (WI-3.1):

- `--color-border`: redefined as a text mix — hairlines and control edges
- `--color-border-subtle`: row dividers, dialog header/footer, rail edge
- `--color-hover`: hover fill for rows, tabs and icon buttons
- `--shadow-soft`: now per theme, a hairline ring plus one faint shadow.
  A surface that uses it takes no separate `border`: the ring is the edge
  (DESIGN.md:123; `tests/colors-wi32.test.ts`, WI-3.2)

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

`tests/css-tokenization.test.ts` enforces this list, the z-index table below
and its own exception and deferred lists (plan P WI-2.1).

- `0.5px` retina sub-pixel borders
- `1px` and `2px` borders, dividers, focus underlines
- `3px` fine positioning offsets
- Focus indicator geometry (`bottom: 2px; left: 4px;` on `::after`)
- `0`, `auto`, `inherit`, `initial`, `unset`, `none`
- `50%` for circles
- `999px` for pills (DR23)
- Animation keyframe percentages
- `transform: scale()/translate()` arithmetic
- `rgba()` lines that precede `color-mix()` lines (browser fallback)
- Defensive `var(--xyz, #fallback)` fallbacks, when `--xyz` is declared
  (an undeclared token's fallback is what renders, so it is a literal)

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
| Dialog backdrop | `20` | `.dialog-backdrop` |
| Toast | `30` | `.toast` |
| ~~Dev toolbar (web only)~~ | ~~`100`~~ | none: `.dev-toolbar` was removed in `1703dbb` (2026-10-07) |
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
