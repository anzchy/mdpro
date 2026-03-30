# Codex Full Audit — Settings Panel Polish (WI-0 to WI-9)
**Date:** 2026-03-30 | **Model:** gpt-5.4 | **Effort:** high | **Sandbox:** read-only

## Audit Progress

| WI | Files | Status | Thread ID (use `/continue <id>` to iterate) |
|----|-------|--------|------|
| WI-0 | `src/styles/globals.css` | ✅ Done + Fixed | `019d3eff-fa34-7ce2-8b35-b5ab895be8ad` |
| WI-1 | `SettingsDialog.tsx`, `editorStore.ts`, `App.tsx` | ✅ Done + Fixed | `019d3f05-3fef-75a1-bb93-b224f75c1c29` |
| WI-2 | `preferences.rs`, `mod.rs`, `preferences.ts`, `preferencesService.ts` | ✅ Done + Fixed | `019d3f0b-1071-7c72-8fbe-3cbc84fdff0f` |
| WI-3 | `dynamicExtensions.ts`, `Editor.tsx`, `editorPrefApply.ts` | ✅ Done + Fixed | `019d3f11-9948-76a2-a6c7-6bf1a7c23b9a` |
| WI-4+5 | `GeneralSettings.tsx`, `EditorSettings.tsx`, `SettingsStepper.tsx` | ✅ Done + Fixed | `019d3f18-983d-78a1-8047-8975cc51aebd` |
| WI-6 | `MarkdownSettings.tsx`, `ImageSettings.tsx` | ⏳ **TODO** | — |
| WI-7 | `ExportSettings.tsx`, `commands/preferences.rs`, `services/preferences.rs` | ⏳ **TODO** | — |
| WI-8 | `AppearanceSettings.tsx`, `AdvancedSettings.tsx` | ⏳ **TODO** | — |
| WI-9 | `KeyboardShortcutsSettings.tsx` | ⏳ **TODO** | — |

**To resume pending WIs:** run the full-audit prompt below on each file group.

### Resume commands for pending WIs

**WI-6:**
```
/codex-toolkit:audit --full src/components/common/settings/MarkdownSettings.tsx src/components/common/settings/ImageSettings.tsx
```

**WI-7:**
```
/codex-toolkit:audit --full src/components/common/settings/ExportSettings.tsx src-tauri/src/commands/preferences.rs src-tauri/src/services/preferences.rs
```

**WI-8:**
```
/codex-toolkit:audit --full src/components/common/settings/AppearanceSettings.tsx src/components/common/settings/AdvancedSettings.tsx
```

**WI-9:**
```
/codex-toolkit:audit --full src/components/common/settings/KeyboardShortcutsSettings.tsx
```

---

## WI-0 — `src/styles/globals.css`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| globals.css:1214 | **High** | 3 | `--color-text-secondary` used in settings/MCP UI but never defined — text color falls back unpredictably | Define in every theme scope or replace with existing token like `--color-muted` |
| globals.css:1297 | **High** | 3 | `--color-bg-secondary` and `--color-bg-tertiary` used for MCP containers but never defined — backgrounds transparent | Add to shared/theme variable sets or switch to `--color-surface` / `--color-panel` |
| globals.css:1 | Medium | 1 | `:root` duplicates light-theme palette that also exists in `themes/light.css` — two sources of truth | Keep structural/layout tokens in globals.css, move theme color tokens to theme files only |
| globals.css:1482 | Medium | 2 | Expanded-link pseudo-content prints raw `data-href` into UI — signed URLs, local paths exposed verbatim | Sanitize/truncate in JS before setting, mask query strings/secrets |
| globals.css:1294 | Medium | 7 | MCP/settings styles have no render or screenshot coverage — broken custom properties can ship unnoticed | Add rendered component tests + visual regression for IntegrationsSettings in both themes |
| globals.css:253 | Low | 1 | `.toolbar-title` and `.toolbar-actions` have no consumers — dead global CSS | Delete unused rules |
| globals.css:991 | Low | 1 | `.settings-placeholder*` has no current consumer | Remove or colocate with consuming component |
| globals.css:1667 | Low | 1 | `.toc-sidebar__header` defined but never rendered by `TOCSidebar.tsx` | Remove or add missing header element |
| globals.css:1553 | Low | 4 | `-ms-overflow-style` targets retired IE/EdgeHTML — stale vendor prefix | Remove unless legacy support intentional and documented |
| globals.css:1245 | Low | 5 | Hard-coded neutral/status colors (`#ccc`, `white`, success greens, amber) instead of semantic tokens | Introduce `--color-control-off`, `--color-success-*`, `--color-warning-*` |
| globals.css:13 | Low | 8 | Font stacks depend on host-installed Apple fonts — non-macOS dev/CI silently falls back | Bundle fonts or standardize on documented cross-platform stack |
| globals.css:232 | Low | 9 | Comment "Legacy toolbar (kept for compatibility)" misstates ownership — active component still uses it | Replace with accurate description of active toolbar/button contract |

