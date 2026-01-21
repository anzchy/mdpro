# Implementation Tasks: Redesign Plugin System

**Feature**: 003-redesign-plugin-system
**Generated**: 2025-01-21
**Source**: [spec.md](./spec.md) | [plan.md](./plan.md)

## Overview

Tasks organized by implementation phase and user story priority. Each task includes:
- `[P]` = Prerequisite for other tasks
- `[USx]` = Maps to User Story x from spec.md
- Dependencies listed where applicable

## Phase 1: Setup

Foundation setup before implementation begins.

- [ ] T001 [P] Create `src/plugins/` directory structure per plan.md
- [ ] T002 [P] Create `src/plugins/core/` directory for core plugin infrastructure
- [ ] T003 [P] Create `src/plugins/codemirror/` directory for CodeMirror-specific plugins
- [ ] T004 [P] Create `src/plugins/milkdown/` directory for Milkdown-specific plugins
- [ ] T005 Create `src/plugins/index.ts` barrel export file

## Phase 2: Core Plugin System (US1 - P1)

Implements the foundational plugin architecture per FR-001 through FR-015.

### Plugin Types & Interface

- [ ] T010 [P] [US1] Create `src/plugins/core/pluginTypes.ts` with `MdproPlugin` interface (FR-001)
  - Define EditorMode type: 'codemirror' | 'milkdown'
  - Define PluginState type: 'pending' | 'active' | 'inactive' | 'error'
  - Define PluginConfig interface with enabled, priority, options
  - Define EditorContext interface with editor references and utilities
  - Define MdproPlugin interface with name, displayName, supportedModes, priority, defaultConfig
  - Define codemirrorExtension and milkdownPlugin factory methods
  - Define init and destroy lifecycle hooks
  - Export createPlugin helper function
  - Include event hook types for doc/selection/focus changes (FR-008)
  - Include controlled editor APIs in EditorContext for state access/updates (FR-009)

- [ ] T024 [US1] Define event hook wiring contract in `pluginTypes.ts` (FR-008)
  - Depends on: T010
  - Specify how plugins receive editor events (callbacks or subscription helpers)

- [ ] T025 [US1] Define controlled editor API surface in `EditorContext` (FR-009)
  - Depends on: T010
  - Limit access to editor state/commands through typed helpers

### Plugin Registry

- [ ] T011 [P] [US1] Create `src/plugins/core/pluginRegistry.ts` with PluginRegistry class (FR-002)
  - Depends on: T010
  - Implement plugins Map<string, RegisteredPlugin>
  - Implement activePlugins Set<string>
  - Implement editorContext storage

- [ ] T012 [US1] Implement `register()` method in PluginRegistry (FR-002)
  - Depends on: T011
  - Validate plugin name (unique, lowercase, alphanumeric with hyphens)
  - Store plugin with pending state
  - Merge defaultConfig with configOverrides

- [ ] T013 [US1] Implement `unregister()` method in PluginRegistry
  - Depends on: T011
  - Call destroy() if plugin is active
  - Remove from plugins map and activePlugins set

- [ ] T014 [US1] Implement `initialize()` method in PluginRegistry (FR-013)
  - Depends on: T012
  - Accept EditorContext parameter
  - Sort plugins by priority (descending)
  - Call init() on enabled plugins
  - Handle initialization errors gracefully (FR-015)
  - Update plugin states to 'active' or 'error'

- [ ] T015 [US1] Implement `cleanup()` method in PluginRegistry (FR-014)
  - Depends on: T014
  - Call destroy() on all active plugins
  - Reset plugin states to 'pending'
  - Clear editorContext

- [ ] T016 [US1] Implement `getCodemirrorExtensions()` method (FR-003)
  - Depends on: T014
  - Filter plugins that support 'codemirror' mode
  - Filter enabled plugins only
  - Call codemirrorExtension factory with resolved config
  - Return flattened Extension array

