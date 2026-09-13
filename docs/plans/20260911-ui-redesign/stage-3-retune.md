# UI redesign plan — Stage 3

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 3 — Visual retune (Deliverable B; items 1, 7, 8, 10, 11, 12, 15)

**Entry:** Deliverable A accepted; Q2 is answered (Q4 is closed by DR15).

### WI-3.0 — Audit `--color-border` used as a fill — S
- Review item 7 says to list consumers that use `--color-border` as a background or fill before it becomes a translucent mix.
- No existing surface token has the same value as `--color-border` in either theme, so a value-preserving retarget needs a new token.
  - **3 or more fill consumers (A10):** add a semantic fill token to both theme files that holds today's `--color-border` value, and retarget the consumers to it. The computed-style diff must stay empty.
  - **Fewer than 3:** retarget them to the nearest surface token as an intended Stage 3 change, and list it in the screenshot index.
- Either way, WI-3.1 then changes borders only.

### WI-3.1 — Theme token retune (items 1, 7, 8, 10, 15) — M
- In both `light.css` and `dark.css`, apply `proposal-ab.html:40-57`:
  - `color-scheme`
  - `--color-accent-soft` retune
  - `--color-border` as a text mix
  - new `--color-border-subtle` and `--color-hover`
  - per-theme `--shadow-soft`, which today exists only in `:root`; the Q2 answer decides the `:root` copy (proposed: keep it, guarded for parity)
- **Item 15 (optional, P2):** derive `--color-code-bg` (review :250).
- **Radii (DR23, required):** snap each deferred radius to its DR23 role.
  - 8px `.toolbar-button` and `.settings-category-btn`, 10px `.settings-search` and 4px `.settings-input` become `--radius-control`.
  - 8px table and image menus, 16px `.dialog-card` and `.settings-dialog`, 12px `.toast` and 12px grouped sections (`.shortcuts-section`, `.recovery-item`) become `--radius-popover`.
  - Nested parts (menu items, tab close, stepper buttons, inline edit, table and grid-picker cells) become `--radius-inner`. If a cell's before/after capture shows 4px breaking its borders, that cell uses `0`.
  - 24px `.toggle-slider` and the 3px About progress bar become `999px`. `.mcp-status-badge` loses its fill in WI-4.4, so its radius goes too.
  - Preflight re-runs the radius grep and assigns each remaining site a role. The selectors above are examples, not the full list.
- D4: `--color-bg`, `--color-surface`, `--color-text` and the other neutrals keep their values.
- **Rule edit:** rule 34 § Theme detection adds that each theme class sets `color-scheme`, so native scrollbars and form controls follow the theme.

### WI-3.2 — Migrate deferred class (b) literals (items 1, 11, 12) — M
- **Item 1:** `globals.css:1032` and `:1747` switch to `--color-accent-soft`.
- **Item 11 (DR12):** colors change instantly; only shape and visibility animate.
  - **Remove** color transitions (preflight re-lists the live sites): `.grid-picker-cell` (`globals.css:639`), the `.toggle-slider` track (`:1335`, `transition: 0.2s` covers every property), `.toc-entry__content` (`:1739`), and `.bottom-tabs__add` and `.bottom-tab` (`BottomTabs.css:24`, `:66`, both `all`). Preflight checks that `all` animated nothing but color. The dead `.tab` rule (`:1629`) is out of scope (A8).
  - **Keep, on the motion tokens:** the switch knob `transform` (`:1347`), and the hover-reveal `opacity` on `.tab__close` (`:1667`), `.bottom-tab__close` (`BottomTabs.css:105`) and `.mcp-copy-btn` (`:1423`). Spinner keyframes (`globals.css:810`, `imagePastePlugin.css:24`) keep rotating.
  - Add one `@media (prefers-reduced-motion: reduce)` block that sets the duration token to zero (proposal :60). Spinners keep rotating (DR13).
  - **Rule edit (DR13):** `.claude/rules/32-component-patterns.md` § Animations replaces "Wrap non-essential motion in `@media (prefers-reduced-motion: no-preference)`" with: every duration comes from the motion tokens, one `@media (prefers-reduced-motion: reduce)` block zeroes them, and progress spinners keep rotating. The modal-entry and theme-property sentences stay.
  - **Test:** extend the tokenization test so a `transition` or `transition-property` that names `background`, `background-color`, `color`, `border-color`, `box-shadow` or `all`, or has no property at all, fails in in-scope CSS.
