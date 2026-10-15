# Manual Testing Guide: UI Redesign (Plan P)

Last updated: 2026-10-15

---

## Overview

Plan P ([`docs/plans/20260911-plan-ui-redesign.md`](../plans/20260911-plan-ui-redesign.md)) restyles mdpro
against [`docs/design/mdpro-ui-new/DESIGN.md`](../design/mdpro-ui-new/DESIGN.md) in stages. This guide is
the manual check for every surface a work item changes (assumption A11). It was created by WI-3.0, the
first Stage 3 work item; each later work item adds or updates its own section in the same commit.

- **Stages 1 and 2 (Deliverable A)** changed no computed style: the CSS split and the value-preserving
  tokens were checked by the computed-style capture alone (empty diff, 32 surfaces × 2 themes), so they
  have no manual steps here.
- **Stage 3 (Deliverable B)** changes rendered values on purpose. Each intended change is listed below
  with the surface to open and what should be different.

---

## 1. Prerequisites

- Run the app with `pnpm tauri dev` (E5). `pnpm dev` alone is enough for the computed-style capture, but
  WKWebView-only behaviour (native scrollbars, form controls, `color-scheme`) needs the Tauri window.
- Check every step in **both themes**: Theme › Light, then Theme › Dark.
- Fixtures live in `tests/manual-fixtures/`. Copy a fixture to a scratch folder and open the copy, never
  the committed original (CLAUDE.md § Manual test fixtures).
- Record each device run in `docs/test/` with the commit, the build and who ran each check.

---

## 2. WI-3.0 — `--color-border` used as a fill

**Visual change: none.** WI-3.0 classifies the five places that paint an area with `--color-border`
before WI-3.1 redefines that token as a translucent text mix (`tests/color-border-fills.test.ts`):

| Selector | Kind | What happens in Stage 3 |
|---|---|---|
| `.bottom-tabs__divider` | line | Follows WI-3.1's border change (DESIGN.md: hairlines and control edges) |
| `.column-resize-handle::after` (WYSIWYG tables) | line | Follows WI-3.1's border change |
| `.about-progress-bar::-webkit-progress-bar` | fill | Retargeted by WI-3.1, see § 3 |
| `.split-divider` | dead | Orphan; deleted with the TODOS.md dead-code entry |
| `.tab__close:hover` | dead | Rendered only by the dead `TabBar/`; deleted with the same entry |

Nothing to check by hand: the computed-style capture for this commit is an empty diff.

---

## 3. WI-3.1 — Theme token retune

Open each surface in both themes and compare with the previous build.

| # | Where | Expected |
|---|---|---|
| 3.1 | Any dialog or menu: Settings (⌘,), the table context menu, the image context menu, a toast | Border is a soft text-coloured hairline; the shadow is a thin ring plus one faint drop shadow, not the old wide blur |
| 3.2 | Bottom tab strip, settings rows, the TOC rail edge | Hairlines are slightly softer in light and slightly lighter in dark; none disappears |
| 3.3 | Source mode: select text; put the cursor in a table cell | Light: the selection and active-cell tint is a little lighter than before. Dark: unchanged |
| 3.4 | Dark theme, in the Tauri window: scroll a long document; open Settings › Editor | The native scrollbar and checkboxes are dark (`color-scheme: dark`). Light theme: light. **Device check, batched at STOP 3** |
| 3.5 | Light ↔ dark switch | Tokens swap at once; no surface keeps the other theme's border or shadow |
| 3.6 | Toolbar and settings buttons, inputs, the settings rail, the MCP client rows, the view-mode badge | Corners are 6px (`--radius-control`); before they were 8px, or 4px for inputs and the badge |
| 3.7 | Dialogs, Settings, menus, toasts, the shortcut and recovery groups, the MCP server box | Corners are 10px (`--radius-popover`); dialogs and Settings were 16px, toasts and groups 12px, menus 8px |
| 3.8 | Menu items, settings stepper buttons, the inline link editor, the table grid picker, the source-mode active cell, a link definition in WYSIWYG | Corners are 4px (`--radius-inner`). Grid-picker cells keep a whole border at 4px (checked on the capture, both themes) |
| 3.9 | Settings › Editor switches; the About progress bar while downloading | Fully round ends (`999px`); the progress bar is not reachable without an update download |

