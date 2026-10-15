# Design System — mdpro (redesign)

A local-first Markdown editor for macOS. Tauri 2 + React 19 + Milkdown +
CodeMirror 6.

> **Status: target design, not shipped yet.** This file describes the UI
> after `docs/plans/20260911-plan-ui-redesign.md` lands. Until then:
> - `docs/design/mdpro-ui-old/DESIGN.md` governs the shipped UI.
> - `.claude/rules/30-34` win any conflict.
>
> When the last stage lands, this file replaces the old one and the root
> `DESIGN.md` index points here.

This file distills two sources:
- `mdpro-ui-codex-review.md`: the change list, cited as "item N".
- `proposal-ab.html`: the rendered target, cited as "proposal :N".

If this file disagrees with either source, treat it as a bug here and stop
and ask. Token **values** are not repeated (rule 31). Before the redesign ships
they live in the proposal's token block; after it ships they live in
`src/styles/globals.css` and `src/styles/themes/*.css`.

| If you need… | Read |
|---|---|
| The aesthetic, the component contracts, and the reasons behind them | this file |
| What changes and why, item by item | `mdpro-ui-codex-review.md` |
| What it looks like in both themes | `proposal-ab.html` in a browser. Query params: `?theme=dark`, `?page=editor`, `?page=integrations`, `?page=export`, `?annot=off` |
| Proposed token values | proposal :21-61. Never :63-69, the rejected code hue. |
| Order of work, gates, tests | `docs/plans/20260911-plan-ui-redesign.md` |
| Enforceable rules | `.claude/rules/30-34` |
| The UI as shipped today | `docs/design/mdpro-ui-old/DESIGN.md` |

## Product context

- **What this is.** A local Markdown editor with WYSIWYG (Milkdown) and
  Source (CodeMirror) modes, plus an HTML preview. Files live on disk, with no
  cloud sync.
- **Who it's for.** Writers who treat plain Markdown as the canonical
  format and want Typora-class editing without cloud lock-in. CJK users are
  first-class.
- **Project type.** macOS desktop app on Apple Silicon. The redesign raises
  the floor to macOS 13.1, because the derived tokens rely on `color-mix()`
  (E1).
- **Constraints.** Local files only, HTML export only, 10MB max. See
  `CLAUDE.md` § Constraints.

## The memorable thing

> A markdown editor that **respects the file**. What you type is what gets
> saved. What gets saved is what other tools see. No proprietary syntax,
> no hidden state, no vendor lock-in.

When two options are equally good, pick the one that makes the file the more
obvious primary artifact. The redesign applies this in three places:

- **Source mode shows the file's structure.**
  - New installs default to monospace, so table pipes and indentation line up.
  - Markdown markers use the accent color, and link targets use muted text.
  - Code keeps the normal text color, set apart by fences and the code
    background rather than a second hue.
- **The status strip reports facts about the file:** cursor position, word
  count, encoding and line endings (proposal :421-427).
- **The chrome gets quieter.** Hairlines derive from the text color, and there
  is one elevation and one accent.

Round-trip discipline is unchanged: if a feature can't survive
save → close → reopen, it doesn't ship.

## Aesthetic register

| Dimension | Choice | Why |
|---|---|---|
| **Direction** | Direction A's register (Quiet paper) in Direction B's structure (Command surface) (D1) | Tone, space and hairlines stay quiet. A pinned header, a mode control and a status strip serve keyboard users without boxed bars or extra density. |
| **Decoration** | Minimal: one accent, hairlines mixed from the text color, one shadow with a hairline ring | Anything more competes with the writing. |
| **Layout** | Sidebar + main + bottom tabs. The main column has a pinned bar (breadcrumb, Source \| WYSIWYG) and a status strip. | Each pane has one job. No command palette (Q11). |
| **Color** | One accent on the current cool neutrals (D4). Borders, hover, focus ring, code surface and shadow are derived with `color-mix()`. | A rebrand stays local to the base tokens. The accent is the only hue in the chrome; green is not used for status. |
| **Typography (chrome)** | `--font-sans`, unchanged. Three named size steps with a 12px floor. Mono only for values (numbers, shortcuts, numeric fields). | Native macOS register. Named steps replace scattered literals. |
| **Typography (editor)** | WYSIWYG uses the user's editor font. Source uses `--source-font-family`: mono on new installs, "Follow editor font" available (D2). Size and line height stay the user's. | Visible structure in Source mode without silently changing existing profiles. |
| **Spacing** | Ad-hoc 4–40px scale, unchanged (rule 31). Row and control heights are now explicit. | Rule of three before any `--space-*` scale. |
| **Radius** | Three semantic tokens: `--radius-control`, `--radius-popover`, `--radius-inner` | Controls share one radius; floating surfaces share the other; parts nested inside a rounded container share the third. Rows and tabs stay flat, and the radius shows only on their hover or selected fill. Circles use `50%` and pills `999px` (DR23). |
| **Elevation** | Single `--shadow-soft`, now a hairline ring plus one faint shadow, defined per theme | One elevation for popovers, dialogs, menus, toasts and the active tab. |
| **Motion** | One duration token and one easing token, used only for the switch knob and hover reveals. Colors change instantly (DR12). | Short and functional; a theme switch never flickers. |
| **Icons** | One outline set in two sizes, `currentColor`, muted by default | Replaces text glyphs and emoji. |
| **Theme** | `.theme-light` / `.theme-dark` on `<html>`, each setting `color-scheme` | Native controls and scrollbars follow the theme (rule 34). |

## Tokens

New and redefined tokens, by name. Values are at the cited proposal lines.
While the redesign is in progress, these tables are its token log (rule 31,
DR14).

- **Theme-scoped tokens** go in both theme files in the same commit.
- **`:root` tokens** derive from bases that are theme-scoped (rule 31).

### Color

