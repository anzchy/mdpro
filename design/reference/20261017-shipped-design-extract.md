---
name: mdpro
source: extracted from src/styles/, src/components/**/*.css, src/plugins/**/*.css at master 0bd1f1b1 (2026-10-17)
colors:
  # light theme (src/styles/themes/light.css)
  background: '#ffffff'
  surface: '#f6f7fb'
  panel: '#ffffff'
  on-surface: '#1a1a1a'
  on-surface-variant: '#6b7280'
  surface-tertiary: '#eeeff3'
  primary: '#2563eb'
  primary-fill: '#2563eb'
  on-primary: '#ffffff'
  error: '#dc2626'
  editor-background: '#ffffff'
  scrim: 'rgba(15, 23, 42, 0.35)'
colors-dark:
  # dark theme (src/styles/themes/dark.css)
  background: '#0f1115'
  surface: '#161a22'
  panel: '#141821'
  on-surface: '#e5e7eb'
  on-surface-variant: '#9aa4b2'
  surface-tertiary: '#1e2330'
  primary: '#60a5fa'
  primary-fill: '#1d4ed8'
  tab-active-accent: '#93c5fd'
  on-primary: '#ffffff'
  error: '#f87171'
  editor-background: '#0f1115'
  scrim: 'rgba(15, 23, 42, 0.35)'
typography:
  ui-font: '"SF Pro Text", "Avenir Next", "Helvetica Neue", sans-serif'
  mono-font: '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
  editor-font-default: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ui-sm: 12px
  ui: 13px
  ui-lg: 14px
  title: 16px
  editor-size-default: 16px
  editor-line-height-default: 1.6
radius:
  inner: 4px
  control: 6px
  popover: 10px
motion:
  duration-fast: 150ms
---

# Design System: mdpro (as shipped)

> Extracted from the code, not from the design docs. It describes what the
> app renders on `master` today. The target design is
> `design/DESIGN.md`; the differences are in
> [`20261017-css-drift-report.md`](20261017-css-drift-report.md).

## 1. Visual Theme & Atmosphere

A quiet, paper-like writing surface in a native macOS frame. The chrome is
cool-neutral and nearly colourless: hairlines are the text colour mixed down to
6–12 %, hover is the text colour at 5–8 %, and one elevation (a 0.5px ring
plus one soft 24px shadow) serves every floating surface. The only hue in the
chrome is a single blue accent, used for selection, focus and the primary
button.

Density is that of a Mac utility rather than a web app: 12–14px chrome
type, a 38px title bar, a 36px bottom tab strip, and a 780px reading column
with 40px gutters. The editor text itself belongs to the user: font,
size and line height are set in Settings, and the chrome never overrides them.

## 2. Color Palette & Roles

### Primary Foundation
- **Paper White** `#ffffff` / **Ink Night** `#0f1115` — window and editor background.
- **Cool Mist** `#f6f7fb` / **Slate Deep** `#161a22` — sidebar, bottom tabs, settings rail (`--color-surface`).
- **Panel** `#ffffff` / `#141821` — dialogs, menus, cards (`--color-panel`).
- **Code Wash** — editor background mixed 6 % toward the text colour (`--color-code-bg`, neutral by ADR-0110).

### Accent & Interactive
- **Signal Blue** `#2563eb` / **Sky Blue** `#60a5fa` — the one accent: focus ring (solid, DR15), links, selection, active markers.
- **Accent Wash** — accent at 14 % (light) / 22 % (dark): selected rows and the active TOC entry.
- **Accent Text** — accent mixed 80 % with the text colour in light; the accent itself in dark (D222, ≥ 4.5:1 on the wash).
- **Primary Fill** `#2563eb` / **Deep Cobalt** `#1d4ed8` — primary button under white text; dark is deeper so white reads (D222).
- **Active Tab Fill** — text 16 % (light) / 30 % (dark) over the surface, with a `#93c5fd` ring in dark (D231).

### Typography & Text Hierarchy
- **Ink** `#1a1a1a` / **Fog White** `#e5e7eb` — body and labels.
- **Muted Slate** `#6b7280` / **Cool Gray** `#9aa4b2` — secondary text, link targets, descriptions.
- Two tiers only; a third tier is an open question in the target design.

### Functional States
- **Danger** `#dc2626` / `#f87171`, with a 12 % / 18 % wash — destructive buttons, errors.
- **Control Edge** — text at 50 % for inputs, selects and steppers (D227, ≥ 3:1).
- **Hairline / Subtle Hairline / Hover** — text at 10/6/5 % (light), 12/7/8 % (dark).
- Off-palette literals still in use: MCP "running" badge green `#dcfce7`/`#16a34a`, shortcut-conflict banner amber `rgba(245,158,11,…)`, highlight mark pink `rgba(255,85,130,0.65)`, switch off-track `#ccc` (an accepted A9 exception, ADR-0106).

