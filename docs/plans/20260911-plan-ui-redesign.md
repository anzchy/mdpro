# Plan: UI Redesign — proposal-ab alignment + 100% tokenized CSS

Generated on 2026-09-11 from the execution prompt `.prompts/2026-09-11_050736_FINAL.md`
Baseline commit: `0a3675e` (re-verify every "observed" fact before relying on it)
Branch: master
Status: DRAFT — blocked on the Stage 0 approval gate
Sources of truth (precedence on conflict: rules > old DESIGN.md > review > proposal > DESIGN.md):

- [`.claude/rules/30-34`](../../.claude/rules/): enforceable rules. Rule 31 defines "tokenized"; rule 33 defines focus patterns; rule 34 defines the theme classes.
- [`docs/design/mdpro-ui-old/DESIGN.md`](../design/mdpro-ui-old/DESIGN.md): the shipped UI's aesthetic register. D1–D4 are logged at :122-125. Cited in these plan files as `old DESIGN.md:N`. Read-only in this plan (see Constraints).
- [`docs/design/mdpro-ui-new/mdpro-ui-codex-review.md`](../design/mdpro-ui-new/mdpro-ui-codex-review.md): the change list, items 1–15.
- [`docs/design/mdpro-ui-new/proposal-ab.html`](../design/mdpro-ui-new/proposal-ab.html): the rendered target. Tokens are at :21-61; the rejected D3 block at :63-69 must never ship.
- [`docs/design/mdpro-ui-new/DESIGN.md`](../design/mdpro-ui-new/DESIGN.md): the target design system distilled from the review and the proposal. It holds token names (no values), a component contract per surface with proposal line citations, the rule edits the redesign needs, and the open questions. Use it as the per-work-item checklist and at visual sign-off. It ranks below the review and the proposal, so a disagreement with either is a bug in this file and a stop-and-ask. A bare `DESIGN.md` in these plan files means this file: every token, platform-floor and runtime-token doc update in this plan lands here. The root `DESIGN.md` is only an index.

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

One line per decision. The full text and sources are in [`decisions.md`](20260911-ui-redesign/decisions.md); if the two differ, `decisions.md` wins.

