# Plan P Stage 3 evidence: contrast table and grep proofs (2026-10-15)

The STOP 3 evidence that can be produced from the tree, without a device: the
A9 contrast table for both themes and the grep proofs in the Stage 3
acceptance list
([`stage-3-retune.md`](../plans/20260911-ui-redesign/stage-3-retune.md)).
The after-screenshots, the rule 33 checklist and the title-bar and tab-bar
computed heights need the Mac mini (WI-3.5b), and `/qa-only` comes after that
(WI-3.5c). Measured on branch `test/p-wi35a-contrast-evidence` (plan P
WI-3.5a, with the D227 fix) by mdpro-a3.

**Amended the same day (D227-WI-3, branch `style/d227-revert-toggle-danger`).**
The user re-chose on the prototype: the input-border fix stays, and the
toggle and danger-label fixes are reverted and accepted as exceptions. The
table below shows the ratios after the revert; the
[accepted exceptions](#d227-input-borders-fixed-four-controls-accepted-as-exceptions)
section lists every pair still below A9.

## Contrast table (A9: 4.5:1 text, 3:1 focus and control boundaries)

Ratios are WCAG 2.x, computed from the real theme tokens and the rules that
paint each pair (`tests/support/contrast.ts`). A translucent fill is
composited over the surface it sits on. `tests/contrast-stage3.test.ts`
asserts every row, so a retuned token or a changed rule that drops a pair
below its threshold fails the unit lane.

| Pair | Needs | Light | Dark |
|---|---|---|---|
| --color-text on --color-bg | 4.5:1 | 17.40 | 15.26 |
| --color-text on --color-surface | 4.5:1 | 16.26 | 14.08 |
| --color-text on --color-panel | 4.5:1 | 17.40 | 14.35 |
| --color-muted on --color-bg | 4.5:1 | 4.83 | 7.49 |
| --color-muted on --color-surface | 4.5:1 | 4.52 | 6.91 |
| --color-muted on --color-panel | 4.5:1 | 4.83 | 7.04 |
| link on the editor background | 4.5:1 | 5.17 | 7.43 |
| typed text in a settings input | 4.5:1 | 17.40 | 15.03 |
| primary label at rest | 4.5:1 | 5.17 | 6.70 |
| primary label hovered | 4.5:1 | 6.04 | 7.99 |
| danger label at rest | 4.5:1 | 4.51 | 6.30 |
| danger label hovered | 4.5:1 | **3.76** (exception) | 4.81 |
| menu highlight | 4.5:1 | 5.17 | 6.99 |
| destructive menu item hovered | 4.5:1 | 4.83 | 6.42 |
| active row over --color-surface | 4.5:1 | 5.19 | 4.64 |
| active row over --color-bg | 4.5:1 | 5.53 | 5.15 |
| focus ring on --color-bg | 3:1 | 5.17 | 7.43 |
| focus ring on --color-surface | 3:1 | 4.83 | 6.85 |
| focus ring on --color-panel | 3:1 | 5.17 | 6.99 |
| focus ring on accent-soft | 3:1 | 3.99 | 4.64 |
| input border | 3:1 | 3.34 | 4.46 |
| toggle off-track | 3:1 | **1.61** (exception) | 11.06 |
| toggle on-track | 3:1 | 5.17 | 6.99 |
| toggle knob on the off-track | 3:1 | **1.61** (exception) | **1.61** (exception) |

How the pairs are drawn:

- **Typed text in a settings input:** `.settings-input` text on its
  translucent `--settings-input-bg` over the panel.
- **Link:** WYSIWYG link text on `--color-editor-bg`.
- **Danger label:** Settings › Integrations › Remove, at rest on the button's
  `--color-surface` fill and hovered on `--color-danger-soft` over the client
  row (`--color-bg-secondary`).
- **Active row:** `--color-accent-text` on `--color-accent-soft`, over each
  surface a selected row can sit on.
- **Control boundaries:** measured against the panel, which every Settings
  control sits on.

**Tight but passing:**

- `--color-muted` on `--color-surface`, light: 4.52:1.
- The light danger label at rest: 4.51:1, back to its pre-D227 colour.

A retune of the light muted colour or the surface would cross the line first.

**Recorded, not required:** disabled controls (WCAG exempts inactive
components).

**Placeholder text is not measured here.** The two rendered placeholders,
Link insert's `https://example.com` and Export's `(prompt on export)`, have no
app `::placeholder` rule, so WebKit draws them in its default placeholder
colour, which the tokens cannot predict. The one app rule,
`.settings-search::placeholder`, styles a selector no component renders. The
device run (WI-3.5b) reads the computed placeholder colour in Web Inspector in
both themes. If it is under 4.5:1, that is a new finding.

**Not applicable at this commit:** the segmented control's selected fill
against its track. No segmented control exists yet; WI-4.5 adds it.

### D227: input borders fixed, four controls accepted as exceptions

The first run of this table found three pairs below A9. All three were
already failing before Stage 3, at about the same ratios. The tokens were
`#e5e7eb` borders, the `#ccc` track and an unchanged `--color-danger-soft`.
The user chose fixes on `prototype/p-wi35-a9-controls` (`3159b9c`, verdict
`b7e5c06`), and all three landed in `d64f291`. The user then re-chose for the
toggle and the danger label (verdict `2f47214` on the prototype branch, D227-WI-3), so
those two fixes are reverted. Rulings relayed by mdpro-delegator:

| Pair | Before | Final (light / dark) | Ruling |
|---|---|---|---|
| Form-control border on the panel | 1.22 / 1.36 | **3.34 / 4.46**, fixed | 「A: text 50% both (Recommended)」 |
| Toggle off-track on the panel | 1.61 / 11.06 | 1.61 / 11.06, accepted | 「Accept (today: #ccc)」, superseding 「light 55% / dark 45% (Recommended)」 |
| White knob on the off-track | 1.61 / 1.61 | 1.61 / 1.61, accepted | the same ruling |
| Danger label, hovered | 3.76 / 4.81 | 3.76 / 4.81, accepted | 「Accept (today)」, superseding 「danger-text 80% mix (Recommended)」 |

Audit b145 then found two more control edges on the hairline
`--color-border`. They were shown on the same prototype (`095ff0e`, verdict
`28f21d7`) and accepted. Each ratio is the lower of edge against the
surrounding surface and edge against the control's own fill:

| Control | Ratio (light / dark) | Ruling |
|---|---|---|
| Settings › Keyboard Shortcuts value (`.shortcut-value`) | 1.17 / 1.31 | 「Accept as exception」 |
| Insert Table grid-picker cell (`.grid-picker-cell`) | 1.22 / 1.25 | 「Accept as exception」 |

`tests/contrast-stage3.test.ts` pins the three accepted pairs above at their
ratios (`ACCEPTED`), so a change to one fails and has to be re-ruled. The
[D227 row](../plans/20260912-frontend-backend-sequencing-order.md#d227)
lists the 8 rules that use `--color-control-border` and all four exceptions.

## Grep proofs

Run from the repo root on this branch.

**Chrome font floor (no chrome `font-size` below 12px).**

```
$ grep -rn -E 'font-size:\s*([0-9]|1[01])(\.[0-9]+)?px' src --include='*.css'
src/styles/sections/settings-mcp.css:107:  font-size: 11px;     .mcp-copy-btn.small        deferred, WI-4.2 (icon glyph)
src/styles/sections/settings-shell.css:71:  font-size: 11px;    .settings-sidebar-title    unrendered (orphan selector)
src/styles/sections/toc-sidebar.css:82:  font-size: 10px;     .toc-entry__collapse-icon  deferred, WI-4.2 (icon glyph)
src/styles/sections/tab-bar.css:116:  font-size: 10px;        .tab__dirty-indicator      unrendered (dead TabBar)
src/styles/sections/tab-bar.css:124:  font-size: 10px;        .tab__pin-indicator        unrendered (dead TabBar)
```

Each hit is on a ruled list in `tests/css-tokenization.test.ts`:

- two are glyph sizes deferred to WI-4.2's icons;
- three never render (an orphan selector and the dead `TabBar/`).

No rendered chrome text is below 12px.

**Radii (DR23).** Every chrome `border-radius` is one of the radius tokens,
`50%` or `999px`, with these exceptions:

- `.mcp-status-badge` 12px is deferred to WI-4.4.
- `.milkdown-editor .ProseMirror pre` 8px is a ruled exception (editor
  content, not chrome).
- `.settings-placeholder-card`, `.settings-form-row` and `.settings-search`
  are orphan selectors that never render.
- The dead `TabBar/` (`tab-bar.css`) never renders.
- `App.css` is the A8 dead-code candidate; nothing imports it.

Command: `grep -rh -o -E 'border-radius:\s*[^;]+' src --include='*.css' | sort | uniq -c`.

**Colour literals (tokenization).**
`pnpm exec vitest run tests/css-tokenization.test.ts` passes:

- every hex, `rgb(` and `hsl(` in in-scope CSS is a token definition, one of
  the five ruled exceptions, or on the deferred or unrendered lists;
- the lists are exact (no stale entry);
- the deferred list holds only `stage: 4` entries, 15 of them. D227
  briefly tokenized the toggle track (14), and D227-WI-3 restored the `#ccc`
  entry when the user accepted the track as an exception (ADR-0106); it is
  the colour half of WI-4.4 again.

**Reduced motion (DR13).** `src/styles/globals.css:80` has the one
`@media (prefers-reduced-motion: reduce)` block. It sets
`--motion-duration-fast: 0ms`.

**`color-scheme`.** `src/styles/themes/light.css:2` sets `color-scheme: light`
and `src/styles/themes/dark.css:2` sets `color-scheme: dark`. That native
scrollbars and checkboxes follow them is a device check (WI-3.5b).

**Title-bar and tab-bar heights.**

- The tokens are unchanged since the Stage 3 base `68b3303`:
  `--title-bar-height: 38px` and `--bottom-tabs-height: 36px`.
- The computed heights in both themes still need the device run (WI-3.5b).

**macOS floor (E1).**

- `src-tauri/tauri.conf.json` sets `minimumSystemVersion` to `13.1` (WI-3.4).
- DESIGN.md states 13.1.
- CLAUDE.md's target line is with the user (mdpro-delegator, 2026-10-15).
