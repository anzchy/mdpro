# Research: Plugin System Design

**Feature**: 003-redesign-plugin-system
**Date**: 2025-01-21

## Research Questions

### 1. How to create a unified plugin interface for CodeMirror and Milkdown?

**Decision**: Use a wrapper interface that produces editor-specific extensions

**Rationale**: CodeMirror uses `Extension` type and Milkdown uses ProseMirror plugins via `$prose()`. Rather than forcing a common abstraction, the plugin interface should:
- Accept a plugin definition with metadata (name, priority, enabled state)
- Provide factory methods that return the appropriate extension type for each editor
- Let plugins implement one or both editor integrations

**Alternatives Considered**:
1. **Single abstract class** - Rejected: Would require complex adapter patterns
2. **Separate plugin systems** - Rejected: Defeats the purpose of unification
3. **Runtime adapter** - Rejected: Adds complexity without benefit

**Reference**: VMark uses Tiptap which has a similar pattern - Extensions can provide both ProseMirror plugins and custom commands through a unified interface.

### 2. How should plugin priority/ordering work?

**Decision**: Use numeric priority with higher numbers loading first

**Rationale**:
- Simple numeric priority (e.g., 100 = high, 50 = normal, 10 = low)
- Plugins with same priority load in registration order
- Priority affects: keyboard shortcut precedence, decoration layering

**Alternatives Considered**:
1. **Dependency graph** - Rejected: Over-engineering for current scope (plugins should be independent)
2. **Alphabetical order** - Rejected: Not flexible enough
3. **String-based priorities** ("high", "normal", "low") - Rejected: Less precise than numeric

### 3. How should plugin configuration work?

**Decision**: TypeScript configuration object with plugin-specific options

**Rationale**:
- Type-safe configuration at build time
- Each plugin defines its config schema via TypeScript interface
- Global config object merges default + user overrides
- No runtime JSON parsing needed

**Configuration Structure**:
```typescript
interface PluginConfig {
  enabled: boolean;
  priority?: number;
  options?: Record<string, unknown>;
}

interface MdproPluginConfig {
  highlight: PluginConfig & { highlightColor?: string };
  heading: PluginConfig;
  link: PluginConfig;
  // ... etc
}
```

### 4. How should plugin lifecycle hooks work?

**Decision**: Minimal lifecycle with init/destroy hooks

**Rationale**:
- `init(context: EditorContext)`: Called when editor mounts, receives shared context
- `destroy()`: Called when editor unmounts, for cleanup
- No complex lifecycle (beforeMount, afterMount, etc.) - YAGNI

**Editor Context Provides**:
- CodeMirror `EditorView` reference (for CM plugins)
- Milkdown `Editor` instance (for Milkdown plugins)
- Access to Zustand stores if needed
- Command dispatch function

### 5. How to handle keyboard shortcut conflicts?

**Decision**: First registered plugin with matching shortcut wins (priority-based)

**Rationale**:
- Plugins are loaded in priority order
- CodeMirror and Milkdown both support keymap ordering
- If two plugins define same shortcut, higher priority plugin takes precedence
- Console warning logged for conflicts in development mode

**Alternative Considered**:
- **Shortcut namespacing** (e.g., `plugin:highlight:toggle`) - Rejected: Complicates UX

### 6. What happens when a plugin fails to initialize?

**Decision**: Log error, skip plugin, continue loading others

**Rationale**:
- Wrap plugin.init() in try/catch
- Log error with plugin name and stack trace
- Set plugin state to "error" in registry
- Continue loading remaining plugins
- Editor remains functional with reduced features

### 7. How to handle mode-specific plugins during mode switch?

**Decision**: Plugins declare supported modes; registry activates/deactivates appropriately

**Rationale**:
- Plugin interface includes `supportedModes: ('codemirror' | 'milkdown')[]`
- When user switches mode, registry:
  1. Calls `destroy()` on plugins that don't support new mode
  2. Calls `init()` on plugins that support new mode but were inactive
- Plugin state persists across mode switches (e.g., configuration)

## Technology Best Practices

### CodeMirror 6 Extension Patterns

- Use `ViewPlugin` for decorations that need to update on selection/document changes
- Use `StateField` for persistent state across transactions
- Use `keymap.of()` for keyboard shortcuts
- Return `Extension[]` from factory functions for composability

### Milkdown Plugin Patterns

- Use `$prose()` utility to wrap ProseMirror plugins
- Use `$useKeymap()` for keyboard shortcuts
- Use Milkdown's context system (`ctx.get()`) for accessing editor state
- Use `listener` plugin for document/selection change events

### React Integration

- Plugin registry as a singleton (created once at app startup)
- Use `useEffect` cleanup for plugin destruction
- Pass EditorView/Editor instance to registry after creation
- Avoid re-creating plugins on React re-renders

## Decisions Summary

| Question | Decision |
|----------|----------|
| Unified interface | Wrapper with editor-specific factory methods |
| Priority system | Numeric (higher = first), same priority = registration order |
| Configuration | TypeScript config object, type-safe |
| Lifecycle | Minimal: init/destroy only |
| Shortcut conflicts | Priority-based, first wins, log warning |
| Init failures | Log error, skip, continue loading |
| Mode switching | Plugins declare supported modes, registry manages activation |