| Token | Change | Scope | Role | Proposal | Item |
|---|---|---|---|---|---|
| `--color-accent-soft` | retuned mix | both themes | Selection and focus fill. Dark mixes more strongly. | :42, :51 | 1 |
| `--color-hover` | new | both themes | Hover fill for rows, tabs and icon buttons; selected segment | :45, :54 | 7 |
| `--color-border` | redefined as a text mix | both themes | Hairlines and control edges | :43, :52 | 7 |
| `--color-border-subtle` | new | both themes | Row dividers, dialog header/footer, rail edge | :44, :53 | 5, 8 |
| `--color-focus-ring` | new | `:root`, equal to the accent (DR15) | Focus outlines and inset rings (see [Focus](#focus)) | :24, not its mix | 7 |
| `--color-syntax-markup` | new | `:root`, from accent | Source markers: heading, list, quote, emphasis, fence, backtick, table pipe, link brackets | :25 | 2 |
| `--color-syntax-meta` | new | `:root`, from muted | Link targets, URLs, fence info strings, HTML | :26 | 2 |
| `--color-code-bg` | redefined as an editor-bg mix | both themes | Code surfaces; keeps the cool tint (D4) | review item 15 | 15 |
| `--settings-sidebar-bg` | points at `--color-surface` | both themes | Settings rail | — | 14 |
| `--color-on-accent` | new | `:root` (same in both themes today) | Labels and the switch knob on an accent fill. Any per-theme value is Stage 3's contrast table. | — | R2 |
| `--color-accent-text` | new | both themes (D222) | Selected-state text on accent-soft: active TOC row, the shortcut being recorded. Light is the accent mixed 80% with the text colour (5.20:1 on the TOC row); dark is the accent. User ruling on prototype/d222-contrast: 「A: derived accent text (Recommended)」 | — | D222 |
| `--color-accent-fill` | new | both themes (D222) | Primary-button fill under `--color-on-accent`. Light is the accent; dark is `#1d4ed8` (white 6.70:1), only ~2.82:1 against the dark background, so the button reads by its label, not its edge. User ruling: 「B: deeper fill, white text」 | — | D222 |
| `--color-accent-fill-hover` | new | both themes (D222) | Primary-button hover. Light mixes the accent 88% toward the text colour; dark mixes the fill 88% toward black (7.96:1) | — | D222 |
| `--color-control-border` | new | both themes (D227) | Edges of form controls: selects, text and number inputs, steppers, Source find fields. The text colour at 50% (3.34:1 light, 4.46:1 dark on the panel); hairlines stay `--color-border`. User ruling on prototype/p-wi35-a9-controls: 「A: text 50% both (Recommended)」 | — | D227 |
| `--color-scrim` | new | `:root` (same in both themes today) | Dialog backdrop. One use: the user overrode the rule of three for it (A10). | — | R6 |

- **`--color-border`:** before redefining it, audit consumers that use it as a
  fill (WI-3.0).
- **Accepted A9 exceptions (D227):** the toggle's `#ccc` off-track (1.61:1
  light, and the white knob on it 1.61:1 in both themes), the light danger
  label hovered (3.76:1), the Keyboard Shortcuts value edge (1.17 / 1.31) and
  the Insert Table grid-picker cell edge (1.22 / 1.25). User rulings on
  prototype/p-wi35-a9-controls: 「Accept (today: #ccc)」, 「Accept (today)」 and
  「Accept as exception」 twice. Changing one needs a new ruling
  ([ADR-0106](../../adr/0106-five-control-colours-are-accepted-below-the-a9-contrast-line.md));
  `tests/contrast-stage3.test.ts` pins the first three.
- **Retired:** `--settings-btn-hover-bg` and `--settings-btn-active-bg`, once
  the rail migrates (WI-4.7).
- **Never add:** `--color-syntax-code` (D3).

### Elevation

| Token | Change | Scope | Role | Proposal | Item |
|---|---|---|---|---|---|
| `--shadow-soft` | moves from `:root` into both themes; becomes a hairline ring plus one faint shadow | both themes | Popovers, dialogs, menus, toasts, active tab | :46-47, :55-56 | 8 |

Elevated surfaces add no separate border, because the ring is part of the
shadow.

### Type, icons, shape, motion

| Token | Scope | Role | Proposal | Item |
|---|---|---|---|---|
| `--font-size-ui-lg` | `:root` | Dialog titles, settings header | :32, :597 | 12 |
| `--font-size-title` | `:root` | Settings page title, About app name (DR22) | :242 (a 16px literal there) | 12 |
| `--font-size-ui` | `:root` | TOC rows, menus, row titles, buttons, inputs | :31, :598 | 12 |
| `--font-size-ui-sm` | `:root` | Tabs, status strip, descriptions, section labels, segmented control | :30, :599 | 12 |
| `--source-font-family` | `:root` mono default; set at runtime from `sourceFont` | Source-mode content | :27, :59 | 3 |
| `--icon-size-md` | `:root` | Settings rail, menus, toolbar, toasts | :36 | 4 |
| `--icon-size-sm` | `:root` | Tab close, TOC carets, new-tab button | :35 | 4 |
| `--radius-control` | `:root` | Buttons, inputs, segmented control, icon buttons; the hover and selected fill of rows and tabs | :33 | 15 |
| `--radius-popover` | `:root` | Menus, dialogs, toasts, grouped sections inside dialogs (DR23) | :34, :261 | 15 |
| `--radius-inner` | `:root` | Parts nested inside a rounded container: segment buttons, menu items, tab close, stepper buttons, table cells (DR23) | :116, :206 (4px literals there) | 15 |
| `--motion-duration-fast` | `:root`; zeroed under reduced motion | The switch knob and hover-reveal opacity transitions (DR12) | :28, :60 | 11 |
| `--motion-ease-out` | `:root` | The same two transitions | :29 | 11 |

- **Chrome font floor:** nothing in chrome goes below the small step.
- **Rows and tabs stay flat:** TOC rows, settings rail items and tabs have no
  border or shadow at rest. The radius shows only on the hover or selected
  fill, and the active tab's `--shadow-soft` is the one exception
  (proposal :45). Nothing in the chrome becomes a card.
- **`color-scheme`:** a property, not a token. `.theme-light` and `.theme-dark`
  set it (proposal :41, :50; item 10).
- **Unchanged tokens:**
  - `--font-sans`. The proposal's `--font-ui` (:17) is only a placeholder for
    it.
  - `--font-mono`, `--editor-font-*`, `--title-bar-height`,
    `--bottom-tabs-height`.
  - `--color-accent`, `--color-danger`, `--color-danger-soft`.
  - The base neutrals (D4) and the z-index table (rule 31).

### Widths

| Token | Scope | Role | Proposal | Item |
|---|---|---|---|---|
| `--sidebar-width-min` | `:root` | The narrowest the resizable sidebar goes (180px); `--sidebar-width` holds the user's stored width | — | D189 |
| `--main-min-width` | `:root` | The width the sidebar yields to, so the editor keeps at least 320px in a narrow window | — | D189 |

## Layout

**Main window** (proposal :358-440):
- **Sidebar:** on `--color-surface` with a hairline right edge. The top strip
  clears the traffic lights, using the existing tokens, and carries no text:
  no "Contents" header and no mode badge (D223; the user's ruling 「B: remove
  everywhere (Recommended)」). Until the main bar's segmented control is
  built (WI-4.8), the mode shows only in the View menu's check marks.
  - **Width ([ADR-0088](../../adr/0088-the-sidebar-keeps-its-width-is-resizable-and-is-toggled-by-one-fixed-button.md)):**
    the user sets it by dragging the right edge, 180–480px, default 220
    (`--sidebar-width`, stored as the `sidebarWidth` preference). It keeps
    that width at every window width and never collapses because the window
    is narrow. The one exception: the *rendered* width yields so the main
    column keeps `--main-min-width` (320px), never below
    `--sidebar-width-min` (180px). The stored width is unchanged, so widening
    the window restores it. See § Sidebar resize handle.
  - **Visibility:** hidden and shown only by the user, through § Sidebar
    toggle, View → Toggle Sidebar or ⌘⇧L (ADR-0088).
- **Main column:**
  - **Bar:** breadcrumb on the left, the Source | WYSIWYG segmented control
    on the right, in both sidebar states (item 9). See § Main bar.
  - **Editor:** on `--color-editor-bg`.
  - **Status strip:** below the editor. See § Status strip.
- **Bottom tab bar:** full width on `--color-surface`, with a hairline top.
  Its first control is the § Sidebar toggle (ADR-0088).
- **Heights:** the shipped title-bar and tab-bar heights stay. Density is a
  product choice.
- **Narrow windows (DR16):** the 400×640 minimum stays.
  - The mode control never shrinks; the breadcrumb ellipsizes.
  - The status strip stays on one line and hides fields as it narrows: line
    ending, then encoding, then word count. The cursor stays; in WYSIWYG,
  word count stays.
  - In a narrow Settings dialog the rail shows icons only, and rows wrap.

**Reading order.** The writing comes first; the chrome is quiet enough to
read past.
1. The editor text.
2. The main bar: which file, and which mode.
3. The sidebar contents and the bottom tabs: where you are, and what else is
   open.
4. The status strip: facts about the file, read only when needed.

```
┌─────────┬─────────────────────────────────────┐
│ o o o   │ docs / notes.md    Source | WYSIWYG │  main bar
│         ├─────────────────────────────────────┤
│ TOC     │                                     │
│         │ editor                              │
│         ├─────────────────────────────────────┤
│         │ Ln 14, Col 8     1,284 words  UTF-8 │  status strip
├─────────┴─────────────────────────────────────┤
│ ◧ │ + │ tab │ tab │ tab                       │  bottom tabs
└───────────────────────────────────────────────┘
```

**Settings dialog** (proposal :470-518):
- **Header:** title and a close icon button.
- **Body:** a flat rail beside the pane.
- **Pane:** page title, lead line, section labels, rows.
- **Footer:** one secondary Close button.
- Header and footer are divided by `--color-border-subtle`.

## Components

Each block below is a contract. Build to it, and check the build against the
cited proposal lines in both themes.

### Icons (item 4; proposal :295-319, :526-531)

- **Set:** one hand-authored outline set: 24 viewBox, 1.75 stroke, round caps
  and joins, `stroke: currentColor`, no fill. No new icon dependency (plan A7).
- **Wrapper:** one `Icon` component. Its default color is `--color-muted`, and
  the icon takes the row's color when the row is hovered, active or
  highlighted.
- **Glyphs:** one close glyph replaces today's text characters, and chevrons
  replace text carets. No emoji or text glyphs as icons. Plan WI-4.2 lists
  every site. Shortcut symbols (⌘, ⌥) are text, not icons.
- **Accessible names:** icon-only controls always have one.
- **Sidebar glyphs (ADR-0088):** `panel-left-close` (rect `3,3,18,18 rx2`,
  `M9 3v18`, `m16 15-3-3 3-3`) while the sidebar is shown, and `panel-left`
  (the rect and divider only) while it is hidden. Same geometry as lucide,
  drawn inline.

### Sidebar toggle (ADR-0088 decision 1)

- **Place:** first in the bottom tab bar, before New Document, then a
  hairline separator. It stays in the same place in both states, so a second
  click undoes the first.
- **Box:** the § Buttons icon button. Focus is rule 33 pattern 2 (outline).
- **Icon and name:** the sidebar glyphs above. The accessible name and the
  tooltip read "Hide Sidebar" or "Show Sidebar" plus the platform shortcut
  (the user's live binding, ⌘⇧L / Ctrl+Shift+L by default). `aria-expanded` follows the
  state; `aria-controls` names the sidebar while it is shown.
- **Behaviour:** the same toggle as the menu and ⌘⇧L, one preference write
  per click. No animation (DR12).

### Sidebar resize handle (ADR-0088 decision 3)

- **Place:** the sidebar's right edge, an 8px hit area inside the edge (the
  sidebar clips its overflow). Cursor `col-resize`.
- **Look:** at rest only the existing hairline. On hover and while dragging,
  a 2px `--color-muted` bar on the edge (3:1 or better in both themes; user's
  prototype ruling, 2026-10-15). Focus is rule 33 pattern 2, with
  the outline inset.
- **Semantics:** a focusable `role="separator"`, vertical, named "Resize
  sidebar", carrying `aria-valuenow` (the drawn width), `-min` (180) and
  `-max` (480).
- **Keyboard:** ←/→ step 8px, Shift+←/→ 32px, from the drawn width; when a
  narrow window has clamped the sidebar, → does nothing. Home/End go to the
  limits, Enter or a double-click resets to 220.
- **Writes:** a drag changes only `--sidebar-width` until it ends; each drag,
  key step or reset writes the preference once. No animation (DR12).

### Main bar (D1, DR2; proposal :143-146, :384-385)

- **Where:** the top row of the main column, in both sidebar states (WI-4.8).
- **Shape:** `--title-bar-height`, the same as the sidebar's traffic-light
  strip, so the two top edges line up. Hairline bottom.
- **Left:** the breadcrumb in `--font-size-ui` (DR4):
  - the parent folder name, muted, then " / " and the file name in text
    color at medium weight
  - an unsaved document shows "Untitled", with no folder
  - when space runs out, the folder ellipsizes first, then the file name;
    the segmented control never shrinks (DR16)
  - the full path appears only in a tooltip (rule 30 rule 3)
  - not clickable, and no unsaved mark (the tab already shows it)
- **Right:** the Source | WYSIWYG segmented control, the window's only mode
  control.
- **Traffic lights:** with the sidebar hidden, the left padding clears them
  (`--traffic-lights-clearance-main`, rule 31).
- **Window drag:** the bar background is a drag region; the breadcrumb and
  the control opt out.

### Segmented control (item 9; proposal :114-121, :566-574)

- **Shape:** 24px tall, `--radius-control`, hairline border on `--color-bg`.
  Small text, no uppercase or letter-spacing.
- **States:**
  - Selected: `--color-hover` fill, `--color-text`, medium weight.
  - Unselected: `--color-muted`; hover turns it to text color.
  - Disabled: reduced opacity.
  - Focus: see [Focus](#focus).
- **Semantics:** a radio group (WI-4.5), named "Editor mode" in the main
  bar and by its row title in settings. It takes one Tab stop: arrow keys
  move and select, and Home/End jump to the ends. ⌃2 / ⌃4 update the
  selection. The control doesn't clip a segment's focus outline.
- **Used for:** the editor mode (in the main bar), and the Source font
  preference.

### Buttons (item 13; proposal :179-190, :533-537)

- **Base:** 28px tall, `--radius-control`, `--font-size-ui`, medium weight.
- **Secondary (default):** `--color-panel` fill and a hairline border;
  `--color-hover` on hover.
- **Primary:**
  - `--color-accent-fill` fill and edge with `--color-on-accent` text, hover
    `--color-accent-fill-hover` (D222). Light: the accent, hovering toward
    the text color. Dark: `#1d4ed8` with white text, hovering toward black,
    because white on the dark accent `#60a5fa` is 2.54:1 (user ruling:
    「B: deeper fill, white text」).
  - Never a black or foreground fill.
  - One per surface (rule 30 rule 1).
- **Danger:** transparent, with `--color-danger` text and border, and
  `--color-danger-soft` on hover.
- **Disabled:** reduced opacity, with the reason stated inline next to the
  button (rule 30 rule 4).
- **Icon button:** 24px square, transparent, muted icon; hover gives
  `--color-hover` and text color (proposal :162-165).

### External change dialog (DR1, DR5)

- **Shell:** the rule 32 modal. The title is linked by `aria-labelledby` and
  the message by `aria-describedby`, Tab is trapped inside, and the safe
  action sits on the left.
- **States:**

  | State | Title | Message | Left | Right | Focus |
  |---|---|---|---|---|---|
  | Changed, no unsaved edits | File changed on disk | *name* was changed by another app. | Keep my version | Reload (primary) | Reload |
  | Changed, unsaved edits | File changed on disk | *name* was changed by another app. Reloading discards your unsaved changes. | Keep my version | Discard and reload (danger) | Keep my version |
  | Deleted | File deleted on disk | *name* no longer exists on disk. Your text is still open here. | Keep editing | Save As… (primary) | Save As… |

- **Esc:** always takes the left action and never reloads.
- **Save As…:** the app has no Save As today. How it is built (or whether
  the deleted state offers "Save" to the old path) is plan Q14.
- **Name:** the file name only, never the path (rule 30 rule 3).
- **No primary with unsaved edits:** the only action that can lose text is a
  danger button, and it never takes focus.

### Destructive confirmation (item 13, DR8; proposal :538-544)

- **Confirm button:** Discard-type confirmations use the danger variant.
  Cancel stays secondary (WI-4.6: `ConfirmDialog` at its two mounted
  Discard callers).
- **Closing:** a choice closes the dialog before the work runs, and a
  failed close shows one error toast (§ States › Dialogs).
- **Focus:**
  - Focus starts on Cancel ("Keep editing"). The danger button never takes
    focus, so pressing Enter as soon as the dialog opens can't discard text.
  - Confirmations that aren't destructive, such as "Save and Restart", keep
    focus on the confirm button.
- **Shell:** the rule 32 modal.
  - The title is linked by `aria-labelledby` and the message by
    `aria-describedby`.
  - Tab is trapped inside the dialog.
  - Esc and a backdrop click both cancel.
  - Focus returns to where it was before the dialog opened.
- **Order:** Cancel on the left, confirm on the right.
- **Out of scope:** the proposal's third Save button illustrates the
  hierarchy. It is not a planned change.

### Switch (items 5, 6; proposal :192-201, :575-585)

- **Where:** the only boolean control in Settings. One `ToggleSwitch`
  replaces the hand-copied toggles and the native checkboxes (E4).
- **Semantics:** `role="switch"` with `aria-checked`. Space toggles it.
- **Track:** 44×24 with an 18px knob.
  - Off: a low text mix.
  - On: `--color-accent`.
  - The knob stays light in both themes, like native switches.
- **Focus:** a visible ring in both themes, including on the visually hidden
  input (WI-4.3).
- **Disabled:** reduced opacity, for both on and off.

### Settings rows (item 5; proposal :241-257)

- **Row:**
  - min-height 56px (a two-line target of 56–60px), with the control
    right-aligned.
  - Title in `--font-size-ui`, medium weight, above a description in
    `--font-size-ui-sm`, muted.
  - `--color-border-subtle` divider, with none after the last row.
- **One markup in every panel with rows** (WI-4.3), drawn or not: an `h4`
  title and an optional `p` description inside `.settings-row-label`, with the
  control beside them. The control takes its name from the title. No
  `strong`/`span` titles, and no `label` wrapped around a heading.
- **Keyboard Shortcuts and About** have no rows. They keep their layouts and
  use the same type steps, section labels and dividers.
- **Controls:**
  - `ToggleSwitch` for booleans.
  - Segmented control for two- or three-way choices.
  - 28px inputs; numeric inputs are narrow and mono.
  - A secondary button for Browse….
- **Inputs:** `--color-bg` fill, hairline border, muted placeholder.
- **Narrow page:** the row wraps, and the control moves under the title and
  description (DR16).

### Status indicator (item 6; proposal :250-251)

- **Look:** a 6px `--color-accent` dot plus the label ("Running") in small
  muted text, inline after the row title. No fill, no green.
- **Label:** the text label always stays, so status never relies on color
  alone.
- **Semantic success color:** if one is ever needed, add `--color-success` /
  `--color-success-soft` in both themes via `color-mix()`. Never use a
  literal.

### Settings rail (item 14; proposal :232-240)

- **Surface:** flat `--color-surface` with a `--color-border-subtle` edge.
- **Items:** min-height 28px, `--radius-control`, a medium-size icon in muted.
- **States:**
  - Hover: `--color-hover`.
  - Active: `--color-accent-soft` fill with `--color-accent` text and icon,
    medium weight (the rule 31 selection pattern).
  - Focus: the inset `--color-focus-ring` ring (DR15). Focus always sits on
    the selected tab, so a fill can't show it.
- **Semantics:** a vertical tab list named "Settings"; the page is its tab
  panel (WI-4.7). One Tab stop; arrow keys and Home/End change the page.
- **Narrow dialog:** icons only (DR16). Each tab keeps its name, visually
  hidden rather than removed, and shows it as a tooltip.

### TOC rows (items 1, 7, 12; proposal :129-140)

- **Row:** min-height 28px, `--radius-control`, `--font-size-ui`, truncated
  with an ellipsis. Nesting is shown by left padding; carets are small muted
  chevrons.
- **States:**
  - Hover: `--color-hover`.
  - Active: `--color-accent-soft` with accent text, medium weight. This
    replaces the light-only literal.
  - Focus: accent-soft plus an inset `--color-focus-ring`.

### Tabs (proposal :161-177)

- **Tab:** 80–180px wide with truncation, small medium-weight muted text,
  `--radius-control`.
- **States:**
  - Hover: `--color-hover` with text color.
  - Active: `--color-panel` fill, text color and `--shadow-soft`.
  - Focus: accent-soft.
- **Close and dirty indicators:** follow rule 32. The proposal's dirty dot is
  illustrative, not a planned change.
- **Markup:** the tab and its close control are sibling buttons (WI-4.2).
  Close is named "Close *name*" and also shows while focus is inside the
  tab. The tab bar is a navigation region named "Open documents", and the
  active tab has `aria-current`.

### Menus (item 8; proposal :203-213, :546-557)

- **Surface:** `--color-panel`, `--radius-popover`, `--shadow-soft`.
- **Items:** `--font-size-ui`, with shortcut hints right-aligned in the chrome
  sans.
- **Highlight:** a solid `--color-accent` fill with `--color-panel` text and
  icons. This is the macOS pattern (rule 32); don't switch to a neutral hover
  step.
- **Other parts:**
  - Group labels: small and muted.
  - Separators: hairline.
  - Disabled items: muted at reduced opacity.
  - Destructive items: `--color-danger`.
- **Keyboard:** one contract for every menu (WI-4.15). Focus starts on the
  first item; arrows wrap, Home/End jump, Enter or Space activates, and
  Escape closes and returns focus to where it was.
- **Choices:** an item that sets a value, like an image width, is a
  `menuitemradio` with the current value checked. A form, like the custom
  width, sits beside the menu, never inside it.

### Toasts (proposal :278-281, :558-564; DR9)

- **Card:** the same card as menus; the icon uses the accent.
- **Error variant:** a danger icon and an inset danger edge on the left, not a
  second shadow. Use it when an action failed: save, open, export, reload,
  draft recovery, preferences, paste. A refusal that tells the user what to
  do next ("Open a document first to insert images") stays default.
- **Timing:** default toasts leave after 3 seconds. Error toasts stay until
  dismissed or replaced.
- **Dismiss:** error toasts have a close button named "Dismiss"; default
  toasts have none. Focus never moves to a toast.
- **Announcement:** default toasts are polite status messages; error toasts
  are alerts.
- **Placement:** bottom-right, one at a time (rule 32; rule 30 rule 5). A new
  toast replaces the current one, including an error.

### Empty state (proposal :284-286, :607-609)

- **When:** no documents are open, once the launch open check has finished
  (WI-4.9). Until then the editor column stays blank, so a launch from Finder
  never flashes this state.
- **Look:** a framed region centered in the editor column, on
  `--color-editor-bg` with a dashed hairline edge and `--radius-control`. The
  frame doubles as the drop hint (DR1). During a drag it becomes the drop
  target (§ Drop target).
- **Content**, top to bottom:
  - a muted file icon
  - the title "No documents open", medium weight
  - two buttons: **New Document** (primary) and **Open…** (secondary), each
    with its shortcut in `kbd`
  - a muted line: "or drop a Markdown file here"
- **Around it:** the main bar keeps its drag region but shows no breadcrumb
  and no mode control; the status strip is not rendered.
- **Focus:** nothing is auto-focused.

### Drop target (DR1, DR7)

- **When:** files are dragged from Finder over the window (WI-4.12). Tauri
  sends the file paths when the drag enters, so the state is chosen at that
  moment. The pointer is not tracked.
- **Where:** the editor column only. The sidebar, main bar, tabs and status
  strip don't change. A drop anywhere in the window still works.
- **Look:**
  - **Accepting:** a `--color-accent-soft` tint over the editor column, a 2px
    dashed `--color-accent` edge inset from the column, and a centered label.
  - **Refusing:** no tint, a dashed edge in `--color-muted`, and a muted label.
  - **Empty state:** WI-4.9's frame takes the edge color, and the label
    replaces its "or drop a Markdown file here" line. No second frame is drawn.
- **Label:** UI text on `--color-panel`, with a hairline border and
  `--radius-control`. The text uses the accent in accepting states and muted
  gray in refusing states.
- **States:**

| Dragged files | Document open | State | Label | On drop |
|---|---|---|---|---|
| Markdown only | either | Accepting | Drop to open | Opens each file |
| Images only | yes | Accepting | Drop to insert image | Inserts them into the active document |
| Markdown and images | yes | Accepting | Drop to open *n* files and insert *n* images | Both |
| Markdown and images | no | Accepting | Drop to open *n* files, with a muted second line: "Images need an open document" | Opens the files; the images get the existing toast |
| Images only | no | Refusing | Open a document first to insert images | The existing toast |
| No Markdown or image files | either | Refusing | Can't open this file type | Toast: "Only Markdown and image files can be dropped" |

- **Copy:**
  - Counts appear only when more than one file is dragged ("Drop to open 3
    files"), and the noun is singular or plural to match.
  - Labels never say "new tab", because dropped images go into the document.
  - When supported and unsupported files are dragged together, the
    unsupported ones are ignored, as today, and not mentioned.
- **Motion:** none. The target appears and clears instantly.
- **Accessibility:** the target is `aria-hidden` and `pointer-events: none`.
  Dragging needs a pointer, and every user gets the drop's result: a new tab
  or a toast.

### Source mode (items 2, 3; proposal :147-157, :388-420)

- **Font:** `--source-font-family`. Size and line height stay the user's
  editor settings.
- **Highlighting:** a mdpro `HighlightStyle` replaces `defaultHighlightStyle`.
  It swaps with the theme because its tokens do.
  - Markers: `--color-syntax-markup`.
  - Meta: `--color-syntax-meta`.
  - Headings: bold, in text color.
  - Everything else, including code: `--color-text`.
- **Editor details:**
  - Gutter: small mono numbers in muted.
  - Current line: `--color-hover`, with its number in text color.
  - Caret: accent.
- **CJK:** no mono face carries CJK glyphs, so tables that contain CJK won't
  align exactly. This is known and accepted.

### Status strip (proposal :158-160, :421-427)

- **Look:** a hairline top, small muted chrome sans, and values in mono at
  text color.
- **Where:** the last row of the main column, above the full-width bottom
  tabs (WI-4.8).
- **Contents:** cursor position, word count, encoding and line endings.
  WYSIWYG has no cursor field (DR19).
- **Word count (DR18):** each Han, Hiragana or Katakana character is one
  word; other runs of letters and digits are one word each. Markdown syntax
  doesn't count: front matter, fence lines, list numbers, link destinations
  and HTML tags. It counts the document's Markdown, so Source and WYSIWYG
  agree.
- **No document:** the strip is not rendered.
- **Narrow:** one line, never wrapped. As it narrows it hides line ending,
  then encoding, then word count; the cursor stays (DR16). In WYSIWYG,
  which has no cursor field, word count stays (DR19). Separators belong
  to the fields, so a hidden field leaves none behind.
- **Semantics:** a group named "Document status", not a live region, so
  cursor moves and typing are never announced.
- **Empty values:** render only fields with a known, nonzero value (rule 30
  rule 2).
- **No palette hint:** the proposal's "Commands ⌘K" hint (:426) does not
  ship. There is no command palette (Q11, closed), and ⌘K already inserts a
  link.

## States

What each surface shows outside its resting look. Every event gets one
signal (rule 30 rule 5), and every failure uses the § Toasts error variant.
"Unchanged" means today's behavior stays.

### Documents

| State | What the user sees | Plan |
|---|---|---|
| No document | § Empty state, once the launch open check has finished; the editor column is blank before that. Neither editor is mounted, so nothing accepts typing. The Contents sidebar shows no message. | WI-4.9 |
| Opening | The busy line under the main bar | unchanged |
| Open failed | One error toast: "Failed to open *name*", with the reason when it is known ("larger than 10 MB"). Several failed files in one open give one toast with the count. An encoding failure opens the encoding dialog instead. | WI-4.13 |
| Already open | Its tab becomes active, and nothing else happens | WI-4.11 |
| Changed on disk | § External change dialog | WI-4.10 |
| Text changed outside the editor (Reload, image drop) | WYSIWYG shows the new text before the next edit. A reloaded document has no unsaved dot. | WI-4.14 |
| Save, export or reload failed | Error toast | WI-4.13 |
| Exported | "Exported *name*". The path goes only to the log (rule 30 rule 3). | WI-4.13 |
| Too large for WYSIWYG | Source mode, with today's toast | unchanged |
| No headings | "No headings found in this document." in the Contents sidebar | unchanged |

### Dialogs

- **A choice closes the dialog.** The destructive confirmation and the
  external change dialog close as soon as a button is chosen, before the work
  runs. Nothing can be pressed twice, and a failure arrives afterwards as one
  error toast.
- **Close failed:** "Close failed" error toast; the tab stays open (WI-4.6).
- **Unchanged:** draft recovery and the encoding dialog.

### Settings

| State | What the user sees | Plan |
|---|---|---|
| Loading | Every page shows the same muted "Loading…" line, marked busy | WI-4.3 |
| Load failed | Every page shows "Failed to load preferences. Please close and reopen settings." in the settings error style. The raw error goes only to the log (rule 30 rule 3). | WI-4.3 |
| Saved | No signal; the control already shows the value | unchanged |
| Save failed | The error toast is the only signal, and the page stays usable. Switches and selects roll back. Logging settings follow the same contract. | WI-4.3, WI-4.13 |
| Shortcuts, unsaved | Today's banner with Discard and Save, moved from amber to an `--color-accent-soft` fill with an accent border, like the tab's unsaved dot (DR21) | WI-4.3 |
| MCP server | The Running badge only; the backend reports no other state | WI-4.4 |

## Focus

Rule 33's four patterns stay; only the color source changes.

| # | Pattern | Surfaces | Redesign spec |
|---|---|---|---|
| 1 | Border + soft ring | Text inputs | Accent border + accent-soft ring, as drawn at proposal :255 |
| 2 | Outline | Buttons, icon buttons, switches, segments, toolbar buttons | 2px `--color-focus-ring` outline (proposal :120, :165, :189, :201). Adds the missing `.toolbar-button:focus-visible` (item 7). |
| 3 | Background | TOC rows, tabs, settings rail | `--color-accent-soft` fill. Selected items keep accent text, so focus ≠ selection. TOC rows and the settings rail add an inset `--color-focus-ring` ring; on the rail, focus always sits on the selected tab (WI-4.7). |
| 4 | Editor widgets | Image handles and similar | Unchanged |

- **Focus ring token (DR15):** `--color-focus-ring` equals the solid accent
  in both themes. The proposal's 70% mix (:24) measures 2.91:1 on the light
  surface and 2.68:1 on accent-soft, below 3:1. Pattern 1 is unchanged, as
  drawn.
- **Contrast:** focus indicators need at least 3:1 against bg, surface and
  accent-soft in both themes (plan A9). Check them at the default window, at
  the 400×640 minimum, and with `zoom: 2` on `<html>` in Web Inspector
  (DR17). mdpro has no page zoom, so 200% browser zoom can't be reached.

## Theme

- **Classes:** `.theme-light` / `.theme-dark` on `<html>`; System resolves to
  one of them. No `[data-theme]`, no `light-dark()` (rule 34).
- **`color-scheme`:** each theme class sets it (rule 34 edit in WI-3.1).
  Verify scrollbars and native inputs in WKWebView.
- **Base neutrals keep their values** (D4): `--color-bg`, `--color-surface`,
  `--color-panel`, `--color-text`, `--color-muted`. Only borders, hover, code
  surface and shadow become derived.
- **Review:** use `proposal-ab.html?theme=dark` or the Side by side view.
  Sign-off screenshots come from `pnpm tauri dev` (E5).

## Motion

- **What animates:** shape and visibility only, never color (DR12):
  - the switch knob's `transform`
  - the `opacity` of controls revealed on hover: the tab close button and
    the MCP copy button
  Both use `--motion-duration-fast` and `--motion-ease-out`. Spinners keep
  their continuous rotation.
- **Colors change instantly** on hover, selection, press and theme switch.
  No transition lists `background-color`, `color`, `border-color`,
  `box-shadow` or `all`, so a theme switch never animates (rule 32) and
  nothing flickers (rule 34).
- **Differs from the proposal:** it fades backgrounds and colors on rows,
  tabs, buttons and the switch track (proposal :117-234). Rules 32 and 34
  outrank the proposal, and macOS sidebars and menus highlight instantly.
- **Reduced motion:** one `@media (prefers-reduced-motion: reduce)` block sets
  the duration token to 0, which stops every transition at once. Spinners keep
  rotating, because they show work in progress (DR13).
- **Not used:** scroll-driven or decorative motion.

## What we deliberately don't do

- **No card grids, icon-in-circle decoration, purple gradients, emoji as
  design, marketing surfaces, or "built for X" copy.**
- **No reference-app look** (review §3, proposal :619-629):
  - No borrowed brand font and no borrowed gray ramp: `--font-sans` and the
    current neutrals stay.
  - No black or foreground-colored primary button: primary is the accent.
    The one exception is the dark primary fill, a deeper blue for its white
    label (D222, § Buttons).
  - No separate control blue: switches, focus and selection all derive from
    the one accent.
  - No neutral-step menu hover: menus keep the solid-accent highlight.
  - No taller in-web title bar and no denser chrome.
  - No translucent sidebar, superellipse corners, `light-dark()`,
    `[data-theme]` or Tailwind spacing scale.
  - No 12px body text: the editor keeps the user's size and line height.
- **No second syntax hue.** Green keeps meaning success and additions.
- **No command palette in this redesign** (Q11), even though proposal Board 2
  draws one for reference.

## What other Markdown editors get wrong

These are for calibration, unchanged from the current design system.

- **Notion.** The database is the artifact, not the file.
- **Bear / iA Writer.** Right posture, but proprietary extensions break
  round-trip. mdpro stays in GFM where possible.
- **Typora.** The closest cousin. Reuse what works; diverge on round-trip
  discipline.
- **Obsidian.** Plugins first, which mdpro isn't.

## Rule changes this design needs

| Rule | Today | Redesign | Planned in |
|---|---|---|---|
| 31 § Layout tokens | Three runtime-toggled tokens | Adds `--source-font-family` | WI-5.3 |
| 33 spec column | Patterns use `--color-accent` | Pattern 2 and pattern 3's inset ring use `--color-focus-ring` (DR15) | WI-3.3 |
| 30 § Core principles | "Same fonts" across modes, including Preview | Source mode's font is the stated exception (D2); Preview leaves the list (DR10) | WI-5.3 |
| 32 § Animations | Wrap motion in `prefers-reduced-motion: no-preference` | Motion tokens zeroed in one `reduce` block; spinners keep rotating (DR13) | WI-3.2 |
| 34 § Theme detection | Silent on `color-scheme` | Theme classes set `color-scheme` | WI-3.1 |
| 32 § Modal contract | "First-focused element is the most-likely-edited control, not title/cancel" | Exception: when the primary action is destructive, focus starts on the safe action (DR5, DR8) | WI-4.6 |
| 31 § Z-index hierarchy | "Recent dropdown" row for `.toolbar-recent-list` | Row removed; no such dropdown is mounted | WI-1.2, with the dead CSS |
| 31 § Token rationale | Tokens are logged in the doc root `DESIGN.md` marks current (the old one) | Interim: redesign tokens are logged in this file's § Tokens; afterwards root `DESIGN.md` marks this file current and the clause goes (DR14) | WI-2.2, WI-5.5 |
| 31 § Acceptable hardcoded values | `50%` for circles | Adds `999px` for pills (DR23) | WI-2.1 |
| 32 § Context menu contract | Dismissal and ARIA roles; no keyboard contract | Adds one keyboard contract and names the shared hook | WI-4.15 |
| 32 § Tab bar | Describes the unmounted `TabBar` classes | Describes the bottom tabs: a sibling close button named "Close *name*", also shown while focus is inside the tab | WI-4.2 |
| 33 pattern 3 | Settings categories use the fill; lists "recent dropdown" | The settings rail adds the inset `--color-focus-ring` ring; "recent dropdown" removed | WI-4.7, WI-3.3 |
| 33 checklist | "Focus visibility holds at 200% browser zoom" | Holds at the 400×640 minimum window and with `zoom: 2` on `<html>` in Web Inspector (DR17) | WI-3.3 |
| 32 § Single source of truth | App shell, sidebar, dialog backdrop, toast and settings live in `globals.css` | Each surface names its CSS partial, per the approved file map | WI-1.2 |
| 32 § Toast | Position and "one toast at a time" only | Adds the variant contract: error toasts are alerts, stay until dismissed or replaced, and have a "Dismiss" button (DR9) | WI-4.13 |

Rows marked "not planned" need a docs work item before the redesign counts
as landed.

## Open questions

Leave these open; don't pick an answer while building.

- **Text tiers:** is a third text tier needed beyond `--color-text` and
  `--color-muted`? (review §4)
- **Sheet icon size:** the proposal's 20px sheet icons are a literal with no
  token. Chrome font sizes (DR22) and radii (DR23) are decided.
- **Other plan questions:** Q3 is closed: One Dark stays selectable and
  unchanged next to the new HighlightStyle (DR20).
  Q1, Preview highlight.js in dark, is closed: the Preview pane isn't mounted
  (DR10). Q4 is closed: the focus ring is the solid accent (DR15).
- **Switch knob colors:** the knob's color and shadow are keyword literals in
  the proposal (:195-196). Tokenize them or add them to rule 31's exceptions.
- **Surfaces the proposal doesn't draw:**
  - the recent-files dropdown: none exists. Recent files are only the native
    "Open Recent" submenu, so this design doesn't style them.
  - the external-file-changed banner (now a dialog, specified under
    § External change dialog: DR1, DR5)
  - the drag-and-drop target (now specified under § Drop target: DR1, DR7)
  - seven of the ten settings pages. They still follow § Settings rows (WI-4.3).

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-15 | D223: the sidebar's top band carries no text; the "Table of Contents" header and the WYSIWYG / SOURCE badge are removed, with the sidebar shown or hidden (user: 「Sidebar左上角的Table of Content 和 Mode(WYSIWYG / Source）等文本去掉，让整体界面比较清爽」; prototype ruling 「B: remove everywhere (Recommended)」) | The header repeated what the outline already shows. The mode stays visible in the View menu's check marks, and comes back to the window with the main bar's segmented control (WI-4.8, not yet built); until then the window itself does not name it. The bands stay as window drag regions for the traffic lights. |
| 2026-10-15 | ADR-0088: the sidebar is resizable (180–480px, default 220) and keeps its width at every window width; two new layout tokens, `--sidebar-width-min` (180px) and `--main-min-width` (320px), set the grid's `clamp()`. One fixed toggle leads the bottom tab bar | The width was a fixed 220px and a leftover 960px media query squeezed the sidebar to 33px or stretched it across the window (#416). Hiding it is the user's choice, never a side effect of window size. The tokens name the two limits instead of literals in the grid. |
| 2026-09-11 | DR23: Radii snap by role to `--radius-control`, `--radius-popover` and a new `--radius-inner` (4px); circles `50%`, pills `999px` | Nested parts need a smaller radius than their container to look concentric, and the proposal already draws 4px for them. Seven ad-hoc values collapse to three roles with no exceptions. |
| 2026-09-11 | DR22: Off-ramp chrome sizes follow the proposal's roles; one new `--font-size-title` (16px) for page titles; glyph sizes become icons | Every size gets a named role and the guard needs no exceptions. The one size the proposal hard-codes, its 16px page title, becomes a token. |
| 2026-09-11 | DR21: No warning color. The Shortcuts unsaved banner uses the accent-soft fill; the dev-only toolbar's literals are a guard exception | Unsaved already means accent, on the tab dot. A warning token would give one state two colors, and only one shipped banner would use it. |
| 2026-09-11 | DR20: One Dark stays selectable and unchanged; "Default" becomes the tokenized HighlightStyle | A visual redesign shouldn't take away a saved setting. One Dark is a deliberate opt-in, and its colors come from a package, not from app CSS. |
| 2026-09-11 | DR19: WYSIWYG shows no cursor position in the status strip | Formatted text has no exact line and column in the file. A number that is sometimes wrong would cost the strip its trust, and it exists to show the file accurately. |
| 2026-09-11 | DR18: A Han, Hiragana or Katakana character counts as one word; other runs of letters and digits count as one; Markdown syntax is removed first | Counting by spaces makes a Chinese note look like a dozen words. A dictionary segmenter would be more precise, but its results differ between Node and WKWebView, so tests and the app would disagree. |
| 2026-09-11 | DR17: Focus is checked at the 400×640 minimum window and with `zoom: 2` in Web Inspector, not at 200% zoom | mdpro has no page zoom, so a 200% check could never run. The two replacements can, and they catch the same clipping and hidden focus. |
| 2026-09-11 | DR16: The 400×640 minimum window stays; the main bar, status strip and Settings dialog each get a narrow rule | People can shrink the window that far today. At 400px with the sidebar shown, the main column is 180px and the Settings page would be 140px, so without rules the new chrome clips. |
| 2026-09-11 | DR15: `--color-focus-ring` equals the solid accent in both themes (Q4 approved) | The proposal's 70% mix falls below 3:1 in the light theme (2.91:1 on the surface, 2.68:1 on accent-soft). The token keeps one focus contract and a single place to retune it. |
| 2026-09-11 | DR14: Redesign tokens are logged in this file's § Tokens while the redesign is in progress; afterwards root `DESIGN.md` marks this file current (WI-5.5) | Rule 31 pointed token logs at the old doc, which the plan keeps read-only, and nothing switched the index once the redesign landed. |
| 2026-09-11 | DR13: Reduced motion zeroes the motion tokens in one `reduce` block; rule 32 § Animations is edited to match; spinners keep rotating | One block is one place to audit, and the tokenization guard already routes every duration through the token. A stopped spinner reads as a hang, and macOS keeps its own spinners turning under Reduce motion. |
| 2026-09-11 | DR12: Colors change instantly; only the switch knob and hover-reveal opacity animate | The proposal's color fades would animate every theme switch through in-between colors, which rule 32 forbids. The shipped CSS already does this on bottom tabs, TOC rows, switches and the table grid picker. |
| 2026-09-11 | DR11: WYSIWYG shows text that changed outside the editor before the next edit (WI-4.14) | Milkdown read the text only when the document id changed. After Reload or an image drop the screen kept the old text, and the next keystroke wrote it back. Source mode already follows the store. |
| 2026-09-11 | D1: Direction A's register with Direction B's structure | Quiet tone and hairlines; B's mode control and status readouts, without its 2px boxes or density. |
| 2026-09-11 | D2: Source mode is mono on new installs; a "Source font" preference (Monospace / Follow editor font) keeps existing profiles on the editor font | Visible structure serves "respects the file". `fontFamily: "system"` can't tell an untouched default from a choice, so an upgrade must not change fonts silently. |
| 2026-09-11 | D3: No second syntax hue. Markers use accent, meta uses muted, code uses text. | Keeps the single-accent register. Green already signals success and additions. |
| 2026-09-11 | D4: Keep the current cool neutrals; adopt only derived mechanics | The cool cast matches the blue accent. Untinted grays would copy a look rather than borrow a mechanism. |
| 2026-09-11 | E1: macOS floor 13.1 | Its bundled WebKit has `color-mix()`, which every derived token needs. No `@supports` fallback. |
| 2026-09-11 | E3: `sourceFont` is `"mono"` \| `"editor"`. Upgrades read `"editor"`, first run writes `"mono"`, unknown values fall back to `"editor"`. | Upgrades keep their current look. The string field adds no new parse failure. |
| 2026-09-11 | E4: One `ToggleSwitch` for every boolean setting | One control, one focus treatment, no native checkboxes. |
| 2026-09-11 | E6: The `config.json` overwrite fix lands before `sourceFont` | A new preference must not ride on a path that can wipe all preferences. |
| 2026-09-11 | E8: `--source-font-family` defaults to mono in `:root` | "Follow editor font" users may see mono briefly before preferences load, the same as `fontFamily` today. Accepted; checked in Stage 5. |
| 2026-09-11 | Q11: No command palette | Out of scope for this redesign. Board 2 stays as reference, and the status strip drops its palette hint. |
| 2026-09-11 | DR1: Reference directions for three review §4 surfaces: empty state = framed drop region (extends the proposal swatch), external change = dirty-aware dialog, drop target = editor-column tint | The framed region is the only empty-state direction that matches this file's dashed-edge contract and hides controls that have nothing to act on. The dirty-aware dialog is the only external-change direction that protects unsaved edits while staying a rule 32 modal. The editor tint is the smallest drop target and needs no pointer tracking. The mockups are local review artifacts, not committed; build scope is decided separately. |
| 2026-09-11 | DR10: The Preview pane is a dead-code candidate; this design doesn't style it | It hasn't been mounted since the view modes were cut to WYSIWYG and Source, so nothing could be seen or signed off. Its light-only code theme must be fixed before any re-mount. |
| 2026-09-11 | DR9: Failure toasts use the error variant, an alert that stays until dismissed or replaced (WI-4.13) | "Save failed" looked like "Saved" and disappeared after 3 seconds, so a failed save could go unnoticed (rule 60). Refusals stay default because they tell the user what to do next. |
| 2026-09-11 | DR8: In destructive confirmations, focus starts on the safe action; `ConfirmDialog` gets the full rule 32 shell (WI-4.6) | Focus on "Discard" meant a reflex Enter after ⌘W threw away unsaved text. macOS never makes "Don't Save" the default. The dialog also lacked the Tab trap, ARIA links and backdrop cancel. |
| 2026-09-11 | DR7: Build the drop target in this plan (WI-4.12); its label follows the dragged file types | WI-4.9 tells people to drop a file, but today nothing responds during a drag and an unsupported drop fails silently. The label and the drop use one classifier, so the label can't promise a new tab for an image. |
| 2026-09-11 | DR6: Opening a file that is already open switches to its tab (WI-4.11) | Re-reading it replaced unsaved edits. The tab switch is the only signal, with no dialog or toast (rule 30 rule 5). |
| 2026-09-11 | DR5: The external-change dialog knows about unsaved edits and has three states (WI-4.10) | One dialog served both "changed" and "deleted", with Reload focused, so Enter could discard edits and a deleted file offered Reload. The safe choice is now the focused one. |
| 2026-09-11 | DR4: The breadcrumb shows folder / file name, or "Untitled"; the path appears only in a tooltip | Matches the proposal's bar, adds the folder that tells same-named files apart, and keeps paths out of primary UI (rule 30 rule 3). |
| 2026-09-11 | DR3: The empty state has clickable New Document and Open… buttons, not only shortcut hints (WI-4.9) | A mouse user needs something to click on the first screen after a launch with no file; the proposal's swatch only shows ⌘N / ⌘O. |
| 2026-09-11 | DR2: The main bar and status strip are built in this redesign (WI-4.8) | D1 already chose B's structure, and the strip carries "respects the file". Encoding, line ending and a cursor store already exist; only word count is new. |
| 2026-09-11 | This file created | Collects the redesign's register and component contracts in one place, instead of spreading them across the review and the proposal. |

Append entries for non-trivial design decisions, with the rationale as well
as the choice.

## When to read this file

- **Before each redesign work item:** find its component contract and the
  proposal lines.
- **At visual sign-off** (end of Stages 3 and 4): compare `pnpm tauri dev`
  screenshots against the matching board and the contract, in both themes.
- **When adding or changing a token:** add a row here, name only (rule 31
  authoring rule 4).
- **When the redesign lands:**
  - Make this file authoritative.
  - Retire `mdpro-ui-old/DESIGN.md`.
  - Update the root index and the rule 30–34 pointers.