Computed-style evidence: `~/.mdpro-redesign/stage-3/index-wi31.md` (the browser harness renders every dark
settings surface with light tokens, because `SettingsDialog.tsx` puts its own theme class on the dialog
from the store; this is a harness artifact, not app behaviour, so check 3.1 in the Tauri window).

From the WI-3.0 rulings (delegator, 2026-10-15):

- **About progress-bar track → `--color-border-subtle`.** An intended change, by analogy with the Switch
  off-track ("a low text mix", DESIGN.md § Switch). Measured contrast, track on the settings dialog surface
  (`--color-panel`):

  | Theme | Track vs surface, before → after | Accent fill vs track, before → after |
  |---|---|---|
  | Light | 1.24 → 1.13 | 4.17 → 4.59 |
  | Dark | 1.23 → 1.18 | 5.66 → 5.92 |

  The fill carries the progress and stays above 3:1; the track was already below 3:1 (accepted by the
  delegator, 2026-10-15).
- **On device: NOT EXERCISED.** The bar renders only while Settings › About downloads an update (an
  available update, then **Install Update**). That needs a published release newer than the running build, served from the
  updater endpoint in `tauri.conf.json`; the verify overlay `tauri.verify.conf.json` has empty endpoints
  ([`manual-test-about-updater.md`](./manual-test-about-updater.md)). The `pnpm dev` computed-style capture
  does not reach it either: its `browser-settings-about` surface is the About page in the update-check
  error state (`scripts/redesign/snapshot.js`, `browser-settings-about`), which renders no progress bar. Screenshot index label: **no screenshot (downloading state not capturable)**. The cell
  rests on source inspection plus the measured contrast above (delegator ruling, 2026-10-15: no capture
  tooling change in Stage 3).

---

## 4. WI-3.2 — Class (b) literals, motion and type ramp

| # | Where | Expected |
|---|---|---|
| 4.1 | Hover the bottom tabs, the + button, TOC rows and the table grid picker (Format › Insert Table) | The highlight appears and disappears at once, with no fade |
| 4.2 | Light ↔ dark switch with tabs, TOC and a switch on screen | No fade on tabs, TOC rows, switches or the grid picker (Stage 3 acceptance) |
| 4.3 | Settings › Editor: flip a switch | The knob slides (150ms); the track colour changes at once |
| 4.4 | macOS System Settings › Accessibility › Display › Reduce motion on, then repeat 4.3 and hover a tab's × | The knob jumps and the × appears without a fade. The recovery and image-paste spinners still rotate |
| 4.5 | Hover a bottom tab, the + button, a tab's × and a TOC row | One faint text-tinted fill (`--color-hover`), the same on all four; in dark it is a light tint, not the old grey panel or black 8% |
| 4.6 | Look at the active bottom tab | It carries the hairline-ring shadow, the same edge as the menus in 4.8 |
| 4.7 | Click a TOC heading; Settings › Shortcuts, click a shortcut to record it | The active TOC row and the shortcut being recorded share one accent tint (`--color-accent-soft`), slightly stronger than before |
| 4.8 | Open the table and image context menus, an unsaved-changes dialog, Settings, a recovery toast and, in Source mode, a lint tooltip | No 1px border; the edge is the shadow's hairline ring. A fixed-width box keeps its width and its content gains 2px; a box sized by its content is 2px shorter (expected) |
| 4.9 | Hover the primary button in Settings (MCP **Install**) and in Insert Link | The hover is the accent mixed 12% toward the text colour: darker in light, lighter in dark (it was a fixed dark blue in both) |
| 4.10 | Settings › Integrations with a connected client; Settings › About after a failed update check | The client's ✓ status is the text colour, not green; the About error text is the theme's danger red; a disabled status is italic in the default colour |

Code block backgrounds (`--color-code-bg`) are unchanged: review item 15 stays deferred (optional P2, open
question for STOP 3).

## 5. WI-3.3 — Focus ring (to be written by WI-3.3)

## 6. WI-3.4 — macOS 13.1 floor (to be written by WI-3.4)

## 7. WI-3.5 — Docs, evidence and QA (to be written by WI-3.5)
