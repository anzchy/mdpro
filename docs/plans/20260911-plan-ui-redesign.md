# Plan: UI Redesign — proposal-ab alignment + 100% tokenized CSS

Generated on 2026-09-11 from the execution prompt `.prompts/2026-09-11_050736_FINAL.md`
Baseline commit: `0a3675e` (re-verify every "observed" fact before relying on it)
Branch: master
Status: DRAFT — blocked on the Stage 0 approval gate
Sources of truth (precedence on conflict: rules > DESIGN.md > review > proposal):

- [`.claude/rules/30-34`](../../.claude/rules/): enforceable rules. Rule 31 defines "tokenized"; rule 33 defines focus patterns; rule 34 defines the theme classes.
- [`docs/design/mdpro-ui-old/DESIGN.md`](../design/mdpro-ui-old/DESIGN.md): aesthetic register. D1–D4 are logged at :122-125. A bare `DESIGN.md` below means this file; the root `DESIGN.md` is only an index.
- [`docs/design/mdpro-ui-new/mdpro-ui-codex-review.md`](../design/mdpro-ui-new/mdpro-ui-codex-review.md): the change list, items 1–15.
- [`docs/design/mdpro-ui-new/proposal-ab.html`](../design/mdpro-ui-new/proposal-ab.html): the rendered target. Tokens are at :21-61; the rejected D3 block at :63-69 must never ship.

A conflict between any two sources is a stop-and-ask, never a silent pick.

---

## Goal

Bring the shipped UI in line with the proposal and the review, and leave app CSS 100% tokenized and well organized. The work follows the user-approved redesign workflow:

1. **Zero-visual-change refactor first.** Intended visual changes come afterwards, backed by before/after screenshots.
2. **Four deliverables, each independently reviewable and revertable:**
   - A: CSS infrastructure
   - B: visual retune
   - C: components
   - D: `sourceFont`
3. **Mandatory visual sign-off** by the user after the retune (end of Stage 3) and after the component changes (end of Stage 4), against the `proposal-ab.html` boards.

## Decided (do not re-litigate)

| ID | Decision | Source |
|---|---|---|
| D1 | A's register with B's structure | review :10-17, DESIGN.md:122 |
| D2 | Hybrid Source font: new installs use Monospace; a "Source font" preference offers Monospace / Follow editor font | review :98-100, DESIGN.md:123 |
| D3 | No second hue in Source syntax (no `--color-syntax-code`) | review :81-85, DESIGN.md:124 |
| D4 | Keep the current cool neutrals; adopt only derived mechanics | review :252, DESIGN.md:125 |
| E1 | macOS floor is 13.1, whose bundled WebKit (Safari 16.2) has `color-mix()`. macOS 11–12 get it only with a Safari 16.2+ update, which the bundle cannot require. It is set in `tauri.conf.json`; no `@supports` fallback. | eng review 2026-09-11 |
| E2 | CSS order has one source: `src/styles/index.css` `@import`s globals → sections → themes. `main.tsx` imports only that file, and the test helper and the pure-move proof read the same list. | eng review 2026-09-11 |
| E3 | `sourceFont` is a string `"mono"` \| `"editor"`, following the `fontFamily` pattern. Serde defaults give existing files `"editor"`; `EditorConfig::default()` (first run) gives `"mono"`; unknown values fall back to `"editor"` at apply time. | eng review 2026-09-11 |
| E4 | One `src/components/common/ToggleSwitch.tsx` replaces the hand-copied toggles and the native checkboxes in Settings. | eng review 2026-09-11 |
| E5 | Zero-change stages are proven by a computed-style JSON diff. Sign-off screenshots are taken in `pnpm tauri dev` (WKWebView). | eng review 2026-09-11 |
| E6 | The existing `config.json` overwrite gets its own PR, which must land before Stage 5 starts (TODOS.md P1). Today a parse failure still lets `App.tsx` write `lastViewMode` at launch, which replaces the file with defaults. | eng review 2026-09-11 (Codex consult) |
| E7 | Allowed test-only devDependencies: `@testing-library/react`, `@testing-library/user-event` and `@testing-library/dom`. Vitest also collects `tests/**/*.test.tsx`. Runtime dependencies stay frozen (A7). | eng review 2026-09-11 (Codex consult) |
| E8 | `--source-font-family` defaults to the mono stack in `:root`. Users who chose `"editor"` may see mono for a moment until preferences load, which is how `fontFamily` and `fontSize` already behave. Accepted; checked in Stage 5, with a TODO if it is visible. | eng review 2026-09-11 (Codex consult) |

## Assumptions (confirm or change at the Stage 0 gate)

