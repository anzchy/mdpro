# Drift report: shipped CSS vs the target design

- **Code:** `master` `0bd1f1b1`, 27 CSS files (2,893 lines) under `src/styles/`, `src/components/`, `src/plugins/`.
- **Compared with:** `docs/design/mdpro-ui-new/DESIGN.md` (last commit `647b3d32`, 2026-10-17) and `proposal-ab.html` (last commit `fbe7f4ab`, 2026-09-11).
- **Method:** I read the token and theme files in full, then scanned every other CSS file for colour, size, radius, motion and z-index values that are typed out by hand instead of using a token. Comments were stripped before scanning. I didn't build or render the app.

## Headline

The CSS is in good shape. 452 `var(--…)` uses against 8 hand-typed colours, and no CSS references a token that isn't defined. Most of the gap is **work that is planned but not built yet**, and some is **dead code**. Very little is real drift.

## A. Planned, not built (no action, already scheduled)

| Target design says | Shipped | Where it's scheduled |
|---|---|---|
| Source mode colours Markdown markers with the accent and link targets with muted (`--color-syntax-markup`, `--color-syntax-meta`) | `src/components/Editor/extensions/syntax.ts` uses CodeMirror's `defaultHighlightStyle` | WI-4.1 (Source syntax highlighting), T6 |
| New installs default Source mode to monospace (`--source-font-family`) | Source uses the editor font | WI-4.1 / D2 |
| `--icon-size-sm` / `--icon-size-md` | not defined | WI-4.2 (Icon wrapper) |
| `--motion-ease-out` on the switch knob and hover reveals | not defined; transitions use the browser default easing | listed in DESIGN.md § Motion; I found no WI that names it |

The Source-mode rows matter most. DESIGN.md's "memorable thing" says *Source mode shows the file's structure*, and that is the part not yet built.

## B. Dead CSS (safe-looking cleanup, check before deleting)

| What | Evidence |
|---|---|
| `src/styles/sections/tab-bar.css` (126 lines) and `src/components/TabBar/` | Nothing imports `TabBar`; only `src/types/preferences.ts` mentions the name. Bottom tabs are `BottomTabs/`. This file also holds most of the rule breaks below: `0.15s` / `0.3s` background transitions (against DR12), a raw `rgba(0,0,0,.08)` shadow, and 10px type. |
| `.settings-search`, `.settings-sidebar-title`, `.settings-placeholder-card` | No `.tsx` file uses these classes |
| `--settings-sidebar-bg`, `--settings-btn-hover-bg`, `--settings-btn-active-bg` | Defined in `globals.css` and both theme files but never read. DESIGN.md marks the button pair "retired once the rail migrates (WI-4.7)" and says the sidebar bg "points at `--color-surface`". Both are done in practice, but the definitions are still there. |

## C. Real drift in live code (against DESIGN.md or rules 31–34)

| # | Location | Shipped | Target / rule |
|---|---|---|---|
| 1 | `settings-mcp.css:14-15` `.mcp-status-badge.running` | green `#dcfce7` / `#16a34a`, the same in both themes | "green is not used for status" (DESIGN.md § Aesthetic register). No dark variant either. |
| 2 | `settings-pages.css:25-26` `.settings-dirty-banner` | amber `rgba(245,158,11,…)` | No warning token exists; this is a second hue in the chrome |
| 3 | `MilkdownEditor.css:266` `mark` | pink `rgba(255,85,130,.65)` | No token; same value in both themes |
| 4 | `MilkdownEditor.css:105` `pre` | `border-radius: 8px` | Not one of the three radius tokens (4 / 6 / 10) |
| 5 | `settings-pages.css:64`, `settings-mcp.css:8` | `border-radius: 12px` | Not a radius token. The badge is a pill, so it should be `999px` per DR23. |
| 6 | `settings-pages.css:102` | `border-radius: 10px` | Equals `--radius-popover` but is typed out by hand |
| 7 | `toc-sidebar.css:88` (TOC caret), `settings-mcp.css:115` (`.mcp-copy-btn.small`) | 10px, 11px | 12px chrome floor (DESIGN.md § Type) |
| 8 | `settings-about.css:91` | `var(--color-accent, #007aff)` | The fallback is Apple's system blue, not mdpro's accent. Harmless while the token exists, but it's a wrong value. |
| 9 | `globals.css`, both themes | `--color-danger-soft` mixes the hex `#dc2626` / `#f87171` | Should mix `var(--color-danger)`, as `--color-accent-soft` does |
| 10 | `globals.css` `:root` | repeats every light-theme value from `light.css` | Two copies to keep in sync. A fallback for no-theme contexts, but no test pins them as equal. |
| 11 | z-index `1000` (image and table context menus), `30` (toast), `20` (dialog) | Check these against rule 31's z-index table |

## D. Corrections to what I told you earlier

- I said the D222 / D231 tokens were missing from the design docs. **That was wrong for DESIGN.md**: its § Tokens table already lists `--color-accent-text`, `--color-accent-fill*` and `--color-control-border`, with their rulings. They are missing only from `proposal-ab.html`, which is expected: it's frozen at 2026-09-11.
- The real gap is narrower than I said. DESIGN.md names every token but keeps no **values**. For tokens added after 2026-09-11 there is no design-side value at all, only `globals.css`. The YAML block at the top of `DESIGN.md` next to this file is what that values table could look like.

## Suggested order

1. Decide C1–C3 (green, amber and pink). Each is a UI question, so under rule 70 it goes to you as a prototype.
2. C4–C9 are mechanical token swaps. One small CSS branch can do them.
3. Section B is deletions, so confirm `TabBar/` is truly dead first. Rule 25 applies only to `rm -r`; one session can delete it as a normal commit.
4. Add a values column to DESIGN.md § Tokens, or generate it from the theme files (step 2 of the earlier plan).
