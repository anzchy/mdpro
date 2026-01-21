# Quickstart: Creating an mdpro Plugin

**Feature**: 003-redesign-plugin-system
**Date**: 2025-01-21

## Overview

This guide shows how to create a new plugin for mdpro's editor. Plugins can extend either CodeMirror (source mode), Milkdown (WYSIWYG mode), or both.

## Plugin Structure

Every plugin must:
1. Implement the `MdproPlugin` interface
2. Be registered with the plugin registry
3. Provide at least one of: `codemirrorExtension` or `milkdownPlugin`

## Example: Creating a "Focus Mode" Plugin

### Step 1: Create the Plugin File

Create `src/plugins/codemirror/focusModePlugin.ts`:

```typescript
import { createPlugin, type PluginConfig, type EditorContext } from "../core/pluginTypes";
import { ViewPlugin, Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// Define plugin-specific config
interface FocusModeConfig extends PluginConfig {
  options: {
    /** Opacity for non-focused paragraphs (0-1) */
    dimOpacity: number;
  };
}

// Create the CodeMirror ViewPlugin
const focusModeViewPlugin = (config: FocusModeConfig) => {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean }) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const cursorLine = view.state.doc.lineAt(view.state.selection.main.head);

        // Dim all lines except the cursor line
        for (let i = 1; i <= view.state.doc.lines; i++) {
          const line = view.state.doc.line(i);
          if (line.number !== cursorLine.number) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                attributes: {
                  style: `opacity: ${config.options.dimOpacity}`,
                },
              })
            );
          }
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
};

// Export the plugin definition
export const focusModePlugin = createPlugin<FocusModeConfig>({
  name: "focus-mode",
  displayName: "Focus Mode",
  supportedModes: ["codemirror"], // Only CodeMirror for this example
  priority: 30, // Lower priority (decorations)
  defaultConfig: {
    enabled: false, // Disabled by default
    options: {
      dimOpacity: 0.3,
    },
  },
  codemirrorExtension: (config) => focusModeViewPlugin(config),
});
```

### Step 2: Register the Plugin

Add to `src/plugins/index.ts`:

```typescript
import { pluginRegistry } from "./core/pluginRegistry";
import { focusModePlugin } from "./codemirror/focusModePlugin";

// Register the plugin
pluginRegistry.register(focusModePlugin);

// Or with config overrides:
pluginRegistry.register(focusModePlugin, {
  enabled: true,
  options: { dimOpacity: 0.4 },
});
```

### Step 3: Enable via Configuration

In `src/plugins/core/pluginConfig.ts`:

```typescript
export const defaultPluginConfig: MdproPluginConfig = {
  // ... other plugins
  "focus-mode": {
    enabled: true, // Enable the plugin
    options: {
      dimOpacity: 0.3,
    },
  },
};
```

## Plugin Types

### CodeMirror-Only Plugin

For plugins that only work in source mode:

```typescript
export const myPlugin = createPlugin({
  name: "my-codemirror-plugin",
  displayName: "My Plugin",
  supportedModes: ["codemirror"],
  priority: 50,
  defaultConfig: { enabled: true },
  codemirrorExtension: (config) => {
    // Return CodeMirror Extension or Extension[]
    return keymap.of([
      { key: "Mod-Shift-x", run: myCommand },
    ]);
  },
});
```

### Milkdown-Only Plugin

For plugins that only work in WYSIWYG mode:

```typescript
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

export const myPlugin = createPlugin({
  name: "my-milkdown-plugin",
  displayName: "My Plugin",
  supportedModes: ["milkdown"],
  priority: 50,
  defaultConfig: { enabled: true },
  milkdownPlugin: (config) => {
    return $prose(() => new Plugin({
      key: new PluginKey("my-plugin"),
      // ... plugin implementation
    }));
  },
});
```

### Dual-Mode Plugin

For plugins that work in both modes:

```typescript
export const myPlugin = createPlugin({
  name: "my-dual-plugin",
  displayName: "My Plugin",
  supportedModes: ["codemirror", "milkdown"],
  priority: 50,
  defaultConfig: { enabled: true },
  codemirrorExtension: (config) => {
    // CodeMirror implementation
  },
  milkdownPlugin: (config) => {
    // Milkdown implementation
  },
});
```

## Common Patterns

### Adding Keyboard Shortcuts

**CodeMirror:**
```typescript
import { keymap } from "@codemirror/view";

codemirrorExtension: (config) => {
  return keymap.of([
    { key: "Mod-Shift-h", run: highlightCommand },
  ]);
},
```

**Milkdown:**
```typescript
import { $useKeymap } from "@milkdown/kit/utils";

milkdownPlugin: (config) => {
  return $useKeymap("my-keymap", {
    highlight: {
      shortcuts: "Mod-Shift-h",
      command: (ctx) => {
        // command implementation
      },
    },
  });
},
```

### Adding Decorations

**CodeMirror:**
```typescript
import { ViewPlugin, Decoration } from "@codemirror/view";

codemirrorExtension: (config) => {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      // ... update decorations on doc/selection change
    },
    { decorations: (v) => v.decorations }
  );
},
```

**Milkdown:**
```typescript
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

milkdownPlugin: (config) => {
  return $prose(() => new Plugin({
    props: {
      decorations(state) {
        // return DecorationSet
      },
    },
  }));
},
```

### Lifecycle Hooks

```typescript
export const myPlugin = createPlugin({
  // ...
  init: (context, config) => {
    console.log(`Plugin initialized in ${context.currentMode} mode`);
    // Setup event listeners, etc.
  },
  destroy: () => {
    console.log("Plugin destroyed");
    // Cleanup event listeners, etc.
  },
});
```

## Testing Your Plugin

1. **Enable the plugin** in configuration
2. **Start the dev server**: `pnpm tauri dev`
3. **Verify functionality** in the appropriate editor mode
4. **Check console** for any errors during plugin initialization
5. **Test disable/enable** by toggling the config

## Checklist

- [ ] Plugin has unique `name` (lowercase, alphanumeric, hyphens)
- [ ] Plugin has descriptive `displayName`
- [ ] `supportedModes` matches implemented factories
- [ ] `defaultConfig` includes all required options
- [ ] Plugin is registered in `src/plugins/index.ts`
- [ ] Plugin handles errors gracefully (doesn't crash editor)
- [ ] Keyboard shortcuts don't conflict with existing plugins
