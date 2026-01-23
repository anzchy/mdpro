# Feature Specification: Redesign Plugin System

**Feature Branch**: `003-redesign-plugin-system`
**Created**: 2025-01-21
**Status**: Draft
**Input**: User description: "我也希望尽可能把很多功能都以plugins或者extensions的模式实现，看看要对当前代码进行怎样的重构，列出开发思路"

## Overview

Redesign mdpro's architecture to use a modular plugin/extension system for all editor features. Currently, mdpro has scattered extensions for CodeMirror and minimal Milkdown plugins, with functionality tightly coupled to the core application. This refactoring will establish a unified plugin architecture that:

1. **Standardizes** how features are implemented across both CodeMirror (source mode) and Milkdown (WYSIWYG mode)
2. **Decouples** features from core application code
3. **Enables** easy addition, removal, and configuration of features
4. **Aligns** with industry patterns (similar to VSCode extensions, Tiptap/VMark plugins)

### Current State Analysis

**CodeMirror Extensions (Source Mode)**:
- `markdownExtension` - markdown language support
- `syntaxHighlightingExtension` - syntax highlighting
- `wysiwygExtension` - visual decorations (heading, list, quote widgets)
- `highlight.ts` - highlight selection command
- `heading.ts` - heading level commands
- `link.ts` - link insertion command

**Milkdown Plugins (WYSIWYG Mode)**:
- Built-in: `commonmark`, `history`, `listener`
- Custom: `inlineEditPlugin` (Typora-style inline editing)

**Problems with Current Architecture**:
- No unified plugin interface across editor modes
- Features scattered across different files without consistent patterns
- Hard to enable/disable specific features
- No plugin configuration system
- Tight coupling between features and core code

## Visual Design

- **Site Diagram**: [site-diagram.html](./diagrams/site-diagram.html) - 应用架构和数据流图

*Note: This is primarily an architectural refactoring with no UI changes, so wireframe and user-flow diagrams are not applicable.*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Adds New Editor Feature (Priority: P1)

As a developer, I want to add a new editor feature (e.g., spell checking, focus mode) by creating a self-contained plugin file, without modifying core editor code.

**Why this priority**: This is the core value proposition - making the codebase extensible and maintainable.

**Independent Test**: Developer can create a new plugin file following the documented pattern, register it, and see it working in the editor without touching existing code.

**Acceptance Scenarios**:

1. **Given** the plugin system is implemented, **When** a developer creates a new plugin following the standard interface, **Then** the plugin can be loaded and activated without modifying core files
2. **Given** a plugin is registered, **When** the editor initializes, **Then** the plugin's functionality is available in the appropriate editor mode(s)
3. **Given** a plugin has both CodeMirror and Milkdown implementations, **When** user switches between Source and WYSIWYG modes, **Then** the feature works consistently in both modes

---

### User Story 2 - Developer Configures Plugin Behavior (Priority: P2)

As a developer, I want to configure plugin options (enable/disable, customize behavior) through a centralized configuration, without editing plugin source code.

**Why this priority**: Configuration flexibility is important for customization but depends on the core plugin system being in place.

**Independent Test**: Developer can modify a configuration file to disable a plugin and verify the feature is no longer available in the editor.

**Acceptance Scenarios**:

1. **Given** a plugin is disabled in configuration, **When** the editor loads, **Then** the plugin's features are not available
2. **Given** a plugin has customizable options, **When** options are changed in configuration, **Then** the plugin behavior reflects the new settings
3. **Given** an invalid plugin configuration, **When** the editor loads, **Then** a helpful error message is shown and other plugins still work

---

### User Story 3 - Migrate Existing Features to Plugins (Priority: P1)

As a developer, I want to refactor existing scattered features (highlight, heading, link, wysiwyg decorations) into the new plugin architecture to establish consistency.

**Why this priority**: Migration of existing code proves the architecture works and provides reference implementations.

**Independent Test**: Each migrated feature continues to work exactly as before, but now lives in a standardized plugin structure.

**Acceptance Scenarios**:

1. **Given** the highlight command exists as a plugin, **When** user presses Cmd+Shift+H, **Then** selected text is wrapped with highlight markup (same as current behavior)
2. **Given** the heading plugin exists, **When** user presses Cmd+1 through Cmd+6, **Then** the line becomes the corresponding heading level
3. **Given** the WYSIWYG decorations plugin exists, **When** user is in source mode with WYSIWYG enabled, **Then** markdown syntax is visually hidden (same as current behavior)

---

### User Story 4 - Add Future Features as Plugins (Priority: P3)

As a developer, I want a clear pattern for implementing future features (focus mode, typewriter mode, spell check, math, mermaid) as plugins.

**Why this priority**: Future extensibility is valuable but depends on the core system and migration being complete.

**Independent Test**: Sample plugins (focus mode, typewriter mode, spell check stub) can be implemented following the documented pattern and work correctly.

**Acceptance Scenarios**:

1. **Given** the plugin architecture documentation exists, **When** a developer follows it to create a focus mode plugin, **Then** the plugin dims non-focused paragraphs correctly
2. **Given** multiple feature plugins are enabled, **When** the editor runs, **Then** all plugins coexist without conflicts
3. **Given** a typewriter mode plugin exists, **When** enabled, **Then** the current line remains vertically centered while typing
4. **Given** a spell check plugin stub exists, **When** enabled, **Then** it loads without errors and documents TODO integration points

---

### Edge Cases

- What happens when a plugin fails to initialize?
  - The plugin state is set to "error" with the caught Error object stored
  - Console.error logs: `[mdpro] Plugin "${name}" failed to initialize: ${error.message}`
  - Other plugins continue loading normally
  - No user-facing notification (errors are developer-facing only)