| ID | Decision |
|---|---|
| D1 | A's register with B's structure |
| D2 | Hybrid Source font: Monospace for new installs, plus a "Source font" preference |
| D3 | No second hue in Source syntax (no `--color-syntax-code`) |
| D4 | Keep the current cool neutrals; adopt only derived mechanics |
| E1 | macOS floor is 13.1, for `color-mix()`; no `@supports` fallback |
| E2 | CSS order has one source: `src/styles/index.css` |
| E3 | `sourceFont` is `"mono"` \| `"editor"`: existing files get `"editor"`, first run gets `"mono"`, unknown values fall back to `"editor"` |
| E4 | One `ToggleSwitch` replaces the Settings toggles and checkboxes |
| E5 | Zero-change stages are proven by a computed-style JSON diff; sign-off screenshots are taken in WKWebView |
| E6 | The `config.json` overwrite fix is its own PR and lands before Stage 5 |
| E7 | Testing Library devDependencies are allowed, test-only; Vitest also collects `.test.tsx` |
| E8 | `--source-font-family` defaults to mono in `:root`; a brief mono flash before preferences load is accepted |
| E9 | WI-4.14 pushes with a flushable owned debounce; fresh-open sources flush, MCP writes are wrapped by `closeHistory` (Q1) |
| E10 | Document ids become UUIDs; duplicate opens are coalesced by canonical path in a shared open coordinator (Q2) |
| E11 | Test tooling is fixed in its own chore PR before any baseline is captured (Q3) |
| E12 | `openDocumentFromPath` returns a result union, and one shared reporter serves every open route (Q4) |
| E13 | The drop target also clears on Escape; a real Escape-cancel check in WKWebView is an acceptance gate (Q5) |
| E14 | Insert-modal requests carry ownership tokens validated on submit (Q6) |
| E15 | Save As watcher re-arm folds in; draft recovery, watcher refcount and the suppression window become release-prerequisite PRs (Q7) |
| E16 | One lifecycle-testing foundation stage for `App.tsx`, then incremental extraction (Q8) |
| E17 | The `FileError` wire format is unchanged; `fileService` normalizes rejections into an `IpcError` carrying `kind` (S1) |
| E18 | The file watcher delivers the trailing event instead of dropping it; the save blackout goes (S2) |
| E19 | One cancellation-safe subscription primitive replaces all nine `listen()` sites (S3) |
| E20 | A `loggedOperation` wrapper logs Start before validation and exactly one terminal outcome (S4) |
| E21 | `ViewMode` persistence is fixed first (Rust gains `Source`), then ts-rs incrementally (S5) |
| E22 | Rule 50 becomes a ratchet; 19 production files exceed 300 lines, `App.tsx` (1194) is the largest (S6) |
| E23 | MCP events are routed in Rust with `emit_to`; Zustand selector violations are lint-enforced (S7) |
| E24 | Decision and risk rows carry ID / prerequisites / finding IDs / disposition / work item / evidence (S8) |
| DR1 | Reference directions for the empty state, external change and drop target; mockups stay local |
| DR2 | Build the main bar and status strip (WI-4.8) |
| DR3 | Build the no-document state, with New and Open… buttons (WI-4.9) |
| DR4 | Breadcrumb: muted parent folder, then file name; the full path only in a tooltip |
| DR5 | Rebuild the external-change dialog with three dirty-aware states (WI-4.10) |
| DR6 | Opening an already-open file switches to its tab and never re-reads it (WI-4.11, first in Stage 4) |
| DR7 | Build the drop target: an editor-column tint with a label chosen from the file types (WI-4.12) |
| DR8 | `ConfirmDialog` meets rule 32; destructive dialogs focus the safe action (WI-4.6) |
| DR9 | Failure toasts use the error variant: `role="alert"`, Dismiss, no auto-dismiss (WI-4.13) |
| DR10 | The Preview pane is a dead-code candidate (A8); Q1 is closed |
| DR11 | WYSIWYG picks up text changed outside the editor before the next edit (WI-4.14) |
| DR12 | Colors change instantly; only the knob `transform` and hover-reveal `opacity` animate |
| DR13 | One reduced-motion block zeroes the motion duration token |
| DR14 | Redesign tokens are logged in the new DESIGN.md; WI-5.5 marks it current |
| DR15 | `--color-focus-ring` equals the solid accent in both themes (Q4) |
| DR16 | The minimum window stays 400×640, and the new chrome gets narrow-width rules |
| DR17 | No page zoom, so QA checks 400×640 and `zoom: 2` instead of 200% zoom |
| DR18 | Word count: one per Han or kana character, one per other letter-digit run; Markdown syntax is not counted (Q12) |
| DR19 | WYSIWYG has no cursor field (Q13) |
| DR20 | One Dark stays selectable and unchanged; "Default" follows the app theme (Q3) |
| DR21 | No warning color; the dev toolbar's literals are a listed exception (Q7) |
| DR22 | Chrome font sizes outside the ramp take the proposal's roles; one new `--font-size-title` (Q8) |
| DR23 | Radii snap to `--radius-control`, `--radius-popover` and a new `--radius-inner`; pills use `999px` (Q9) |

## Assumptions (confirm or change at the Stage 0 gate)