- **Item 12:**
  - Snap the sub-12px chrome sizes (Baseline hotspots) to the ramp. Resolve the non-ramp sizes per DR22.
  - Add `--font-size-title: 16px` beside the ramp tokens.
  - Preflight sorts each non-ramp selector by role against proposal Board 3: dialog title (:230, :274), settings page title (:242), section label (:244) or card heading (:265). For example, `.settings-title` is the dialog title and `.settings-page-title` the page title; each settings page's `h3` is a page title or a card heading depending on what it heads (assumption — confirm per page).
  - Glyph sizes (`.toast-close`, `.settings-close`, `.settings-stepper button`) go on the deferred list, tagged Stage 4 WI-4.2, which replaces them with icons.
  - Give TOC rows and settings-nav rows `min-height: 28px`.
  - Keep the title-bar and tab-bar heights (review :217).
- **Hover:** row hover moves from `--color-panel` to `--color-hover` (review item 7).
- **Flat rows and tabs:** TOC rows, settings rail items and tabs get no border or shadow at rest; the radius shows only on the hover or selected fill (DESIGN.md § Tokens). The active tab's `--shadow-soft` is the one exception (proposal :45).
- **Item 8:** menus and toasts may use `--color-border-subtle` with the single `--shadow-soft`.
- Remove each migrated `stage: 3` entry from the deferred list.

### WI-3.3 — Focus ring (item 7, DR15) — S
- Add `--color-focus-ring: var(--color-accent)` to `:root`. The proposal's 70% mix (proposal :24) is not used: in the light theme it measures 2.91:1 on the surface and 2.68:1 on accent-soft. The theme classes sit on `<html>`, the same element as `:root`, so the token follows each theme's accent.
- Pattern 2 outlines and pattern 3's inset ring on TOC rows use it. Pattern 1 (input border and soft ring) and pattern 3's accent-soft fill are unchanged.
- Apply the drafted spec-column edit to `.claude/rules/33-focus-indicators.md`, and drop "recent dropdown" from pattern 3's surfaces (none is mounted, WI-1.2).
- Add `.toolbar-button:focus-visible`.
- **Rule edit (DR17):** rule 33's checklist line "Focus visibility holds at 200% browser zoom." becomes "Focus visibility holds at the 400×640 minimum window and with `zoom: 2` on `<html>` in Web Inspector."
- **Test:** `tests/focus-trap.test.ts` stays green. A source-inspection assertion checks that `:root` declares `--color-focus-ring: var(--color-accent)`, and that `.toolbar-button:focus-visible` exists and uses it.

### WI-3.4 — Raise the macOS floor to 13.1 (E1) — S
- Add `bundle.macOS.minimumSystemVersion: "13.1"` to `src-tauri/tauri.conf.json`. macOS 13.1 is the lowest release whose bundled WebKit (Safari 16.2) has `color-mix()`, which the app CSS already uses (`light.css:9-11`, `dark.css:9-11`). No `@supports` fallback is added.
- Change the target in `CLAUDE.md` ("macOS 13+") to macOS 13.1+. DESIGN.md § Product context already states the 13.1 floor; confirm it still does.
- **Verify:** after `pnpm tauri build`, the bundle's `Info.plist` has `LSMinimumSystemVersion` 13.1.

### WI-3.5 — Docs, evidence, QA — S
- Add or update DESIGN.md § Tokens rows for every new or changed token (names only).
- Capture after screenshots for the whole matrix.
- Measure contrast and run the rule 33 protocol.
- Run `/qa-only` on the changed surfaces.

