# mdpro UI: Codex-style review of the design canvas

- **Date:** 2026-09-11
- **mdpro commit:** `0a3675e`
- **Reference:** a local style study of the Codex desktop app, not committed. This review keeps only screenshot measurements and paraphrased observations of Codex. It does not reproduce Codex source, token names or token values.
- **Target:** the artboards in `docs/design/mdpro-ui/` (`canvas.json`, `Main`, `Wysiwyg`, `Sidebar`, `Settings`, `Components`, `DirectionA/B/C` `.dc.html`), now in `design/archive/20260920-mdpro-ui-old/`. The boards record the current UI and are kept outside git; the committed proposal is `design/archive/20260911-proposal-ab.html`.
- **Method:** a read-only review. Citations were spot-checked against the files at the commit above (16 of 16 matched).
- **Rule 31:** mdpro's current token values are cited by `path:line` only. Codex observations are paraphrased or screenshot-measured.
- **`DESIGN.md:N` citations** point at the file as of the commit above. It now lives at `design/archive/20260920-mdpro-ui-old/DESIGN.md`.

## Decisions

| # | Decision | Status | Owner / date |
|---|---|---|---|
| D1 | **Direction: A's register (Quiet paper) with B's structure (Command surface).** Section 1 lists the concrete edits | **Decided** | owner, 2026-09-11 |
| D2 | P6 Source font: **hybrid.** New installs default Source mode to mono. A "Source font" preference (Monospace / Follow editor font) keeps existing profiles on the editor font (item 3) | **Decided** | owner, 2026-09-11 |
| D3 | P7 code hue: **none.** Markers use accent, meta uses muted, code uses text (item 2) | **Decided** | owner, 2026-09-11 |
| D4 | P10 neutrals: **keep mdpro's current cool neutrals.** Only derived mechanics are adopted (item 15) | **Decided** | owner, 2026-09-11 |

The owner decided D2–D4 after consulting Codex. The reasoning is recorded in the DESIGN.md decisions log.

The companion artifact `design/archive/20260911-proposal-ab.html` renders the decided state. The D2 and D3 toggles remain, so the alternatives that were not chosen can still be compared.

## 1. Direction: A's register with B's structure

**Why this combination.**
- **What Codex shares with A.** Codex chrome is two flat neutral surfaces, hairlines and neutral selection (screenshot-measured). That is A's "chrome drops to tone and space" (`DirectionA.dc.html:60`).
- **What Codex shares with B.** Codex keeps every affordance pinned: a 46pt bar and 30pt rows. That is B's structural honesty, not A's "no bar, no borders" (`DirectionA.dc.html:56`).
- **Why not C.** C (`DirectionC.dc.html:55,60`) is the opposite of Codex; nothing in Codex appears on pointer approach.

**Edits to each direction.**
- **From A: keep**
  - The tone-based outline (`DirectionA.dc.html:31-35`).
- **From A: change**
  - Drop the serif display face (`DirectionA.dc.html:38`). Codex and `DESIGN.md:65` both use the system sans.
  - Restore a hairline title bar and a 0.5px sidebar edge.
- **From B: keep**
  - The mode switch (`DirectionB.dc.html:32-33`), built as the segmented control in item 9.
  - The elevated command/palette card (`DirectionB.dc.html:50`). It matches the elevated composer card in Codex.
- **From B: change**
  - Demote the 2px boxed bars (`DirectionB.dc.html:28,58`) to hairlines.
  - Keep the status readouts, but set them in the chrome sans, with mono only for values (`DESIGN.md:65`).
- **From C:** at most the floating tab-pill idea (`DirectionC.dc.html:48`), as an optional distraction-free mode. Not the tick rail.

**Tension to keep in mind.**
- **Codex is a coding-agent surface: dense and tool-forward.** mdpro's memorable thing (`DESIGN.md:37-43`) benefits from Codex mainly in Source mode: mono, themed markers, visible structure.
- **Elsewhere, Codex density fights "the editor disappears"** (`DESIGN.md:61`). Take the token mechanics, not the density.

## 2. Prioritized suggestions

Priority: **P0** fixes a real defect (broken dark mode, illegibility); **P1** is a clear polish win; **P2** is optional. Effort: S / M / L.

### P0