- What happens when two plugins conflict (e.g., both try to handle the same keyboard shortcut)? Plugin priority/order should determine precedence.
- What happens when a plugin is configured but its file is missing? Clear error message should be shown.
- What happens during mode switch (Source ↔ WYSIWYG) with plugins that only support one mode? The plugin should gracefully do nothing in unsupported modes.

## Requirements *(mandatory)*

### Functional Requirements

**Plugin Interface & Registration**

- **FR-001**: System MUST define a standard plugin interface that works for both CodeMirror and Milkdown plugins
- **FR-002**: System MUST provide a plugin registry where plugins are registered by name
- **FR-003**: System MUST support plugins that target: CodeMirror only, Milkdown only, or both editors
- **FR-004**: System MUST load plugins in a defined order with configurable priority

**Plugin Capabilities**

- **FR-005**: Plugins MUST be able to add keyboard shortcuts
- **FR-006**: Plugins MUST be able to add editor commands (callable from menu/toolbar)
- **FR-007**: Plugins MUST be able to add decorations/widgets to the editor (CodeMirror ViewPlugin, Milkdown Decoration)
- **FR-008**: Plugins MUST be able to listen to editor events (document change, selection change, focus)
- **FR-009**: Plugins MUST be able to access and modify editor state through a controlled API

**Plugin Configuration**

- **FR-010**: System MUST allow plugins to be enabled/disabled via configuration
- **FR-011**: System MUST allow plugins to define their own configuration options
- **FR-012**: System MUST provide default configurations that can be overridden

**Plugin Lifecycle**

- **FR-013**: System MUST call plugin initialization when editor mounts
- **FR-014**: System MUST call plugin cleanup when editor unmounts
- **FR-015**: System MUST handle plugin initialization errors gracefully without crashing the editor

**Migration Requirements**

- **FR-016**: Existing highlight command MUST be migrated to a plugin
- **FR-017**: Existing heading commands MUST be migrated to a plugin
- **FR-018**: Existing link command MUST be migrated to a plugin
- **FR-019**: Existing WYSIWYG decorations (heading/list/quote/code widgets) MUST be migrated to a plugin
- **FR-020**: Existing Milkdown inlineEditPlugin MUST be integrated into the plugin system
- **FR-021**: All migrated plugins MUST maintain backward compatibility with current behavior

### Key Entities

- **Plugin**: A self-contained feature module with defined interface, configuration, and lifecycle hooks
- **Plugin Registry**: Central store managing all registered plugins and their state
- **Plugin Configuration**: Settings that control plugin behavior and enabled/disabled state
- **Editor Context**: Shared context providing access to editor views, state, and commands

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All existing editor features (highlight, heading, link, WYSIWYG decorations, inline edit) work identically after migration to plugin architecture
- **SC-002**: A new plugin can be added to the system by creating a single file and adding one line to the plugin registry
- **SC-003**: Disabling a plugin removes its functionality without affecting other features
- **SC-004**: Plugin initialization errors do not crash the editor; other plugins continue to work
- **SC-005**: Developer documentation exists with at least 3 example plugins covering different use cases
- **SC-006**: No regression in editor startup time (within 10% of current performance)

## Assumptions

- Milkdown's `$prose()` utility will continue to be the primary way to create ProseMirror plugins
- CodeMirror's Extension system will remain the primary way to add functionality to source mode
- The plugin system is internal (developer-facing) and does not require end-user plugin management UI
- Plugin configuration will be stored in code (TypeScript config file) rather than user-editable settings file

## Out of Scope

- End-user plugin marketplace or installation UI
- Runtime plugin loading (hot-reload)
- Plugin sandboxing or security isolation
- Cross-plugin communication/dependencies (plugins should be independent)
- Persistent plugin state (plugins can use existing Zustand stores if needed)

## Refactoring Approach

### Phase 1: Define Plugin Architecture

1. Design the unified plugin interface that supports both CodeMirror and Milkdown
2. Create the plugin registry with lifecycle management
3. Implement plugin configuration system

### Phase 2: Migrate Existing Features

1. Migrate CodeMirror extensions to plugins:
   - `highlightPlugin` (from `highlight.ts`)
   - `headingPlugin` (from `heading.ts`)
   - `linkPlugin` (from `link.ts`)
   - `wysiwygDecorationsPlugin` (from `wysiwyg.ts`, `widgets.ts`)

2. Integrate Milkdown plugins:
   - `inlineEditPlugin` (already exists, needs registry integration)
   - `typoraKeymapPlugin` (from `useMilkdown.ts` keymap)

### Phase 3: Establish Patterns

1. Document plugin development patterns
2. Create example plugins for future features (focus mode, typewriter mode, spell check stub)
3. Update CLAUDE.md with plugin development guidelines

### Proposed Directory Structure

```
src/
├── plugins/
│   ├── core/
│   │   ├── pluginRegistry.ts      # Central plugin management
│   │   ├── pluginTypes.ts         # TypeScript interfaces
│   │   └── pluginConfig.ts        # Default configuration
│   ├── codemirror/
│   │   ├── highlightPlugin.ts
│   │   ├── headingPlugin.ts
│   │   ├── linkPlugin.ts
│   │   └── wysiwygDecorationsPlugin.ts
│   │   ├── focusModePlugin.ts
│   │   ├── typewriterModePlugin.ts
│   │   └── spellCheckPlugin.ts
│   ├── milkdown/
│   │   ├── inlineEditPlugin.ts    # (moved from components/Editor/plugins/)
│   │   └── typoraKeymapPlugin.ts
├── components/
│   └── Editor/
│       ├── Editor.tsx             # Uses plugin registry
│       └── MilkdownEditor.tsx     # Uses plugin registry
```