| ID | Assumption |
|---|---|
| A1 | All 15 review items are in scope. If scope narrows (e.g. P0 only), drop whole work items. |
| A2 | Orchestrate through `/feature-workflow`. Each work item is implemented with `/tdd-guardian:workflow`. |
| A3 | Visual QA uses `/qa-only` (report-only). `/design-review` runs only when the user asks. |
| A4 | Screenshots and computed-style JSON are stored at `$TMPDIR/mdpro-redesign/<stage>/<surface>-<theme>.{png,json}` and never committed. |
| A5 | "100% tokenized" follows the definition below. |
| A6 | Stage 1 is a pure move into ordered partials listed in `src/styles/index.css` (E2). `:root` tokens stay in `globals.css` (rule 31:11-16). |
| A7 | No new runtime npm or cargo dependency, including icon, image-diff and contrast tools. The only exception is E7's test-only devDependencies, added in WI-1.0. |
| A8 | `src/App.css` and `src/components/TabBar/` are dead-code candidates; list them, do not delete them. The tokenization test asserts that they stay unimported. Deletion is tracked in TODOS.md. |
| A9 | Contrast thresholds are WCAG 2.1 AA: 4.5:1 for text, 3:1 for focus indicators and control boundaries. |
| A10 | Class (c) literals with 3 or more unrelated uses get a semantic token (rule 31's rule of three). |
| A11 | Manual test guide location: `docs/guide/manual-test-ui-redesign.md`. |
| A12 | Deferred class (b) literals are tracked in an explicit allowlist inside the tokenization test rather than by `it.skip` on whole files. This refines the prompt so every file stays guarded during Stage 2; see WI-2.1. |

## Open questions (must be answered at the Stage 0 gate)

| ID | Question | Blocks |
|---|---|---|
| Q1 | Should the Preview's highlight.js theme follow dark mode? Only `github.css` is imported (`Preview.tsx:6`). | WI-3.2 |
| Q2 | Should `:root` keep its duplicated light values (`globals.css:1-47`)? | WI-3.1 |
| Q3 | Does One Dark stay selectable, unchanged, next to the new HighlightStyle (review :86)? | WI-4.1 |
| Q4 | Is the rule 33 edit approved (patterns 1–3 → `--color-focus-ring`, review item 7)? | WI-3.3 |
| Q5 | ~~What is the WebKit floor?~~ **Closed by E1:** macOS 13.1, set in WI-3.4. | — |
| Q6 | Undeclared tokens are read with a hex fallback: `--color-success`, `--color-error` and `--color-text-tertiary` (`globals.css:1842`, `:1846`, `:1850`). Declare them, or replace them with existing tokens? | WI-2.2 |
| Q7 | Amber warning literals (`globals.css:1065-1066`, `:1519-1544`, mostly the dev toolbar) need a decision: add a `--color-warning` token, or exclude the dev-only toolbar? | WI-2.2 |
| Q8 | Chrome font sizes outside the 12/13/14 ramp (18px ×9, 16px ×4, 15px ×2, 24px ×1 in `globals.css`) need a decision: add title tokens, or make them exceptions? | WI-2.2, WI-3.2 |
| Q9 | Radii outside the proposal's control/popover pair (4px ×12, 8px ×11, 12px ×6, 3px ×5, 2px ×2, 16px ×2, 24px ×1) need a decision: add tokens from the DESIGN.md:76 scale, or make them exceptions? | WI-2.2 |
| Q10 | `z-index: 1` at `MilkdownEditor.css:214` is not in the rule 31:83-91 table. Allow it as a local stacking exception? | WI-2.1 |
| Q11 | If the app has no command palette, confirm it is out of scope (the proposal draws one). | Scope |

---

## Baseline (observed at `0a3675e`)

### Token files

- `src/styles/globals.css` `:root` (:1-47) declares these tokens:
  - colors, `--shadow-soft`, fonts
  - layout: title bar, traffic lights, sidebar, bottom tabs, content width
  - the three runtime editor tokens
  - the `--settings-*` tokens and the semantic aliases
- `src/styles/themes/light.css` and `dark.css` declare the color set, the `--settings-*` tokens and the aliases. `--shadow-soft` exists only in `:root`.
- `src/main.tsx:3-5` imports `globals.css`, then `light.css`, then `dark.css`.

### Literal inventory

| File | Lines | Color literals | px font-sizes |
|---|---|---|---|
| `src/styles/globals.css` | 1918 | 49 | 88 |
| `src/components/Editor/MilkdownEditor.css` | 269 | 1 | 1 |
| `src/components/Preview/styles/preview.css` | 139 | 1 | 2 |
| `src/components/BottomTabs/BottomTabs.css` | 116 | 2 | 3 |
| `src/components/Editor/ImageContextMenu.css` | 65 | 0 | 1 |
| `src/plugins/milkdown/inlineEditPlugin.css` | 39 | 0 | 0 |
| `src/plugins/milkdown/imagePastePlugin.css` | 25 | 0 | 1 |
| `src/plugins/codemirror/wysiwygDecorationsPlugin.css` | 16 | 0 | 1 |

`globals.css` also contains non-`var()` declarations of these kinds: 47 `border-radius`, 7 `transition`, 5 `z-index`, 1 `box-shadow`.

### Hotspots feeding work items

- **Hardcoded accent fills (item 1):** `globals.css:1032` and `:1747`.
- **Sub-12px font sizes (item 12):**
  - `globals.css`: `:122`, `:219`, `:532`, `:578`, `:929`, `:1245`, `:1431`, `:1682`, `:1690`, `:1774`
  - `wysiwygDecorationsPlugin.css:5`
- **Transitions (item 11):**
  - `globals.css`: `:639` (0.05s), `:1335` (0.2s), `:1347` (0.2s), `:1423`, `:1629` (includes 0.3s), `:1667`, `:1739`
  - `BottomTabs.css`: `:24`, `:66`, `:105`
  - Only the 0.15s durations match the proposal's fast-duration token.
- **Focus:** only two `:focus-visible` rules exist (`globals.css:572`, `:648`). Item 7 adds `.toolbar-button:focus-visible`.
- **Running badge and toggle track (item 6):** `.mcp-status-badge.running` at `globals.css:1371-1372`; the toggle off-track at `:1334`.
- **Settings rows (item 5):** `globals.css:1296`, `:1301`, `:1314`; `.toggle-switch` at `:1314`.
- **Settings rail (item 14):** `.settings-sidebar` at `:904`; `.settings-category-btn` at `:937`, with hover at `:948` and active at `:952`. The `--settings-btn-*` tokens are at `light.css:21-22`, `dark.css:21-22` and `globals.css:40-41`.
- **Mode label (item 9):** `.sidebar-mode-label` at `src/App.tsx:1128` and `src/components/Sidebar/index.tsx:39`.
- **Discard (item 13):**
  - `ConfirmDialog.tsx:42,52` renders both buttons as `.toolbar-button`.
  - A `.toolbar-button.danger` variant already exists at `globals.css:1195`.
  - Callers: `Sidebar/Sidebar.tsx:53`, `BottomTabs.tsx:83`, `App.tsx:1180` ("Discard changes").
- **Icons (item 4):** `SettingsDialog.tsx:30-38` and `BottomTabs.tsx:73`.
- **Syntax (item 2):**
  - `src/components/Editor/extensions/syntax.ts:3` uses `defaultHighlightStyle`.
  - `src/components/common/settings/editorPrefApply.ts:183-186` switches to `oneDark`.
- **Fonts (item 3):**
  - Source and WYSIWYG both use `--editor-font-family` (`globals.css:336`, `MilkdownEditor.css:43`).
  - The `fontFamily: "system"` default is at `src/types/preferences.ts:284` and `src-tauri/src/models/preferences.rs:568`.
- **Dead-code candidates:**
  - `src/App.css` (19 color literals, imported nowhere)
  - `src/components/TabBar/` (re-exported only by its own `index.ts`)

### Gates and tools

- `pnpm build` (`tsc && vite build`), `pnpm test:run` (`vitest run`), `cd src-tauri && cargo test`. All three also run in `.github/workflows/ci.yml`.
- `pnpm dev` serves localhost:1420 without Tauri APIs; `pnpm tauri dev` runs the full app.
- `.claude/tdd-guardian/config.json` has `enabled: true` and `testCommand: pnpm test:run`, but `lanes` is absent. Readiness must be confirmed in WI-0.1.
- `CHANGELOG.md:8` has a `## [Unreleased]` section.

---

## Working protocol (applies to every stage)

**Per work item** (`/feature-workflow` + `/tdd-guardian:workflow`):
1. Preflight: re-verify the cited file:line facts and record discrepancies.
2. RED: write or adjust a test that fails for the right reason. CSS-only changes have no unit test (rule 10) but must pass the screenshot and tokenization gates.
3. GREEN, then refactor.
4. Run the common gate (below).
5. Update the manual test guide (A11).

**Common gate G0** runs at the end of every work item and every stage:
- [ ] `pnpm build` exits 0
- [ ] `pnpm test:run` exits 0; no newly skipped tests; no assertion deleted to get green
- [ ] `cd src-tauri && cargo test` exits 0 (required whenever Rust changed; otherwise run once per stage)
- [ ] No file outside the work item's declared file set changed, compared with the baseline `git status --porcelain` saved in WI-0.1 (the tree already has unrelated changes)
- [ ] No new dependency: `git diff package.json src-tauri/Cargo.toml` is empty, apart from the three E7 devDependencies added in WI-1.0
- [ ] No screenshot, no `.prompts/` artifact, and no conversation content in the diff
- [ ] Nothing committed or pushed

**Stop protocol:** there are five stops: end of Stage 0, and end of Stages 2, 3, 4 and 5.

At each stop:
1. Post the stop report (template at the bottom).
2. Propose the commit split for that deliverable.
3. Wait for the user's explicit reply.

Do not start the next stage without that reply.

**Visual evidence protocol (E5):**
- **Zero-change stages (1–2):** the proof is a computed-style snapshot, not a visual comparison.
  - A throwaway script kept outside the repo (`$TMPDIR/mdpro-redesign/snapshot.js`) runs through `/browse` against `pnpm dev`.
  - For each Appendix B surface, in both themes and at a fixed viewport, it walks a fixed selector list. It records `getComputedStyle` for the A5 property families plus the box size, including `::before` / `::after`, and writes sorted JSON.
  - It also puts each surface into the states the selectors style (checked, disabled, focus-visible, an open modal, a scrolled container) and asserts that each state actually applied, so a missed state fails instead of producing an empty diff. A state that script cannot force (e.g. hover) is marked manual in the index.
  - Before and after files are compared with plain `diff`; an empty diff passes. Screenshots are still taken, as reference only.
  - Chromium is not the engine that ships. A representative subset is also collected inside `pnpm tauri dev` through WebView DevTools and diffed the same way: main window Source, one Settings page and one modal, in both themes.
- **Sign-off stages (3–4):** the screenshots the user signs off on are taken in `pnpm tauri dev` (WKWebView). `/browse` is Chromium, and rules 30/34 require visual QA in Tauri. `/browse` shots are fine for iteration.
- Capture Tauri-only surfaces manually in `pnpm tauri dev`.
- Each before/after pair uses the same window size and zoom, recorded in the index.
- A cell that cannot be captured is marked in the matrix, and the user is asked to capture it. Never skip a cell silently.

**Contrast protocol:**
- Compute ratios from resolved colors, in both themes, with a throwaway script outside the repo. Record a table.
- Failures are flagged, not silently retuned.

**Rule 33 protocol:**
- Tab through every changed surface in both themes, including at 200% zoom.
- Modals loop Tab, and Esc returns focus to the invoking control.
- Where `/browse` cannot drive focus or zoom, ask the user to run the check, and record who ran it.

---

## Definition of "100% tokenized" (A5)

Applies to every app-owned `src/**/*.css` file except `globals.css :root`, `light.css`, `dark.css`, third-party CSS (highlight.js, KaTeX) and the dead-code candidates. The dead-code exclusion holds only while they stay unimported: the tokenization test asserts that no `src/**` file and not `index.html` imports them, and any import brings the file into scope.

- **Color properties** (color, background, border, outline, fill, stroke, box-shadow, caret-color, text-decoration-color) may use only `var(--…)`, `color-mix()` over `var()`s, `transparent`, `currentColor` or `inherit`.
- **Must use `var(--…)`:** font-family, chrome font-size, border-radius, transition/animation duration and easing, icon width/height.
- **Allowed literals:**
  - the rule 31:58-76 list
  - `em` / `%` sizes inside editor and preview content
  - z-index values from the rule 31:83-91 table
- **Enforcement:** `tests/css-tokenization.test.ts` (WI-2.1).

---

## Deliverables overview

| Deliverable | Stages | Visual change | Review items | Stop after |
|---|---|---|---|---|
| A — CSS infrastructure | 1, 2 | None (computed-style diff is empty) | none directly | Stage 2 |
| B — Visual retune | 3 | Intended | 1, 7, 8, 10, 11, 12, 15 | Stage 3 **(visual sign-off)** |
| C — Components | 4 | Intended | 2, 4, 5, 6, 9, 13, 14 | Stage 4 **(visual sign-off)** |
| D — `sourceFont` | 5 | Intended (Source mode only) | 3 (D2) | Stage 5 |

The item→stage mapping is an assumption (A1). Correct it at the Stage 0 gate.

---

## Stage 0 — Inventory, baseline, plan approval (no code edits)

**Entry:** this plan exists; the working tree is otherwise as at the baseline.

### WI-0.1 — Readiness and baseline gates — S
- Run `/tdd-guardian:status`. If the config is missing, disabled, or has no runnable lane, **stop and ask the user to run `/tdd-guardian:init`**.
- Run G0 on the untouched tree and record pre-existing failures, so they are not blamed on this work.
- Save `git status --porcelain` to `$TMPDIR/mdpro-redesign/git-status-baseline.txt`. G0's file-set check compares against it.
- Re-verify every Baseline fact above and note discrepancies in Appendix A.
- List every test that reads app CSS from disk, since Stage 1 will move those files: `grep -rln "\.css" tests`.

### WI-0.2 — Literal inventory and classification — M
- For every non-token value in the tokenized categories, record file:line, selector, property and value.
- Put each value in a class:
  - **(a)** an existing or proposal token with the same value exists
  - **(b)** tokenizing it changes the rendered value (e.g. sub-12px chrome sizes, the `:1032`/`:1747` accent fills, 0.05s/0.2s/0.3s transitions)
  - **(c)** it needs a new token or an exception (feeds Q6–Q10)
- Write the result to Appendix A.

### WI-0.3 — QA surface matrix — S
- Fill Appendix B with every surface × {light, dark}.
- Mark each row "has reference" (drawn on a proposal board) or "no reference".

### WI-0.4 — Baseline snapshots and screenshots — M
- Write the computed-style snapshot script, and record baseline JSON for every `pnpm dev` surface × theme (E5).
- Capture every matrix cell per the visual evidence protocol.
- Record the paths, window size and zoom in Appendix B.

### WI-0.5 — CSS file map and rule 33 edit proposal — S
- Read every section banner in `globals.css`. The list observed so far is incomplete: `.toast` at `:819` sits between the link modal and Settings banners.
- Propose the partial file map (WI-1.1). Any section longer than about 300 lines (Settings spans `:858-1435`) splits along its sub-banners.
- Draft the exact rule 33 spec-column edit for Q4, without applying it.

### WI-0.6 — Plan design review — S
- Run `/plan-design-review` on this plan.
- Fold non-controversial findings into this file. List the rest as open questions.

### Stage 0 acceptance criteria
- [ ] tdd-guardian readiness confirmed, or the user was asked to run `/tdd-guardian:init` (the stage does not pass until it is ready)
- [ ] Baseline G0 results recorded, including pre-existing failures
- [ ] Appendix A lists every non-token value in the tokenized categories with file:line and class a/b/c; the counts reconcile with the Baseline table, or the discrepancy is explained
- [ ] Appendix B lists every surface × theme with a reference flag, including the review §4 surfaces (recent-files dropdown, disabled-with-reason button, external-file-changed banner, drag-and-drop target, empty/no-tabs state)
- [ ] Every Appendix B cell has a baseline screenshot path, or a "could not capture" mark with the user asked
- [ ] Every `pnpm dev` surface × theme has baseline computed-style JSON, and the baseline `git status --porcelain` is saved
- [ ] The CSS file map is decided: every partial is ≤ ~300 lines and its import position is listed
- [ ] The rule 33 edit is drafted (text only)
- [ ] `/plan-design-review` findings are recorded
- [ ] **Gate:** the user explicitly approves the plan and answers or waives A1–A12 and Q1–Q11

**Rollback:** nothing to roll back; Stage 0 changes only this plan document.

---

## Stage 1 — Split `globals.css` (Deliverable A; zero visual change)

**Entry:** Stage 0 gate passed.

### WI-1.0 — Test tooling (E7) — S
- Add `@testing-library/react`, `@testing-library/user-event` and `@testing-library/dom` as devDependencies, in versions compatible with React 19; record the versions.
- Widen the vitest `include` to `tests/**/*.test.{ts,tsx}` and confirm that the JSX transform works for files under `tests/`.
- Nothing else in `package.json` changes. Existing tests and the jsdom environment stay as they are.
- **RED → GREEN:** the smoke test `tests/testing-library-smoke.test.tsx`
  - renders a native checkbox and presses Space with `userEvent.keyboard`
  - asserts the checkbox becomes checked
  - stays in the suite, because the Stage 4 and 5 keyboard tests rely on this tooling
- **Zero change:** the app bundle and the computed-style snapshot are unaffected.

### WI-1.1 — Ordered CSS entry and location-independent reader — S
- **Entry file (E2):**
  - Create `src/styles/index.css` containing only `@import "./globals.css";`, `@import "./themes/light.css";` and `@import "./themes/dark.css";`, one per line, in today's order.
  - `src/main.tsx` replaces its three style imports with one `./styles/index.css` import at the same position, so App's component CSS still comes first.
- **Test helper:** `src/test/appCss.ts` (rule 10).
  - It parses the `@import` lines of `index.css` and returns the app CSS in that order, per file or concatenated.
  - `tsc` type-checks it (`tsconfig` includes `src`; `@types/node` is present).
  - Its own test lives under `tests/`, because vitest collects tests only there.
- Every test that reads `src/styles/globals.css` from disk switches to the helper, with assertions unchanged: `design-tokens-accent-danger`, `settings-row-layout`, `source-scroll-layout` and `source-table-cell-highlight` (re-check with the WI-0.1 grep).
- **RED:** helper tests assert that
  1. before the split, the helper's non-theme concatenation equals `globals.css` byte for byte (after the split, the Stage 1 pure-move proof takes over this check);
  2. an `@import` of a missing file throws instead of being skipped;
  3. `index.css` is rejected if it contains anything other than comments and `@import` lines, a duplicate import, or a path that resolves outside `src/styles/`.
- **Zero change:** after the entry switch, the computed-style diff against the Stage 0 baseline is empty.

### WI-1.2 — Move sections into partials — M
- Keep `:root` tokens and base/reset rules in `globals.css` (rule 31:11-16).
- Move each other section verbatim into a partial, per the approved file map (A6). Assumed location: `src/styles/sections/<section>.css`.
- List the partials in `src/styles/index.css` immediately after `./globals.css`, in original source order. `main.tsx` is not touched again.
- Change no selector, value or rule order. Remove only the moved text.
- Plugin CSS stays co-located with its plugin (rule 50 §4). Do not pull plugin CSS into the partials.

### Stage 1 acceptance criteria
- [ ] G0 passes
- [ ] **Pure-move proof:** concatenate the new `globals.css` and the partials in import order, strip banner comments from both sides, and diff against the baseline file. The diff is empty; the exact command and its empty output are in the report. Example:
  ```bash
  diff <(git show 0a3675e:src/styles/globals.css | sed '/^\/\*.*\*\/$/d') \
       <(sed -n 's|^@import "\./\(.*\)";$|src/styles/\1|p' src/styles/index.css \
           | grep -v '/themes/' | xargs cat | sed '/^\/\*.*\*\/$/d')
  ```
  The file list comes from `index.css`, so the proof, the helper and the app share one order.
- [ ] **Built-CSS order:** in the `pnpm build` output CSS, rules appear in the same relative order as before. Spot-check the first and last selector of each partial.
- [ ] The computed-style diff against the Stage 0 baseline is empty for every `pnpm dev` surface × theme (command and empty output in the report); Tauri-only cells show no visible difference
- [ ] Every app CSS file is ≤ ~300 lines, or is listed as an approved exception
- [ ] No test assertion changed; only the file-reading paths did
- [ ] The WI-1.0 smoke test passes, and the `package.json` diff is exactly the three E7 devDependencies

**Rollback:** revert the partials, `src/styles/index.css` and the `main.tsx` import. `globals.css` is restored byte-for-byte from the baseline.

---

## Stage 2 — Value-preserving tokenization (Deliverable A; zero visual change)

**Entry:** Stage 1 accepted (no stop between Stages 1 and 2).

### WI-2.1 — Tokenization guard test (RED first) — M
- Create `tests/css-tokenization.test.ts` with one `it` per in-scope CSS file. Use the source-inspection style of `tests/design-tokens-accent-danger.test.ts`, including its `@module` / `Purpose:` header.
- The test enforces the A5 definition: the property families above, the rule 31:58-76 allowlist, and the rule 31:83-91 z-index table plus any Q10 exception.
- **Deferred list (A12):**
  - Class (b) literals are listed explicitly as `{ file, selector, property, value, stage: 3 | 4, item: N }`. A listed literal passes; anything else fails.
  - A separate `it` asserts the per-stage counts.
  - Class (b) literals owned by a Stage 4 item are tagged `stage: 4`, e.g. the toggle off-track `#ccc` in `.toggle-slider` (item 6).
- **Scanner fixtures:** a `describe` block feeds the scanner inline CSS strings with known violation counts. Without these, a scanner bug passes silently. Cover:
  - comments that contain literals
  - multi-line values
  - `@media` and `@keyframes` bodies
  - `var(--x, #fff)` fallbacks
  - `color-mix()` with a literal argument
- **Dead-code guard (A8), temporary:** assert that neither any `src/**` file nor `index.html` imports `src/App.css` or `src/components/TabBar/`.
  - Its failure message names the TODOS.md entry "Remove dead App.css and TabBar".
  - Delete the guard when that cleanup lands.
- **RED evidence:** run the test on the post-Stage-1 tree and record the failing count per file.

### WI-2.2 — Value-preserving tokens — M
- Add proposal tokens only where their value equals the current literal. These are candidates to confirm against Appendix A:
  - the UI font-size ramp tokens (12/13/14px sites)
  - `--radius-control` and `--radius-popover` (sites that already use exactly those values)
  - `--motion-duration-fast` (the 0.15s sites only)
  - the icon size tokens where current sizes match
- Theme-independent tokens go in `globals.css :root`. Theme-specific tokens go in both theme files together (rule 31 authoring rule 1).
- Class (c) resolutions come from the answers to Q6–Q10. A10 applies: 3 or more unrelated uses gets a semantic token; fewer uses stays an open question, with no invented token.
- Add each new token to DESIGN.md (rule 31 authoring rule 4) without mirroring values (rule 31:18-19).
- Don't copy any value into this plan or DESIGN.md; cite `proposal-ab.html:21-61`.

### WI-2.3 — Migrate class (a) literals, file by file — M
- Replace class (a) literals with the equal-value tokens. Leave class (b) literals, which stay on the deferred list.
- Update CSS-pinning tests when an assertion names a literal that became a token. Name each updated test in the report:
  - `tests/design-tokens-accent-danger.test.ts`
  - `tests/settings-row-layout.test.ts`
  - `tests/source-scroll-layout.test.ts`
  - `tests/source-table-cell-highlight.test.ts`
  - `tests/milkdown-table-cell-highlight.test.ts`
  - `tests/milkdown-image-resize.test.ts`
  - `tests/milkdown-table-resize-handle.test.ts`
  - `tests/highlight-rendering.test.ts`
  - `tests/wide-table-fit-to-width.test.ts`
  - `tests/table-alignment-rendering.test.ts`
  - `tests/table-context-menu-component.test.ts` reads only TSX and is not affected.

### Stage 2 acceptance criteria
- [ ] G0 passes
- [ ] `tests/css-tokenization.test.ts` was shown failing before migration (counts in the report) and passes now
- [ ] Every remaining non-token literal is on the rule 31 allowlist, the z-index table, an approved exception, or the deferred list. The deferred list contains only class (b) entries, each tagged with its stage (3 or 4) and item.
- [ ] The computed-style diff against the Stage 0 baseline is empty for every `pnpm dev` surface × theme; Tauri-only cells show no visible difference. A mismatch is a bug to fix; never re-baseline in Stage 2.
- [ ] Every new token is declared in its correct file (`:root`, or both theme files) and documented in DESIGN.md without values
- [ ] Literal counts per file (before → after) are reported
- [ ] `CHANGELOG.md` `## [Unreleased]` has an entry for Deliverable A
- [ ] **STOP (Deliverable A):** the report is posted, the commit split is proposed, and the user has replied

**Proposed commit split (A, proposal only):**
1. `refactor(css): ordered styles/index.css entry and app CSS reader`
2. `refactor(css): split globals.css into ordered section partials`
3. `test(css): tokenization guard with deferred list`
4. `style(css): value-preserving token migration`

**Rollback:** revert the commits in reverse order. Each one leaves the build and tests green.

---

## Stage 3 — Visual retune (Deliverable B; items 1, 7, 8, 10, 11, 12, 15)

**Entry:** Deliverable A accepted; Q2 and Q4 are answered.

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
  - per-theme `--shadow-soft`, which today exists only in `:root`; the Q2 answer decides the `:root` copy
- **Item 15 (optional, P2):** derive `--color-code-bg` (review :250) and add the radius tokens not already added in WI-2.2.
- D4: `--color-bg`, `--color-surface`, `--color-text` and the other neutrals keep their values.

### WI-3.2 — Migrate deferred class (b) literals (items 1, 11, 12) — M
- **Item 1:** `globals.css:1032` and `:1747` switch to `--color-accent-soft`.
- **Item 11:** transitions switch to the motion tokens. No transition lists a theme-related color property (rule 32), so a theme switch never animates. Add one `@media (prefers-reduced-motion: reduce)` block that sets the duration token to zero (proposal :60).
- **Item 12:**
  - Snap the sub-12px chrome sizes (Baseline hotspots) to the ramp. Resolve the non-ramp sizes per Q8.
  - Give TOC rows and settings-nav rows `min-height: 28px`.
  - Keep the title-bar and tab-bar heights (review :217).
- **Hover:** row hover moves from `--color-panel` to `--color-hover` (review item 7).
- **Item 8:** menus and toasts may use `--color-border-subtle` with the single `--shadow-soft`.
- Remove each migrated `stage: 3` entry from the deferred list.
- **Q1:** if "yes", make the Preview highlight.js theme follow dark mode with no new dependency. Otherwise list it as deferred.

### WI-3.3 — Focus ring (item 7, conditional on Q4) — S
- **If Q4 is approved:**
  - Add `--color-focus-ring` to `:root` (proposal :24).
  - Point rule 33 patterns 1–3 at it in CSS.
  - Apply the drafted spec-column edit to `.claude/rules/33-focus-indicators.md`.
  - Add `.toolbar-button:focus-visible`.
- **If Q4 is not approved:** keep rule 33 as written, still add `.toolbar-button:focus-visible` using the existing pattern 2, and list the focus-ring part as deferred.
- **Test:** `tests/focus-trap.test.ts` stays green. Add a source-inspection assertion that `.toolbar-button:focus-visible` exists and uses the approved token.

### WI-3.4 — Raise the macOS floor to 13.1 (E1) — S
- Add `bundle.macOS.minimumSystemVersion: "13.1"` to `src-tauri/tauri.conf.json`. macOS 13.1 is the lowest release whose bundled WebKit (Safari 16.2) has `color-mix()`, which the app CSS already uses (`light.css:9-11`, `dark.css:9-11`). No `@supports` fallback is added.
- Change the target in `CLAUDE.md` ("macOS 13+") and `DESIGN.md:33` to macOS 13.1+.
- **Verify:** after `pnpm tauri build`, the bundle's `Info.plist` has `LSMinimumSystemVersion` 13.1.

### WI-3.5 — Docs, evidence, QA — S
- Add DESIGN.md entries for every new or changed token (names only).
- Capture after screenshots for the whole matrix.
- Measure contrast and run the rule 33 protocol.
- Run `/qa-only` on the changed surfaces.

### Stage 3 acceptance criteria
- [ ] G0 passes
- [ ] The tokenization deferred list has no `stage: 3` entries, the test has no `it.skip`, and the per-stage count check asserts 0 for Stage 3 (only `stage: 4` entries remain)
- [ ] Every theme-specific token change landed in both theme files in the same change (rule 31 authoring rule 1); none of the D4 neutral token values changed
- [ ] No chrome `font-size` below 12px (grep proof); non-ramp sizes are resolved per Q8
- [ ] The title-bar and tab-bar heights are unchanged (computed height in both themes matches the baseline)
- [ ] A `prefers-reduced-motion: reduce` block exists and zeroes the motion duration token
- [ ] `color-scheme` is set on `.theme-light` and `.theme-dark`; native scrollbars and checkboxes follow the theme in WKWebView (manual check)
- [ ] The focus result matches the Q4 answer, and `.toolbar-button:focus-visible` exists
- [ ] `tauri.conf.json` sets `minimumSystemVersion` to 13.1, and CLAUDE.md and DESIGN.md say macOS 13.1+ (E1)
- [ ] **Screenshot index:** every Appendix B cell has a before/after pair taken in `pnpm tauri dev` (E5), labelled "matches proposal" (same `?theme`/`?page`), "intentionally differs: <reason>", or "no reference"
- [ ] "No reference" surfaces received token changes only, with no layout, spacing or structure changes (checked against the diff)
- [ ] **Contrast table** for both themes. Nothing fails A9 unless it is flagged and explicitly accepted by the user. It covers:
  - `--color-text` and `--color-muted` on the bg and surface tokens
  - the focus indicator on bg, surface and `--color-accent-soft`
  - the toggle off-track and the segmented-control selected fill
- [ ] Rule 33 checklist is done in both themes at 100% and 200% zoom, with who ran each check recorded
- [ ] `/qa-only` findings are listed, each marked fixed, deferred or out of scope
- [ ] Tokenization grep: hex, `rgb(` and `hsl(` in in-scope CSS return only lines that rule 31:58-76 or an approved exception permits
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable B
- [ ] **STOP (Deliverable B) — mandatory visual sign-off:** the user reviews the before/after index and explicitly approves before Stage 4

**Proposed commit split (B, proposal only):**
1. `style(css): retarget border-as-fill consumers`
2. `style(theme): derived borders, hover, accent-soft, shadow, color-scheme`
3. `style(css): motion tokens and reduced motion`
4. `style(css): chrome type ramp and row heights`
5. `style(css): focus ring` + `docs(rules): rule 33 focus-ring spec` (only if Q4 is approved)
6. `chore(config): macOS 13.1 minimum for color-mix()`
7. `docs(design): token entries`

**Rollback:** each commit reverts independently. Reverting B leaves A intact, with a zero-diff UI.

---

## Stage 4 — Component changes (Deliverable C; items 2, 4, 5, 6, 9, 13, 14)

**Entry:** Deliverable B visually signed off; Q3 answered.

Each work item captures before/after screenshots per item × theme, and the stage ends with `/qa-only`. New UI behavior logs per CLAUDE.md "Logging Rules" (rule 20).

### WI-4.1 — Source syntax HighlightStyle (item 2, D3) — M
- Replace `defaultHighlightStyle` (`syntax.ts:3`) with an mdpro `HighlightStyle`:
  - markers use `--color-syntax-markup`
  - URLs, link targets and HTML use `--color-syntax-meta`
  - everything else, including inline and fenced code, uses `--color-text`
- Add both syntax tokens to `:root` (proposal :25-26).
- Keep the `editorPrefApply.ts:183-186` One Dark path consistent per Q3.
- **Tests:** extract the tag→style mapping into a pure module. Assert:
  - marker tags map to the markup token
  - meta tags map to the meta token
  - no code-hue token is referenced anywhere (D3 guard)
  - the One Dark switch still returns the One Dark extension

### WI-4.2 — One Icon wrapper (item 4) — M
- **Dependency gate (A7):** if an icon library seems necessary, stop and ask. Name the candidate and describe the inline-SVG alternative.
- Add one `Icon` component (assumption: `src/components/common/Icon.tsx`):
  - inline SVG with `stroke: currentColor`
  - default color `--color-muted`
  - sized with the icon-size tokens
- Replace the glyph and emoji icons at `SettingsDialog.tsx:30-38` and `BottomTabs.tsx:73`. Use one close glyph and one caret (review item 4).
- **Tests (by role and name):**
  - decorative icons are `aria-hidden`
  - icon-only buttons keep an accessible name
  - no emoji code points remain in the replaced sites

### WI-4.3 — Settings row contract and ToggleSwitch (item 5, E4) — M
- Extend the `.settings-row-label strong` / `.settings-row-description` selectors to `h4` / `p` (or migrate the panels), per review :131-134.
- Extract `src/components/common/ToggleSwitch.tsx`:
  - it renders the label, the input and `.toggle-slider`
  - it exposes `role="switch"` with `aria-checked`, and gets its accessible name through `aria-labelledby` pointing at the visible row heading
  - its visually hidden input gets a keyboard focus ring: add `.toggle-switch input:focus-visible + .toggle-slider` using the rule 33 pattern (there is none today, `globals.css:1314-1356`)
  - it replaces every checkbox input in Settings: nine inputs in six files (re-count in preflight)
    - three hand-copied toggles in `src/components/common/IntegrationsSettings.tsx` (`:152`, `:174`, `:196`)
    - six native checkboxes in the other five files: `EditorSettings`, `MarkdownSettings` ×2, `ImageSettings`, `ExportSettings`, `AdvancedSettings`
- **Tests:**
  - ToggleSwitch behavior, written once with `userEvent` (E7):
    - role, with its name coming from the row heading
    - `aria-checked` follows the value
    - click and Space toggle it
    - Tab reaches it and it receives focus
    - when disabled, it ignores both click and Space
  - A source-inspection assertion that the `:focus-visible` rule for `.toggle-slider` exists.
  - **CRITICAL regression:** one table-driven test over every replaced site asserts that toggling still writes the same preference key and value as before.
  - Update `tests/settings-row-layout.test.ts`.

### WI-4.4 — Running badge and toggle track (item 6) — S
- `.mcp-status-badge.running` (`globals.css:1371-1372`, pre-split reference): a dot plus muted text, no fill (review :146).
- Toggle off-track (the `#ccc` at pre-split `globals.css:1335`): a text-based `color-mix` (review :147). This removes the last `stage: 4` deferred entry.
- No semantic green token unless the user asks (review :146).
- **Tests:** the tokenization test covers the literals; the badge keeps its text label, so status is not conveyed by color only (rule 33 hard rule).

### WI-4.5 — Source | WYSIWYG segmented control (item 9) — M
- Replace `.sidebar-mode-label` at `App.tsx:1128` and `Sidebar/index.tsx:39` with one shared control, used in both the sidebar-on and sidebar-off headers (review :185).
- Styling follows proposal :114-120 and review :183-184.
- The native menu shortcuts (⌃2 / ⌃4) keep working, and the control reflects the current mode.
- **Tests (userEvent, by role):**
  - clicking a segment switches the view mode through the existing store action
  - the selected segment is exposed (`aria-pressed`, or radio semantics)
  - keyboard activation works
  - the store-driven mode change updates the selection
- **Logging:** `ui.mode_switch.click` per rule 20 (name to be confirmed against existing events).

### WI-4.6 — Dialog button hierarchy (item 13) — S
- Add a destructive option to `ConfirmDialog` (assumption: `destructive?: boolean`) that applies the existing `.toolbar-button.danger` (`globals.css:1195`) to the confirm button. Cancel stays secondary.
- Pass it at the Discard callers: `Sidebar/Sidebar.tsx:53`, `BottomTabs.tsx:83`, `App.tsx:1180`.
- **Tests:**
  - with `destructive`, the confirm button carries the danger variant; without it, it does not
  - focus order and Esc behavior are unchanged (`tests/focus-trap.test.ts`)

### WI-4.7 — Settings rail (item 14) — S
- `--settings-sidebar-bg` → `var(--color-surface)` in both theme files.
- `.settings-category-btn.is-active` uses the rule 31 active pattern; hover uses `--color-hover`.
- Retire `--settings-btn-hover-bg` / `--settings-btn-active-bg` from `light.css`, `dark.css` and `globals.css :root` once no consumer remains.
- **Tests:** a source-inspection assertion that both retired tokens are neither declared nor consumed anywhere in app CSS.

### Stage 4 acceptance criteria
- [ ] G0 passes; every work item above has its RED→GREEN tests (rule 10: behavior and ARIA, not rendering snapshots)
- [ ] `defaultHighlightStyle` no longer drives the Source light theme; no `--color-syntax-code` appears anywhere in `src/`; the One Dark path matches the Q3 answer
- [ ] No new runtime dependency (the E7 test devDependencies are excepted); if an icon library was proposed, the user's decision is recorded
- [ ] No emoji or glyph icons remain at the item 4 sites; icon-only controls have accessible names
- [ ] Every boolean setting renders `ToggleSwitch` (E4) and the per-site regression test passes; every switch shows a focus-visible ring in both themes; one row contract across the settings panels
- [ ] The Running badge has no fill and a text label; the toggle track has no literal
- [ ] The segmented control works by mouse, keyboard and menu shortcut, in both sidebar states
- [ ] Discard confirmations use the danger variant at all three callers; Cancel stays secondary
- [ ] The `--settings-btn-*` tokens are fully retired
- [ ] The tokenization deferred list is **empty**, and the per-stage count check asserts 0 for every stage
- [ ] Before/after screenshots per item × theme, taken in `pnpm tauri dev` (E5); `/qa-only` findings triaged
- [ ] Rule 33 checklist on every changed control, in both themes
- [ ] New UI events log per rule 20
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable C
- [ ] **STOP (Deliverable C) — mandatory visual sign-off:** the user compares the after-shots with the matching `proposal-ab.html` boards (main window Source, Settings, components and states) and explicitly approves before Stage 5; the report is posted and the commit split is proposed

**Proposed commit split (C, proposal only, one per item):**
- `feat(editor): mdpro Source HighlightStyle`
- `feat(ui): Icon wrapper`
- `refactor(settings): ToggleSwitch component`
- `style(settings): row contract`
- `style(settings): running badge`
- `feat(ui): mode segmented control`
- `feat(dialog): destructive confirm`
- `style(settings): flat rail`

**Rollback:** each item's commit reverts independently.

**Worktree lanes (optional):**
- **Lane A:** WI-4.1 (`Editor/extensions/`) is independent.
- **Lane B:** WI-4.2 → WI-4.6 → WI-4.5 run in sequence, because they share `BottomTabs`, `Sidebar` and `App.tsx`.
- **Lane C:** WI-4.3 → WI-4.4 → WI-4.7 run in sequence, because they share the settings components and the settings CSS partial.
- **Conflict flag:** all lanes still meet in the theme files, `DESIGN.md` and `CHANGELOG.md`. Merge one lane at a time and re-run G0 after each merge.

---

## Stage 5 — `sourceFont` preference (Deliverable D; item 3, D2)

**Entry:** Deliverable C is accepted, **and** the E6 fix has landed in its own PR: a `config.json` parse failure no longer leads to any write over the file (TODOS.md P1). If the fix has not landed, stop here.

**First run vs upgrade (observed; re-verify in preflight):**
- A missing `~/.mdpro/config.json` is created from `UserPreferences::default()` (`src-tauri/src/services/preferences.rs:62-77`), so `EditorConfig::default()` decides the first-run value.
- An existing file goes through serde, so field-level defaults decide the upgrade value.
- If preflight finds this no longer holds, stop and ask.

### WI-5.1 — Rust model (E3) — S
- **Field:** add `source_font: String` to `EditorConfig` in `src-tauri/src/models/preferences.rs` (near `:568`).
  - It is serialized as `sourceFont`, with exactly two known values: `"mono"` and `"editor"`.
  - This follows the existing `font_family: String` pattern.
- **Upgrade defaults (review :100):**
  - The field gets `#[serde(default = …)]` returning `"editor"`, so existing files keep their current look.
  - `UserPreferences.editor` (`:54-56`) is plain `#[serde(default)]` today, which calls `EditorConfig::default()`. It gets a dedicated default fn that also yields `"editor"`, so a file with no `editor` block counts as an upgrade too.
- **First-run default (review :100):** `EditorConfig::default()` returns `"mono"`. It is reached only through `UserPreferences::default()`, which is written when no file exists.
- **Unknown values:** an unknown string deserializes without error and is interpreted at apply time (WI-5.3). Because there is no enum, the field adds no new whole-file parse failure.
- **Shared fixture:** `tests/fixtures/preferences-source-font.json` (assumption; match existing fixture folders) holds the cases below. Rust reads it with `include_str!`; the TS tests read the same file.
- **Tests (`cargo test`):**
  - `editor` present without `sourceFont` → `"editor"`
  - no `editor` block → `"editor"`
  - `UserPreferences::default()` (what a missing file becomes) → `"mono"`
  - `"mono"` and `"editor"` round-trip through serialize and deserialize
  - an unknown string (e.g. `"serif"`) loads without error and leaves every other preference intact
  - a merge that changes `sourceFont` preserves every sibling `editor` field

### WI-5.2 — TypeScript type and defaults — S
- Add `sourceFont: "mono" | "editor"` to `EditorConfig` in `src/types/preferences.ts` (near `:284`). `DEFAULT_EDITOR_CONFIG.sourceFont` is `"mono"`, matching Rust `Default`; `DEFAULT_PREFERENCES` must stay in sync with Rust.
- Add one shared `normalizeSourceFont(value: unknown): "mono" | "editor"`, which maps anything unknown to `"editor"`. Both the startup apply (WI-5.3) and Settings initialization (WI-5.4) use it, so an unknown stored value never reaches a two-option control.
- **Tests:**
  - Read the shared fixture and assert that the TS defaults agree with its known values.
  - `normalizeSourceFont` maps `"mono"`, `"editor"`, an unknown string, `undefined` and a non-string correctly.
  - Upgrade semantics are proven in Rust only, because TS never deserializes the file.

### WI-5.3 — Runtime application — S
- Declare `--source-font-family` in `:root`, defaulting to the mono stack (proposal :27; E8). `.cm-content` consumes it instead of `--editor-font-family`.
- `editorPrefApply.ts` sets `--source-font-family` at runtime from `normalizeSourceFont(value)`:
  - `"mono"` → the mono stack (proposal :27; confirm the mono token name in `:root`)
  - `"editor"` and any unknown value → `var(--editor-font-family)` (proposal :59), like the default branch of `fontFamilyToCss` (`editorPrefApply.ts:46-52`)
- Editor font size and `--editor-line-height` stay unchanged (review :97).
- Update rule 31:93-98 to list `--source-font-family` as the fourth runtime-toggled token.
- **Tests:** a pure-function test that `"mono"`, `"editor"` and an unknown string each produce the expected CSS variable assignment.

### WI-5.4 — Settings → Editor "Source font" row — S
- Add a row with Monospace / Follow editor font, using the Stage 4 row contract.
- It goes through `EditorSettings.handleChange` (`EditorSettings.tsx:30-34`), which sends the whole `editor` object and rolls back on failure. No new save path.
- Settings initialization (`EditorSettings.tsx:12-16`, which does `{ ...DEFAULT_EDITOR_CONFIG, ...p.editor }`) passes `sourceFont` through `normalizeSourceFont`.
- **Tests (userEvent):**
  - changing the option sends an `editor` payload with `sourceFont` changed and every sibling field unchanged
  - the applied variable changes
  - a rejected save rolls back both the row and the variable
  - the row has an accessible label
  - a stored unknown value shows "Follow editor font" as selected
- **Logging:** follow the existing preference-change logging pattern (rule 20).

### Stage 5 acceptance criteria
- [ ] G0 passes, including `cargo test`
- [ ] Upgrade path proven by Rust tests: a missing field and a missing `editor` block both give `"editor"`
- [ ] Upgrade path seen in Tauri with an existing `config.json` that has no `sourceFont`: Source mode renders exactly as before, and the screenshot matches the Stage 4 after-shot. `pnpm dev` cannot show this, because it returns `DEFAULT_PREFERENCES`.
  - Never touch the real `~/.mdpro/config.json`. `load_preferences` finds the file through `HOME` (`services/preferences.rs:51-60`).
  - Build once with `pnpm tauri dev`. Then, with the Vite server still running, launch the debug binary with `HOME` pointed at a temp directory that holds the fixture.
  - Record the `shasum` of the real file before and after; the two must match.
- [ ] Cold start in Tauri with `sourceFont: "editor"`: record whether a mono first paint is visible (E8). If it is, a TODO exists that covers first paint for all editor preferences.
- [ ] First-run path proven by test: no preferences file → `"mono"`
- [ ] An unknown `sourceFont` value loads without error, applies as Follow editor font, and leaves other preferences intact
- [ ] The Settings row switches Source mode between mono and the editor font live, in both themes; WYSIWYG is unaffected
- [ ] Editor font size and line height are unchanged in both options
- [ ] Rule 31:93-98 lists four runtime-toggled tokens; DESIGN.md is updated without values
- [ ] CJK caveat checked manually: tables with CJK are noted as not aligning exactly (review :102-103); scroll and selection mapping across mode switches is verified
- [ ] Source-mode screenshots for each option × theme; `/qa-only` findings triaged
- [ ] `CHANGELOG.md` Unreleased entry for Deliverable D
- [ ] **STOP (Deliverable D):** the report is posted, the commit split is proposed, and the user has replied

**Proposed commit split (D, proposal only; backend first, per the CLAUDE.md splitting strategy):**
1. `feat(prefs): sourceFont model (Rust)`
2. `feat(prefs): sourceFont type and apply (TS)`
3. `feat(settings): Source font row`
4. `docs(rules): rule 31 runtime token`

**Rollback:** revert D. A missing-field preferences file stays valid in both directions, because the field is additive.

---

## Constraints (all stages)

- **Do not copy anything review §3 lists (:255-263):**
  - OpenAI Sans and the gray ramp
  - foreground-colored primary buttons
  - a control blue separate from the accent
  - neutral-step menu hover
  - the 46pt title bar and 24px chrome
  - a translucent sidebar, `superellipse`, `light-dark()`, `[data-theme]`
  - a Tailwind spacing scale or any `--space-N` scale
  - 12px body text
- **Keep:**
  - the solid-accent menu highlight (review :260; rule 32)
  - the current neutrals (D4)
  - the title-bar and tab-bar heights
  - the editor font size and `--editor-line-height`
- **No `--color-syntax-code`**; never copy `proposal-ab.html:63-69`.
- **No behavior changes** outside the numbered review items. Do not build a command palette (Q11). Do not edit `docs/design/mdpro-ui-old/*` or `docs/design/mdpro-ui-new/proposal-ab.html`.
- **Do not delete** the dead-code candidates (A8).
- **No commits or pushes** unless the user asks. Never commit screenshots.

## Risks

| Risk | Mitigation |
|---|---|
| The split breaks tests that read `globals.css` from disk | WI-1.1 helper before the move; assertions are unchanged |
| Vite changes CSS order across partials | One ordered `src/styles/index.css`, read by the app, the test helper and the pure-move proof (E2); built-CSS order check in Stage 1 |
| A translucent `--color-border` changes elements that use it as a fill | WI-3.0 retargets fills first |
| `color-mix()` is unsupported at the WebKit floor | Floor raised to macOS 13.1 in WI-3.4 (E1) |
| A 70% focus ring misses 3:1 on soft or tinted fills | Contrast table in Stage 3; flag, don't silently retune |
| Snapping sub-12px text overflows tight chrome (tab badges, TOC) | Screenshot matrix at 100% and 200% zoom |
| Undeclared fallback tokens hide intended colors | Q6 resolved in Stage 2 |
| First run cannot be told apart from an upgrade | File presence decides (observed). Serde defaults cover both the field and the `editor` block; Rust tests cover both plus first run (WI-5.1) |
| A zero-change stage drifts by 1px or one color without anyone noticing | Computed-style JSON diff instead of visual comparison (E5) |
| Replacing native checkboxes breaks a setting's persistence | Table-driven per-site regression test (WI-4.3) |
| A corrupt `config.json` is overwritten at launch (pre-existing) | The E6 fix must land before Stage 5 |
| Keyboard behavior (Space on a switch) cannot be tested with plain DOM events in jsdom | Test-only Testing Library devDependencies (E7), pinned by the WI-1.0 smoke test |
| Existing users see mono for a moment before preferences load | Accepted (E8); checked in Stage 5 acceptance |
| The manual upgrade check overwrites the developer's real preferences | Temp `HOME` plus a before/after checksum of the real file (Stage 5) |

## What already exists (reuse, don't rebuild)

| Existing | Reused by |
|---|---|
| `.toolbar-button.danger` (`globals.css:1195`) | WI-4.6 destructive confirm |
| `.toggle-switch` / `.toggle-slider` CSS (`globals.css:1314-1345`) | `ToggleSwitch` wraps it; no new switch styles |
| The `fontFamilyToCss` default-branch fallback (`editorPrefApply.ts:46-52`) | `sourceFont` apply (WI-5.3) |
| `EditorSettings.handleChange`: full `editor` object save plus rollback; the failure toast in `preferencesService.setPreferences` | Source font row (WI-5.4) |
| `load_preferences` writes defaults when the file is missing (`services/preferences.rs:62-77`) | First-run detection, with no new flag (WI-5.1) |
| The source-inspection pattern of `tests/design-tokens-accent-danger.test.ts`; `tests/focus-trap.test.ts` | WI-2.1, WI-3.3, WI-4.6, WI-4.7 |
| `color-mix()` already ships in 7 places (e.g. `dark.css:9`) | E1 makes official the macOS floor it already needs |

## NOT in scope

- Review §4 artboard work (designing the undrawn surfaces). Those surfaces get token changes only.
- A command palette, unless the app already has one (Q11).
- Density changes, title-bar and tab-bar height changes.
- Deleting `src/App.css` or `src/components/TabBar/` (list them only).
- A stylelint setup or any new runtime dependency.
- The rejected D3 code hue.
- Fixing the existing `config.json` overwrite inside this plan. It is a separate PR that gates Stage 5 (E6; TODOS.md P1).
- Removing the first-paint delay that all editor preferences already have (E8).
- An `@supports` fallback for `color-mix()`, which E1 makes unnecessary.

## Acceptance Criteria

- [ ] Stage 0 gate: the plan is approved and A1–A12 / Q1–Q11 are answered or waived
- [ ] Deliverable A: `globals.css` split with a pure-move proof; tokenization guard is green; empty computed-style diff against the baseline
- [ ] Deliverable B: proposal token retune applied in both themes; deferred list empty; contrast table and rule 33 checklist recorded; **user visual sign-off received**
- [ ] Deliverable B also raises the macOS floor to 13.1 in `tauri.conf.json`, CLAUDE.md and DESIGN.md
- [ ] Deliverable C: items 2, 4, 5, 6, 9, 13, 14 implemented with behavior tests; `--settings-btn-*` retired; deferred list empty; no new runtime dependency; **user visual sign-off received**
- [ ] E6: the `config.json` overwrite fix landed before Stage 5 started
- [ ] Deliverable D: `sourceFont` upgrade, first-run and unknown-value semantics proven in Rust tests against a fixture shared with TS; unknown values are normalized in the UI; the real preferences file stayed untouched during manual checks; rule 31 lists four runtime tokens
- [ ] `pnpm build`, `pnpm test:run` and `cargo test` all exit 0 at the end of every stage
- [ ] In-scope app CSS is 100% tokenized per A5: the grep returns only permitted lines
- [ ] DESIGN.md documents every new token without values; CHANGELOG Unreleased covers A–D
- [ ] `docs/guide/manual-test-ui-redesign.md` covers every changed surface
- [ ] No screenshots, `.prompts/` artifacts or commits were added without the user's request

## Implementation tasks (tracking)

- [ ] **T0 (S+M)** — Stage 0 — WI-0.1…0.6 — Verify: the Stage 0 acceptance list and the user's approval
- [ ] **T1a (S)** — Test tooling — WI-1.0 — Files: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `tests/testing-library-smoke.test.tsx` — Verify: `pnpm test:run`, `pnpm build`
- [ ] **T1 (S)** — Ordered CSS entry and reader helper — WI-1.1 — Files: `src/styles/index.css`, `src/main.tsx`, `src/test/appCss.ts`, 4 CSS-reading tests — Verify: `pnpm test:run`, empty computed-style diff
- [ ] **T2 (M)** — Split `globals.css` — WI-1.2 — Files: `src/styles/globals.css`, `src/styles/sections/`, `src/styles/index.css` — Verify: pure-move diff, empty computed-style diff
- [ ] **T3 (M)** — Tokenization guard with scanner fixtures, stage-tagged deferred list and dead-code guard — WI-2.1 — Files: `tests/css-tokenization.test.ts` — Verify: RED evidence, then green
- [ ] **T4 (M)** — Value-preserving tokens and migration — WI-2.2/2.3 — Files: `src/styles/**`, the co-located CSS, `DESIGN.md` — Verify: G0, empty computed-style diff
- [ ] **T5 (M)** — Visual retune and macOS 13.1 floor — WI-3.0…3.5 — Files: theme files, partials, `DESIGN.md`, `CLAUDE.md`, `src-tauri/tauri.conf.json`, rule 33 (conditional) — Verify: Stage 3 list and visual sign-off in WKWebView
- [ ] **T6 (M)** — HighlightStyle — WI-4.1 — Files: `src/components/Editor/extensions/syntax.ts`, `editorPrefApply.ts` — Verify: `pnpm test:run`
- [ ] **T7 (M)** — Icon wrapper — WI-4.2 — Files: `src/components/common/`, `SettingsDialog.tsx`, `BottomTabs.tsx` — Verify: `pnpm test:run`
- [ ] **T8 (M)** — ToggleSwitch, settings rows and badge — WI-4.3/4.4 — Files: `src/components/common/ToggleSwitch.tsx`, settings panels, CSS — Verify: `pnpm test:run`, including the per-site regression test and the focus-visible check
- [ ] **T9 (M)** — Segmented control — WI-4.5 — Files: `App.tsx`, `Sidebar/index.tsx`, new component — Verify: `pnpm test:run`
- [ ] **T10 (S)** — Destructive confirm and settings rail — WI-4.6/4.7 — Files: `ConfirmDialog.tsx`, callers, theme files — Verify: `pnpm test:run`
- [ ] **T11 (M)** — `sourceFont` — WI-5.1…5.4 — Files: `preferences.rs`, `preferences.ts`, `editorPrefApply.ts`, `EditorSettings.tsx`, the shared fixture, `normalizeSourceFont`, rule 31 — Blocked by: the E6 fix PR — Verify: `cargo test`, `pnpm test:run`

Sizes (S/M) are planning estimates, not commitments.

---

## Stop report template (posted at each of the five stops)

1. **Summary:** stages done; review items done or deferred, by number; which assumptions were confirmed or changed.
2. **Token changes:** names only, with file:line.
3. **CSS file map:** before → after, with line counts.
4. **Literal inventory:** before and after counts per file; every remaining exception with file:line and the rule 31 clause, or approved exception, that allows it.
5. **Tests:** new and updated test files; exact commands run, with exit codes.
6. **Visual evidence:** computed-style diff commands and results (Stages 1–2); before/after screenshot paths (outside the repo) per surface × theme, with window size, zoom and engine (`/browse` or `pnpm tauri dev`); mismatches and "no reference" flags.
7. **Contrast table and rule 33 checklist results.**
8. **`/plan-design-review` or `/qa-only` findings:** each marked fixed, deferred or out of scope.
9. **Open questions, dead-code candidates, and the proposed commit split.**

---

## Appendix A — Literal classification (filled in WI-0.2)

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| _to fill_ | | | | | | |

## Appendix B — QA surface matrix (filled in WI-0.3 / WI-0.4)

| Surface | Reference | Runs under | Light before | Dark before | Light after | Dark after | Size / zoom | Notes |
|---|---|---|---|---|---|---|---|---|
| Main window — Source | has reference | `pnpm dev` | | | | | | |
| Main window — WYSIWYG | _check_ | `pnpm dev` | | | | | | |
| Sidebar / TOC active row | has reference | `pnpm dev` | | | | | | |
| Insert modal / link modal | _check_ | `pnpm dev` | | | | | | |
| Table and image context menus | _check_ | `pnpm dev` | | | | | | |
| Settings — each page | Integrations / Export / Editor drawn; others no reference | `pnpm dev` / Tauri | | | | | | |
| Toasts | _check_ | `pnpm dev` | | | | | | |
| Preview pane | _check_ | `pnpm dev` | | | | | | |
| Recent-files dropdown | no reference | _check_ | | | | | | |
| Disabled-with-reason button | no reference | _check_ | | | | | | |
| External-file-changed banner/dialog | no reference | Tauri | | | | | | |
| Drag-and-drop target | no reference | Tauri | | | | | | |
| Empty / no-tabs state | no reference | `pnpm dev` | | | | | | |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 | ISSUES_FOUND (all resolved) | Plan review: 9 findings, 8 folded, 1 invalid. Decision consult: 10 verdicts (4 agree, 5 agree-with-changes, 1 disagree) plus 3 cross-cutting issues, all accepted. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 29 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Scheduled as WI-0.6 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** Caught three factual errors in the draft: the preferences file is `config.json`, not `preferences.json`; the checkbox inventory was wrong; and so was the `color-mix` release claim. It also showed that the preferences overwrite happens at every launch, not only on the next settings change, which escalated D8 into E6. It flagged two further gaps: Testing Library is not installed, which led to E7, and the computed-style gate did not cover pseudo-elements or interaction states.
- **CROSS-MODEL:** The two models agreed on D1–D7, D9 and D10; the changes Codex asked for were accepted as refinements (E3–E5). They disagreed on D8. The review had filed it as a TODO; Codex argued the bug should block Stage 5. The user sided with Codex (E6).
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — ready to implement. Stage 5 stays blocked until the E6 fix lands.

NO UNRESOLVED DECISIONS
