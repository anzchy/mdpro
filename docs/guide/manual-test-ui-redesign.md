# Manual Testing Guide: UI Redesign (Plan P)

Last updated: 2026-10-15

---

## Overview

Plan P ([`docs/plans/20260911-plan-ui-redesign.md`](../plans/20260911-plan-ui-redesign.md)) restyles mdpro
against [`design/DESIGN.md`](../../design/DESIGN.md) in stages. This guide is
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
| 4.9 | Hover the primary button in Settings (MCP **Install**) and in Insert Link | The hover is the accent mixed 12% toward the text colour: darker in light, lighter in dark (it was a fixed dark blue in both). **Dark superseded by 5.8** (D222, WI-3.3) |
| 4.10 | Settings › Integrations with a connected client; Settings › About after a failed update check | The client's ✓ status is the text colour, not green; the About error text is the theme's danger red; a disabled status is italic in the default colour |

| 4.11 | Sidebar header and mode label; Settings section labels; a table's right-click menu (group labels and shortcut hints); in Source mode, a WYSIWYG marker badge | All 12px (they were 10–11px); the uppercase labels keep their letter-spacing |
| 4.12 | Any dialog title (Insert Link, unsaved changes); the Settings header; Settings › Integrations card headings | 14px (they were 15–18px) |
| 4.13 | Settings page titles (General, Advanced…), Integrations and Shortcuts page headings, About › app name | 16px (they were 15–18px) |
| 4.14 | A WYSIWYG table, then Settings › Editor › font size up and down | Table text is 7/8 of the editor font and follows it (it was a fixed 14px) |
| 4.15 | TOC rows and the Settings sidebar rows | At least 28px tall (today they are 30px and 39px, so no visible change); the title bar and the bottom tab bar keep their heights |
| 4.16 | The ×, + and ✓ glyphs, the TOC ▸ and the MCP 📋 button | Unchanged: glyph sizes wait for WI-4.2 |

Code block backgrounds (`--color-code-bg`) are unchanged: review item 15 stays deferred (optional P2, open
question for STOP 3).

## 5. WI-3.3 — Focus ring and accent contrast

Use the keyboard: click once in the window, then **Tab** / **Shift-Tab**. Do every row in light **and** dark.
If Tab skips buttons, turn on macOS System Settings › Keyboard › Keyboard navigation.

| # | Where | Expected |
|---|---|---|
| 5.1 | Tab to any toolbar button: Settings footer, Insert Link (⌘K) Cancel / Insert, the unsaved-changes dialog | A solid 2px accent outline 2px outside the button. In dark it is the light blue `#60a5fa`, not a dimmed or system ring |
| 5.2 | Click the same buttons with the mouse | No outline (focus-visible only) |
| 5.3 | Right-click a WYSIWYG table cell, then arrow through the menu; Format › Insert Table and Tab into the grid; ⌘F in Source mode and Tab to the search buttons | Each focused item shows the same accent outline (inset on menu items, just outside grid cells and search buttons) |
| 5.4 | Show the TOC and Tab into it | The focused row fills with the accent tint and shows a 2px accent ring **inside** the row's rounded edge. The link text has no second ring of its own |
| 5.5 | Click a TOC row with the mouse | It jumps and becomes active (tint plus accent text, 4.7) but shows no ring |
| 5.6 | Tab onto the TOC row that is already active | Ring plus tint: the ring is what tells focus apart from the selection |
| 5.7 | Light theme: the active TOC row text, and Settings › Shortcuts while a shortcut is being recorded | The blue text is a little darker than the accent (accent mixed 80% with the text colour), easy to read on the tint (5.20:1; was 3.99:1) |
| 5.8 | Dark theme: Settings MCP **Install** and Insert Link's **Insert**, at rest and hovered | A deeper blue `#1d4ed8` with white text; hover goes darker, not lighter. The button reads by its label: its edge against the dark background is faint (~2.8:1, accepted in the D222 ruling) |
| 5.9 | Light theme: the same two buttons | Unchanged from 4.9: accent fill, white text, hover slightly darker |
| 5.10 | Source mode, light theme: hover a lint marker to show its tooltip | No grey 1px border, only the shadow's hairline ring (b136 M1) |
| 5.11 | Window at its 400×640 minimum, and with `zoom: 2` on `<html>` in Web Inspector, repeat 5.1 and 5.4 | Every ring is still visible and not clipped (rule 33 checklist, DR17) |

## 6. WI-3.4 — macOS 13.1 floor

The theme tokens use `color-mix()`, which macOS's WebKit has only from 13.1 (E1), so the bundle now
declares 13.1 as its minimum (`bundle.macOS.minimumSystemVersion` in `src-tauri/tauri.conf.json`). This is
a packaging check, not a theme check: build once, no theme switch needed.

| # | Check | Expected |
|---|---|---|
| 6.1 | `pnpm tauri build --bundles app`, then `/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' src-tauri/target/release/bundle/macos/mdpro.app/Contents/Info.plist` | `13.1` (before WI-3.4 it was Tauri's default, `10.13`) |
| 6.2 | Open that build on macOS 13.1 or later | It launches as before |
| 6.3 | Only if a macOS 13.0 machine is at hand: open the same build there | Finder refuses it with "You can't use this version of the application with this version of macOS". This is the accepted risk in [ADR-0101](../adr/0101-macs-on-macos-13-0-can-be-updated-to-a-build-they-cannot-open.md): the updater still offers the release on 13.0 |

## 7. WI-3.5 — Docs, evidence and QA

WI-3.5a measured the A9 contrast table from the tokens
([`docs/test/20261015-plan-p-stage3-evidence.md`](../test/20261015-plan-p-stage3-evidence.md)).
That table found three pre-existing failures (D227). The user had the input
borders fixed and accepted the toggle and the danger label as exceptions,
along with two more edges (the shortcut values and the Insert Table grid).
Check in light **and** dark that the fix is there and the exceptions are
unchanged.

| # | Where | Expected |
|---|---|---|
| 7.1 | Settings › Editor or Advanced: a select; Settings › Export or Image: a text field; Settings › Editor: a − / + stepper | Each control has a clearly visible grey edge against the dialog, darker than the hairline row dividers (was nearly invisible, 1.22:1) |
| 7.2 | ⌘K in WYSIWYG (Insert Link); Format › Insert Table (the size fields); right-click an image › Custom… | The same visible edge on each input; focusing one still turns it to the accent with the soft ring (rule 33 pattern 1) |
| 7.3 | Source mode, ⌘F: the find and replace fields | The same visible edge |
| 7.4 | Settings › Integrations or Markdown: a toggle that is **off** | Unchanged, an accepted exception: the pale `#ccc` track with the white knob (1.61:1 light). **On** is the accent |
| 7.5 | Settings › Integrations, an installed client: **Remove**, at rest and hovered | Unchanged, an accepted exception: the light hovered label stays 3.76:1 on the pink fill. Dark: unchanged |
| 7.6 | Insert Link's URL field and Export's folder field, empty | Read the placeholder's computed colour in Web Inspector, in both themes. The tokens don't set it, so it is WebKit's default. Record the ratio against the field; under 4.5:1 is a new finding, not a D227 regression |

The after-screenshots for the whole Appendix B matrix and the rule 33
checklist (default window, 400×640, `zoom: 2`) are WI-3.5b's device run;
`/qa-only` is WI-3.5c.
