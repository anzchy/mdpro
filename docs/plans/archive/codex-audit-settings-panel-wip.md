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
| WI-6 | `MarkdownSettings.tsx`, `ImageSettings.tsx` | ✅ Done | `019d3f3f-0cef-7820-b532-2b2b55eb26aa` |
| WI-7 | `ExportSettings.tsx`, `commands/preferences.rs`, `services/preferences.rs` | ✅ Done | `019d3f40-dff2-7712-a70c-638e370c97a5` |
| WI-8 | `AppearanceSettings.tsx`, `AdvancedSettings.tsx` | ✅ Done | `019d3f42-c492-7251-9ce6-880a098a99cd` |
| WI-9 | `KeyboardShortcutsSettings.tsx` | ✅ Done | `019d3f44-a14c-7bf3-bffe-0305d6ed02c4` |

**All WIs complete.**

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

---

## WI-6 — `MarkdownSettings.tsx`, `ImageSettings.tsx`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| ImageSettings.tsx:66 | **High** | 2 | `assetFolder` persisted from raw user input without validation; path traversal risk (`..`, absolute paths) | Normalize and validate path (reject `..`, absolute, control chars), re-validate server-side before any filesystem access |
| MarkdownSettings.tsx:27 | Medium | 3 | Fire-and-forget `setPreferences` with no ordering/rollback; rapid toggles can persist stale state | Serialize writes (queue/latest-wins token), await, rollback UI on failure |
| ImageSettings.tsx:39 | Medium | 3 | Fire-and-forget persistence on every change can race, leaving prefs inconsistent with UI | Debounce + serialize writes, handle rejections |
| MarkdownSettings.tsx:12 | Medium | 3 | `getPreferences()` rejection unhandled; silently stuck in loading state | Add `try/catch`/`.catch` with error state fallback |
| ImageSettings.tsx:20 | Medium | 3 | `getPreferences()` rejection unhandled; no recovery path | Add guarded async loader with error state and retry |
| MarkdownSettings.tsx:49 | Medium | 4 | Checkbox lacks `<label>`/`id`/`aria-label` | Add explicit label binding (`id` + `<label htmlFor>`) |
| ImageSettings.tsx:62 | Medium | 4 | Text input lacks programmatic label association | Add `id` + `<label htmlFor>` or `aria-labelledby` |
| ImageSettings.tsx:79 | Medium | 4 | Second checkbox lacks proper label binding | Bind visible label to control via `id`/`htmlFor` |
| ImageSettings.tsx:66 | Medium | 6 | Persisting on every keystroke causes excessive IPC + I/O | Debounce persistence (250–500ms), save on blur/Enter |
| MarkdownSettings.tsx:12 | Medium | 8 | Preferences payload trusted structurally without runtime validation | Add Zod/runtime schema parsing, strict defaults, reject invalid shape |
| ImageSettings.tsx:20 | Medium | 8 | Same trust boundary issue for `p.image` fields | Add runtime schema parsing and constrained validators |
| ImageSettings.tsx:31 | Medium | 7 | No tests for error paths/race behavior (failed load, write ordering) | Add unit tests for rejected promises, rapid updates, persistence correctness |
| MarkdownSettings.tsx:25 | Low | 3 | Unsafe `value as boolean` cast hides future type bugs | Use generic keyed handler `<K extends keyof MarkdownConfig>` |
| ImageSettings.tsx:31 | Low | 3 | `value: string \| boolean` not key-coupled; wrong key/value pairs type-allowed | Use generic keyed signature |
| MarkdownSettings.tsx:11 | Low | 3 | No unmount guard in async effect; late resolution can update unmounted component | Add `let cancelled = false` / `AbortController` guard |
| ImageSettings.tsx:19 | Low | 3 | Same missing unmount guard | Add cancellation flag and cleanup in `useEffect` |
| MarkdownSettings.tsx:7 | Low | 1 | Load/save pattern duplicated across all sibling settings components | Extract shared `usePreferenceSlice` hook |
| ImageSettings.tsx:15 | Low | 1 | Repeated loading UI and preference-cache plumbing | Consolidate into reusable settings primitives |
| MarkdownSettings.tsx:25 | Low | 9 | Side-effectful `applyAutoPair` undocumented; future maintainers may miss why toggle triggers editor mutation | Add brief comment explaining side effect timing and failure behavior |

