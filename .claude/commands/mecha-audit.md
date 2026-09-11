---
description: Deep codebase audit across 17 dimensions (mdpro-specific). Randomly picks 4-6 dimensions per run.
argument-hint: "[dimensions: e.g. '2,7,11' to force specific ones | empty = random]"
---

# mdpro Deep Audit

You are a read-only codebase auditor for **mdpro**. Do not edit any files.

## Step 1: Select Dimensions

Arguments: `$ARGUMENTS`

If `$ARGUMENTS` is empty: use the current UTC minute as a seed to pick **4–6 dimensions** from the list below.
Seed formula: `(minute % 17)` as starting index, then walk forward, wrapping around, picking every other one until you have 5. This gives a stable but rotating selection across runs.

If `$ARGUMENTS` contains numbers (e.g. `2,7,11`): use exactly those dimensions.

### The 17 Dimensions

```
1.  KEYBOARD SHORTCUT SYNC
    Files: src-tauri/src/menu.rs, src/types/preferences.ts, docs/guide/keyboard-shortcuts.md
    Look for: Shortcuts in menu.rs missing from preferences.ts DEFAULT_KEYBOARD_SHORTCUTS;
              docs that don't match menu.rs accelerators; new menu items without doc updates.

2.  ZUSTAND ANTI-PATTERNS
    Files: src/stores/*.ts, src/components/**/*.tsx, src/hooks/*.ts
    Look for: Store values destructured at component top-level (use selectors instead);
              stale closures in callbacks (use useXStore.getState()); store not reset in
              beforeEach in tests; missing TypeScript generics on create<State>().

3.  IPC TRUST BOUNDARIES
    Files: src-tauri/src/commands/*.rs
    Look for: #[tauri::command] functions using user-supplied path/string without validation;
              .unwrap() or .expect() on invoke arguments; commands returning Option<T>
              instead of Result<T, String>; MCP handlers missing arg validation.

4.  RUST BACKEND SAFETY
    Files: src-tauri/src/**/*.rs
    Look for: unwrap()/expect() on user-input-derived values; missing ? propagation in
              command handlers; panic! in non-test code; unchecked index ops on user data.

5.  DRAFT & AUTO-SAVE RACES
    Files: src/hooks/useAutoSave.ts, src-tauri/src/services/draft.rs, src-tauri/src/commands/draft.rs
    Look for: Auto-save timer not cancelled on doc close; save_draft writing without
              checking if a newer draft exists; non-atomic draft writes; load_draft not
              comparing timestamps before restoring.

6.  FILE WATCHER CORRECTNESS
    Files: src-tauri/src/services/file_watcher.rs, src/hooks/useFileWatcher.ts
    Look for: External change events not debounced; watcher not removed on doc close;
              file:changed emitted for writes made by mdpro itself (self-trigger);
              missing platform guards for watcher backends.

7.  MILKDOWN WYSIWYG EDGE CASES
    Files: src/plugins/milkdown/**/*.ts, src/components/Editor/MilkdownEditor.tsx, src/hooks/useMilkdown*.ts
    Look for: Plugin init not guarded against editor unmount race; ProseMirror schema
              conflicts; commands dispatched after editor destroyed; missing cleanup in
              useEffect return; circular imports between milkdown plugins.

8.  CODEMIRROR SOURCE MODE EDGE CASES
    Files: src/plugins/codemirror/*.ts, src/components/Editor/
    Look for: IME composition events not handled (breaks CJK input); multi-cursor ops
              not tested; circular deps between CM extensions; duplicate facet registration.

9.  PLUGIN CSS ISOLATION
    Files: src/plugins/**/*.css, src/styles/*.css
    Look for: Plugin styles in global stylesheets (should be co-located); hardcoded color
              values instead of CSS variables; selectors broad enough to bleed outside
              the plugin scope; missing scoped class wrapper.

10. MCP SHADOW STORE CORRECTNESS
    Files: src-tauri/src/services/shadow_store.rs, src-tauri/src/commands/mcp.rs
    Look for: Shadow store not updated on open/close; write_document emitting non-
              serializable payload; read_document returning stale content; MCP handlers
              not holding Mutex correctly (potential deadlock).

11. TYPE SAFETY
    Files: src/**/*.ts, src/**/*.tsx
    Look for: `any` type annotations; unsafe `as SomeType` casts; catch(e) using
              `(e as Error).message` instead of instanceof narrowing; optional chaining
              missing where null is possible; return types omitted on exported functions.

12. LOGGING COMPLETENESS
    Files: recently modified src/**/*.ts, src-tauri/src/**/*.rs
    Look for: New Tauri commands missing Start + Success/Fail log pairs; console.log()
              in committed TypeScript; println!/eprintln! in committed Rust;
              loggingService calls missing actionId; new features not logging
              ui.<component>.<action> events.

13. TEST COVERAGE GAPS
    Files: src/stores/*.ts vs *.test.ts, src/hooks/*.ts vs *.test.ts, src/services/*.ts vs *.test.ts
    Look for: Store/hook/service files with no corresponding .test.ts; bug fix commits
              without regression tests; pure utils with no table-driven tests;
              snapshot assertions instead of explicit assertions.

14. DEAD CODE
    Files: src/**/*.ts(x), src-tauri/src/**/*.rs
    Look for: Exported functions/components never imported; mod declarations in Rust
              with no usages; feature flags or commented-out code blocks; orphaned CSS
              classes; unused deps in package.json or Cargo.toml.

15. EXPORT & HTML RENDERING
    Files: src/services/exportService.ts, src-tauri/src/commands/export.rs,
           src-tauri/src/services/html_template.rs, src-tauri/src/services/markdown.rs
    Look for: DOMPurify not applied before export; image path resolution not handling
              all editor modes; filename collisions in folder export; missing error
              handling when output path is not writable; XSS vectors in HTML template.

16. DEPENDENCY HEALTH
    Files: package.json, src-tauri/Cargo.toml
    Look for: npm packages with known CVEs (pnpm audit); Rust crates with advisories
              (cargo audit); deprecated Tauri 2.x APIs; Milkdown 7.x API changes.

17. VERSION FILE SYNC
    Files: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
    Look for: Any of the three files having a different version string.
              Run: grep '"version"' package.json src-tauri/tauri.conf.json
                   grep '^version' src-tauri/Cargo.toml
```

## Step 2: Announce Selected Dimensions

Print: `Auditing dimensions: [list] — [names]`

## Step 3: Scan

For each selected dimension:
1. Use Grep and Read to examine the relevant files.
2. Apply only the checks listed for that dimension — do not expand scope.
3. **High confidence only** — skip uncertain findings.

## Step 4: Report

For each finding use this exact format:

```
### [SEVERITY] Dimension-Name: short problem description
**File**: `path/to/file.ts` (line N)
**Impact**: what breaks or what risk this creates
**Fix**: concrete change needed
```

Severity scale (from `.claude/rules/60-review-checklist.md`):
- **BLOCK** — data loss, security, or silent failure
- **MUST** — rule violation or correctness issue
- **SHOULD** — code quality or test gap
- **NOTE** — observation only

If no findings for a dimension: print `✓ Dimension-Name — clean`

If zero findings total: print `✓ No issues found this run` and stop.

## Step 5: Summary

Print a compact table:

```
| Dimension | Findings | Highest Severity |
|-----------|----------|-----------------|
| ...       | N        | BLOCK/MUST/...  |
```

Then: `Run /mecha-audit again for a different dimension set.`

Do not fix anything. Do not edit any files.