- [ ] T017 [US1] Implement `getMilkdownPlugins()` method (FR-003)
  - Depends on: T014
  - Filter plugins that support 'milkdown' mode
  - Filter enabled plugins only
  - Call milkdownPlugin factory with resolved config
  - Return MilkdownPlugin array

- [ ] T018 [US1] Implement `onModeChange()` method for mode switching (FR-003)
  - Depends on: T014, T015
  - Handle graceful plugin activation/deactivation on mode switch
  - Plugins not supporting new mode should be set to 'inactive'

- [ ] T019 [US1] Implement priority-based loading order (FR-004)
  - Depends on: T014
  - Sort by priority descending (higher = loads first)
  - Same priority: registration order
  - Log loading order in development mode

- [ ] T026 [US1] Handle missing plugin entries referenced by config (Edge Case)
  - Depends on: T020
  - If config references an unregistered plugin, log a clear error and continue

### Plugin Configuration

- [ ] T020 [P] [US2] Create `src/plugins/core/pluginConfig.ts` with default configuration (FR-010, FR-012)
  - Define MdproPluginConfig interface
  - Define default config for all plugins (enabled: true by default)
  - Export configuration object

- [ ] T021 [US2] Implement `isPluginActive()` method in PluginRegistry
  - Depends on: T014
  - Check if plugin exists, is enabled, and state is 'active'

- [ ] T022 [US2] Implement `setPluginEnabled()` method (FR-010)
  - Depends on: T020, T014
  - Enable/disable plugin at runtime
  - Trigger re-initialization if needed

- [ ] T023 [US2] Implement `updatePluginConfig()` method (FR-011)
  - Depends on: T020
  - Merge new config with existing
  - Optionally trigger plugin reload

## Phase 3: Migrate Existing Features (US3 - P1)

Migrate scattered features to plugin architecture per FR-016 through FR-021.

> **Note**: FR-005 (keyboard shortcuts) and FR-006 (editor commands) are satisfied implicitly through the migration tasks below. Each migrated plugin demonstrates these capabilities via `keymap.of()` (CodeMirror) or `$useKeymap()` (Milkdown).

### Highlight Plugin (CodeMirror)

- [ ] T030 [US3] Create `src/plugins/codemirror/highlightPlugin.ts` (FR-016)
  - Depends on: T010, T016
  - Migrate logic from `src/components/Editor/extensions/highlight.ts`
  - Implement MdproPlugin interface
  - supportedModes: ['codemirror']
  - Provide codemirrorExtension factory returning keymap
  - Keyboard shortcut: Cmd+Shift+H
  - Verify: Selected text wrapped with `==text==` markup

- [ ] T031 [US3] Register highlightPlugin in `src/plugins/index.ts`
  - Depends on: T030
  - Import and register with pluginRegistry

### Heading Plugin (CodeMirror)

- [ ] T032 [US3] Create `src/plugins/codemirror/headingPlugin.ts` (FR-017)
  - Depends on: T010, T016
  - Migrate logic from `src/components/Editor/extensions/heading.ts`
  - Implement MdproPlugin interface
  - supportedModes: ['codemirror']
  - Keyboard shortcuts: Cmd+1 through Cmd+6
  - Verify: Line becomes corresponding heading level

- [ ] T033 [US3] Register headingPlugin in `src/plugins/index.ts`
  - Depends on: T032

### Link Plugin (CodeMirror)

- [ ] T034 [US3] Create `src/plugins/codemirror/linkPlugin.ts` (FR-018)
  - Depends on: T010, T016
  - Migrate logic from `src/components/Editor/extensions/link.ts`
  - Implement MdproPlugin interface
  - supportedModes: ['codemirror']
  - Keyboard shortcut: Cmd+K
  - Verify: Selected text wrapped with link markup

- [ ] T035 [US3] Register linkPlugin in `src/plugins/index.ts`
  - Depends on: T034

### WYSIWYG Decorations Plugin (CodeMirror)

