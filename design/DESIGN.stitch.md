---
name: mdpro — Quiet paper, command surface
colors:
  background: '#ffffff'
  surface: '#f6f7fb'
  surface-panel: '#ffffff'
  editor-background: '#ffffff'
  on-surface: '#1a1a1a'
  on-surface-muted: '#6b7280'
  primary: '#2563eb'
  on-primary: '#ffffff'
  primary-soft: '#2563eb24'
  primary-text: '#2354c1'
  primary-fill: '#2563eb'
  primary-fill-hover: '#245ad2'
  hover: '#1a1a1a0d'
  outline: '#1a1a1a1a'
  outline-subtle: '#1a1a1a0f'
  control-outline: '#1a1a1a80'
  error: '#dc2626'
  error-soft: '#dc26261f'
  error-text: '#b91c1c'
  code-surface: '#f1f1f1'
  highlight: '#ff5582a6'
  scrim: '#0f172a59'
colors-dark:
  background: '#0f1115'
  surface: '#161a22'
  surface-panel: '#141821'
  editor-background: '#0f1115'
  on-surface: '#e5e7eb'
  on-surface-muted: '#9aa4b2'
  primary: '#60a5fa'
  on-primary: '#ffffff'
  primary-soft: '#60a5fa38'
  primary-text: '#60a5fa'
  primary-fill: '#1d4ed8'
  primary-fill-hover: '#1a45be'
  hover: '#e5e7eb14'
  outline: '#e5e7eb1f'
  outline-subtle: '#e5e7eb12'
  control-outline: '#e5e7eb80'
  error: '#f87171'
  error-soft: '#f871712e'
  error-text: '#f87171'
  code-surface: '#1c1e22'
  highlight: '#ff558266'
  scrim: '#0f172a59'
typography:
  ui-sm:
    fontFamily: SF Pro Text
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: '0'
  ui:
    fontFamily: SF Pro Text
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: '0'
  ui-lg:
    fontFamily: SF Pro Text
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: '0'
  title:
    fontFamily: SF Pro Text
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: '0'
  section-label:
    fontFamily: SF Pro Text
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  value-mono:
    fontFamily: SF Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: '0'
  editor-body:
    fontFamily: SF Pro Text
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: '0'
rounded:
  inner: 4px
  DEFAULT: 6px
  popover: 10px
  full: 999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  title-bar-height: 38px
  sidebar-width: 220px
---

# Design System: mdpro

Written for Stitch from mdpro's `design/DESIGN.md` (the target design) and
the app's resolved CSS tokens. `colors:` is the light theme and
`colors-dark:` the dark theme, with the same keys; Stitch is only known to
read `colors:`. Translucent colours keep their alpha, as 8-digit hex.

The front matter is generated (D278): never edit it by hand. Regenerate it
with `MDPRO_WRITE_SIDECAR=1 pnpm exec vitest run
tests/design-token-parity.test.ts`; without the variable that test fails
when it is stale. The prose below is hand-written. The repo's DESIGN.md wins
any conflict.

## Brand & Style

mdpro is a local Markdown editor for macOS for writers who treat plain
Markdown as the real file. Its memorable thing: **it respects the file.** What
you type is what gets saved; no proprietary syntax, no hidden state.

The register is **Quiet paper in a command-surface structure**: native macOS
calm, hairlines instead of boxes, one accent, one elevation. The chrome stays
quiet enough to read past; the writing comes first.

## Colors

- **One accent, Cobalt (#2563eb)**, is the only hue in the chrome: selection,
  focus rings, primary buttons, switches, links. Dark theme uses Sky
  (#60a5fa) for text and a deeper Cobalt (#1d4ed8) as the button fill.
- **Cool neutrals**: white editor, a faint blue-grey surface (#f6f7fb) for
  the sidebar and tab bar, near-black text (#1a1a1a), slate muted text.
- **Hairlines, hover fills and the code surface are mixed from the text
  color**, so they stay neutral and track the theme.
- **Danger red** only on destructive buttons and errors. Green means success
  only. No second syntax hue, no gradients.

## Typography

SF Pro Text for all chrome, with three steps: 12px (tabs, status strip,
descriptions, section labels), 13px (rows, menus, buttons, inputs) and 14px
semibold (dialog titles), plus 16px for settings page titles and the About
app name (DR22). 12px is the floor. SF Mono only for values:
numbers, shortcuts, the status strip's values, Source mode. The editor body
uses the user's font and size.

## Layout & Spacing

- **Window**: sidebar (220px default, 180–480 resizable) on the surface
  color with a hairline right edge, and traffic lights in its top strip.
  The main column has a 38px **main bar** (breadcrumb `folder / file.md` on
  the left; a **Source | WYSIWYG segmented control** on the right), the
  editor, and a one-line **status strip** (cursor, word count, encoding, line
  endings). A full-width **bottom tab bar** sits under everything; its first
  control is the sidebar toggle, then "+", then the tabs.
- Ad-hoc 4–24px spacing; rows ~28–32px tall. Dense but calm.

## Elevation & Depth

One shadow only: a 0.5px hairline ring plus a faint 8/24 blur. It's used for
menus, dialogs and toasts; the active tab takes a fill instead (D231). Elevated surfaces carry no
separate border. A dialog backdrop is a slate scrim at 35%.

## Shapes

6px for controls (buttons, inputs, segmented control, hover fills); 10px for
floating surfaces (menus, dialogs, toasts); 4px for parts nested inside them
(menu items, segments). Rows and tabs stay flat: no border or card at rest.

## Components

- **Buttons**: primary = accent fill + white label; secondary = panel fill +
  hairline; danger = red, never focused by default. Cancel left, confirm
  right.
- **Segmented control**: two segments in a hairline track; the selected
  segment takes the hover fill, not the accent.
- **Switch**: accent track when on; knob slides.
- **Menus**: grouped with small caps-style group labels and hairline
  separators; the hovered item takes the solid accent with a white label.
- **TOC rows**: flat; the active heading gets accent-soft fill + accent text.
- **Toasts**: small floating card (10px radius) at bottom, one line, optional
  icon; error variant in danger.
- **Dialogs**: centered card (10px radius) over the scrim: title, one message line, actions right.

## Do's and Don'ts

- Do: hairlines, one accent, instant color changes (no color transitions),
  native macOS feel, both light and dark.
- Don't: card grids, icon-in-circle decoration, purple gradients, emoji as
  design, marketing copy, translucent sidebars, a command palette, black
  primary buttons, a second syntax color.
