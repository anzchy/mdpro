# Implementation Plan: Redesign Plugin System

**Branch**: `003-redesign-plugin-system` | **Date**: 2025-01-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-redesign-plugin-system/spec.md`

## Summary

Refactor mdpro's editor architecture to use a unified plugin system that standardizes feature implementation across both CodeMirror (source mode) and Milkdown (WYSIWYG mode). The approach involves:

1. Creating a plugin interface that abstracts over CodeMirror Extensions and Milkdown/ProseMirror plugins
2. Building a central plugin registry with lifecycle management, event hooks, and controlled editor APIs
3. Migrating existing scattered features (highlight, heading, link, wysiwyg decorations, inline edit) to the new plugin architecture
4. Establishing patterns and documentation for future plugin development, including example plugins (focus mode, typewriter mode, spell check stub)

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend - unchanged)
**Primary Dependencies**: React 19, Tauri 2.0, CodeMirror 6 (@codemirror/*), Milkdown 7.18 (@milkdown/kit, @milkdown/react), Zustand 4
**Storage**: N/A (no new storage requirements)
**Testing**: Manual testing (existing project has no test framework configured)
**Target Platform**: macOS 13+ (Apple Silicon), Tauri desktop app
**Project Type**: Single desktop application with React frontend
**Performance Goals**: No regression in editor startup time (within 10% of current baseline per SC-006)
**Constraints**: Must maintain backward compatibility with all existing keyboard shortcuts and behaviors
**Scale/Scope**: ~6 plugins to migrate, plugin registry managing 10-20 plugins max

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution is not yet customized (template placeholders present). Proceeding with standard development practices:

- [x] **Simplicity**: Start with minimal plugin interface, avoid over-abstraction
- [x] **Backward Compatibility**: All migrated features must work identically
- [x] **No Breaking Changes**: Existing keyboard shortcuts preserved
- [x] **Testable**: Each plugin can be enabled/disabled independently for testing

**Gate Status**: PASS (no constitution violations)

## Project Structure

### Documentation (this feature)

```text
specs/003-redesign-plugin-system/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (TypeScript interfaces)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── plugins/
│   ├── core/
│   │   ├── pluginTypes.ts         # MdproPlugin interface & types
│   │   ├── pluginRegistry.ts      # Central registry with lifecycle
│   │   └── pluginConfig.ts        # Default configuration
│   ├── codemirror/
│   │   ├── highlightPlugin.ts     # Migrated from extensions/highlight.ts
│   │   ├── headingPlugin.ts       # Migrated from extensions/heading.ts
│   │   ├── linkPlugin.ts          # Migrated from extensions/link.ts
│   │   └── wysiwygDecorationsPlugin.ts  # Migrated from extensions/wysiwyg.ts
│   │   ├── focusModePlugin.ts     # Example plugin
│   │   ├── typewriterModePlugin.ts # Example plugin
│   │   └── spellCheckPlugin.ts    # Example plugin stub
│   ├── milkdown/
│   │   ├── inlineEditPlugin.ts    # Moved from components/Editor/plugins/
│   │   └── typoraKeymapPlugin.ts  # Extracted from useMilkdown.ts
│   └── index.ts                   # All plugins export
├── components/
│   └── Editor/
│       ├── Editor.tsx             # Updated to use plugin registry
│       ├── MilkdownEditor.tsx     # Updated to use plugin registry
│       └── extensions/            # To be deprecated after migration
└── hooks/
    └── useMilkdown.ts             # Updated to use plugin registry

# Files to be deprecated/removed after migration:
# - src/components/Editor/extensions/highlight.ts
# - src/components/Editor/extensions/heading.ts
# - src/components/Editor/extensions/link.ts
# - src/components/Editor/extensions/wysiwyg.ts
# - src/components/Editor/extensions/widgets.ts
# - src/components/Editor/plugins/inlineEditPlugin.ts
```

**Structure Decision**: Single project structure maintained. New `src/plugins/` directory created alongside existing `src/components/` and `src/hooks/`. Existing extensions deprecated in place after migration completes.

## Complexity Tracking

No complexity violations identified. The plugin system adds a thin abstraction layer without introducing unnecessary complexity:

- Single plugin interface (not separate interfaces per editor type)
- Configuration via TypeScript (not runtime/JSON)
- No cross-plugin dependencies
- No dynamic loading