- [ ] T036 [US3] Create `src/plugins/codemirror/wysiwygDecorationsPlugin.ts` (FR-019)
  - Depends on: T010, T016
  - Migrate logic from `src/components/Editor/extensions/wysiwyg.ts`
  - Migrate widget code from `src/components/Editor/extensions/widgets.ts`
  - Implement MdproPlugin interface
  - supportedModes: ['codemirror']
  - Provide ViewPlugin with decorations
  - Verify: Markdown syntax visually hidden in source mode

- [ ] T037 [US3] Register wysiwygDecorationsPlugin in `src/plugins/index.ts`
  - Depends on: T036

### Inline Edit Plugin (Milkdown)

- [ ] T038 [US3] Refactor `src/components/Editor/plugins/inlineEditPlugin.ts` to plugin system (FR-020)
  - Depends on: T010, T017
  - Move to `src/plugins/milkdown/inlineEditPlugin.ts`
  - Wrap with MdproPlugin interface
  - supportedModes: ['milkdown']
  - Provide milkdownPlugin factory
  - Verify: Typora-style inline editing works in WYSIWYG mode

- [ ] T039 [US3] Register inlineEditPlugin in `src/plugins/index.ts`
  - Depends on: T038

### Typora Keymap Plugin (Milkdown)

- [ ] T040 [US3] Extract Typora keymap from `useMilkdown.ts` to plugin
  - Depends on: T010, T017
  - Create `src/plugins/milkdown/typoraKeymapPlugin.ts`
  - Implement MdproPlugin interface
  - supportedModes: ['milkdown']
  - Extract keyboard shortcuts from useMilkdown.ts
  - Verify: All WYSIWYG keyboard shortcuts work

- [ ] T041 [US3] Register typoraKeymapPlugin in `src/plugins/index.ts`
  - Depends on: T040

## Phase 4: Editor Integration

Connect plugin system to existing editor components.

### CodeMirror Integration

- [ ] T050 Update `src/components/Editor/Editor.tsx` to use plugin registry
  - Depends on: T016, T031, T033, T035, T037
  - Import pluginRegistry
  - Call getCodemirrorExtensions() when building extensions
  - Call initialize() with EditorContext on mount
  - Call cleanup() on unmount
  - Verify: All CodeMirror plugins work

### Milkdown Integration

- [ ] T051 Update `src/hooks/useMilkdown.ts` to use plugin registry
  - Depends on: T017, T039, T041
  - Import pluginRegistry
  - Call getMilkdownPlugins() when configuring editor
  - Call initialize() with EditorContext on mount
  - Call cleanup() on unmount
  - Remove hardcoded inlineEditPlugin usage
  - Verify: All Milkdown plugins work

- [ ] T052 Update `src/components/Editor/MilkdownEditor.tsx` to use plugin registry
  - Depends on: T051
  - Ensure plugin lifecycle hooks are called
  - Verify: Mode switching works correctly

- [ ] T053 Wire editor events into `EditorContext` (FR-008)
  - Depends on: T024, T050, T051
  - Emit document change, selection change, and focus events for plugins

## Phase 5: Configuration System (US2 - P2)

Complete the plugin configuration capabilities.

- [ ] T060 [US2] Add plugin-specific options to pluginConfig.ts
  - Depends on: T020, T030-T041
  - Define options for each migrated plugin
  - Example: highlightPlugin { highlightSyntax: '==' }
  - Example: wysiwygDecorationsPlugin { hideHeaders: true }

- [ ] T061 [US2] Implement configuration validation
  - Depends on: T060
  - Validate required fields
  - Log warnings for invalid config
  - Fall back to defaults gracefully (FR-015)

- [ ] T062 [US2] Test plugin enable/disable functionality
  - Depends on: T022, T050, T051
  - Verify: Disabled plugin features not available
  - Verify: Other plugins unaffected

- [ ] T063 [US2] Validate config references to missing plugins
  - Depends on: T026
  - Verify: Missing plugin names produce clear errors and do not block other plugins

