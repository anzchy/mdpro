# Data Model: Plugin System

**Feature**: 003-redesign-plugin-system
**Date**: 2025-01-21

## Entities

### Plugin

A self-contained feature module that extends editor functionality.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier (e.g., "highlight", "heading") |
| `displayName` | `string` | Human-readable name for logging/debugging |
| `supportedModes` | `EditorMode[]` | Which editor modes this plugin supports |
| `priority` | `number` | Loading order (higher = earlier, default: 50) |
| `codemirrorExtension` | `() => Extension \| Extension[]` | Factory for CodeMirror extension(s) |
| `milkdownPlugin` | `() => MilkdownPlugin` | Factory for Milkdown/ProseMirror plugin |
| `init` | `(ctx: EditorContext) => void` | Lifecycle hook called on editor mount |
| `destroy` | `() => void` | Lifecycle hook called on editor unmount |
| `defaultConfig` | `PluginConfig` | Default configuration for this plugin |

### PluginRegistry

Central store managing all registered plugins and their runtime state.

| Field | Type | Description |
|-------|------|-------------|
| `plugins` | `Map<string, RegisteredPlugin>` | All registered plugins by name |
| `activePlugins` | `Set<string>` | Currently active plugin names |
| `config` | `MdproPluginConfig` | Merged configuration (defaults + overrides) |
| `editorContext` | `EditorContext \| null` | Shared context once editor mounts |

### RegisteredPlugin

Runtime state for a single plugin.

| Field | Type | Description |
|-------|------|-------------|
| `plugin` | `MdproPlugin` | The plugin definition |
| `state` | `PluginState` | Current state: "pending" \| "active" \| "inactive" \| "error" |
| `error` | `Error \| null` | Error if initialization failed |
| `configOverrides` | `Partial<PluginConfig>` | User config overrides for this plugin |

### PluginConfig

Configuration for a single plugin.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Whether plugin is enabled (default: true) |
| `priority` | `number \| undefined` | Override default priority |
| `options` | `Record<string, unknown>` | Plugin-specific options |

### EditorContext

Shared context providing access to editor state and utilities.

| Field | Type | Description |
|-------|------|-------------|
| `codemirrorView` | `EditorView \| null` | CodeMirror editor view |
| `milkdownEditor` | `Editor \| null` | Milkdown editor instance |
| `currentMode` | `EditorMode` | Current active mode |
| `dispatchCommand` | `(cmd: string, args?: unknown) => void` | Execute a registered command |
| `getStore` | `<T>(store: StoreApi<T>) => T` | Access Zustand stores |

## Enums

### EditorMode

```typescript
type EditorMode = 'codemirror' | 'milkdown';
```

### PluginState

```typescript
type PluginState = 'pending' | 'active' | 'inactive' | 'error';
```

## Relationships

```
┌─────────────────┐
│ PluginRegistry  │
│                 │
│ plugins ────────┼──► Map<string, RegisteredPlugin>
│ activePlugins   │
│ config          │
│ editorContext ──┼──► EditorContext
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ RegisteredPlugin│
│                 │
│ plugin ─────────┼──► MdproPlugin
│ state           │
│ error           │
│ configOverrides │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  MdproPlugin    │
│                 │
│ name            │
│ supportedModes  │
│ priority        │
│ codemirrorExt   │
│ milkdownPlugin  │
│ init/destroy    │
│ defaultConfig   │
└─────────────────┘
```

## State Transitions

### Plugin Lifecycle

```
                    register()
    ┌─────────────────────────────────┐
    │                                 │
    ▼                                 │
┌─────────┐  editorMount()  ┌────────┐│  editorUnmount()  ┌──────────┐
│ pending │ ───────────────►│ active │├─────────────────►│ inactive │
└─────────┘                 └────────┘│                   └──────────┘
    │                           │     │                        │
    │                           │     │                        │
    │      init() throws        │     │    modeSwitch()        │
    │           │               │     │         │              │
    │           ▼               │     │         ▼              │
    │       ┌───────┐           │     │   (re-init if          │
    └──────►│ error │◄──────────┘     │   mode supported)      │
            └───────┘                 │         │              │
                                      │         ▼              │
                                      │    ┌────────┐          │
                                      └───►│ active │◄─────────┘
                                           └────────┘
```

## Validation Rules

1. **Plugin Name**: Must be unique, lowercase, alphanumeric with hyphens only
2. **Priority**: Must be positive integer (0-100 recommended)
3. **Supported Modes**: Must include at least one mode
4. **Extension Factory**: Must return valid Extension or throw (not return null)