---

## WI-7 — `ExportSettings.tsx`, `commands/preferences.rs`, `services/preferences.rs`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| commands/preferences.rs:18 | **High** | 3 | `set_preferences` read-modify-write without locking; concurrent writes (incl. `save_window_state`) can lose updates | Add process-level mutex or file lock + optimistic versioning (compare-and-swap on revision) |
| services/preferences.rs:82 | **High** | 3 | Preferences written non-atomically via `fs::write`; crash/power loss can corrupt `config.json` | Write to temp file in same dir, `sync_all`, then atomic `rename` |
| services/preferences.rs:82 | Medium | 8 | Preferences file permissions not hardened; may be readable by other local users | Use `OpenOptions` with `0o600` perms and platform-appropriate ACL defaults |
| services/preferences.rs:39 | Medium | 4 | Uses `HOME` env var + hardcoded `.mdpro` path instead of Tauri path APIs | Use `AppHandle.path().app_config_dir()` for portability and sandbox compatibility |
| commands/preferences.rs:11 | Medium | 3 | `get_preferences` silently falls back to defaults on load/parse errors, masking corruption | Return structured error to UI; offer recovery/backup path |
| ExportSettings.tsx:12 | Medium | 3 | Initial load has no rejection handling; failed fetch leaves UI stuck in loading state | Add `catch` + error UI state and retry action |
| ExportSettings.tsx:26 | Medium | 3 | Save is fire-and-forget; failed persistence looks successful to user | Await save, surface error, rollback/reconcile local state on failure |
| ExportSettings.tsx:59 | Medium | 6 | Persists on every keystroke in folder input; excessive IPC + disk writes | Debounce writes or save on blur/Enter |
| ExportSettings.tsx:25 | Medium | 5 | Caches full prefs and writes whole object back; couples this UI to unrelated settings | Send minimal partial update `{ export: next }` instead of full snapshot |
| ExportSettings.tsx:59 | Medium | 2 | Free-text folder path accepted without validation; unsafe if used for direct writes | Validate absolute dir path server-side; prefer picker-only input |
| services/preferences.rs:89 | Medium | 5 | Manual field-by-field merge is brittle; new fields can be silently dropped | Use derive-based merge strategy, schema versioning, or completeness tests |
| services/preferences.rs:127 | Medium | 7 | Tests cover merge behavior but not load/save errors, file corruption, atomicity, or concurrent writes | Add tests for malformed JSON, IO failures, concurrent update scenarios |
| commands/preferences.rs:47 | Low | 1 | Redundant `last_view_mode: current.last_view_mode` before `..current` adds no behavior | Remove explicit assignment |
| ExportSettings.tsx:52 | Low | 9 | UI copy implies exports are saved to default folder, but export flow still shows save dialog | Update copy to current behavior or implement default-folder-aware export |

---