## 3. Typography Rules

### Hierarchy & Weights
- **Chrome** uses `--font-sans` (SF Pro Text) on a four-step ramp: 12 (tabs, status, descriptions, section labels), 13 (rows, menus, buttons, inputs), 14 (dialog titles), 16 (settings page title, About name).
- **Values** — numbers, shortcuts, tokens, file paths — use `--font-mono` (SF Mono).
- **Editor (WYSIWYG)** uses the user's `--editor-font-family` at `--editor-font-size` / `--editor-line-height` (default 16px / 1.6). Headings scale in `em` (2, 1.5, 1.25, 1.1) so they follow the user's size.
- **Source mode** uses the same editor font today; there is no separate mono default yet.

### Spacing Principles
- 12px is the chrome floor in the target design. Five chrome sites still go below it (10px TOC caret and tab indicators, 11px settings section title and MCP copy button).
- Section labels: 11px, uppercase, 0.08em tracking.

## 4. Component Stylings

### Buttons
- 6px radius (`--radius-control`). Primary: accent fill, white label, darker fill on hover. Secondary: hairline edge on the panel. Danger: red label, red wash on hover.
- No colour transitions: hover and press change colour instantly (DR12).

### Cards & Floating Surfaces
- Menus, dialogs and toasts: 10px radius (`--radius-popover`), panel background, `--shadow-soft` as both border and elevation — no extra border.
- Nested parts (segment buttons, menu items, tab close, stepper buttons): 4px (`--radius-inner`).
- Dialog backdrop: slate scrim at 35 %.

### Navigation
- **Sidebar (TOC):** surface background, hairline right edge, flat rows that show a 6px-radius fill only on hover or selection; active row in accent wash with accent text. User-resizable 180–480px, default 220.
- **Bottom tabs:** full width, 36px, on the surface; the sidebar toggle is the first control; the active tab is filled (D231); close button revealed by opacity on hover.
- **Settings rail:** icons at 19px with labels, flat items.

### Inputs & Forms
- 1px `--color-control-border` edge, 6px radius, 13px text, solid accent focus ring (2px outline, 2px offset).
- Switch: pill track, white knob that slides with `transform` over 150ms.

### Domain-Specific Components
- **Code blocks:** neutral code wash, 12px padding, 8px radius (a literal, not a token).
- **Highlight mark (`==text==`):** translucent pink with a 4px radius.
- **MCP status badge:** pill with green "running", neutral "off".

## 5. Layout Principles

### Grid & Structure
- Three panes: sidebar | main column | bottom tab strip across the full width.
- Reading column capped at 780px with 40px padding.
- Title bar 38px with macOS traffic-light clearances (78px) set at runtime.

### Whitespace Strategy
- Ad-hoc 4/6/8/12/16/40px values; no spacing scale by design (rule 31).

### Alignment & Visual Balance
- Left-aligned everywhere; the editor column is centred in the main pane.

### Responsive Behavior
- Desktop only, minimum window 400×640. The sidebar's rendered width yields so the main column keeps 320px.

## 6. Design System Notes for Stitch Generation

### Language to Use
"Native macOS document editor, quiet paper register, cool neutral grays,
hairline dividers, one blue accent, no cards, no gradients, no shadows except
a single soft popover shadow, 13px SF Pro chrome, generous reading column."

### Color References
Paper White `#ffffff`, Cool Mist `#f6f7fb`, Ink `#1a1a1a`, Muted Slate
`#6b7280`, Signal Blue `#2563eb`; dark: Ink Night `#0f1115`, Slate Deep
`#161a22`, Fog White `#e5e7eb`, Sky Blue `#60a5fa`.

### Component Prompts
1. "A macOS Markdown editor window: a 220px cool-gray sidebar listing document headings as flat rows, the active one tinted pale blue; a white centred 780px writing column; a 36px bottom strip of document tabs with the active tab filled light gray."
2. "A settings dialog with a 10px-radius white panel and a soft hairline shadow, a flat left rail of icon+label items, and grouped rows of label, description and a pill switch on the right."
3. "A context menu: 10px radius, 13px SF Pro items, solid blue highlight on hover, 4px inner radius on the highlight."

### Incremental Iteration
Change one surface at a time; keep the accent single and the chrome colourless.