---

## WI-1 — `SettingsDialog.tsx`, `editorStore.ts`, `App.tsx`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| App.tsx:112 | **High** | 3 | Auto-save can never be turned off — store says `0 = off` but hook clamps to 5000ms minimum, drafts still written | Treat `<= 0` as disabled, validate persisted values, add regression test for `0` case |
| App.tsx:320 | Medium | 2 | Info logs capture `window.location.href`, `openPath`, filesystem paths — persisted into log file | Redact paths by default, log basename/hash only, require explicit diagnostic mode for full paths |
| App.tsx:150 | Medium | 3 | `handleToggleSidebar` reads render-time `showSidebar` then calls `toggleSidebar()` — two rapid toggles can desync persisted prefs | Derive next value inside one store update or read via `useEditorStore.getState()` |
| App.tsx:390 | Medium | 3 | Window-state persistence is fire-and-forget on `onCloseRequested` — window can terminate before save completes | Prevent close, await `saveWindowState()`, then re-close |
| SettingsDialog.tsx:63 | Medium | 3 | MCP settings applied optimistically, never rolled back on persistence failure — `autoApproveEdits` can show wrong state | Keep previous config, revert on error, surface error state |
| SettingsDialog.tsx:89 | Medium | 4 | Modal has `role="dialog"` but no `aria-modal`, no focus trap, no focus restore — users can tab into background | Add `aria-modal="true"`, trap focus, restore focus on close |
| App.tsx:112 | Medium | 7 | No regression test for "autosave interval `0` disables drafts" | Add integration test asserting `save_draft` never invoked when interval is `0` |
| App.tsx:483 | Low | 5 | WYSIWYG fallback threshold `500 * 1024` hard-coded inline | Extract named constant, keep with other size thresholds |
| editorStore.ts:39 | Low | 4 | `viewMode` defaults to `"split"` in store while app/preferences defaults are `"wysiwyg"` — startup flash | Define one shared default, initialize both from it |
| SettingsDialog.tsx:43 | Low | 6 | `useThemeStore()` subscribes dialog to entire Zustand store | Select only `resolvedTheme` with `useThemeStore((s) => s.resolvedTheme)` |
| App.tsx:696 | Low | 6 | `IMAGE_EXTENSIONS` set recreated every render — changes `handleFileDrop` identity | Hoist to module scope |
| App.tsx:882 | Low | 1 | Leftover `console.log` in `handleDevOpenFile` | Remove or guard with `import.meta.env.DEV` |
| editorStore.ts:52 | Low | 9 | `setViewMode`/`cycleViewMode` have hidden logging side effects not in store contract | Document side effect or move logging to middleware |
| SettingsDialog.tsx:50 | Low | 3 | `setTimeout` focus call has no cleanup — quick open/close can focus stale node | Store timer id and clear in effect cleanup |

---

## WI-2 — `preferences.rs`, `mod.rs`, `preferences.ts`, `preferencesService.ts`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| preferences.ts:4 | **High** | 3 | TS `UserPreferences` missing `autoSave` and `tabBar` entirely; `image`/`export` optional but Rust persists both with defaults — compiler can't see real backend fields | Define `AutoSaveConfig`, `TabBarConfig`, `ImageConfig`, `ExportConfig` to match Rust exactly; make required fields required |
| preferences.rs:348 | **High** | 2 | `ImageConfig.asset_folder` and `ExportConfig.default_folder` stored as arbitrary strings with no path validation — hostile IPC or edited config can push writes outside intended area | Validate/canonicalize path-like prefs at backend boundary, reject `..` and absolute paths where not allowed |
| preferences.rs:12 | Medium | 1 | Two competing auto-save models: top-level `auto_save_interval` and nested `auto_save.interval_ms/debounce_ms/save_on_blur` — TS only exposes scalar, richer config is dead state | Pick one auto-save contract, remove the other, or expose full nested config end-to-end |
| preferences.rs:377 | Medium | 3 | `font_size`, `line_height_x10`, `tab_size`, window dims accept any integer — invalid persisted values surface as broken UI | Add validation for all constrained fields with custom deserializers or `validate()` pass |
| preferences.rs:278 | Medium | 4 | Nested config structs missing `#[serde(default)]` per field — adding a new field breaks old saved configs | Add `#[serde(default)]` on all nested struct fields |
| preferencesService.ts:38 | Medium | 2 | `invoke()` untyped, no runtime validation on returned preferences or outbound updates | Use `invoke<UserPreferences>` plus runtime decoding; sanitize outbound payloads |
| preferences.rs:494 | Medium | 8 | `McpConfig::default()` enables and autostarts MCP bridge — enlarges local attack surface by default | Default `enabled` and `start_on_launch` to `false`, require explicit user opt-in |
| preferencesService.ts:15 | Medium | 5 | `DEFAULT_PREFERENCES` drifting from Rust: omits `image`, `export`, `autoSave`, `tabBar`; `logging.enabled` differs | Source frontend defaults from shared schema or backend-produced JSON snapshot |
| preferencesService.ts:15 | Medium | 7 | No parity test tying `DEFAULT_PREFERENCES` to Rust's `UserPreferences::default()` | Add Rust-to-JSON default snapshot test + Vitest parity test comparing frontend shape/defaults |
| mod.rs:16 | Low | 1 | Crate root re-exports almost entire preferences schema — wide, low-value API surface | Re-export only truly shared types, import the rest from submodule explicitly |
| preferences.rs:195 | Low | 6 | Keyboard shortcut defaults built via dozens of tiny heap-allocating helper functions; literal table duplicated in TS | Replace per-field builders with one canonical static manifest consumed by both Rust and TS |
| preferences.ts:50 | Low | 9 | `image` modeled as anonymous inline optional object — splits contract, weakens docs reuse | Export named `ImageConfig` with full field docs |