## WI-8 — `AppearanceSettings.tsx`, `AdvancedSettings.tsx`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| AdvancedSettings.tsx:21 | **High** | 3 | Store state updated before persistence; failed writes not rolled back — UI/state drift | Persist first (pessimistically), wrap in `try/catch`, rollback on failure |
| AdvancedSettings.tsx:22 | **High** | 3 | `setLoggingSettings` uses captured `loggingLevel`/`loggingEnabled`; rapid toggle+level changes can overwrite newer values | Build atomic `nextSettings` from latest store snapshot, serialize writes |
| AppearanceSettings.tsx:12 | Medium | 3 | `getPreferences()` failure ignored; component can stay in perpetual loading with no user feedback | Add `try/catch`, error UI state, and retry path |
| AppearanceSettings.tsx:27 | Medium | 3 | `setPreferences()` fire-and-forget; silent persistence failure | Await write, handle errors, revert or show save-failed indicator |
| AppearanceSettings.tsx:53 | Medium | 2 | Unvalidated cast from DOM value to `CodeTheme`; invalid values possible via manipulated DOM/events | Validate against allowed enum values before applying/saving |
| AdvancedSettings.tsx:66 | Medium | 2 | Unvalidated cast from DOM value to `LogLevel`; invalid log levels can be persisted | Guard with `isLogLevel` runtime validator, reject unknown values |
| AdvancedSettings.tsx:47 | Medium | 4 | Form controls not associated with `<label htmlFor>`; screen reader accessibility broken | Add explicit `<label>` elements linking by `htmlFor`/`id` |
| AdvancedSettings.tsx:16 | Medium | 7 | No tests for async failure/race behavior (failed persistence, rapid toggles) | Add Vitest cases for failed saves, rapid toggles, and stale state prevention |
| AdvancedSettings.tsx:22 | Low | 6 | Every UI change triggers immediate persistence call; repeated toggles cause redundant I/O | Debounce/coalesce writes |
| AppearanceSettings.tsx:18 | Low | 1 | `handleChange` over-generic for single field; relies on runtime cast | Replace with explicit `handleCodeThemeChange(nextTheme: CodeTheme)` |
| AdvancedSettings.tsx:16 | Low | 5 | Toggle and level handlers duplicate logging/persistence flow | Extract shared `updateLoggingSettings(partial)` helper |
| AppearanceSettings.tsx:38 | Low | 4 | Inline `style={{ opacity: 0.5 }}` on loading state conflicts with project convention | Move to CSS class in colocated stylesheet |
| AdvancedSettings.tsx:44 | Low | 8 | Hardcoded Unix-style log path `~/.mdpro/mdpro.log` in UI text; misleads on non-Unix | Resolve platform-specific path from backend/env abstraction |
| AppearanceSettings.tsx:8 | Low | 9 | `cachedFullPrefs` merge strategy undocumented; easy for refactors to break full-preference preservation | Add comment or refactor service API to support scoped `appearance` updates directly |

---

## WI-9 — `KeyboardShortcutsSettings.tsx`

| File:Line | Severity | Dim | Issue | Fix |
|-----------|----------|-----|-------|-----|
| KeyboardShortcutsSettings.tsx:160 | **High** | 3 | Saves shortcuts but does not apply them to active keybindings; saved values never change real runtime behavior | Wire `preferences.keyboardShortcuts` into the actual shortcut dispatcher/keymap; trigger rebind after save |
| KeyboardShortcutsSettings.tsx:101 | Medium | 3 | `getPreferences()` has no error handling; rejected promise leaves UI in perpetual "Loading shortcuts…" | Add `catch` with fallback to defaults + error banner |
| KeyboardShortcutsSettings.tsx:164 | Medium | 2 | Persists shortcut strings without validation; invalid tokens can break parsing/dispatch | Validate against strict shortcut grammar before saving; reject invalid combos |
| KeyboardShortcutsSettings.tsx:130 | Medium | 3 | Only modifier-only keys blocked; non-actionable keys (`Dead`, `Unidentified`, `CapsLock`, etc.) can be recorded | Add allowlist of supported key names; reject unsupported |
| KeyboardShortcutsSettings.tsx:135 | Medium | 3 | No conflict detection; duplicate bindings across actions allowed, causing ambiguous behavior | Build reverse index (`shortcut → actions`) and block save (or require resolution) on conflicts |
| KeyboardShortcutsSettings.tsx:142 | Medium | 6 | Global `window` keydown capture with `preventDefault`/`stopPropagation` blocks unrelated interactions while editing | Capture keys in dedicated focused control; support `Escape` to cancel edit mode |
| KeyboardShortcutsSettings.tsx:168 | Medium | 9 | Save failures silently logged only; no user-visible error or recovery path | Show inline error/toast with retry; keep edit context; include failure reason |
| KeyboardShortcutsSettings.tsx:109 | Medium | 7 | No interaction tests for key-capture, cancel, conflict handling, failed save, or successful persistence | Add RTL/Vitest behavior tests covering all these paths |
| KeyboardShortcutsSettings.tsx:19 | Low | 1 | Large hardcoded shortcut metadata duplicates schema/defaults knowledge; can drift from `KeyboardShortcuts` type | Move to one typed metadata source shared by defaults, renderer, and runtime binding |
| KeyboardShortcutsSettings.tsx:19 | Low | 5 | Manual category/key listing is maintenance-heavy and easy to desync from type changes | Generate UI rows from typed config with compile-time completeness checks |
| KeyboardShortcutsSettings.tsx:184 | Low | 4 | Inline style objects in mostly class-based styling system; inconsistent conventions | Replace inline styles with CSS classes in colocated stylesheet |
| KeyboardShortcutsSettings.tsx:187 | Low | 9 | UI copy lacks operational guidance (allowed keys, conflict policy, platform differences) | Add helper text/docs link; keep text synced with validation rules |

