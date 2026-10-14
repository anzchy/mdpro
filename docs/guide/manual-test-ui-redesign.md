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

## 4. WI-3.2 — Class (b) literals, motion and type ramp (to be written by WI-3.2)

## 5. WI-3.3 — Focus ring (to be written by WI-3.3)

## 6. WI-3.4 — macOS 13.1 floor (to be written by WI-3.4)

## 7. WI-3.5 — Docs, evidence and QA (to be written by WI-3.5)
