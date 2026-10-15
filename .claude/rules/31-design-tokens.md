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
- `--font-size-title` (16px, WI-3.2): settings page titles and the About
  app name, the top of the ramp (DR22). Glyph sizes (×, +, ✓, ▸) are not
  text and stay off the ramp until WI-4.2
- `--radius-inner`, `--radius-control`, `--radius-popover`: the chrome radii
  (DR23)
- `--motion-duration-fast`: hover-reveal opacity transitions (DR12)
- `--color-focus-ring`: `var(--color-accent)`, so it follows the theme;
  rule 33 pattern 2 outlines and the TOC inset ring (DR15, WI-3.3)

Per theme (both theme files, with a light copy in `:root`, Q2), derived
from `--color-text` by `color-mix()` (WI-3.1):

- `--color-border`: redefined as a text mix — hairlines and control edges
- `--color-border-subtle`: row dividers, dialog header/footer, rail edge
- `--color-hover`: hover fill for rows, tabs and icon buttons
- `--shadow-soft`: now per theme, a hairline ring plus one faint shadow.
  A surface that uses it takes no separate `border`: the ring is the edge
  (DESIGN.md:123; `tests/colors-wi32.test.ts`, WI-3.2)
- `--color-code-bg`: the editor background mixed 94% with the text — the
  inline-code and code-block fill; neutral in both themes, so code surfaces
  no longer carry D4's cool cast (STOP 3 S2,
  [ADR-0110](../../docs/adr/0110-code-surfaces-take-the-neutral-derived-background.md))

Per theme, for text contrast on accent surfaces (D222, WI-3.3; ratios
measured in `tests/contrast-d222.test.ts`):

- `--color-accent-text`: selected-state text on `--color-accent-soft`
  (active TOC row, the shortcut being recorded). Light mixes the accent 80%
  with the text colour to reach 4.5:1; dark is the accent
- `--color-accent-fill`, `--color-accent-fill-hover`: the primary-button
  fill and hover under `--color-on-accent`. Light is the accent, hovering
  toward the text colour; dark is `#1d4ed8`, hovering toward black, because
  white on `#60a5fa` is 2.54:1

Per theme, for the edges of controls (D227, WI-3.5a; ratios in
`tests/contrast-stage3.test.ts`, usage in `tests/contrast-d227.test.ts`):

- `--color-control-border`: the edge of every form control (selects, text
  and number inputs, steppers, the Source find fields). The
  text colour at 50%, 3:1 or better on the panel; hairlines keep
  `--color-border`

Per theme, for the active document tab (D231, user rulings 2026-10-15:
「D231 c」, 「Active tab fill: 用方案6」, 「6c OK」; ratios in
`tests/d231-tab-active-contrast.test.ts`):

- `--color-tab-active-fill`: the active tab's fill, replacing its shadow
  lift. The text colour at 16% over the surface in light, 30% in dark
- `--color-tab-active-accent`: the active tab's × focus ring and unsaved
  dot. The accent in light; `#93c5fd` in dark, because the plain accent is
  2.81:1 on the dark fill
- `--tab-active-close-opacity`: the active tab's resting ×, `0.5` light and
  `0.6` dark, so it stays 3:1 or better on the fill

**Accepted A9 exceptions (D227, user rulings 2026-10-15):** the toggle's
`#ccc` off-track and its knob, the light danger label hovered, the
`.shortcut-value` edge and the `.grid-picker-cell` edge stay below A9. Don't
give them a new token without a new ruling; ratios and quotes are in
DESIGN.md § Tokens and
[ADR-0106](../../docs/adr/0106-five-control-colours-are-accepted-below-the-a9-contrast-line.md).

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

`--sidebar-width` is the fifth: `App.tsx` sets the user's stored width
inline on `.app-shell`, and the resize handle sets it during a drag (D189,
[ADR-0088](../../docs/adr/0088-the-sidebar-keeps-its-width-is-resizable-and-is-toggled-by-one-fixed-button.md)).

`--traffic-lights-end` and `--traffic-lights-clearance{,-main}` are
toggled by `body.tauri-macos` in `main.tsx`. Top-of-window chrome
must respect them or it collides with the macOS traffic-light buttons.
