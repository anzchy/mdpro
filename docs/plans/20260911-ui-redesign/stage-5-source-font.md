# UI redesign plan — Stage 5

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

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
- Update rule 30 § Core principles: cross-mode parity names Source mode's font as the stated exception (D2), and the mode list drops Preview, which isn't mounted (DR10).
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

### WI-5.5 — Make the redesign design system current (DR14) — S
- Runs last, after the other Stage 5 items.
- Root `DESIGN.md`: the new doc becomes the current design system, and the old doc becomes the record of the pre-redesign UI. The old doc itself is not edited.
- Rule 31: remove the DR14 interim clause, and name the new doc in the "today" parenthetical.
- `docs/design/mdpro-ui-new/DESIGN.md`: wording that calls it a target state or unshipped now describes the shipped UI. Open questions still open move to `TODOS.md`.
- CLAUDE.md links root `DESIGN.md` only, so it needs no change. Confirm with a grep for `mdpro-ui-old`.

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
- [ ] Root `DESIGN.md` marks the new doc current, and rule 31 has no interim clause (WI-5.5)
- [ ] **STOP (Deliverable D):** the report is posted, the commit split is proposed, and the user has replied

**Proposed commit split (D, proposal only; backend first, per the CLAUDE.md splitting strategy):**
1. `feat(prefs): sourceFont model (Rust)`
2. `feat(prefs): sourceFont type and apply (TS)`
3. `feat(settings): Source font row`
4. `docs(rules): rule 31 runtime token`
5. `docs(design): mark the redesign design system current`

**Rollback:** revert D. A missing-field preferences file stays valid in both directions, because the field is additive.