## Phase 6: Documentation & Examples (US4 - P3)

Establish patterns for future development per SC-005.

- [ ] T070 [US4] Create developer documentation in `specs/003-redesign-plugin-system/quickstart.md`
  - Already created in plan phase, review and update if needed
  - Include plugin creation patterns
  - Include configuration examples
  - Include lifecycle management

- [ ] T071 [US4] Create example Focus Mode plugin
  - Depends on: T010, T016
  - Create `src/plugins/codemirror/focusModePlugin.ts`
  - Implement dimming of non-focused paragraphs
  - Default enabled: false
  - Document as example plugin

- [ ] T072 [US4] Create example Typewriter Mode plugin
  - Depends on: T010, T016
  - Create `src/plugins/codemirror/typewriterModePlugin.ts`
  - Keep current line vertically centered while typing
  - Default enabled: false
  - Document as example plugin

- [ ] T073 [US4] Create example Spell Check plugin (stub)
  - Depends on: T010, T016
  - Create `src/plugins/codemirror/spellCheckPlugin.ts`
  - Provide no-op placeholder with clear TODOs for future integration
  - Default enabled: false
  - Document as example plugin

- [ ] T074 [US4] Update CLAUDE.md with plugin development guidelines
  - Document plugin directory structure
  - Document adding new plugins
  - Document testing plugins

## Phase 7: Cleanup & Validation

Final verification and cleanup.

- [ ] T080 Deprecate old extension files
  - Mark for removal after migration verified:
    - `src/components/Editor/extensions/highlight.ts`
    - `src/components/Editor/extensions/heading.ts`
    - `src/components/Editor/extensions/link.ts`
    - `src/components/Editor/extensions/wysiwyg.ts`
    - `src/components/Editor/extensions/widgets.ts`
  - Add TODO comments for future removal

- [ ] T081 Verify backward compatibility (FR-021, SC-001)
  - Test all keyboard shortcuts work as before
  - Test all visual decorations work as before
  - Test mode switching works correctly
  - Document any behavior changes

- [ ] T082 Performance verification (SC-006)
  - Measure editor startup time before and after
  - Ensure within 10% of baseline
  - Optimize if needed

- [ ] T083 Error handling verification (SC-004)
  - Test plugin initialization failure
  - Verify editor continues working
  - Verify error logging works

- [ ] T084 Verify shortcut conflict resolution (Edge Case)
  - Depends on: T019
  - Ensure priority order determines which plugin handles a conflicting keymap

## Task Summary

| Phase | Tasks | User Story | Priority |
|-------|-------|------------|----------|
| Setup | T001-T005 | - | Prerequisite |
| Core Plugin System | T010-T026 | US1, US2 | P1, P2 |
| Migrate Features | T030-T041 | US3 | P1 |
| Editor Integration | T050-T053 | US1, US3 | P1 |
| Configuration | T060-T063 | US2 | P2 |
| Documentation | T070-T074 | US4 | P3 |
| Cleanup | T080-T084 | - | Final |

**Total Tasks**: 49
**Critical Path**: T001 → T010 → T011 → T014 → T016/T017 → T030-T041 → T050-T052

## Dependencies Graph

```
T001-T005 (Setup)
    │
    ▼
T010 (pluginTypes.ts) ◄─────────────┐
    │                               │
    ▼                               │
T011 (pluginRegistry.ts)            │
    │                               │
    ├──► T012-T019 (Registry methods)
    │                               │
    └──► T020 (pluginConfig.ts)     │
         │                          │
         ▼                          │
    T021-T023 (Config methods)      │
                                    │
T030-T041 (Migrate plugins) ────────┘
    │
    ▼
T050-T052 (Editor integration)
    │
    ▼
T060-T062 (Configuration)
    │
    ▼
T070-T072 (Documentation)
    │
    ▼
T080-T083 (Cleanup)
```
