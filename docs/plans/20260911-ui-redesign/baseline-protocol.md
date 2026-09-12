# UI redesign plan — Baseline and working protocol

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

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
| `src/components/Preview/styles/preview.css` (dead-code candidate, DR10; out of scope) | 139 | 1 | 2 |
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
  - Callers: `BottomTabs.tsx:83` and `App.tsx:1180` ("Discard changes"). `Sidebar/Sidebar.tsx:53` is a third, in a component nothing renders.
  - The confirm button has `autoFocus` (`:53`), and the card uses `aria-label` (`:37`). There is no Tab trap and no backdrop click (DR8).
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
  - the Preview pane (DR10): `src/components/Preview/Preview.tsx` is imported nowhere since `4570de3`; `ImageRenderer.tsx`, `styles/preview.css` and `src/hooks/usePreview.ts` are used only by it. `mathRender.ts` in the same folder is live (`exportService.ts:4`).
  - the old document list: `src/components/Sidebar/Sidebar.tsx` is re-exported at `Sidebar/index.tsx:54` but rendered nowhere, and `FileItem.tsx` is imported only by it (`Sidebar.tsx:3`). The WI-2.1 dead-code guard must allow that re-export or name it.
  - the large-file warning (`useDocument.ts:31`, `:66-68`, `:101-103`, `:126-128`; `App.tsx:499-503`): it warns above 10 MB, and the backend already refuses those files (`src-tauri/src/commands/file.rs:16`, `:162-168`)

### Gates and tools

- `pnpm build` (`tsc && vite build`), `pnpm test:run` (`vitest run`), `cd src-tauri && cargo test`. **Correction (E25): all three run in `.github/workflows/ci.yml` only on `tags: ['v*']` and manual dispatch** (`ci.yml:2-6`). There is no pull-request or push-to-master trigger, so today none of them gates a merge, and all 1138 tests are skipped on every merge path. WI-0.0 restores that gate. Note also that `tsc` type-checks only `src` (`tsconfig.json:23`), so no test file is type-checked (E28).
- `pnpm dev` serves localhost:1420 without Tauri APIs; `pnpm tauri dev` runs the full app.
- `.claude/tdd-guardian/config.json` has `enabled: true`. **Correction (verified 2026-09-12): `lanes` is present, not absent, and there is no top-level `testCommand` key.** Two lanes are configured: `unit` (`pnpm exec vitest run --coverage`, `gateOn: ["taskCompleted", "commit"]`, `coverageSummaryPath: coverage/coverage-summary.json`, `probeCommand: pnpm exec vitest list`) and `rust`. The file also carries `coverageThresholds`, `coverageMode`, `requireMutation`, `mutationCommand` and `mutationGateOn`. Consequence for ordering: **the unit lane already runs `--coverage`**, so until E27's `coverage.include` fix lands it measures against the 97898-line denominator; no threshold may be written into this config before WI-0.0. Readiness is still confirmed in WI-0.1.
- `CHANGELOG.md:8` has a `## [Unreleased]` section.

---

## Working protocol (applies to every stage)

**Per work item** (`/feature-workflow` + `/tdd-guardian:workflow`):
1. Preflight: re-verify the cited file:line facts and record discrepancies.
2. RED: write or adjust a test that fails for the right reason. CSS-only changes have no unit test (rule 10) but must pass the screenshot and tokenization gates.
   - **E26 exemption:** a behavior-preserving move (a CSS split, a pure extraction) has no honest RED — inventing a failing test for it is theater. It lands as passing characterization before and after, so "every work item lands RED to GREEN" does not apply to it.
   - **E26 migration rule:** when the work item touches a test that asserts on production **source text** (43 of 85 files read source with `readFileSync`; 41 assert on it), add the behavioral characterization and delete the superseded regex assertions in the **same** commit, before the commit that changes production code. Never migrate the suite wholesale.
3. GREEN, then refactor.
4. Run the common gate (below).
5. Update the manual test guide (A11).

**Common gate G0** runs at the end of every work item and every stage:
- [ ] `pnpm build` exits 0
- [ ] `pnpm test:run` exits 0; no newly skipped tests; no assertion deleted to get green
- [ ] `cd src-tauri && cargo test` exits 0 (required whenever Rust changed; otherwise run once per stage)
- [ ] No file outside the work item's declared file set changed, compared with the baseline `git status --porcelain` saved in WI-0.1 (the tree already has unrelated changes)
- [ ] No new dependency: `git diff package.json src-tauri/Cargo.toml` is empty, apart from the **four** E7/E28 devDependencies, which land in WI-0.0's chore PR before Stage 0 — not in WI-1.0
- [ ] No screenshot, no `.prompts/` artifact, and no conversation content in the diff
- [ ] `pnpm coverage` exits 0 and no metric fell below its recorded threshold (E27; from WI-0.0 onward)
- [ ] The Milkdown browser suite exits 0, once it exists (E31). G0 names it explicitly, so the original three commands cannot pass while the plan's most important regression is skipped.
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
- Each before/after pair uses the same window size and scale (1×, or the DR17 2× check), recorded in the index.
- A cell that cannot be captured is marked in the matrix, and the user is asked to capture it. Never skip a cell silently.

**Contrast protocol:**
- Compute ratios from resolved colors, in both themes, with a throwaway script outside the repo. Record a table.
- Failures are flagged, not silently retuned.

**Rule 33 protocol:**
- Tab through every changed surface in both themes: at the default window, at the 400×640 minimum (DR16), and with `zoom: 2` set on `<html>` from Web Inspector in `pnpm tauri dev` (DR17). mdpro has no page zoom, so 200% browser zoom can't be reached.
- Modals loop Tab, and Esc returns focus to the invoking control.
- Where `/browse` cannot drive focus, or a check needs Web Inspector, ask the user to run it, and record who ran it.

---

## Definition of "100% tokenized" (A5)

Applies to every app-owned `src/**/*.css` file except `globals.css :root`, `light.css`, `dark.css`, third-party CSS (highlight.js, KaTeX) and the dead-code candidates. The dead-code exclusion holds only while they stay unimported: the tokenization test asserts that no `src/**` file outside the candidates, and not `index.html`, imports them, and any such import brings the file into scope.

- **Color properties** (color, background, border, outline, fill, stroke, box-shadow, caret-color, text-decoration-color) may use only `var(--…)`, `color-mix()` over `var()`s, `transparent`, `currentColor` or `inherit`.
- **Must use `var(--…)`:** font-family, chrome font-size, border-radius, transition/animation duration and easing, icon width/height.
- **Allowed literals:**
  - the rule 31:58-76 list
  - `em` / `%` sizes inside editor and preview content
  - z-index values from the rule 31:83-91 table
- **Enforcement:** `tests/css-tokenization.test.ts` (WI-2.1).