**1. Theme the two hardcoded accent fills (TOC active, shortcut "Recording…")**: P0 / S
- **Area:** Sidebar, Main, WYSIWYG-dark, Components.
- **Now:**
  - The active TOC row uses a light-only rgba accent literal: `Main.dc.html:208`, `Sidebar.dc.html:84,175`.
  - The same literal appears on the dark board: `Wysiwyg.dc.html:57`.
  - The shortcut-editing chip repeats it: `Components.dc.html:108`.
  - Shipped code: `src/styles/globals.css:1747`, `:1032`.
- **Codex:**
  - Selected rows are one neutral step off the surface, #f0f1f1 / #333333 (screenshot-measured).
  - Soft fills are derived from base colors rather than fixed per-theme literals.
- **Change:**
  - Consume `--color-accent-soft`, retuned to `color-mix(in srgb, var(--color-accent) 14%, transparent)` in `.theme-light` and `22%` in `.theme-dark`.
  - Redraw `Wysiwyg.dc.html:57-59` with the dark pair.
- **DESIGN.md:** agrees (`DESIGN.md:111`; rule 31 selection pattern).

**2. Themed Source-mode syntax palette**: P0 / M
- **Area:** Main (source). Needs a dark Source artboard.
- **Now:**
  - `Main.dc.html:90-117` reproduces the unmodified CodeMirror default highlight, which does not swap for dark.
  - Shipped code: `src/components/Editor/extensions/syntax.ts:3` (`defaultHighlightStyle`).
  - `canvas.json` `note-dark` calls it the weakest contrast in the app.
- **Codex:**
  - Few semantic colors; "just use the default foreground" (tui-guide styles.md:9).
  - Code colors swap per theme, e.g. keyword #751ed9 / #b06dff (screenshot-measured).
- **Change:** an mdpro `HighlightStyle` that reads:
  - `--color-syntax-markup: var(--color-accent)` for heading, list, quote and fence markers.
  - `--color-syntax-meta: var(--color-muted)` for URLs, link targets and HTML.
  - Body text in `--color-text`.
- **D3 / P7, decided: position 1.**
  - Markers, meta and text only (`DESIGN.md:62,111`). Inline and fenced code use `--color-text`.
  - Code stays distinguishable through fences, the code background and the mono face.
  - Not adopted: a `--color-syntax-code` green. Green already signals success (`src/styles/globals.css:1842`) and diff additions.
  - Keep the One Dark path consistent (`src/components/common/settings/editorPrefApply.ts:183-186`).
- **DESIGN.md:** agrees.

**3. Source mode in mono (P6)**: P0-adjacent / S
- **Area:** Main (source).
- **Now:**
  - `Main.dc.html:84` sets the source pane in the proportional editor sans, so the pipe table at `:112-115` cannot align (`canvas.json` `note-sourcefont`).
  - Shipped code: `src/styles/globals.css:31`, `:336`.
- **Codex:** diffs and code render in a monospace face with generous line height.
- **Change:**
  - Add `--source-font-family: var(--font-mono)` in `:root`, consumed by `.cm-content`. It is selected by the new `sourceFont` preference described under D2 below, not by the existing font preset.
  - Keep mdpro's editor size and `--editor-line-height`; don't adopt Codex's 12px.
- **D2 / P6, decided: hybrid.**
  - **Why mono:** "respects the file" (`DESIGN.md:37-43`) is better served by visible structure. The "same fonts" clause in DESIGN.md is revised accordingly.
  - **Why not a plain default change:** `fontFamily: "system"` (`src/types/preferences.ts:284`) can't tell an untouched default from an explicit choice. A new `sourceFont` preference is needed: a missing field means Follow editor font, and the first-run profile writes Monospace.
  - **Verify when implementing:**
    - scroll and selection mapping across mode switches
    - CJK, emoji, tabs and full-width punctuation. CJK falls back to the system CJK face, so tables that contain CJK won't align exactly.

**4. One outline icon set, one close glyph, one caret**: P0 / M
- **Area:** Components, Settings, Main, Sidebar.
- **Now:**
  - The "icon set" is text glyphs plus emoji: `Components.dc.html:197-207`.
  - Three close characters at three sizes: `Main.dc.html:166`, `Components.dc.html:187`, `Settings.dc.html:65`.
  - Text carets: `Sidebar.dc.html:55`.
  - Emoji settings nav: `Settings.dc.html:258-267`.
  - Shipped code: `src/components/common/SettingsDialog.tsx:30-38`, `src/components/BottomTabs/BottomTabs.tsx:73`.