### Stage 3 acceptance criteria
- [ ] G0 passes
- [ ] The tokenization deferred list has no `stage: 3` entries, the test has no `it.skip`, and the per-stage count check asserts 0 for Stage 3 (only `stage: 4` entries remain)
- [ ] Every theme-specific token change landed in both theme files in the same change (rule 31 authoring rule 1); none of the D4 neutral token values changed
- [ ] No chrome `font-size` below 12px (grep proof); non-ramp sizes are resolved per DR22, and the only chrome size outside the ramp is `--font-size-title`
- [ ] Every chrome `border-radius` is `--radius-control`, `--radius-popover`, `--radius-inner`, `50%`, `999px` or `0`, apart from the DR21 dev-toolbar exception (DR23)
- [ ] The title-bar and tab-bar heights are unchanged (computed height in both themes matches the baseline)
- [ ] A `prefers-reduced-motion: reduce` block exists and zeroes the motion duration token, and rule 32 § Animations describes that block (DR13)
- [ ] Only `transform` and `opacity` transitions remain, plus spinner keyframes (the DR12 test passes). Switching Light and Dark in `pnpm tauri dev` shows no fade on tabs, TOC rows, switches or the table grid picker, and hover highlights appear instantly
- [ ] `color-scheme` is set on `.theme-light` and `.theme-dark`; native scrollbars and checkboxes follow the theme in WKWebView (manual check)
- [ ] Focus outlines use `--color-focus-ring`, which equals the accent in both themes (DR15), rule 33's spec column names it, and `.toolbar-button:focus-visible` exists
- [ ] `tauri.conf.json` sets `minimumSystemVersion` to 13.1, and CLAUDE.md and DESIGN.md say macOS 13.1+ (E1)
- [ ] **Screenshot index:** every Appendix B cell has a before/after pair taken in `pnpm tauri dev` (E5), labelled "matches proposal" (same `?theme`/`?page`), "intentionally differs: <reason>", or "no reference"
- [ ] "No reference" surfaces received token changes only, with no layout, spacing or structure changes (checked against the diff)
- [ ] **Contrast table** for both themes. Nothing fails A9 unless it is flagged and explicitly accepted by the user. It covers:
  - text (4.5:1): `--color-text` and `--color-muted` on bg, surface and panel; placeholder text on the input fill; link text on the editor background
  - labels on fills (4.5:1): primary and danger button labels; the menu highlight (`--color-panel` on `--color-accent`, rule 34); active rows (accent text on accent-soft over surface and over bg)
  - the focus ring on bg, surface, panel and `--color-accent-soft` (3:1)
  - control boundaries (3:1): the toggle off-track, input borders, and the segmented-control selected fill against its track
  - disabled controls: recorded, not required (WCAG exempts inactive controls)
- [ ] Rule 33 checklist is done in both themes, at the default window, at 400×640 and with the DR17 2× scale, with who ran each check recorded
- [ ] `/qa-only` findings are listed, each marked fixed, deferred or out of scope
- [ ] Tokenization grep: hex, `rgb(` and `hsl(` in in-scope CSS return only lines that rule 31 § Acceptable hardcoded values or an approved exception permits
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable B
- [ ] **STOP (Deliverable B) — mandatory visual sign-off:** the user reviews the before/after index and explicitly approves before Stage 4

**Proposed commit split (B, proposal only):**
1. `style(css): retarget border-as-fill consumers`
2. `style(theme): derived borders, hover, accent-soft, shadow, color-scheme`
3. `style(css): instant color changes, motion tokens and reduced motion`
4. `style(css): chrome type ramp and row heights`
5. `style(css): focus ring` + `docs(rules): rule 33 focus-ring spec` (DR15)
6. `chore(config): macOS 13.1 minimum for color-mix()`
7. `docs(design): token entries`

**Rollback:** each commit reverts independently. Reverting B leaves A intact, with a zero-diff UI.