---

## WI-3 — `dynamicExtensions.ts`, `Editor.tsx`, `editorPrefApply.ts`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| Editor.tsx:110 | **High** | 3 | `autoPair` not actually disableable — `basicSetup` enables `closeBrackets()` by default; compartment only controls duplicate copy | Disable `closeBrackets`/`closeBracketsKeymap` in `basicSetup`, or remove from `basicSetup` and let compartment own it |
| Editor.tsx:83 | **High** | 3 | Initial compartment values hardcoded to `true/4/true/"default"` — any CodeMirror remount resets to defaults, not persisted prefs | Hydrate `Editor` with saved prefs and build initial compartment extensions from that state |
| editorPrefApply.ts:90 | **High** | 3 | All compartment applies silently no-op when `editorView` is null, no replay path — startup loads and remounts can permanently drop saved settings | Store pending editor prefs and reapply in `onCreateEditor`, or render `Editor` only after prefs loaded |
| Editor.tsx:76 | **High** | 6 | `extensions` array rebuilt every render — `@uiw/react-codemirror` reconfigures on identity change, full extension set churns on normal typing | Memoize `extensions` array and `basicSetup` object with stable deps |
| Editor.tsx:78 | Medium | 1 | Syntax highlighting owned in three places: `basicSetup`, `syntaxHighlightingExtension`, and code-theme compartment — duplicate with unclear precedence | Pick one owner; disable `syntaxHighlighting` in `basicSetup`, let theme compartment provide both variants |
| dynamicExtensions.ts:27 | Medium | 4 | `tabSize` implemented with `indentUnit` only — changes indent insertion width, not tab display facet; literal tabs still render at default width | Reconfigure with `EditorState.tabSize.of(size)` plus `indentUnit.of(" ".repeat(size))` |
| editorPrefApply.ts:61 | Medium | 2 | Runtime values trusted via casts — corrupted persisted prefs drive invalid CSS var values; `" ".repeat(value as number)` can throw for out-of-range input | Validate and clamp every runtime value before `setProperty` or `dispatch`, fall back to defaults |
| editorPrefApply.ts:tests | Medium | 7 | Tests mock compartments, only assert dispatch called — don't catch: autoPair still active via `basicSetup`, remount resets, dropped pre-mount applies | Add integration tests with real CodeMirror view covering disable-autoPair, mount/unmount/remount, pre-mount prefs |
| editorPrefApply.ts:111 | Low | 5 | Comment "TypeScript exhaustiveness handles unknown keys" — no `never` assertion, future `EditorConfig` field silently no-ops | Replace comment with real exhaustiveness check or typed handler map with `satisfies` |
| editorPrefApply.ts:13 | Low | 8 | Feature ownership split between app code and `@uiw` `basicSetup` defaults — already broke autoPair | Explicitly disable every `basicSetup` feature managed in-house |
| dynamicExtensions.ts:1 | Low | 9 | Docs don't state: compartments must be mounted exactly once, apply helpers only work against mounted view or replay mechanism | Add contract doc covering mount order, singleton ownership, remount/replay expectations |

---