- **Codex:** one monochrome outline icon set in two small sizes, tinted from the foreground color.
- **Change:**
  - Add `--icon-size-sm: 14px` and `--icon-size-md: 16px` in `:root`.
  - Build one `Icon` wrapper with `stroke: currentColor` and a default `color: var(--color-muted)`.
  - Close is an `x` at 14px inside the existing close box. TOC carets are chevrons at 14px. Settings-nav icons are 16px.
  - Redraw the Components inventory with the real set.
- **DESIGN.md:** agrees (`DESIGN.md:80` "no emoji as design").

**5. Settings rows: one row contract, one boolean control**: P0 / S / (`canvas.json` `note-settings`)
- **Area:** Settings.
- **Now:**
  - Export rows use bare `h4`/`p` (`Settings.dc.html:93-94,106-107`) and a native checkbox (`:111,220`).
  - Integrations uses `strong` + description + toggle (`:123-124,130`).
  - As a result, identical rows render at two different heights (`:208,225`).
  - Shipped code: `src/styles/globals.css:1296,1301,1314`.
- **Codex:** settings card rows are 45pt for one line and 61pt for title + description, with 0.5pt in-card dividers and a 33×20 switch (screenshot-measured).
- **Change:**
  - Extend the `.settings-row-label strong` / `.settings-row-description` selectors to `h4` / `p` (or migrate the eight panels).
  - Always use `.toggle-switch`.
  - Target a 56–60px two-line row, with `--color-border-subtle` dividers once that token exists.
- **DESIGN.md:** agrees (`DESIGN.md:61`).

### P1

**6. Retire the "Running" mint badge and the hardcoded toggle track**: P1 / S
- **Now:**
  - The badge is fixed green-on-mint: `Settings.dc.html:127`, `Components.dc.html:102`.
  - The off-state toggle track is a gray literal: `Components.dc.html:95`, `Settings.dc.html:142`.
  - Shipped code: `src/styles/globals.css:1371-1372`.
- **Codex:**
  - Green is reserved for additions, #01a241 / #41c977 (screenshot-measured; tui-guide styles.md:11).
  - Status is shown as a dot plus foreground text.
- **Change:**
  - Show a 6px dot in `var(--color-accent)` plus "Running" in `--color-muted`, with no fill. If a semantic green is wanted, add `--color-success` / `--color-success-soft` via `color-mix` in both theme files instead.
  - Off-track: `color-mix(in srgb, var(--color-text) 12%, transparent)`.
- **DESIGN.md:** agrees (`DESIGN.md:62`).

**7. Foreground-alpha borders, hover, and a focus-ring token**: P1 / M
- **Now:**
  - Hover paints the row in `--color-panel` (`Main.dc.html:30`, `Sidebar.dc.html:24,81`; shipped `src/styles/globals.css:1633,1743`). That lightens in light and darkens in dark.
  - Each theme has one fixed border literal (`src/styles/themes/light.css:7`, `dark.css:7`).
  - Row focus is unimplemented (`Components.dc.html:85-88`), and only two `:focus-visible` rules exist (`src/styles/globals.css:572,648`).
- **Codex:**
  - Borders and hover fills are derived from the foreground color at low opacity, so they adapt to both themes.
  - They render near #ededed / #353535 (screenshot-measured).
  - Focus rings use a translucent accent.
- **Change:**
  - `--color-hover`: 5% light, 8% dark.
  - `--color-border` → a text mix at 10% light, 12% dark.
  - `--color-focus-ring: color-mix(in srgb, var(--color-accent) 70%, transparent)` for rule 33 patterns 1–3.
  - Add `.toolbar-button:focus-visible`.
  - First audit the `--color-border` consumers that use it as a fill.
- **DESIGN.md:** agrees (`DESIGN.md:62`).

**8. Elevation: hairline ring inside the single shadow**: P1 / S
- **Now:**
  - Popovers rely on a 1px border plus one wide shadow (`Components.dc.html:135,152,175,185`).
  - The boards hand-author per-theme shadows (`Settings.dc.html:23,36`) that shipped `:root` does not have (`src/styles/globals.css:15`).