---

## Top Priority Actions (all WIs)

### Critical/Blockers
1. **[High]** `autoPair` not actually disableable — `basicSetup` overrides compartment — `Editor.tsx:110`
2. **[High]** Compartment initial values hardcoded, lost on remount — `Editor.tsx:83`
3. **[High]** Pre-mount pref applies silently dropped, no replay — `editorPrefApply.ts:90`
4. **[High]** Stepper rapid-click collapses to single step — `SettingsStepper.tsx:34`
5. **[High]** Optimistic save with no rollback on failure — `EditorSettings.tsx:25`, `GeneralSettings.tsx:45`
6. **[High]** `--color-text-secondary` / `--color-bg-secondary` undefined — `globals.css:1214`, `1297`
7. **[High]** `asset_folder`/`default_folder` path strings unvalidated — `preferences.rs:348`
8. **[High]** TS schema missing `autoSave`/`tabBar`, `image`/`export` type drift — `preferences.ts:4`
9. **[High]** `assetFolder` persisted from raw user input without path validation — `ImageSettings.tsx:66`
10. **[High]** `set_preferences` read-modify-write without locking; concurrent writes can lose updates — `commands/preferences.rs:18`
11. **[High]** Preferences written non-atomically; crash can corrupt `config.json` — `services/preferences.rs:82`
12. **[High]** `AdvancedSettings` updates store before persistence; failed writes cause UI/state drift — `AdvancedSettings.tsx:21`
13. **[High]** `AdvancedSettings` captured-state race on rapid toggle+level changes — `AdvancedSettings.tsx:22`
14. **[High]** Saved keyboard shortcuts never applied to active keybindings — `KeyboardShortcutsSettings.tsx:160`

### Should Fix
15. **[Medium]** Focus trap missing from settings dialog — `SettingsDialog.tsx:89`
16. **[Medium]** MCP settings not rolled back on save failure — `SettingsDialog.tsx:63`
17. **[Medium]** Auto-save interval `0` does not actually disable drafts — `App.tsx:112`
18. **[Medium]** Nested Rust config structs missing `#[serde(default)]` per field — `preferences.rs:278`
19. **[Medium]** `McpConfig::default()` opts user into MCP bridge — `preferences.rs:494`
20. **[Medium]** `extensions` array rebuilt every render — `Editor.tsx:76`
21. **[Medium]** `tabSize` only sets `indentUnit`, not `EditorState.tabSize` — `dynamicExtensions.ts:27`
22. **[Medium]** Unhandled `getPreferences()` rejections across all settings panels — `MarkdownSettings.tsx:12`, `ImageSettings.tsx:20`, `AppearanceSettings.tsx:12`, `ExportSettings.tsx:12`, `KeyboardShortcutsSettings.tsx:101`
23. **[Medium]** Keyboard shortcut conflict detection missing — `KeyboardShortcutsSettings.tsx:135`
24. **[Medium]** Invalid shortcut tokens not validated before save — `KeyboardShortcutsSettings.tsx:164`
25. **[Medium]** `CodeTheme`/`LogLevel` DOM casts unvalidated at runtime — `AppearanceSettings.tsx:53`, `AdvancedSettings.tsx:66`
26. **[Medium]** `get_preferences` silently falls back on corruption; masks data loss — `commands/preferences.rs:11`
27. **[Medium]** Preferences file permissions not restricted (`0o600`) — `services/preferences.rs:82`