| ID | Assumption |
|---|---|
| A1 | All 15 review items are in scope. If scope narrows (e.g. P0 only), drop whole work items. |
| A2 | Orchestrate through `/feature-workflow`. Each work item is implemented with `/tdd-guardian:workflow`. |
| A3 | Visual QA uses `/qa-only` (report-only). `/design-review` runs only when the user asks. |
| A4 | Screenshots and computed-style JSON are stored at `$TMPDIR/mdpro-redesign/<stage>/<surface>-<theme>.{png,json}` and never committed. |
| A5 | "100% tokenized" follows the definition in [`baseline-protocol.md`](20260911-ui-redesign/baseline-protocol.md). |
| A6 | Stage 1 is a pure move into ordered partials listed in `src/styles/index.css` (E2). `:root` tokens stay in `globals.css` (rule 31:11-16). |
| A7 | No new runtime npm or cargo dependency, including icon, image-diff and contrast tools. The only exception is E7's test-only devDependencies, added in WI-1.0. |
| A8 | `src/App.css`, `src/components/TabBar/`, the unmounted Preview pane (DR10: `src/components/Preview/Preview.tsx`, `ImageRenderer.tsx`, `styles/preview.css`, and `src/hooks/usePreview.ts`) the unmounted document list (`src/components/Sidebar/Sidebar.tsx` and `FileItem.tsx`) and the unreachable large-file warning (WI-4.13) are dead-code candidates; list them, do not delete them. `src/components/Preview/mathRender.ts` stays live, because HTML export uses it. The tokenization test asserts that no file outside the candidates imports them. Deletion is tracked in TODOS.md. |
| A9 | Contrast thresholds are WCAG 2.1 AA: 4.5:1 for text, 3:1 for focus indicators and control boundaries. |
| A10 | Class (c) literals with 3 or more unrelated uses get a semantic token (rule 31's rule of three). |
| A11 | Manual test guide location: `docs/guide/manual-test-ui-redesign.md`. |
| A12 | Deferred class (b) literals are tracked in an explicit allowlist inside the tokenization test rather than by `it.skip` on whole files. This refines the prompt so every file stays guarded during Stage 2; see WI-2.1. |

## Open questions (must be answered at the Stage 0 gate)

Q2, Q6 and Q10 are still open. The others are closed; their answers are in the decisions they name.

| ID | Question | Blocks |
|---|---|---|
| Q1 | The Preview's highlight.js theme in dark mode. **Closed by DR10:** the Preview is unmounted. | — |
| Q2 | Should `:root` keep its duplicated light values (`globals.css:1-47`)? **Proposed (design review; confirm at the Stage 0 gate):** keep them. `App.tsx:451-452` adds the theme class in an effect, after first paint, so `:root` is what paints first. WI-2.1's guard asserts that every token declared in both `:root` and `.theme-light` has the same value, so the copies can't drift. | WI-3.1 |
| Q3 | One Dark next to the new HighlightStyle. **Answered: DR20.** | WI-4.1 |
| Q4 | The rule 33 focus-ring edit. **Closed by DR15.** | WI-3.3 |
| Q5 | The WebKit floor. **Closed by E1:** macOS 13.1. | — |
| Q6 | Undeclared tokens are read with a hex fallback: `--color-success`, `--color-error` and `--color-text-tertiary` (`globals.css:1842`, `:1846`, `:1850`). Declare them, or replace them with existing tokens? **Proposed (design review; confirm at the Stage 0 gate):** replace them. They color the About update status (`AboutSettings.tsx:219-281`): error uses `--color-danger`, disabled uses `--color-muted`, and "up to date" uses `--color-text`, because DESIGN.md § Status indicator rules out green and the label already states the result. No token is declared. | WI-2.2 |
| Q7 | Amber warning literals. **Answered: DR21.** | WI-2.1, WI-4.3 |
| Q8 | Chrome font sizes outside the ramp. **Answered: DR22.** | WI-3.2, WI-4.2 |
| Q9 | Radii outside the token pair. **Answered: DR23.** | WI-2.1, WI-2.2, Stage 3 |
| Q10 | `z-index: 1` at `MilkdownEditor.css:214` is not in the rule 31:83-91 table. Allow it as a local stacking exception? **Proposed (design review; confirm at the Stage 0 gate):** allow it. It stacks the column-resize handle inside a table cell, not a window layer, and rule 31's table lists window layers. WI-2.1 lists it as a local exception with file:line. | WI-2.1 |
| Q11 | A command palette. **Closed:** the app has none, so the proposal's palette (:449) is out of scope; ⌘K already inserts a link (`typoraKeymapPlugin.ts:5`). | — |
| Q12 | Status-strip word count for CJK text and Markdown syntax. **Answered: DR18.** | WI-4.8 |
| Q13 | A cursor field in WYSIWYG. **Answered: DR19.** | WI-4.8 |
| Q14 | "Save As…" in the deleted-file state. **Closed:** `saveActiveDocumentAs` (`useDocument.ts:172-200`) already exists; only a menu item is missing. | WI-4.10 |

---

## Deliverables overview

| Deliverable | Stages | Visual change | Review items | Stop after |
|---|---|---|---|---|
| A — CSS infrastructure | 1, 2 | None (computed-style diff is empty) | none directly | Stage 2 |
| B — Visual retune | 3 | Intended | 1, 7, 8, 10, 11, 12, 15 | Stage 3 **(visual sign-off)** |
| C — Components | 4 | Intended | 2, 4, 5, 6, 9, 13, 14; DR2 main bar and status strip; DR3 empty state; DR5 external-change dialog; DR6 already-open guard; DR7 drop target; DR8 destructive confirmation; DR9 error toasts | Stage 4 **(visual sign-off)** |
| D — `sourceFont` | 5 | Intended (Source mode only) | 3 (D2) | Stage 5 |

The item→stage mapping is an assumption (A1). Correct it at the Stage 0 gate.

---

## Plan files

Read this file first, then only the stage file you are working on.

| File | Holds |
|---|---|
| [`decisions.md`](20260911-ui-redesign/decisions.md) | D1–D4, E1–E24 and DR1–DR23, with their sources |
| [`baseline-protocol.md`](20260911-ui-redesign/baseline-protocol.md) | Baseline facts at `0a3675e`, the working protocol, and the A5 definition of "100% tokenized" |
| [`stage-0-inventory.md`](20260911-ui-redesign/stage-0-inventory.md) | Stage 0: inventory, baseline, plan approval |
| [`stage-1-split.md`](20260911-ui-redesign/stage-1-split.md) | Stage 1: split `globals.css` (Deliverable A) |
| [`stage-2-tokenize.md`](20260911-ui-redesign/stage-2-tokenize.md) | Stage 2: value-preserving tokenization (Deliverable A) |
| [`stage-3-retune.md`](20260911-ui-redesign/stage-3-retune.md) | Stage 3: visual retune (Deliverable B) |
| [`stage-4a-components.md`](20260911-ui-redesign/stage-4a-components.md) | Stage 4 entry; WI-4.1–4.9, WI-4.12 and WI-4.15; the Stage 4 acceptance criteria, commit split and lanes (Deliverable C) |
| [`stage-4b-data-safety.md`](20260911-ui-redesign/stage-4b-data-safety.md) | WI-4.10, WI-4.11, WI-4.13, WI-4.14, WI-4.16, WI-4.17 and WI-4.18 (Deliverable C) |
| [`stage-4c-foundation.md`](20260911-ui-redesign/stage-4c-foundation.md) | WI-4.19–WI-4.22: the cross-cutting foundations the round-2 eng review decided (E19, E20, E23, E22/E16) |
| [`stage-5-source-font.md`](20260911-ui-redesign/stage-5-source-font.md) | Stage 5: `sourceFont` preference (Deliverable D) |
| [`risks.md`](20260911-ui-redesign/risks.md) | Risks and mitigations |
| [`appendices.md`](20260911-ui-redesign/appendices.md) | Appendix A (literal classification) and Appendix B (QA surface matrix) |

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
- **No behavior changes** outside the numbered review items, WI-4.8 (DR2), WI-4.9 (DR3), WI-4.10 (DR5), WI-4.11 (DR6), WI-4.12 (DR7), WI-4.13 (DR9), WI-4.14 (DR11) and the WI-4.6 dialog fix (DR8). Do not build a command palette (Q11). Do not edit `docs/design/mdpro-ui-old/*` or `docs/design/mdpro-ui-new/proposal-ab.html`.
- **Do not delete** the dead-code candidates (A8).
- **No commits or pushes** unless the user asks. Never commit screenshots.

## What already exists (reuse, don't rebuild)

| Existing | Reused by |
|---|---|
| `.toolbar-button.danger` (`globals.css:1195`) | WI-4.6 destructive confirm |
| `Toast`'s unused `onClose` prop and the `.toast-close` style (`App.tsx:1189` passes no `onClose`) | WI-4.13 dismiss button |
| `.toggle-switch` / `.toggle-slider` CSS (`globals.css:1314-1345`) | `ToggleSwitch` wraps it; no new switch styles |
| The `fontFamilyToCss` default-branch fallback (`editorPrefApply.ts:46-52`) | `sourceFont` apply (WI-5.3) |
| `EditorSettings.handleChange`: full `editor` object save plus rollback; the failure toast in `preferencesService.setPreferences` | Source font row (WI-5.4) |
| `load_preferences` writes defaults when the file is missing (`services/preferences.rs:62-77`) | First-run detection, with no new flag (WI-5.1) |
| The source-inspection pattern of `tests/design-tokens-accent-danger.test.ts`; `tests/focus-trap.test.ts` | WI-2.1, WI-3.3, WI-4.6, WI-4.7 |
| `color-mix()` already ships in 7 places (e.g. `dark.css:9`) | E1 makes official the macOS floor it already needs |
| The MCP `replaceAll` push into the live editor (`useMcpEvents.ts:135-144`) | WI-4.14 |
| Table menu keyboard traversal (`TableContextMenu/index.tsx:146-172`) | WI-4.15 extracts it into the shared hook |
| The save picker and save path `saveActiveDocumentAs` (`useDocument.ts:172-200`) | WI-4.10's "Save As…" (Q14) |
| The General and Editor load-failure line (`GeneralSettings.tsx:73`) and the `MarkdownSettings` rollback (`:30-39`) | WI-4.3 settings states |

## NOT in scope

- Review §4 artboard work (designing the undrawn surfaces). Those surfaces get token changes only, except the empty state, which WI-4.9 builds (DR3), the external-change dialog, which WI-4.10 rebuilds (DR5), and the drop target, which WI-4.12 builds (DR7).
- A command palette, unless the app already has one (Q11).
- Density changes, title-bar and tab-bar height changes.
- Deleting `src/App.css`, `src/components/TabBar/`, the Preview pane files, `Sidebar/Sidebar.tsx` and `FileItem.tsx`, or the large-file warning (list them only).
- Restyling or re-mounting the Preview pane (DR10). Its dark code theme is unsolved, because `Preview.tsx:6` imports only the light `github.css`, and has to be solved before any re-mount.
- A stylelint setup or any new runtime dependency.
- The rejected D3 code hue.
- Fixing the existing `config.json` overwrite inside this plan. It is a separate PR that gates Stage 5 (E6; TODOS.md P1).
- Removing the first-paint delay that all editor preferences already have (E8).
- An `@supports` fallback for `color-mix()`, which E1 makes unnecessary.
- Page zoom (⌘= / ⌘−). mdpro has none today, and the DR17 2× check stands in for it (TODOS candidate).
- An app error boundary. `src/` has none (no `componentDidCatch`), so a render error leaves a blank window with no message and no way back (TODOS candidate).
- The update download failure copy. About shows the raw error, `Download failed: ${msg}` (`AboutSettings.tsx:152-155`), while a failed check shows friendly copy (`:105`). Rule 30 rule 3 wants the raw text in the log only (TODOS candidate).
- Asking before unsaved shortcut edits are dropped. Esc closes Settings with no dirty check (`SettingsDialog.tsx:63-65`) and the closed dialog unmounts its pages (`:110`), so Shortcuts edits vanish without a prompt. WI-4.3 restyles the banner only (TODOS candidate).
- A Save As menu item. The ⌘⇧S preference and its Shortcuts row exist (`src/types/preferences.ts:87`, `:162`; `KeyboardShortcutsSettings.tsx:27`), but no menu item or handler uses them. WI-4.10 reaches `saveActiveDocumentAs` from the dialog only (Q14) (TODOS candidate).

## Acceptance Criteria

- [ ] Stage 0 gate: the plan is approved and A1–A12 / Q1–Q14 are answered or waived
- [ ] Deliverable A: `globals.css` split with a pure-move proof; tokenization guard is green; empty computed-style diff against the baseline
- [ ] Deliverable B: proposal token retune applied in both themes; deferred list empty; contrast table and rule 33 checklist recorded; **user visual sign-off received**
- [ ] Deliverable B also raises the macOS floor to 13.1 in `tauri.conf.json`, CLAUDE.md and DESIGN.md
- [ ] Deliverable C: items 2, 4, 5, 6, 9, 13, 14, the DR2 main bar and status strip, the DR3 empty state, the DR5 external-change dialog and the DR6 already-open guard (each with its data-loss regression test), the DR7 drop target, the DR8 destructive confirmation (with its data-loss regression test), the DR9 error toasts (with the save-failure and open-failure regression tests), and the DR11 WYSIWYG sync (with its Reload regression test), all implemented with behavior tests; `--settings-btn-*` retired; deferred list empty; no new runtime dependency; **user visual sign-off received**
- [ ] E6: the `config.json` overwrite fix landed before Stage 5 started
- [ ] Deliverable D: `sourceFont` upgrade, first-run and unknown-value semantics proven in Rust tests against a fixture shared with TS; unknown values are normalized in the UI; the real preferences file stayed untouched during manual checks; rule 31 lists four runtime tokens
- [ ] `pnpm build`, `pnpm test:run` and `cargo test` all exit 0 at the end of every stage
- [ ] In-scope app CSS is 100% tokenized per A5: the grep returns only permitted lines
- [ ] DESIGN.md documents every new token without values; CHANGELOG Unreleased covers A–D
- [ ] `docs/guide/manual-test-ui-redesign.md` covers every changed surface
- [ ] No screenshots, `.prompts/` artifacts or commits were added without the user's request

## Implementation tasks (tracking)

**`Depends on:`** is the only dependency field in this list, and it points **backwards**: "T13 depends on T12" means T12 lands first. Earlier drafts wrote `Blocks:` here for that same backwards relation while the open-questions table above uses `Blocks:` forwards, so one word named opposite directions inside one file; a reader following the task list would have executed the graph reversed (E24). The open-questions table keeps `Blocks:`, which is correct there.

- [ ] **T0 (S+M)** — Stage 0 — WI-0.1…0.6
  - **Depends on:** none
  - **Verify:** the Stage 0 acceptance list and the user's approval
- [ ] **T1a (S)** — Test tooling — WI-1.0
  - **Files:** `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `tests/testing-library-smoke.test.tsx`
  - **Depends on:** T0, and the E11 tooling chore PR, which lands before Stage 0
  - **Verify:** `pnpm test:run`, `pnpm build`
- [ ] **T1 (S)** — Ordered CSS entry and reader helper — WI-1.1
  - **Files:** `src/styles/index.css`, `src/main.tsx`, `src/test/appCss.ts`, 4 CSS-reading tests
  - **Depends on:** T1a
  - **Verify:** `pnpm test:run`, empty computed-style diff
- [ ] **T2 (M)** — Split `globals.css` — WI-1.2
  - **Files:** `src/styles/globals.css`, `src/styles/sections/`, `src/styles/index.css`
  - **Depends on:** T1
  - **Verify:** pure-move diff, empty computed-style diff
- [ ] **T3 (M)** — Tokenization guard with scanner fixtures, stage-tagged deferred list and dead-code guard — WI-2.1
  - **Files:** `tests/css-tokenization.test.ts`, `.claude/rules/31-design-tokens.md` (§ Acceptable hardcoded values, DR23)
  - **Depends on:** T2
  - **Verify:** RED evidence, then green
- [ ] **T4 (M)** — Value-preserving tokens and migration — WI-2.2/2.3
  - **Files:** `src/styles/**`, the co-located CSS, `DESIGN.md`
  - **Depends on:** T3
  - **Verify:** G0, empty computed-style diff
- [ ] **T5 (M)** — Visual retune and macOS 13.1 floor — WI-3.0…3.5
  - **Files:** theme files, partials, `DESIGN.md`, `CLAUDE.md`, `src-tauri/tauri.conf.json`, rule 33 (DR15 spec column, DR17 checklist)
  - **Depends on:** T4
  - **Verify:** Stage 3 list and visual sign-off in WKWebView
- [ ] **T6 (M)** — HighlightStyle — WI-4.1
  - **Files:** `src/components/Editor/extensions/syntax.ts`, `editorPrefApply.ts`
  - **Depends on:** T5 (Lane A, independent of the other Stage 4 lanes)
  - **Verify:** `pnpm test:run`
- [ ] **T7 (M)** — Icon wrapper — WI-4.2
  - **Files:** `src/components/common/`, `SettingsDialog.tsx`, `BottomTabs.tsx` and `BottomTabs.css` (tab markup), rule 32 (§ Tab bar), `TOCSidebar.tsx`, `IntegrationsSettings.tsx`, `AboutSettings.tsx`, `KeyboardShortcutsSettings.tsx`
  - **Depends on:** T5 (first in Lane B)
  - **Verify:** `pnpm test:run`
- [ ] **T8 (M)** — ToggleSwitch, settings rows and badge — WI-4.3/4.4
  - **Files:** `src/components/common/ToggleSwitch.tsx`, settings panels, `IntegrationsSettings.tsx`, `SettingsDialog.tsx` (MCP read), CSS
  - **Depends on:** T5 (first in Lane C)
  - **Verify:** `pnpm test:run`, including the per-site regression test, the settings state tests, the row-name test and the focus-visible check
- [ ] **T9 (M)** — Segmented control — WI-4.5
  - **Files:** `App.tsx`, `Sidebar/index.tsx`, new component
  - **Depends on:** T12
  - **Verify:** `pnpm test:run`
- [ ] **T10 (S)** — Destructive confirm and settings rail — WI-4.6/4.7
  - **Files:** `ConfirmDialog.tsx`, the two mounted Discard callers (`App.tsx`, `BottomTabs.tsx`), `tests/focus-trap.test.ts`, `.claude/rules/32-component-patterns.md` (first-focus exception) and rule 33 (pattern 3), theme files, `SettingsDialog.tsx` (rail tabs)
  - **Depends on:** T17 for WI-4.6 (Lane B); T8 for WI-4.7 (Lane C)
  - **Verify:** `pnpm test:run`, including the DR8 Enter regression. Then in `pnpm tauri dev`, press ⌘W on a document with unsaved edits and then Enter; the text must stay. Open Settings at 400×640: the rail is icon-only and rows wrap.
- [ ] **T12 (M)** — Main bar and status strip — WI-4.8
  - **Files:** `App.tsx`, `Sidebar/index.tsx`, new bar and strip components, a word-count util, the cursor-source wiring, the layout CSS partial
  - **Depends on:** T7 and T17 (Lane B runs WI-4.2 → WI-4.13 → WI-4.6 → WI-4.8)
  - **Verify:** `pnpm test:run`; drag region and traffic lights in `pnpm tauri dev`; the window at 400×640 in both sidebar states and at 959px
- [ ] **T13 (S)** — Empty state — WI-4.9
  - **Files:** `App.tsx`, a new empty-state component, `TOCSidebar.tsx`, the layout CSS partial
  - **Depends on:** T12
  - **Verify:** `pnpm test:run`; in `pnpm tauri dev`, launch with no file, close the last tab, and drop a `.md` file
- [ ] **T14 (M)** — External change dialog — WI-4.10
  - **Files:** `src/utils/dataLossGuards.ts`, `src/components/common/ReloadDialog.tsx`, `App.tsx`, `tests/focus-trap.test.ts`, new guard and dialog tests
  - **Depends on:** T13
  - **Verify:** `pnpm test:run`; the three states by hand in `pnpm tauri dev`
- [ ] **T15 (S)** — Already-open guard — WI-4.11
  - **Files:** `src/hooks/useDocument.ts`, a pure helper, new tests
  - **Depends on:** none (first in Stage 4)
  - **Verify:** `pnpm test:run`; in `pnpm tauri dev`, edit a file, then re-open it by ⌘O, recent files and a drop
- [ ] **T16 (S)** — Drop target — WI-4.12
  - **Files:** a new pure helper, a new hook, `App.tsx`, the workspace and empty-state CSS, and new tests
  - **Depends on:** T14; T23 (it registers through the cancellation-safe primitive, E19); and T26 (the lifecycle seam lands before the drop-target extraction, E22)
  - **Verify:** `pnpm test:run`. Then in `pnpm tauri dev`, in both themes and with and without a document, drag each file mix over the window, drop it, and cancel one drag with Esc — the target must clear (E13 acceptance gate).
- [ ] **T17 (S)** — Error toasts — WI-4.13
  - **Files:** `src/stores/toastStore.ts`, `src/components/common/Toast.tsx`, `App.tsx`, `useDocument.ts`, `loggingService.ts`, `saveService.ts`, `preferencesService.ts`, `useUpdater.ts`, `imagePastePlugin.ts`, the toast CSS, `.claude/rules/32-component-patterns.md` (§ Toast), and tests
  - **Depends on:** T7 (the `Icon` wrapper)
  - **Verify:** `pnpm test:run`. Then in `pnpm tauri dev`, in both themes, make a save fail (for example into a folder made read-only with `chmod a-w`). The toast must stay, "Dismiss" must clear it, and VoiceOver must read it. Open a missing file from recent files; one error toast names it.
- [ ] **T18 (M)** — WYSIWYG follows outside writes — WI-4.14
  - **Files:** `src/components/Editor/MilkdownEditor.tsx`, a new sync hook, `App.tsx` (the image-drop write, if the preflight routes it through the hook), and new tests
  - **Depends on:** T15
  - **Verify:** `pnpm test:run`, including the Reload regression. Then in `pnpm tauri dev`, in WYSIWYG: change an open file in another app, choose Reload, type, press ⌘S, and check that the file holds both changes. Drop an image, type, and check that the image stays. No unsaved dot appears after Reload.
- [ ] **T19 (S)** — Menu keyboard contract — WI-4.15
  - **Files:** `TableContextMenu/index.tsx`, `SourceTableContextMenu/index.tsx`, `ImageContextMenu.tsx` and its CSS, the new hook, rule 32 (§ Context menu contract), new tests
  - **Depends on:** none
  - **Verify:** `pnpm test:run`; in `pnpm tauri dev`, in both themes, open each menu and use it with arrow keys, Home/End, Enter and Escape, and scroll to close it
- [ ] **T25 (S)** — MCP window routing and Zustand selectors — WI-4.21
  - **Files:** `src-tauri/src/services/http_server.rs`, `src/hooks/useMcpEvents.ts`, `AdvancedSettings.tsx`, the lint config, new tests
  - **Depends on:** T5 (it shares no files with the Stage 4 lanes, and runs first among the foundations)
  - **Verify:** `cargo test`, `pnpm test:run`; with two windows open, one MCP call creates exactly one document
- [ ] **T22 (M)** — View mode and preference persistence — WI-4.18
  - **Files:** `src-tauri/src/models/preferences.rs`, `src-tauri/src/services/preferences.rs`, `src/types/preferences.ts`, `src/utils/viewModeUtils.ts`, round-trip tests
  - **Depends on:** T25
  - **Verify:** `cargo test`, `pnpm test:run`; in `pnpm tauri dev`, switch to Source, relaunch, and confirm the mode persisted with no failure toast
- [ ] **T23 (M)** — Cancellation-safe subscription primitive — WI-4.19
  - **Files:** `src/hooks/useTauriEvent.ts`, `App.tsx`, `useMenuEvents.ts`, `useMcpEvents.ts`, `useTheme.ts`, `useFileWatcher.ts`, new tests
  - **Depends on:** T22
  - **Verify:** `pnpm test:run`, including the unmount-during-registration regression
- [ ] **T21 (M)** — File watcher trailing delivery — WI-4.17
  - **Files:** `src-tauri/src/services/file_watcher.rs`, `src/hooks/useFileWatcher.ts`, new Rust and TS tests
  - **Depends on:** T23
  - **Verify:** `cargo test`, `pnpm test:run`; in `pnpm tauri dev`, change a file twice in quick succession and confirm the second change is seen
- [ ] **T20 (M)** — IPC error contract — WI-4.16
  - **Files:** `src/services/fileService.ts`, the `FileError` TS union, `saveService.ts`, `useDocument.ts`, `tests/save-blink.test.ts`, new fixture-driven tests
  - **Depends on:** T21, and T17 for the error-toast variant
  - **Verify:** `pnpm test:run`. Then in `pnpm tauri dev`, make a save fail into a read-only folder; the toast must name the reason, not `[object Object]`.
- [ ] **T24 (M)** — Command logging wrapper — WI-4.20
  - **Files:** `src-tauri/src/commands/file.rs`, `image.rs`, `mod.rs`, the shared wrapper module, Rust tests
  - **Depends on:** T20
  - **Verify:** `cargo test`; `~/.mdpro/mdpro.log` shows a Start and exactly one terminal record for a save rejected by path validation
- [ ] **T26 (M)** — File-size ratchet and `App.tsx` lifecycle seam — WI-4.22
  - **Files:** `App.tsx`, a new lifecycle controller and dialog host, the ratchet check and its baseline, the source-text tests it replaces
  - **Depends on:** T24. It lands before T16.
  - **Verify:** `pnpm test:run`, including the close-confirmation regression (request close on A, activate B, confirm). The ratchet must fail on a seeded over-limit production file and ignore `#[cfg(test)]` modules.
- [ ] **T11 (M)** — `sourceFont` — WI-5.1…5.4
  - **Files:** `preferences.rs`, `preferences.ts`, `editorPrefApply.ts`, `EditorSettings.tsx`, the shared fixture, `normalizeSourceFont`, rule 31
  - **Depends on:** the E6 fix PR, and T22 (which changes the same Rust preference types)
  - **Verify:** `cargo test`, `pnpm test:run`

Sizes (S/M) are planning estimates, not commitments.

---

## Stop report template (posted at each of the five stops)

1. **Summary:** stages done; review items done or deferred, by number; which assumptions were confirmed or changed.
2. **Token changes:** names only, with file:line.
3. **CSS file map:** before → after, with line counts.
4. **Literal inventory:** before and after counts per file; every remaining exception with file:line and the rule 31 clause, or approved exception, that allows it.
5. **Tests:** new and updated test files; exact commands run, with exit codes.
6. **Visual evidence:** computed-style diff commands and results (Stages 1–2); before/after screenshot paths (outside the repo) per surface × theme, with window size, scale and engine (`/browse` or `pnpm tauri dev`); mismatches and "no reference" flags.
7. **Contrast table and rule 33 checklist results.**
8. **`/plan-design-review` or `/qa-only` findings:** each marked fixed, deferred or out of scope.
9. **Open questions, dead-code candidates, and the proposed commit split.**

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 3 | ISSUES_FOUND | Plan review: 9 findings, 8 folded, 1 invalid. Decision consult: 10 verdicts (4 agree, 5 agree-with-changes, 1 disagree) plus 3 cross-cutting issues, all accepted. Design outside voices (Codex and an independent Claude subagent): 34 findings, taken into Passes 1–7. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (before the design review) | 29 issues, 0 critical gaps. It predates WI-4.8–4.15, T12–T19 and their tests. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES_OPEN | score: 6/10 → 9/10, 23 decisions (DR1–DR23); 3 proposed answers wait for the Stage 0 gate |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** In the eng review, Codex caught three factual errors in the draft: the preferences file is `config.json`, not `preferences.json`; the checkbox inventory was wrong; and so was the `color-mix` release claim. It also showed that the preferences overwrite happens at every launch, which escalated D8 into E6, and it found that Testing Library is not installed (E7). In the design review, it found that Appendix B marked undrawn surfaces as having references, and that this report said "ready to implement" while the Stage 0 gate was still open.
- **CROSS-MODEL:** In the eng review, the two models agreed on D1–D7, D9 and D10, and the changes Codex asked for were accepted as refinements (E3–E5). They disagreed on D8; the user sided with Codex (E6).
- **VERDICT:** Design reviewed; eng review was CLEAR but predates the design review's new work items, so re-run `/plan-eng-review` before implementing. Implementation starts only after the Stage 0 gate. Stage 5 stays blocked until the E6 fix lands.

**UNRESOLVED DECISIONS:**
- Q2: keep the duplicated `:root` light values, with a parity guard (proposed; confirm at the Stage 0 gate)
- Q6: replace the undeclared success, error and tertiary-text tokens with `--color-danger`, `--color-muted` and `--color-text`, with no green (proposed; confirm at the Stage 0 gate)
- Q10: allow `z-index: 1` at `MilkdownEditor.css:214` as a local stacking exception (proposed; confirm at the Stage 0 gate)