## WI-4+5 — `GeneralSettings.tsx`, `EditorSettings.tsx`, `SettingsStepper.tsx`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| SettingsStepper.tsx:34 | **High** | 6 | Rapid clicks collapse to single step — `increment`/`decrement` derive from stale `value` prop; 3 fast clicks from `16` save `17` not `19` | Track pending value in `useRef`/state, debounce only the flush, compute each next from last pending |
| EditorSettings.tsx:27 | **High** | 3 | `cachedFullPrefs.current` used as mutable full-object snapshot — back-to-back saves can resolve out of order, overwrite newer change with older snapshot | Serialize writes per page, await each save, merge from latest persisted result |
| GeneralSettings.tsx:50 | **High** | 3 | Same whole-object snapshot race as `EditorSettings` — concurrent saves can clobber newer data | Send only changed slice or centralize in shared hook that queues writes |
| EditorSettings.tsx:25 | **High** | 3 | UI and editor prefs applied before persistence succeeds; failed IPC write ignored — UI out of sync with disk | Make `handleChange` async, catch save failures, rollback/reload state and applied editor prefs |
| GeneralSettings.tsx:45 | **High** | 3 | `setAutoSaveInterval` and local state updated optimistically; `setPreferences` not awaited/caught — failed write leaves in-memory change but disk unchanged | Await save, catch/log errors, revert store/local state or show error |
| EditorSettings.tsx:12 | Medium | 3 | Initial `getPreferences()` load has no rejection handling — component stuck in loading state forever on failure | `try/catch`, surface error state, guard against setting state after unmount |
| GeneralSettings.tsx:32 | Medium | 3 | Same unhandled initial-load failure as `EditorSettings` | Same fix: `try/catch`, loading/error state, cancel late resolutions on unmount |
| EditorSettings.tsx:57 | Low | 2 | Raw DOM values cast into `EditorConfig` types — malformed synthetic values can reach IPC and persist invalid config | Validate/coerce at UI boundary; add Rust-side range/enum validation before saving |
| GeneralSettings.tsx:28 | Low | 5 | `GeneralSettings` + `EditorSettings` duplicate the same load/cache/optimistic-save orchestration — propagating same bugs | Extract shared `usePreferenceSlice` helper |
| SettingsStepper.tsx:19 | Low | 1 | "Stable debounced wrapper" via `useMemo` is misleading — parent passes new inline `onChange` each render, so memo provides no stability | Remove memoization, implement explicit pending-value ref/state with debounced flush |
| EditorSettings.tsx:19 | Medium | 7 | No test for rejected/out-of-order `setPreferences()` — optimistic update failures unguarded | Add component tests with mocked `preferencesService` that reject and resolve out of order |
| SettingsStepper.tsx:20 | Medium | 7 | Stepper tests don't render component with fake timers — broken rapid-click behavior went undetected | Add rendered tests for rapid clicks, rapid arrow keys, boundary behavior under debounce, timer cleanup |
| GeneralSettings.tsx:28 | Low | 9 | `cachedFullPrefs` pattern undocumented — invariants, failure modes, and why full-object saves are used not explained | Document pattern or replace with shared abstraction |

---

## Pending WIs (not yet audited)

### WI-6: `MarkdownSettings.tsx`, `ImageSettings.tsx`
### WI-7: `ExportSettings.tsx`, `src-tauri/src/commands/preferences.rs`, `src-tauri/src/services/preferences.rs`
### WI-8: `AppearanceSettings.tsx`, `AdvancedSettings.tsx`
### WI-9: `KeyboardShortcutsSettings.tsx`

---

## Top Priority Actions (from completed WIs)

### Critical/Blockers
1. **[High]** `autoPair` not actually disableable — `basicSetup` overrides compartment — `Editor.tsx:110`
2. **[High]** Compartment initial values hardcoded, lost on remount — `Editor.tsx:83`
3. **[High]** Pre-mount pref applies silently dropped, no replay — `editorPrefApply.ts:90`
4. **[High]** Stepper rapid-click collapses to single step — `SettingsStepper.tsx:34`
5. **[High]** Optimistic save with no rollback on failure — `EditorSettings.tsx:25`, `GeneralSettings.tsx:45`
6. **[High]** `--color-text-secondary` / `--color-bg-secondary` undefined — `globals.css:1214`, `1297`
7. **[High]** `asset_folder`/`default_folder` path strings unvalidated — `preferences.rs:348`
8. **[High]** TS schema missing `autoSave`/`tabBar`, `image`/`export` type drift — `preferences.ts:4`

### Should Fix
9. **[Medium]** Focus trap missing from settings dialog — `SettingsDialog.tsx:89`
10. **[Medium]** MCP settings not rolled back on save failure — `SettingsDialog.tsx:63`
11. **[Medium]** Auto-save interval `0` does not actually disable drafts — `App.tsx:112`
12. **[Medium]** Nested Rust config structs missing `#[serde(default)]` per field — `preferences.rs:278`
13. **[Medium]** `McpConfig::default()` opts user into MCP bridge — `preferences.rs:494`
14. **[Medium]** `extensions` array rebuilt every render — `Editor.tsx:76`
15. **[Medium]** `tabSize` only sets `indentUnit`, not `EditorState.tabSize` — `dynamicExtensions.ts:27`