- **Codex:**
  - Elevated surfaces combine a hairline ring with faint shadows.
  - Popovers have a 0.5pt border and an ≈8pt shadow (screenshot-measured).
- **Change:** keep one `--shadow-soft` and define a hairline-ring plus faint-shadow pair in both theme files. Menus and toasts may then drop to `--color-border-subtle`.
- **DESIGN.md:** agrees (`DESIGN.md:69`).

**9. Mode label → a real segmented control (B's mode switch)**: P1 / S
- **Now:**
  - The "SOURCE" chip is 10px uppercase on a fill that matches the sidebar, so it has no edge (`Main.dc.html:50`, `Sidebar.dc.html:48`).
  - Components draws a separate button pair for the same job (`Components.dc.html:67-68`).
- **Codex:** a segmented control. The selected pill is #f4f4f4 at 62×24; unselected segments are bare text #8e8f90 (screenshot-measured).
- **Change:**
  - A 24px-tall "Source | WYSIWYG" control.
  - Selected segment: `--color-hover` fill with `--color-text`. Unselected: `--color-muted`. 12px text, 6px radius, no uppercase tracking.
  - Use the same element in both the sidebar-on and sidebar-off headers (`Main.dc.html:77`).
- **DESIGN.md:** agrees (`DESIGN.md:61`); rule 30 rule 1.

**10. `color-scheme` on the theme classes**: P1 / S
- **Now:** the native checkbox at `Settings.dc.html:111` is the visible symptom; nothing sets `color-scheme` in `src/**/*.css`.
- **Codex:** its theme classes set `color-scheme`, so native controls follow the theme.
- **Change:** `color-scheme: light` in `.theme-light` and `dark` in `.theme-dark`. Verify scrollbars in WKWebView.
- **DESIGN.md:** agrees (`DESIGN.md:61,71`).

**11. Motion tokens + reduced motion**: P1 / S
- **Now:**
  - `Sidebar.dc.html:81` documents an ad hoc transition.
  - There are seven `transition` sites in `src/styles/globals.css` (:639, :1335, :1347, :1423, :1629, :1667, :1739).
  - There are no `prefers-reduced-motion` queries in `src/`.
- **Codex:** short default durations, named enter/exit curves, and reduced-motion handling throughout.
- **Change:**
  - In `:root`: `--motion-duration-fast: 150ms` and `--motion-ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`.
  - One `@media (prefers-reduced-motion: reduce)` block that sets the duration to 0.
- **DESIGN.md:** agrees (`DESIGN.md:70`).

**12. Chrome type ramp and explicit row heights**: P1 / M
- **Now:**
  - Chrome sizes are scattered literals (`Main.dc.html:50,54,59,163`, `Settings.dc.html:74`).
  - TOC row height is implicit (`canvas.json` `note-toc`).
  - Shipped code: `src/styles/globals.css:122`.
- **Codex:**
  - A small, named chrome type ramp in 1px steps.
  - Nav rows 30pt, buttons 28pt (screenshot-measured).
- **Change:**
  - Add `--font-size-ui-sm` / `--font-size-ui` / `--font-size-ui-lg` = 12/13/14px.
  - Nothing in chrome below 12px.
  - TOC and settings-nav rows get `min-height: 28px`.
  - Keep mdpro's current title-bar and tab-bar heights; density is a product choice.
- **DESIGN.md:** agrees (`DESIGN.md:67`, rule of three).

**13. Dialog button hierarchy**: P1 / S / rule 30
- **Now:** "Cancel" and "Discard" are identical secondary buttons (`Components.dc.html:142-143,147`), yet a danger variant exists on the same board (`:62-63`).
- **Codex:** primary emphasis is the foreground color, not blue (screenshot-measured).
- **Change:**
  - Discard uses the existing danger outline variant: `--color-danger` text and border, `--color-danger-soft` on hover.
  - Cancel stays secondary.
  - Do not adopt Codex's black fill (section 3).
- **DESIGN.md:** agrees (`DESIGN.md:62`).

### P2

**14. Settings rail: flat surface, tokenized active state**: P2 / S
- **Now:**
  - The rail is a two-stop gradient (`Settings.dc.html:17,30,72`).
  - The active item uses a bespoke accent pair (`:20-21,33-34`; shipped `src/styles/themes/light.css:17,21-22`).
- **Codex:** settings nav sits on the plain sidebar surface. The selected row is a neutral step, #f0f1f1 / #333333, radius ≈10pt (screenshot-measured).
- **Change:**
  - `--settings-sidebar-bg: var(--color-surface)`.
  - Active uses the rule 31 pattern (`--color-accent-soft` fill, `--color-accent` text). Hover uses `--color-hover`.
  - Retire `--settings-btn-hover-bg` / `--settings-btn-active-bg` once migrated.
- **DESIGN.md:** agrees (`DESIGN.md:62`).

**15. Derived code surface and semantic radius tokens (optional)**: P2 / S+M
- **Now:**
  - The code surface is a fixed color (`Wysiwyg.dc.html:31-32`; `src/styles/themes/light.css:14`, `dark.css:14`).
  - Radii are scattered (`Components.dc.html:33-34,152,175,185`).
- **Codex:**
  - The code surface is derived from the page surface, mixed slightly toward the text color.
  - Popover ≈15pt, card ≈12pt, row ≈10pt (screenshot-measured).
- **Change:**
  - `--color-code-bg: color-mix(in srgb, var(--color-editor-bg) 94%, var(--color-text))`.
  - `--radius-control: 6px` and `--radius-popover: 10px`, from the `DESIGN.md:68` scale.
- **D4 / P10, decided: keep the current neutrals.** The derived mix keeps mdpro's cool tint, which is intended.
- **DESIGN.md:** agrees (`DESIGN.md:68`).

## 3. Don't copy

- **OpenAI Sans and Codex's gray ramp.** OpenAI Sans's license is unverified. The gray ramp is out: D4 decided to keep mdpro's neutral family, which is part of its identity.
- **Foreground-colored primary buttons and the black user bubble** (screenshot-measured). mdpro's accent is blue by decision (`DESIGN.md:64`); a black primary would add a second emphasis system (`DESIGN.md:111`).
- **A fixed control blue separate from the accent.** mdpro uses one accent for switches and focus.
- **Neutral-step menu hover.** mdpro's solid-accent menu highlight (`Components.dc.html:36,158`) is the macOS-native pattern and rule 32. Keep it.
- **Codex's 46pt in-web title bar and 24px chrome.** mdpro's overlay title bar is native and lighter; no action.
- **Excluded mechanisms.** Translucent sidebar, `superellipse`, `light-dark()`, `[data-theme]` and a Tailwind `--spacing` scale are all excluded, by rule 34's theme convention and rule 31's rule of three.
- **12px body/diff text.** A writing tool keeps its editor size and `--editor-line-height` (`DESIGN.md:66`).

## 4. Missing states and artboards

- **Dark Source mode** with the themed palette (item 2). `Wysiwyg.dc.html` is dark WYSIWYG only.
- **Pinned dark frames for Settings and Components.** Both boards have a `theme` prop but no dark frame to review (rule 34).
- **Hover and focus-visible for every interactive row:** toolbar buttons (`Components.dc.html:88`), tabs, TOC rows (rule 33 pattern 3), settings nav, all using `--color-focus-ring`.
- **Text-hierarchy sheet.**
  - Codex uses six text tiers: primary / secondary / tertiary / section / placeholder / disabled (screenshot-measured).
  - mdpro's boards use only `--color-text` and `--color-muted`.
  - Decide whether a third tier is needed.
- **Missing surfaces:**
  - popover and menu elevation in dark (item 8)
  - the recent-files dropdown (`src/styles/globals.css:415`; absent from the canvas)
  - disabled-with-reason button (rule 30 rule 4)
  - the external-file-changed banner
  - the drag-and-drop target
  - the empty document / no-tabs state
  - toast variants
- **The eight undrawn Settings pages** (`Settings.dc.html:163-168`), once the row contract (item 5) exists.

## 5. Top 5

1. Themed Source-mode syntax, plus a dark Source artboard (item 2): today's worst contrast.
2. An outline icon set replacing glyphs and emoji (item 4): the cheapest whole-app lift.
3. Tokenize the two hardcoded accent fills and redraw the dark TOC (item 1).
4. One settings row contract, with `.toggle-switch` everywhere (item 5).
5. Foreground-alpha border, hover and focus tokens, plus `color-scheme` (items 7 and 10).
