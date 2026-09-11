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
| **Radius** | Two semantic tokens: `--radius-control`, `--radius-popover` | Controls and rows share one radius; floating surfaces share the other. Other radii wait on Q9. |
| **Elevation** | Single `--shadow-soft`, now a hairline ring plus one faint shadow, defined per theme | One elevation for popovers, dialogs, menus, toasts and the active tab. |
| **Motion** | One duration token and one easing token, zeroed under reduced motion | Short, functional, one switch to turn it all off. |
| **Icons** | One outline set in two sizes, `currentColor`, muted by default | Replaces text glyphs and emoji. |
| **Theme** | `.theme-light` / `.theme-dark` on `<html>`, each setting `color-scheme` | Native controls and scrollbars follow the theme (rule 34). |

## Tokens

New and redefined tokens, by name. Values are at the cited proposal lines.

- **Theme-scoped tokens** go in both theme files in the same commit.
- **`:root` tokens** derive from bases that are theme-scoped (rule 31).

### Color

| Token | Change | Scope | Role | Proposal | Item |
|---|---|---|---|---|---|
| `--color-accent-soft` | retuned mix | both themes | Selection and focus fill. Dark mixes more strongly. | :42, :51 | 1 |
| `--color-hover` | new | both themes | Hover fill for rows, tabs and icon buttons; selected segment | :45, :54 | 7 |
| `--color-border` | redefined as a text mix | both themes | Hairlines and control edges | :43, :52 | 7 |
| `--color-border-subtle` | new | both themes | Row dividers, dialog header/footer, rail edge | :44, :53 | 5, 8 |
| `--color-focus-ring` | new | `:root`, from accent | Focus outlines and rings (see [Focus](#focus)) | :24 | 7 |
| `--color-syntax-markup` | new | `:root`, from accent | Source markers: heading, list, quote, emphasis, fence, backtick, table pipe, link brackets | :25 | 2 |
| `--color-syntax-meta` | new | `:root`, from muted | Link targets, URLs, fence info strings, HTML | :26 | 2 |
| `--color-code-bg` | redefined as an editor-bg mix | both themes | Code surfaces; keeps the cool tint (D4) | review item 15 | 15 |
| `--settings-sidebar-bg` | points at `--color-surface` | both themes | Settings rail | — | 14 |

- **`--color-border`:** before redefining it, audit consumers that use it as a
  fill (WI-3.0).
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
| `--font-size-ui` | `:root` | TOC rows, menus, row titles, buttons, inputs | :31, :598 | 12 |
| `--font-size-ui-sm` | `:root` | Tabs, status strip, descriptions, section labels, segmented control | :30, :599 | 12 |
| `--source-font-family` | `:root` mono default; set at runtime from `sourceFont` | Source-mode content | :27, :59 | 3 |
| `--icon-size-md` | `:root` | Settings rail, menus, toolbar, toasts | :36 | 4 |
| `--icon-size-sm` | `:root` | Tab close, TOC carets, new-tab button | :35 | 4 |
| `--radius-control` | `:root` | Buttons, inputs, segmented control, rows, tabs, icon buttons | :33 | 15 |
| `--radius-popover` | `:root` | Menus, dialogs, toasts | :34 | 15 |
| `--motion-duration-fast` | `:root`; zeroed under reduced motion | Every hover, press and switch transition | :28, :60 | 11 |
| `--motion-ease-out` | `:root` | The same transitions | :29 | 11 |

- **Chrome font floor:** nothing in chrome goes below the small step.
- **`color-scheme`:** a property, not a token. `.theme-light` and `.theme-dark`
  set it (proposal :41, :50; item 10).
- **Unchanged tokens:**
  - `--font-sans`. The proposal's `--font-ui` (:17) is only a placeholder for
    it.
  - `--font-mono`, `--editor-font-*`, `--title-bar-height`,
    `--bottom-tabs-height`.
  - `--color-accent`, `--color-danger`, `--color-danger-soft`.
  - The base neutrals (D4) and the z-index table (rule 31).

## Layout

**Main window** (proposal :358-440):
- **Sidebar:** on `--color-surface` with a hairline right edge. The top strip
  clears the traffic lights, using the existing tokens. The "Contents" label
  is small and muted.
- **Main column:**
  - **Bar:** a hairline-bottomed bar. Breadcrumb on the left (folder muted,
    file name in text color); the Source | WYSIWYG segmented control on the
    right. The same control appears whether the sidebar is shown or hidden
    (item 9).
  - **Editor:** on `--color-editor-bg`.
  - **Status strip:** below the editor.
- **Bottom tab bar:** full width on `--color-surface`, with a hairline top.
- **Heights:** the shipped title-bar and tab-bar heights stay. Density is a
  product choice.

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
  replace text carets. No emoji or text glyphs as icons.
- **Accessible names:** icon-only controls always have one.

### Segmented control (item 9; proposal :114-121, :566-574)

- **Shape:** 24px tall, `--radius-control`, hairline border on `--color-bg`.
  Small text, no uppercase or letter-spacing.
- **States:**
  - Selected: `--color-hover` fill, `--color-text`, medium weight.
  - Unselected: `--color-muted`; hover turns it to text color.
  - Disabled: reduced opacity.
  - Focus: see [Focus](#focus).
- **Selection:** exposed with `aria-pressed` or radio semantics (WI-4.5).
  ⌃2 / ⌃4 update the selection.
- **Used for:** the editor mode, and the Source font preference.

### Buttons (item 13; proposal :179-190, :533-537)

- **Base:** 28px tall, `--radius-control`, `--font-size-ui`, medium weight.
- **Secondary (default):** `--color-panel` fill and a hairline border;
  `--color-hover` on hover.
- **Primary:**
  - `--color-accent` fill with `--color-panel` text. Hover mixes the accent
    toward the text color.
  - Never a black or foreground fill.
  - One per surface (rule 30 rule 1).
- **Danger:** transparent, with `--color-danger` text and border, and
  `--color-danger-soft` on hover.
- **Disabled:** reduced opacity, with the reason stated inline next to the
  button (rule 30 rule 4).
- **Icon button:** 24px square, transparent, muted icon; hover gives
  `--color-hover` and text color (proposal :162-165).

### Destructive confirmation (item 13; proposal :538-544)

- **Confirm button:** Discard-type confirmations use the danger variant.
  Cancel stays secondary (WI-4.6: `ConfirmDialog` at its three Discard
  callers).
- **Order and behavior:** button order, focus trap and Esc follow the rule 32
  modal contract.
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
- **One row contract across all settings panels.** Titles and descriptions use
  the same classes whether the markup is `strong`/`span` or `h4`/`p`.
- **Controls:**
  - `ToggleSwitch` for booleans.
  - Segmented control for two- or three-way choices.
  - 28px inputs; numeric inputs are narrow and mono.
  - A secondary button for Browse….
- **Inputs:** `--color-bg` fill, hairline border, muted placeholder.

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
  - Focus: accent-soft fill without the accent text, so focus and selection
    stay distinguishable.

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

### Toasts (proposal :278-281, :558-564)

- **Card:** the same card as menus; the icon uses the accent.
- **Error variant:** a danger icon and an inset danger edge on the left, not a
  second shadow.
- **Placement:** bottom-right, one at a time (rule 32; rule 30 rule 5).

### Empty state (proposal :284-286, :607-609)

- **When:** no documents are open.
- **Look:** on `--color-editor-bg` with a dashed hairline edge.
- **Content:** a muted file icon, a short title, and the New / Open shortcuts
  in `kbd`.

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
- **Contents:** cursor position, word count, encoding and line endings.
- **Empty values:** render only fields with a known, nonzero value (rule 30
  rule 2).
- **No palette hint:** the proposal's "Commands ⌘K" hint (:426) does not
  ship, because there is no command palette (Q11).

## Focus

Rule 33's four patterns stay; only the color source changes.

| # | Pattern | Surfaces | Redesign spec |
|---|---|---|---|
| 1 | Border + soft ring | Text inputs | Accent border + accent-soft ring, as drawn at proposal :255 |
| 2 | Outline | Buttons, icon buttons, switches, segments, toolbar buttons | 2px `--color-focus-ring` outline (proposal :120, :165, :189, :201). Adds the missing `.toolbar-button:focus-visible` (item 7). |
| 3 | Background | TOC rows, tabs, settings rail | `--color-accent-soft` fill. Selected items keep accent text, so focus ≠ selection. TOC rows add an inset ring. |
| 4 | Editor widgets | Image handles and similar | Unchanged |

- **Q4 is open.** Moving the rule 33 spec to `--color-focus-ring` needs its
  approval, and item 7 says patterns 1–3 while the proposal draws pattern 1
  unchanged. If Q4 is declined, patterns 2–3 keep `--color-accent`, and
  `.toolbar-button:focus-visible` is still added.
- **Contrast:** focus indicators need at least 3:1 against bg, surface and
  accent-soft in both themes, checked at 100% and 200% zoom (plan A9).

## Theme

- **Classes:** `.theme-light` / `.theme-dark` on `<html>`; System resolves to
  one of them. No `[data-theme]`, no `light-dark()` (rule 34).
- **`color-scheme`:** each theme class sets it. Verify scrollbars and native
  inputs in WKWebView.
- **Base neutrals keep their values** (D4): `--color-bg`, `--color-surface`,
  `--color-panel`, `--color-text`, `--color-muted`. Only borders, hover, code
  surface and shadow become derived.
- **Review:** use `proposal-ab.html?theme=dark` or the Side by side view.
  Sign-off screenshots come from `pnpm tauri dev` (E5).

## Motion

- **What animates:** `background-color`, `color`, `border-color` and the
  switch knob's `transform`. Every transition uses `--motion-duration-fast`
  and `--motion-ease-out`.
- **Theme switches:** no transition lists a theme-related property, so a
  theme switch never animates (rule 32).
- **Reduced motion:** one `@media (prefers-reduced-motion: reduce)` block sets
  the duration token to 0, which stops every transition at once.
- **Not used:** scroll-driven or decorative motion.

## What we deliberately don't do

- **No card grids, icon-in-circle decoration, purple gradients, emoji as
  design, marketing surfaces, or "built for X" copy.**
- **No reference-app look** (review §3, proposal :619-629):
  - No borrowed brand font and no borrowed gray ramp: `--font-sans` and the
    current neutrals stay.
  - No black or foreground-colored primary button: primary is the accent.
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
| 33 spec column | Patterns use `--color-accent` | Patterns use `--color-focus-ring` | WI-3.3, if Q4 is approved |
| 30 § Core principles | "Same fonts" across modes | Source mode may use mono (D2) | not planned |
| 32 § Animations | Wrap motion in `prefers-reduced-motion: no-preference` | Motion tokens zeroed in one `reduce` block | not planned |
| 34 | Silent on `color-scheme` | Theme classes set `color-scheme` | not planned |

Rows marked "not planned" need a docs work item before the redesign counts
as landed.

## Open questions

Leave these open; don't pick an answer while building.

- **Text tiers:** is a third text tier needed beyond `--color-text` and
  `--color-muted`? (review §4)
- **Sizes and radii outside the tokens:** chrome sizes (Q8) and radii (Q9).
  The proposal still uses literals for the 16px settings page title, the
  nested segment and menu-item radius, and the 20px sheet icons.
- **Other plan questions:** Preview highlight.js in dark (Q1), One Dark next
  to the new HighlightStyle (Q3), the focus-ring rule edit (Q4).
- **Switch knob colors:** the knob's color and shadow are keyword literals in
  the proposal (:195-196). Tokenize them or add them to rule 31's exceptions.
- **Surfaces the proposal doesn't draw:**
  - the recent-files dropdown
  - the external-file-changed banner
  - the drag-and-drop target
  - seven of the ten settings pages

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
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
